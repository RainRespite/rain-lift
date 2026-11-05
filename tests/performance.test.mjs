import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppHarness, Storage} from './helpers/app-harness.mjs';
import {initial, start, record, KEY, TRAINING_V2_KEY, Repository} from '../dist/data.js';
import {makeLoad, unknownSnapshot} from '../dist/load.js';
import {effortLabel, performanceDetails, setPerformance} from '../dist/performance.js';
import {generateAIReport, reportToText} from '../dist/ai-report.js';

const exact = rpe => ({kind:'exact',rpe});
const bound = {kind:'at_most',rpe:5};
const mark = (setType,effort=null,toFailure=false) => ({setType,toFailure,effort});
const file = value => ({size:1,text:async()=>JSON.stringify(value)});
const legacy = () => {const db=initial();start(db,db.plans[0].id);return db;};
const firstSet = db => db.active.movements[0].sets[0];
const restRef = db => ({session:db.active.id,movement:db.active.movements[0].id,id:db.rest.setID});

test('performance strictly validates marks, exact scores and the RIR 5+ bound in either training format',()=>{
 for(const version of [1,2]){
  const db=legacy(),m=db.active.movements[0];
  db.version=version;
  const set=record(db,m.id,8,40,true,Date.now(),undefined,mark('drop',bound,true));
  assert.deepEqual(set.performance,{schemaVersion:1,setType:'drop',toFailure:true,effort:bound,effortBasis:{weight:40,reps:8,bodyWeightKg:null}});
  const storage=new Storage(),key=version===2?TRAINING_V2_KEY:KEY;
  storage.setItem(key,JSON.stringify(db));
  const repo=new Repository(storage);
  for(const invalid of [exact(4.5),exact(10.5),exact(8.2),exact('8'),exact(NaN),{kind:'at_most',rpe:5.5},{kind:'other',rpe:5}]){
   assert.throws(()=>repo.change(next=>setPerformance(firstSet(next),mark('normal',invalid))),/强度/);
  }
  for(const patch of [{setType:['normal']},{setType:'other'},{toFailure:0},{schemaVersion:2},{effortBasis:null}]){
   assert.throws(()=>repo.change(next=>Object.assign(firstSet(next).performance,patch)),/不受支持|强度/);
  }
  const corrupt=structuredClone(db);firstSet(corrupt).performance.schemaVersion=2;
  storage.setItem(key,JSON.stringify(corrupt));
  const raw=storage.getItem(key),blocked=new Repository(storage);
  assert.equal(blocked.writable,false);
  assert.throws(()=>blocked.change(next=>{next.active.note='should fail';}),/已停止写入/);
  assert.equal(storage.getItem(key),raw);
 }
 assert.equal(effortLabel(exact(5),'rir'),'RIR 5');
 assert.equal(effortLabel(bound,'rir'),'RIR 5+');
 assert.equal(effortLabel(bound,'rpe'),'RPE ≤5');
 assert.equal(effortLabel(exact(8.5),'rir'),'RIR 1.5');
});

test('quick set marks are single-use, preserve pending inputs and avoid duplicate reps',()=>{
 const app=createAppHarness(legacy());
 app.run("document.querySelector('#weight').value='44.5';document.querySelector('#note').value='合成备注'");
 app.action('next-set-type',{type:'warmup'});
 app.action('next-set-failure');
 assert.match(app.html,/data-type="warmup" aria-pressed="true"/);
 app.action('record',{reps:'8'});
 app.action('record',{reps:'8'});
 assert.equal(app.state.active.movements[0].sets.length,1);
 assert.deepEqual(firstSet(app.state).performance,{schemaVersion:1,setType:'warmup',toFailure:true,effort:null});
 assert.equal(firstSet(app.state).weight,44.5);
 assert.equal(app.state.active.note,'合成备注');
 assert.match(app.html,/data-type="normal" aria-pressed="true"/);
 assert.match(app.html,/data-action="next-set-failure" aria-pressed="false"/);
 app.action('next-set-type',{type:'drop'});
 app.action('select',{id:app.state.active.movements[1].id});
 app.action('select',{id:app.state.active.movements[0].id});
 assert.match(app.html,/data-type="normal" aria-pressed="true"/);
});

test('a failed quick set keeps the next group draft available for retry',()=>{
 const app=createAppHarness(legacy());
 app.action('next-set-type',{type:'drop'});
 app.storage.fail=true;
 app.action('record',{reps:'8'});
 assert.equal(app.state.active.movements[0].sets.length,0);
 assert.equal(app.state.rest,null);
 assert.match(app.html,/data-type="drop" aria-pressed="true"/);
 app.storage.fail=false;
 app.run('lastTap=0');
 app.action('record',{reps:'8'});
 assert.equal(firstSet(app.state).performance.setType,'drop');
});

