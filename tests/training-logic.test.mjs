import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,start,record,finish} from '../dist/data.js';
import {makeLoad,unknownSnapshot} from '../dist/load.js';
import {ExerciseMetaRepository} from '../dist/exercise-meta.js';
import {generateAIReport,reportToText} from '../dist/ai-report.js';
import {createAppHarness,Storage} from './helpers/app-harness.mjs';

const mark=(setType,toFailure=false)=>({setType,toFailure,effort:null});
const now=Date.now();
const modeType={external:'external',assisted:'assisted',bodyweight_plus_extra:'bodyweight',unknown:'unknown'};
function fixture({weight=35,mode='external',unit='kg'}={}){
 const data=initial(),storage=new Storage(),plan=data.plans[0],exercise=plan.exercises[0];
 exercise.weight=weight;exercise.unit=unit;exercise.target=3;
 new ExerciseMetaRepository(storage).set(data,exercise,modeType[mode]);
 return {data,storage,plan,exercise};
}
function add(data,type,weight,reps=8,opts={}){
 const m=data.active.movements[0],mode=opts.mode??'external';
 const load=mode==='legacy'?undefined:makeLoad(mode,m.exercise.unit,weight,data.active.bodyWeightSnapshot);
 return record(data,m.id,reps,weight,false,opts.date??now-10000,load,type===null?undefined:mark(type,opts.failure));
}
function completed(d,sets,{age=1,plan=d.plans[0],legacy=false,snapshot=unknownSnapshot()}={}){
 const ended=now-age*86400000;
 start(d,plan.id,legacy?undefined:snapshot);d.active.started=ended-60000;
 for(const [type,weight,reps,opts] of sets)add(d,type,weight,reps,{mode:legacy?'legacy':'external',date:ended-1000,...opts});
 finish(d);d.history[0].ended=ended;return d.history[0];
}
const active=(f,snapshot=unknownSnapshot())=>start(f.data,f.plan.id,snapshot);
const open=f=>createAppHarness(f.data,{storage:f.storage});
const input=app=>Number(app.run("$('#weight').value"));
const choose=(app,type)=>app.action('next-set-type',{type});
function quick(app){app.run('lastTap=0');app.action('record',{reps:'8'});}
const report=(data,profile=null,health=null)=>generateAIReport(data,health,{now,timeZone:'Asia/Shanghai',profile});

test('normal prefill excludes historical warmups and drop sets, including after two warmups',()=>{
 const f=fixture();
 completed(f.data,[['warmup',20],['warmup',30],['normal',40],['drop',25]]);
 active(f);
 const app=open(f);
 assert.equal(input(app),40);
 choose(app,'warmup');assert.equal(input(app),20);quick(app);
 choose(app,'warmup');app.run("$('#weight').value='30'");quick(app);
 assert.equal(input(app),40);
 quick(app);
 choose(app,'drop');assert.equal(input(app),25);quick(app);
 assert.equal(input(app),40);
 assert.deepEqual(app.state.active.movements[0].sets.map(s=>[s.performance.setType,s.weight]),[
  ['warmup',20],['warmup',30],['normal',40],['drop',25]]);
});

test('warmup, drop, unclassified and failure marks do not inflate working target; edit and undo recompute',()=>{
 const f=fixture();active(f);
 add(f.data,'warmup',20);add(f.data,'warmup',30);add(f.data,'normal',40,8,{failure:true});
 const app=open(f);
 assert.match(app.html,/已完成 <b class="accent">1<\/b> \/ 3/);
 assert.match(app.html,/总记录 3 组/);
 choose(app,'drop');quick(app);
 assert.match(app.html,/已完成 <b class="accent">1<\/b> \/ 3/);
 const drop=app.state.active.movements[0].sets.at(-1);
 app.action('set-edit',{id:drop.id});app.field('setType','normal');app.submit();
 assert.match(app.html,/已完成 <b class="accent">2<\/b> \/ 3/);
 quick(app);assert.match(app.html,/已完成 <b class="accent">3<\/b> \/ 3/);
 app.action('undo');assert.match(app.html,/已完成 <b class="accent">2<\/b> \/ 3/);
 assert.match(app.html,/力竭标记 1/);
 assert.equal(app.state.active.movements[0].sets.length,4);
});

