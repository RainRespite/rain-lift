import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {KEY,initial,start,record,finish,parseBackup,Repository} from '../dist/data.js';
import {HEALTH_KEY,HealthRepository,parseHealthImport,healthRecordKey} from '../dist/health.js';
import {Storage,createAppHarness} from './helpers/app-harness.mjs';

const envelope={format:'rainlift-health',version:1,timeZone:'Asia/Shanghai',exportedAt:'2026-10-30T12:00:00+08:00',records:[{id:'test-only-step',type:'steps',source:{name:'合成测试 iPhone'},start:'2026-10-30T08:00:00+08:00',end:'2026-10-30T09:00:00+08:00',unit:'count',value:123,aggregation:'sample'}]};
const file=(data=envelope)=>({name:'synthetic-health.json',size:JSON.stringify(data).length,text:async()=>JSON.stringify(data)});
function workout(){const d=initial();start(d,d.plans[0].id);record(d,d.active.movements[0].id,8,40);finish(d);start(d,d.plans[1].id);return d;}

test('settings entry previews before save, cancels safely and saves only health key after explicit confirmation',async()=>{
 const storage=new Storage(),app=createAppHarness(workout(),{storage}),before=storage.getItem(KEY);
 app.action('nav',{view:'settings'});assert.match(app.html,/打开健康与 AI/);app.action('health-open');
 assert.match(app.html,/暂无数据/);await app.file('health-import-file',file());
 assert.match(app.modalHtml,/新增 1 条/);assert.equal(storage.getItem(HEALTH_KEY),null);assert.equal(storage.getItem(KEY),before);
 app.modalAction('cancel');assert.equal(storage.getItem(HEALTH_KEY),null);
 await app.file('health-import-file',file());app.modalAction('confirm');
 assert.equal(JSON.parse(storage.getItem(HEALTH_KEY)).records.length,1);assert.equal(storage.getItem(KEY),before);
 await app.file('health-import-file',file());assert.match(app.modalHtml,/新增 0 条 · 重复 1 条/);app.modalAction('confirm');
 assert.equal(JSON.parse(storage.getItem(HEALTH_KEY)).records.length,1);assert.equal(storage.getItem(KEY),before);
});

test('invalid and oversized files cannot change either store; failed storage retains preview for retry',async()=>{
 const storage=new Storage(),app=createAppHarness(workout(),{storage}),before=storage.getItem(KEY);
 app.action('health-open');await app.file('health-import-file',file({...envelope,records:[{...envelope.records[0],value:-1}]}));
 assert.match(app.toast,/非法/);assert.equal(app.modalOpen,false);assert.equal(storage.getItem(HEALTH_KEY),null);
 await app.file('health-import-file',{...file(),size:3*1024*1024});assert.match(app.toast,/2 MiB/);
 await app.file('health-import-file',file());storage.fail=true;app.modalAction('confirm');
 assert.match(app.toast,/失败/);assert.equal(app.modalOpen,true);assert.equal(storage.getItem(HEALTH_KEY),null);assert.equal(storage.getItem(KEY),before);
 storage.fail=false;app.modalAction('confirm');assert.equal(JSON.parse(storage.getItem(HEALTH_KEY)).records.length,1);
});

test('health page and report reopen offline without network calls or training writes; copy requires explicit action',async()=>{
 const storage=new Storage();new HealthRepository(storage).import(parseHealthImport(JSON.stringify(envelope)));
 let copies=0,uploads=0;const app=createAppHarness(workout(),{storage,globals:{navigator:{onLine:false,clipboard:{async writeText(value){copies++;assert.match(value,/不据此推断/);assert.doesNotMatch(value,/完整 JSON|"format"/);}}},fetch(){uploads++;throw Error('network forbidden');},XMLHttpRequest:class{constructor(){uploads++;throw Error('network forbidden');}}}});
 const train=storage.getItem(KEY),health=storage.getItem(HEALTH_KEY);
 app.action('health-open');assert.match(app.html,/离线模式/);assert.match(app.html,/合成测试 iPhone/);
 app.action('health-report');assert.match(app.modalHtml,/本地预览/);assert.match(app.modalHtml,/合成测试 iPhone/);assert.equal(copies,0);
 app.modalAction('copy');await new Promise(resolve=>setImmediate(resolve));assert.equal(copies,1);assert.equal(uploads,0);
 assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(HEALTH_KEY),health);
 const reopened=createAppHarness(null,{storage,globals:{navigator:{onLine:false}}});reopened.action('health-open');assert.match(reopened.html,/合成测试 iPhone/);
});

test('specific health delete confirms and never affects training; legacy training restore leaves health intact',async()=>{
 const storage=new Storage(),app=createAppHarness(workout(),{storage});app.action('health-open');await app.file('health-import-file',file());app.modalAction('confirm');
 const train=storage.getItem(KEY),health=storage.getItem(HEALTH_KEY),saved=JSON.parse(health).records[0];
 const restored=parseBackup(train);assert.equal(restored.version,1);new Repository(storage).restore(restored);assert.equal(storage.getItem(HEALTH_KEY),health);
 app.action('health-delete',{id:healthRecordKey(saved)});assert.equal(storage.getItem(HEALTH_KEY),health);app.modalAction('cancel');assert.equal(storage.getItem(HEALTH_KEY),health);
 app.action('health-delete',{id:healthRecordKey(saved)});app.modalAction('confirm');assert.equal(JSON.parse(storage.getItem(HEALTH_KEY)).records.length,0);assert.equal(storage.getItem(KEY),train);
});

test('unreadable health storage is protected and its raw export remains accessible',()=>{
 const storage=new Storage();storage.setItem(HEALTH_KEY,'{broken');const app=createAppHarness(workout(),{storage});app.action('health-open');
 assert.match(app.html,/停止健康数据写入/);assert.match(app.html,/health-export-raw/);app.action('health-report');assert.match(app.toast,/无法读取健康存储/);assert.equal(storage.getItem(HEALTH_KEY),'{broken');
});

test('shipped local-only health and report modules declare no upload transport',()=>{
 for(const name of ['health.js','health-ui.js','ai-report.js'])assert.doesNotMatch(fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'),/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/,name);
});

test('existing WebMCP tools retain invocation, validate sets and expose no health storage',async()=>{
 const tools=new Map(),d=initial();start(d,d.plans[0].id);
 const app=createAppHarness(d,{globals:{AbortController},documentProperties:{modelContext:{registerTool(tool){tools.set(tool.name,tool);}}}});
 assert.deepEqual([...tools.keys()],['read_training_state','record_training_set']);
 const raw=app.storage.getItem(KEY),state=await tools.get('read_training_state').execute({});
 assert.ok(state.active);assert.equal(state.health,undefined);assert.equal(app.storage.getItem(KEY),raw);
 for(const input of [{weight:-1,reps:8},{weight:20,reps:0},{weight:NaN,reps:8},{weight:20,reps:1.5}])await assert.rejects(tools.get('record_training_set').execute(input));
 assert.equal(app.storage.getItem(KEY),raw);
 const saved=await tools.get('record_training_set').execute({weight:20,reps:8});
 assert.equal(saved.reps,8);assert.equal(app.state.active.movements[0].sets.length,1);assert.equal(app.storage.getItem(HEALTH_KEY),null);
});