test('rest annotation stays attached to the recorded movement and leaves the running timer intact',()=>{
 const db=legacy(),m=db.active.movements[0];
 const set=record(db,m.id,8,40);
 const app=createAppHarness(db,{globals:{navigator:{onLine:true,userAgent:'iPhone'},window:{addEventListener(){},location:{href:''}}}});
 app.action('select',{id:db.active.movements[1].id});
 app.action('rest-performance',restRef(db));
 assert.match(app.modalHtml,/补记这组/);
 app.field('effort','bound');
 app.submit();
 assert.deepEqual(app.state.rest,db.rest);
 assert.deepEqual(firstSet(app.state),{...set,performance:{schemaVersion:1,setType:null,toFailure:false,effort:bound,effortBasis:{weight:40,reps:8,bodyWeightKg:null}}});
 assert.equal(app.state.active.movements[1].sets.length,0);
 app.action('island-start');
 assert.match(app.run('window.location.href'),/^shortcuts:\/\/run-shortcut/);
});

test('undo and storage failures cannot resurrect a set or erase the already saved group',()=>{
 const db=legacy();
 record(db,db.active.movements[0].id,8,40);
 const app=createAppHarness(db),ref=restRef(db);
 app.action('rest-performance',ref);
 app.field('effort','8.5');
 const before=app.storage.getItem(KEY);
 app.storage.fail=true;
 app.submit();
 assert.equal(app.modalOpen,true);
 assert.equal(app.storage.getItem(KEY),before);
 assert.deepEqual(app.state,db);
 app.storage.fail=false;
 app.action('undo');
 app.submit();
 assert.match(app.toast,/找不到这组/);
 assert.equal(app.state.active.movements[0].sets.length,0);
 assert.equal(app.state.rest,null);
});

test('manual set, history edit, display modes and recent deletion preserve independent marks',async()=>{
 const app=createAppHarness(legacy());
 app.action('set-new');
 app.field('setType','drop');
 app.field('effort','5');
 app.submit({toFailure:''});
 assert.equal(firstSet(app.state).performance.effort.rpe,5);
 assert.match(app.html,/递减 · 力竭 · RPE 5/);
 const previousRest=app.state.rest;
 app.action('nav',{view:'settings'});
 await app.change('effort-display','rir');
 app.action('nav',{view:'today'});
 assert.match(app.html,/RIR 5</);
 app.action('rest-performance',restRef(app.state));
 app.field('effort','bound');
 app.submit();
 assert.match(app.html,/RIR 5\+/);
 app.action('nav',{view:'settings'});
 await app.change('effort-display','off');
 app.action('nav',{view:'today'});
 assert.match(app.html,/递减 · 力竭</);
 assert.doesNotMatch(app.html,/RIR 5\+|已评分/);
 app.action('rest-performance',restRef(app.state));
 assert.doesNotMatch(app.modalHtml,/name="effort"/);
 app.submit();
 assert.deepEqual(app.state.rest,previousRest);
 assert.deepEqual(firstSet(app.state).performance.effort,bound);
 app.action('finish');app.modalAction('confirm');
 const session=app.state.history[0],movement=session.movements[0],id=movement.sets[0].id;
 app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 app.action('history-edit',{session:session.id,movement:movement.id,id});app.field('setType','warmup');app.submit();
 app.action('history-delete',{session:session.id});app.modalAction('confirm');
 assert.equal(app.state.deletedHistory[0].session.movements[0].sets[0].performance.setType,'warmup');
 app.action('history-restore',{session:session.id});
 assert.deepEqual(app.state.history[0].movements[0].sets[0].performance.effort,bound);
 const reopened=createAppHarness(null,{storage:app.storage});
 assert.equal(reopened.state.effortDisplay,'off');
});