test('working report ignores changed warmups while retaining all-set data and never pairs different types',()=>{
 const f=fixture();
 completed(f.data,[['warmup',20,5],['normal',40,8],['drop',40,4]],{age:3});
 completed(f.data,[['warmup',20,10],['warmup',40,11],['normal',40,8]],{age:2});
 const result=report(f.data),row=result.training.exercises[0];
 assert.equal(result.version,2);
 assert.equal(result.training.recordedSetCount,6);
 assert.equal(row.comparison.scope,'all_recorded_descriptive');
 assert.ok(row.comparison.sameWeight.every(pair=>pair.setType!=='drop'));
 assert.deepEqual(row.comparison.sameWeight.find(pair=>pair.setType==='normal').pairedRepChanges,[0]);
 assert.equal(row.workingSetComparison.status,'comparable');
 assert.deepEqual(row.workingSetComparison.comparison.sameWeight.map(pair=>[pair.weight,pair.pairedRepChanges]),[[40,[0]]]);
 const text=reportToText(result);
 assert.match(text,/普通工作组对照/);
 assert.doesNotMatch(text,/同记录重量20kg，对应|次数变化 \+5/);
});

test('only historical warmups or unclassified records require confirming the configured weight',()=>{
 for(const type of ['warmup',null]){
  const f=fixture({weight:35});
  completed(f.data,[[type,20]]);active(f);
  const app=open(f);
  assert.equal(input(app),35);assert.match(app.html,/暂无同类型重量/);
  if(type===null)assert.match(app.html,/第 1 组 · 未分类/);
 }
 const old=fixture({weight:35});
 completed(old.data,[[null,23]],{legacy:true});start(old.data,old.plan.id);
 const app=open(old);assert.equal(input(app),35);assert.match(app.html,/暂无同类型重量/);
});

test('same name with a different ID, other units and other load modes stay out of prefill',()=>{
 const f=fixture();
 completed(f.data,[['normal',42]],{age:4});
 completed(f.data,[['normal',15,8,{mode:'assisted'}]],{age:3});
 f.exercise.unit='lb';completed(f.data,[['normal',90]],{age:2});f.exercise.unit='kg';
 f.data.plans[1].exercises[0].name=f.exercise.name;
 completed(f.data,[['normal',80]],{age:1,plan:f.data.plans[1]});
 active(f);
 assert.equal(input(open(f)),42);
});

test('manual draft has priority across group switches and the consumed weight stays with its type',()=>{
 const f=fixture();completed(f.data,[['warmup',20],['normal',40],['drop',25]]);active(f);
 const app=open(f);
 app.run("$('#weight').value='47.5';$('#note').value='合成草稿'");
 choose(app,'warmup');assert.equal(input(app),47.5);
 app.action('weight-minus');assert.equal(input(app),45);
 assert.equal(app.state.active.note,'合成草稿');assert.equal(app.state.active.movements[0].sets.length,0);
 quick(app);
 assert.equal(app.state.active.movements[0].sets[0].weight,45);
 assert.equal(input(app),40);
 choose(app,'warmup');assert.equal(input(app),45);
});

test('a person can deliberately fill a weight from a visible historical group of a different type',()=>{
 const f=fixture();
 const old=completed(f.data,[['warmup',20],['normal',40],['drop',25,8,{mode:'assisted'}]]);
 active(f);const app=open(f),prior=old.movements[0];
 assert.match(app.html,/填入上次第 1 组热身重量/);
 app.action('use-history-weight',{session:old.id,movement:prior.id,id:prior.sets[0].id});
 assert.equal(input(app),20);assert.match(app.toast,/上次热身组/);
 assert.equal(app.state.active.movements[0].sets.length,0);
 app.action('use-history-weight',{session:old.id,movement:prior.id,id:prior.sets[2].id});
 assert.equal(input(app),20);assert.match(app.toast,/负重模式与当前不同/);
});

test('bodyweight defaults stay extra-only and assisted defaults stay assistance-only',()=>{
 const body=fixture({mode:'bodyweight_plus_extra',weight:68});
 const snapshot={...unknownSnapshot(),bodyWeightKg:68,bodyWeightSource:'manual_session'};
 const old=completed(body.data,[['normal',73]],{legacy:true,age:3});
 completed(body.data,[['warmup',0,8,{mode:'bodyweight_plus_extra'}],['normal',5,8,{mode:'bodyweight_plus_extra'}]],{age:1,snapshot});
 const before=structuredClone(body.data.history);
 active(body,{...snapshot,bodyWeightKg:72});
 const app=open(body);
 assert.equal(input(app),5);assert.match(app.html,/额外负重/);
 choose(app,'warmup');assert.equal(input(app),0);quick(app);
 assert.equal(input(app),5);
 assert.equal(app.state.active.movements[0].sets[0].load.bodyWeightKg,72);
 assert.deepEqual(app.state.history,before);
 assert.equal(old.movements[0].sets[0].weight,73);

 const assisted=fixture({mode:'assisted',weight:30});
 completed(assisted.data,[['normal',10,8,{mode:'external'}],['normal',25,8,{mode:'assisted'}]]);
 active(assisted);const assistedApp=open(assisted);
 assert.equal(input(assistedApp),25);quick(assistedApp);
 assert.equal(assistedApp.state.active.movements[0].sets[0].load.mode,'assisted');
});

