import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,start,record,finish} from '../dist/data.js';
import {HEALTH_KEY} from '../dist/health.js';
import {EXERCISE_META_KEY,ExerciseMetaRepository,getExerciseLoadType} from '../dist/exercise-meta.js';
import {Storage,createAppHarness} from './helpers/app-harness.mjs';

const now=Date.parse('2026-11-01T12:00:00+08:00');
function fixture(){
 const training=initial();training.plans[0].exercises=[exercise('引体向上',68),exercise('龙悬',68),exercise('器械卧推',40)];
 start(training,training.plans[0].id);record(training,training.active.movements[0].id,8,68);record(training,training.active.movements[1].id,9,68);record(training,training.active.movements[1].id,7,73);finish(training);
 const session=training.history[0];session.started=now-40*86400000;session.ended=session.started+3600000;for(const movement of session.movements)for(const set of movement.sets)set.date=session.started+600000;
 start(training,training.plans[0].id);record(training,training.active.movements[0].id,10,68);finish(training);
 const recent=training.history[0];recent.started=now-86400000;recent.ended=recent.started+3600000;for(const movement of recent.movements)for(const set of movement.sets)set.date=recent.started+600000;
 return training;
}
const jsonFile=data=>({name:'synthetic-only.json',size:Buffer.byteLength(JSON.stringify(data)),text:async()=>JSON.stringify(data)});
const importButton=(app,name)=>{app.run("$('#health-import-file').click=()=>{}");app.action(name);};
function exportHarness(training,storage=new Storage()){
 const downloads=[],blobs=[];
 const app=createAppHarness(training,{storage,globals:{
  Blob:class{constructor(parts,options){this.raw=parts.join('');this.type=options?.type;}},
  URL:{createObjectURL(blob){blobs.push(blob);return 'blob:synthetic-local-only';},revokeObjectURL(){}},
  captureDownload(name){downloads.push({...blobs.at(-1),name});}
 }});
 app.run('document.createElement=()=>({click(){captureDownload(this.download)},remove(){}});document.body.append=()=>{}');
 return {app,downloads};
}

test('metadata UI changes are explicit, cancel safely and persist separately after save and reopen',()=>{
 const training=fixture(),storage=new Storage(),health=JSON.stringify({format:'rainlift-health',version:1,timeZone:'Asia/Shanghai',records:[],lastImportAt:null});storage.setItem(HEALTH_KEY,health);const app=createAppHarness(training,{storage}),original=storage.getItem(KEY);app.action('health-open');
 assert.match(app.html,/动作负重类型/);assert.match(app.html,/自重动作（可加重）/);assert.match(app.html,/三份备份分别迁移/);
 app.action('health-meta-edit',{index:'0'});app.field('loadType','assisted');assert.equal(storage.getItem(EXERCISE_META_KEY),null);app.modalAction('close');assert.equal(app.modalOpen,false);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
 app.action('health-meta-edit',{index:'0'});app.submit({loadType:'assisted'});assert.equal(app.modalOpen,false);assert.match(app.toast,/已保存/);assert.equal(storage.getItem(KEY),original);assert.equal(storage.getItem(HEALTH_KEY),health);
 const reopened=createAppHarness(null,{storage});reopened.action('health-open');assert.match(reopened.html,/辅助负重/);assert.equal(getExerciseLoadType(training,training.plans[0].exercises[0],JSON.parse(storage.getItem(EXERCISE_META_KEY))),'assisted');
});

test('metadata save quota failure retains dialog and does not claim success or change any data',()=>{
 const training=fixture(),storage=new Storage(),app=createAppHarness(training,{storage}),original=storage.getItem(KEY);app.action('health-open');app.action('health-meta-edit',{index:'0'});
 storage.fail=true;app.submit({loadType:'external'});assert.equal(app.modalOpen,true);assert.match(app.toast,/未保存/);assert.equal(storage.getItem(EXERCISE_META_KEY),null);assert.equal(storage.getItem(KEY),original);assert.equal(storage.getItem(HEALTH_KEY),null);
 storage.fail=false;app.submit({loadType:'external'});assert.equal(app.modalOpen,false);assert.match(app.toast,/已保存/);assert.equal(JSON.parse(storage.getItem(EXERCISE_META_KEY)).entries[0].loadType,'external');
});