test('modern self-weight metadata-only edits preserve the load and condition changes require score confirmation',()=>{
 const db=initial(),snapshot={...unknownSnapshot(),bodyWeightKg:68,bodyWeightSource:'manual_session',bodyWeightUpdatedAt:Date.now()};
 start(db,db.plans[0].id,snapshot);
 const m=db.active.movements[0],set=record(db,m.id,8,5,true,Date.now(),makeLoad('bodyweight_plus_extra','kg',5,snapshot),mark('normal',exact(8)));
 const app=createAppHarness(db);
 app.action('set-edit',{id:set.id});app.field('setType','drop');app.submit();
 assert.deepEqual(firstSet(app.state).load,set.load);
 assert.deepEqual(app.state.rest,db.rest);
 app.action('set-edit',{id:set.id});app.field('reps','9');app.submit();
 assert.match(app.html,/评分待确认/);
 assert.equal(performanceDetails(firstSet(app.state)).effort,null);
 assert.deepEqual(firstSet(app.state).performance.effort,exact(8));
 app.action('set-edit',{id:set.id});app.submit({confirmEffort:''});
 assert.deepEqual(performanceDetails(firstSet(app.state)).effort,exact(8));
 assert.equal(firstSet(app.state).date,set.date);
 app.action('set-edit',{id:set.id});app.field('effort','');app.submit();
 assert.equal(firstSet(app.state).performance.effort,null);
});

test('WebMCP keeps its record contract and never consumes the manual type draft',async()=>{
 const tools=new Map();
 const app=createAppHarness(legacy(),{globals:{AbortController},documentProperties:{modelContext:{registerTool(tool){tools.set(tool.name,tool);}}}});
 app.action('next-set-type',{type:'drop'});
 const result=await tools.get('record_training_set').execute({weight:20,reps:8});
 assert.deepEqual(Object.keys(result),['id','weight','reps','load']);
 assert.equal(firstSet(app.state).performance,undefined);
 assert.match(app.html,/data-type="drop" aria-pressed="true"/);
 app.action('record',{reps:'8'});
 assert.equal(app.state.active.movements[0].sets[1].performance.setType,'drop');
});

test('stale tabs and full restore previews reject an overwrite of ratings',async()=>{
 const db=legacy();record(db,db.active.movements[0].id,8,40);
 const first=createAppHarness(db),second=createAppHarness(null,{storage:first.storage});
 second.action('set-edit',{id:db.rest.setID});second.field('effort','9');
 first.action('rest-performance',restRef(db));first.field('effort','8.5');first.submit();
 second.submit();
 assert.match(second.toast,/其他页面修改/);
 assert.equal(JSON.parse(first.storage.getItem(KEY)).active.movements[0].sets[0].performance.effort.rpe,8.5);
 first.action('nav',{view:'settings'});await first.file('import-file',file(db));
 assert.match(first.modalHtml,/会话内容不匹配.*完整备份/);
});

test('a modal opened before a storage event cannot overwrite the updated set',()=>{
 const db=legacy();
 record(db,db.active.movements[0].id,8,40);
 const first=createAppHarness(db);
 let refresh;
 const second=createAppHarness(null,{storage:first.storage,globals:{window:{addEventListener(type,fn){if(type==='storage')refresh=fn;}}}});
 second.action('rest-performance',restRef(db));
 second.field('effort','9');
 first.action('rest-performance',restRef(db));
 first.field('effort','8.5');
 first.submit();
 refresh({key:KEY});
 assert.equal(firstSet(second.state).performance.effort.rpe,8.5);
 second.submit();
 assert.equal(second.modalOpen,true);
 assert.match(second.toast,/这组记录已修改/);
 assert.equal(firstSet(second.state).performance.effort.rpe,8.5);
});

test('report separates classifications and valid coverage from the original all-set count',()=>{
 const db=legacy(),m=db.active.movements[0],now=Date.now();
 record(db,m.id,10,20,true,now,undefined,mark('warmup',exact(6)));
 record(db,m.id,8,40,true,now,undefined,mark('normal',bound));
 record(db,m.id,6,30,true,now,undefined,mark('drop',exact(10),true)).reps=5;
 record(db,m.id,8,20,true,now);
 db.active.ended=now;db.history.push(db.active);db.active=null;db.rest=null;
 const report=generateAIReport(db,null,{now,timeZone:'Asia/Shanghai'});
 assert.equal(report.training.recordedSetCount,4);
 assert.equal(report.training.effectiveHardSetCount,null);
 assert.deepEqual(report.training.performanceCounts,{normal:1,warmup:1,drop:1,unclassified:1,failureMarked:1,rated:2,effortNeedsConfirmation:1});
 const sets=report.training.exercises[0].latest.sets;
 assert.deepEqual(sets[1].performance.effort,bound);
 assert.equal(sets[2].performance.effort,null);
 assert.equal(sets[2].performance.effortNeedsConfirmation,true);
 assert.match(reportToText(report),/普通工作组 1 · 热身 1 · 递减 1 · 未分类 1 · 力竭标记 1 · 已评分 2/);
});