test('unclassified records stay visible without advancing ordinary group count',()=>{
 const f=fixture();active(f);add(f.data,null,20);add(f.data,'drop',30);add(f.data,'warmup',15);
 const app=open(f);
 assert.match(app.html,/已完成 <b class="accent">0<\/b> \/ 3/);
 assert.match(app.html,/总记录 3 组.*未分类 1/);
 assert.match(app.html,/下一组 · 普通 01/);
 choose(app,'warmup');assert.match(app.html,/下一组 · 热身 02/);
});

test('background visibility persists a valid unblurred weight and leaves the recorded sets and timer intact',()=>{
 const f=fixture();active(f);add(f.data,'warmup',20);
 const handlers=[];
 const app=createAppHarness(f.data,{storage:f.storage,documentProperties:{
  addEventListener(name,handler){if(name==='visibilitychange')handlers.push(handler);}
 }});
 const before=app.state;
 app.run("$('#weight').value='46.5';$('#note').value='待保存';document.visibilityState='hidden'");
 handlers.forEach(fn=>fn());
 const reloaded=createAppHarness(null,{storage:f.storage});
 assert.equal(input(reloaded),46.5);
 assert.equal(reloaded.state.active.note,'待保存');
 assert.deepEqual(reloaded.state.active.movements[0].sets,before.active.movements[0].sets);
 assert.deepEqual(reloaded.state.rest,before.rest);
});

test('the working trend ignores warmup changes and missing samples remain explicit',()=>{
 const f=fixture();
 for(const [age,reps] of [[3,4],[2,8],[1,12]]){
  completed(f.data,[['warmup',20,reps],['normal',40,8]],{age});
 }
 const result=report(f.data),row=result.training.exercises[0];
 assert.equal(row.recentPattern.observation,'increasing_recorded_reps');
 assert.equal(row.recentPattern.scope,'all_recorded_descriptive');
 assert.equal(row.workingSetComparison.recentPattern.observation,'unchanged_recorded_reps');
 assert.match(reportToText(result),/普通工作组的组数及逐组重量一致，对应次数持平/);
 assert.doesNotMatch(reportToText(result),/对应次数连续上升/);
 f.data.history[0].movements[0].sets[1].performance.setType='drop';
 const insufficient=report(f.data);
 assert.equal(insufficient.training.exercises[0].workingSetComparison.status,'insufficient');
 assert.match(reportToText(insufficient),/最近两次缺少可比的普通工作组/);
});

test('work comparisons keep load modes, bodyweight references, identity and health data separate',()=>{
 const f=fixture(),snap=bodyWeightKg=>({...unknownSnapshot(),bodyWeightKg,bodyWeightSource:'manual_session'});
 completed(f.data,[['normal',40],['normal',20,8,{mode:'assisted'}],['normal',5,8,{mode:'bodyweight_plus_extra'}]],{age:2,snapshot:snap(68)});
 completed(f.data,[['normal',40],['normal',20,9,{mode:'assisted'}],['normal',5,10,{mode:'bodyweight_plus_extra'}]],{age:1,snapshot:snap(70)});
 const health={timeZone:'Asia/Shanghai',records:[]},profile={current:{weightKg:72,updatedAt:now-100},history:[]};
 const result=report(f.data,profile,health);
 assert.equal(result.body.current.weightKg,72);
 assert.equal(result.health.hasUsableData,false);
 const rows=Object.fromEntries(result.training.exercises.map(row=>[row.recordMode,row.workingSetComparison]));
 assert.deepEqual(rows.external.comparison.sameWeight[0].pairedRepChanges,[0]);
 assert.deepEqual(rows.assisted.comparison.sameWeight[0].pairedRepChanges,[1]);
 assert.equal(rows.bodyweight_plus_extra.status,'incomparable_load');
 f.data.plans[1].exercises.push({...f.exercise,name:'独立冲突'});
 assert.ok(report(f.data).training.exercises.every(row=>row.workingSetComparison.status==='identity_uncertain'));
});