test('metadata UI disables conflicted identities and refuses a forced submit without writing',()=>{
 const training=fixture(),pull=training.plans[0].exercises[0];training.plans[1].exercises.push({...pull,name:'另一器械'});const storage=new Storage(),app=createAppHarness(training,{storage});app.action('health-open');
 assert.match(app.html,/请先整理历史关联/);assert.match(app.html,/data-action="health-meta-edit" data-index="0" disabled/);
 app.action('health-meta-edit',{index:'0'});app.submit({loadType:'bodyweight'});assert.match(app.toast,/身份|归属/);assert.equal(app.modalOpen,true);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
});

test('metadata import previews and cancels, then restores only after confirmation with a prior copy',async()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage);repo.set(training,training.plans[0].exercises[0],'external');const before=storage.getItem(EXERCISE_META_KEY),app=createAppHarness(training,{storage}),train=storage.getItem(KEY);
 const source=new ExerciseMetaRepository(new Storage());source.set(training,training.plans[0].exercises[0],'assisted');const backup=source.export(now);app.action('health-open');
 importButton(app,'health-meta-import');assert.equal(await app.file('health-import-file',jsonFile(backup)),'');assert.match(app.modalHtml,/预览动作类型恢复/);assert.equal(storage.getItem(EXERCISE_META_KEY),before);app.modalAction('cancel');assert.equal(storage.getItem(EXERCISE_META_KEY),before);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),null);
 importButton(app,'health-meta-import');await app.file('health-import-file',jsonFile(backup));app.modalAction('confirm');assert.equal(app.modalOpen,false);assert.match(app.toast,/备份已恢复/);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),before);assert.equal(JSON.parse(storage.getItem(EXERCISE_META_KEY)).entries[0].loadType,'assisted');assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(HEALTH_KEY),null);
});

test('failed metadata restore keeps preview available and protects stored training and metadata',async()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage);repo.set(training,training.plans[0].exercises[0],'external');const before=storage.getItem(EXERCISE_META_KEY),backup=new ExerciseMetaRepository(new Storage()).export(now),app=createAppHarness(training,{storage}),train=storage.getItem(KEY);app.action('health-open');
 importButton(app,'health-meta-import');await app.file('health-import-file',jsonFile(backup));storage.fail=true;app.modalAction('confirm');assert.equal(app.modalOpen,true);assert.match(app.toast,/恢复失败/);assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(EXERCISE_META_KEY),before);
 storage.fail=false;app.modalAction('confirm');assert.equal(app.modalOpen,false);assert.equal(JSON.parse(storage.getItem(EXERCISE_META_KEY)).entries.length,0);
});

test('metadata dialog rejects stale tab writes and stale pending import instead of overwriting another page',async()=>{
 const training=fixture(),storage=new Storage(),app=createAppHarness(training,{storage});app.action('health-open');app.action('health-meta-edit',{index:'0'});
 new ExerciseMetaRepository(storage).set(training,training.plans[0].exercises[0],'assisted');const saved=storage.getItem(EXERCISE_META_KEY);app.submit({loadType:'external'});assert.match(app.toast,/其他页面/);assert.equal(app.modalOpen,true);assert.equal(storage.getItem(EXERCISE_META_KEY),saved);app.modalAction('close');
 importButton(app,'health-meta-import');await app.file('health-import-file',jsonFile(new ExerciseMetaRepository(new Storage()).export(now)));new ExerciseMetaRepository(storage).set(training,training.plans[0].exercises[0],'bodyweight');const latest=storage.getItem(EXERCISE_META_KEY);app.modalAction('confirm');assert.match(app.toast,/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY),latest);assert.equal(app.modalOpen,true);
});

test('metadata import and health import share a picker but maintain distinct formats and stores',async()=>{
 const training=fixture(),storage=new Storage(),app=createAppHarness(training,{storage});app.action('health-open');const metadata=new ExerciseMetaRepository(new Storage()).export(now);
 importButton(app,'health-meta-import');await app.file('health-import-file',jsonFile({...metadata,version:99}));assert.match(app.toast,/导入失败/);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
 importButton(app,'health-import');await app.file('health-import-file',jsonFile(metadata));assert.match(app.toast,/健康数据操作失败/);assert.equal(storage.getItem(HEALTH_KEY),null);
 const health={format:'rainlift-health',version:1,timeZone:'Asia/Shanghai',exportedAt:'2026-11-01T12:00:00+08:00',records:[]};await app.file('health-import-file',jsonFile(health));assert.match(app.modalHtml,/预览健康数据导入/);app.modalAction('confirm');assert.equal(JSON.parse(storage.getItem(HEALTH_KEY)).records.length,0);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
});

test('metadata raw and pre-restore exports preserve original text, and corrupt type storage blocks report generation',()=>{
 const training=fixture(),storage=new Storage(),raw='{synthetic-corrupt',prior='{"prior":"exact-text"}';storage.setItem(EXERCISE_META_KEY,raw);storage.setItem(EXERCISE_META_KEY+'.before-restore',prior);const {app,downloads}=exportHarness(training,storage),train=storage.getItem(KEY);app.action('health-open');
 assert.match(app.html,/停止动作类型写入/);assert.match(app.html,/导出类型原始文件/);app.action('health-meta-raw');assert.equal(downloads[0].raw,raw);app.action('health-meta-previous');assert.equal(downloads[1].raw,prior);app.action('health-report');assert.match(app.toast,/无法读取动作类型/);assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);
});

test('report generation and copy are offline, use compact text without IDs or appended JSON and never upload',async()=>{
 const training=fixture(),storage=new Storage(),copies=[];let uploads=0;
 const app=createAppHarness(training,{storage,globals:{navigator:{onLine:false,clipboard:{async writeText(value){copies.push(value);}}},fetch(){uploads++;throw Error('network forbidden');}}}),train=storage.getItem(KEY);app.action('health-open');app.action('health-report');
 assert.equal(copies.length,0);assert.match(app.modalHtml,/精简 GPT 报告（默认）/);assert.match(app.modalHtml,/2026-09-22/);assert.match(app.modalHtml,/尚未导入可用健康数据，本次仅分析训练记录/);app.modalAction('copy');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(copies.length,1);assert.match(copies[0],/第一部分：训练概况/);assert.match(copies[0],/第五部分：GPT 分析任务/);assert.doesNotMatch(copies[0],/"format"|"exerciseID"|"sessionID"|```json/);for(const movement of training.history.flatMap(session=>session.movements)){assert.ok(!copies[0].includes(movement.exercise.id));assert.ok(!copies[0].includes(movement.id));}
 assert.equal(uploads,0);assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(HEALTH_KEY),null);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
});

test('detail preview switches and exports independently while the copy action still uses compact text',async()=>{
 const training=fixture(),storage=new Storage(),copies=[],downloads=[],blobs=[];
 const app=createAppHarness(training,{storage,globals:{navigator:{onLine:false,clipboard:{async writeText(value){copies.push(value);}}},Blob:class{constructor(parts,options){this.raw=parts.join('');this.type=options?.type;}},URL:{createObjectURL(blob){blobs.push(blob);return 'blob:synthetic-only';},revokeObjectURL(){}},captureDownload(name){downloads.push({...blobs.at(-1),name});}}});
 app.run('document.createElement=()=>({click(){captureDownload(this.download)},remove(){}});document.body.append=()=>{}');app.action('health-open');app.action('health-report');app.modalAction('copy');await new Promise(resolve=>setImmediate(resolve));const compact=copies[0];
 app.modalAction('detail');assert.match(app.modalHtml,/详细分析报告/);assert.match(app.modalHtml,/历次/);app.modalAction('copy');await new Promise(resolve=>setImmediate(resolve));assert.equal(copies[1],compact);
 app.modalAction('text');assert.match(downloads[0].name,/detailed-.*\.txt$/);assert.match(downloads[0].raw,/详细分析报告/);assert.match(downloads[0].type,/text\/plain/);assert.doesNotMatch(downloads[0].raw,/"format"/);
 app.modalAction('json');assert.match(downloads[1].name,/\.json$/);const json=JSON.parse(downloads[1].raw);assert.equal(json.format,'rainlift-ai-report');assert.ok(json.training.exercises.some(item=>item.exerciseID===training.plans[0].exercises[0].id));
 app.modalAction('compact');assert.match(app.modalHtml,/精简 GPT 报告（默认）/);app.modalAction('text');assert.match(downloads[2].name,/compact-.*\.txt$/);assert.equal(downloads[2].raw,compact);
});
