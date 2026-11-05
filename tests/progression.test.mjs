import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,finish,record,start,validate,parseBackup,Repository,KEY} from '../dist/data.js';
import {makeLoad,unknownSnapshot} from '../dist/load.js';
import {ExerciseMetaRepository} from '../dist/exercise-meta.js';
import {LOOKBACK_DAYS,progressionTarget,recommendProgression} from '../dist/progression.js';
import {createAppHarness,Storage} from './helpers/app-harness.mjs';

const day=86400000,now=Date.parse('2026-11-05T03:00:00Z');
const range={enabled:true,minReps:8,maxReps:12};
const exact=rpe=>({kind:'exact',rpe});
const normal=(rpe=8)=>({setType:'normal',toFailure:false,effort:exact(rpe)});
const empty=()=>{const d=initial(),e=d.plans[0].exercises[0];e.progression={...range};e.target=2;return d;};
const current=d=>d.active.movements[0];
const observe=(d,options={})=>recommendProgression(d,current(d),{mode:'external',weight:40,now,...options});
function open(d){start(d,d.plans[0].id,unknownSnapshot());return current(d);}
function add(d,reps=12,weight=40,{date=now-5000,type=normal(),mode='external'}={}){
 const m=current(d);
 return record(d,m.id,reps,weight,true,date,makeLoad(mode,m.exercise.unit,weight),type);
}
function complete(d,ended,edit=()=>{}){
 open(d);d.active.started=ended-900000;
 const rows=[add(d,12,40,{date:ended-1000}),add(d,13,40,{date:ended-500})];
 edit(rows,current(d));
 finish(d);d.history[0].ended=ended;
 return d.history[0];
}
function two({at=now,older=8*day}={}){
 const d=empty();
 complete(d,at-older);
 complete(d,at-2*day);
 open(d);d.active.started=at-60000;
 return d;
}
const storeWithExternal=d=>{
 const storage=new Storage(),m=current(d);
 new ExerciseMetaRepository(storage).set(d,m.exercise,'external');
 return storage;
};
const token=app=>app.run(`$('#app').querySelector('[data-action="progression-apply"]')?.dataset.suggestion`);

test('per-set target snapshots preserve actual goals across active changes and legacy absence',()=>{
 const d=empty();
 open(d);
 const first=add(d);
 current(d).exercise.progression={enabled:true,minReps:9,maxReps:13};
 current(d).exercise.target=3;
 const second=add(d);
 assert.deepEqual(first.progressionTarget,{schemaVersion:1,target:2,minReps:8,maxReps:12});
 assert.deepEqual(second.progressionTarget,{schemaVersion:1,target:3,minReps:9,maxReps:13});
 assert.equal(d.plans[0].exercises[0].target,2);
 assert.deepEqual(d.plans[0].exercises[0].progression,range);
 current(d).exercise.progression.enabled=false;
 assert.equal(add(d).progressionTarget,undefined);
 finish(d);
 assert.deepEqual(parseBackup(JSON.stringify(d)),d);
 const legacy=initial();start(legacy,legacy.plans[0].id);
 assert.equal(record(legacy,current(legacy).id,8,40).progressionTarget,undefined);
});

test('invalid configuration and malformed saved snapshots fail closed without overwriting storage',()=>{
 const d=empty();open(d);add(d);
 for(const invalid of [{enabled:true,minReps:0,maxReps:8},{enabled:true,minReps:9,maxReps:8},
  {enabled:true,minReps:8,maxReps:1000},{enabled:1,minReps:8,maxReps:12},{enabled:true,minReps:8.5,maxReps:12}]){
  const corrupt=structuredClone(d);corrupt.plans[0].exercises[0].progression=invalid;
  assert.throws(()=>validate(corrupt),/目标次数/);
 }
 const corrupt=structuredClone(d);current(corrupt).sets[0].progressionTarget.schemaVersion=2;
 const storage=new Storage(),raw=JSON.stringify(corrupt);storage.setItem(KEY,raw);
 const repo=new Repository(storage);assert.equal(repo.writable,false);
 assert.throws(()=>repo.change(()=>{}),/已停止写入/);
 assert.equal(storage.getItem(KEY),raw);
});

test('same-weight next set proposes one additional rep up to the target limit',()=>{
 const d=empty();open(d);
 add(d,8);
 assert.deepEqual(observe(d),{kind:'reps',weight:40,reps:9,previousReps:8,rpe:8});
 current(d).sets.length=0;add(d,11);
 assert.equal(observe(d).reps,12);
 current(d).sets.length=0;add(d,12);
 assert.equal(observe(d).reason,'at_rep_limit');
 current(d).sets.length=0;add(d,7);
 assert.equal(observe(d).reason,'below_range');
});

test('same-session safeguards handle current input, unsupported modes, fatigue and latest set type',()=>{
 const d=empty();open(d);
 const set=add(d,8);
 assert.equal(observe(d,{weight:41}).reason,'different_weight');
 for(const mode of ['legacy','unknown','assisted','bodyweight_plus_extra'])assert.equal(observe(d,{mode}).reason,'unsupported_mode');
 assert.equal(observe(d,{identityUncertain:true}).reason,'identity');
 assert.equal(observe(d,{nextSetType:'warmup'}).reason,'different_next_set');
 set.performance.toFailure=true;assert.equal(observe(d).reason,'failure');set.performance.toFailure=false;
 set.performance.effort=exact(9.5);assert.equal(observe(d).reason,'high_effort');
 set.performance.effort={kind:'at_most',rpe:5};assert.equal(observe(d).reason,'bounded_effort');
 set.performance.effort=null;delete set.performance.effortBasis;assert.equal(observe(d).reason,'no_effort');
 const rated=add(d,8,40,{date:now-4000});rated.reps=9;
 assert.equal(observe(d).reason,'stale_effort');
 add(d,8,40,{date:now-3000,type:{setType:'drop',toFailure:false,effort:null}});
 assert.equal(observe(d).reason,'latest_not_working');
});

test('the two most recent qualifying completed exposures propose exactly one step without mutation',()=>{
 const d=two(),before=JSON.stringify(d);
 const proposal=observe(d);
 assert.deepEqual(proposal,{kind:'increase',fromWeight:40,weight:42.5,sessionIDs:d.history.map(s=>s.id)});
 assert.equal(JSON.stringify(d),before);
 add(d,8,20,{type:{setType:'warmup',toFailure:false,effort:null}});
 assert.equal(observe(d).kind,'increase');
 add(d,8,40);
 assert.equal(observe(d).kind,'reps');
});

test('recent underperformance is not skipped, even if older sessions both qualify',()=>{
 const d=two();d.active=null;d.rest=null;
 complete(d,now-day,rows=>{rows[1].reps=11;rows[1].performance.effortBasis.reps=11;});
 open(d);assert.equal(observe(d).reason,'below_session_limit');
 d.history[0].movements[0].sets[1].performance.setType='warmup';
 assert.equal(observe(d).reason,'too_few_sets');
 d.history[0].movements[0].sets[0].performance.setType='drop';
 assert.equal(observe(d).reason,'too_few_sets');
 d.deletedHistory=[{session:d.history.shift(),deletedAt:now}];
 assert.equal(observe(d).kind,'increase');
});

test('historical evidence excludes mixed targets, legacy sets and changed loads or ratings',()=>{
 const checks=[
  [set=>delete set.progressionTarget,'no_target_snapshot'],
  [set=>set.progressionTarget.maxReps=13,'different_target'],
  [set=>set.load.mode='unknown','different_load'],
  [set=>set.weight=42.5,'different_weight'],
  [set=>set.performance.toFailure=true,'failure'],
  [set=>set.performance.effort=exact(8.5),'high_effort'],
  [set=>set.performance.effort={kind:'at_most',rpe:5},'bounded_effort'],
  [set=>{set.reps++;},'stale_effort']
 ];
 for(const [alter,reason] of checks){
  const d=two();alter(d.history[0].movements[0].sets[0]);assert.equal(observe(d).reason,reason);
 }
 const d=two();
 current(d).exercise.target=3;
 assert.equal(observe(d).reason,'too_few_sets');
 current(d).exercise.target=2;current(d).exercise.progression.maxReps=14;
 assert.equal(observe(d).reason,'different_target');
});

test('lookback includes the exact 30-day boundary and refuses stale or overflowing increases',()=>{
 const d=two({older:LOOKBACK_DAYS*day});
 assert.equal(observe(d).kind,'increase');
 assert.equal(observe(d,{now:now+1}).reason,'old_history');
 for(const s of d.history)for(const set of s.movements[0].sets){set.weight=9999;set.performance.effortBasis.weight=9999;}
 assert.equal(observe(d,{weight:9999}).reason,'weight_limit');
});

test('opt-in uses the existing action editor, preserves shortcuts and is scoped to the edited plan',()=>{
 const d=initial(),e=d.plans[0].exercises[0],same={...e};d.plans[1].exercises[0]=same;
 const app=createAppHarness(d);
 app.action('plan-edit',{id:d.plans[0].id});app.modalAction('edit-0');
 assert.match(app.modalHtml,/渐进建议（选填）/);
 app.field('progressionMin','12');app.field('progressionMax','8');app.submit({progressionEnabled:''});
 assert.match(app.toast,/下限不能大于上限/);
 app.field('progressionMin','8');app.field('progressionMax','12');app.submit();app.submit();
 assert.deepEqual(app.state.plans[0].exercises[0].progression,range);
 assert.deepEqual(app.state.plans[0].exercises[0].reps,e.reps);
 assert.equal(app.state.plans[0].exercises[0].target,e.target);
 assert.equal(app.state.plans[1].exercises[0].progression,undefined);
});

test('adopt uses manual weight override while a stale offer leaves manual input and note intact',()=>{
 const d=two({at:Date.now()}),app=createAppHarness(d,{storage:storeWithExternal(d)});
 const initial=token(app);
 assert.ok(initial);assert.equal(app.run("$('#weight').value"),'40');
 app.run("$('#weight').value='41';$('#note').value='手动输入备注'");
 app.action('progression-apply',{suggestion:initial});
 assert.match(app.toast,/建议条件已变化/);
 assert.equal(current(app.state).overrideWeight,41);
 assert.equal(app.state.active.note,'手动输入备注');
 assert.equal(current(app.state).sets.length,0);
 app.run("$('#weight').value='40'");
 app.action('progression-apply',{suggestion:initial});
 assert.equal(current(app.state).overrideWeight,42.5);
 assert.equal(current(app.state).overrideMode,'external');
 assert.equal(current(app.state).sets.length,0);
 assert.equal(app.state.rest,null);
 assert.equal(app.state.plans[0].exercises[0].weight,40);
 assert.deepEqual(app.state.plans[0].exercises[0].reps,d.plans[0].exercises[0].reps);
 assert.equal(token(app),undefined);
});

test('a newly scored set changes the advisory reps without recording or changing buttons',()=>{
 const d=empty();open(d);const app=createAppHarness(d,{storage:storeWithExternal(d)});
 app.action('record',{reps:'8'});
 const state=app.state,m=current(state),rest=state.rest;
 app.action('rest-performance',{session:state.active.id,movement:m.id,id:rest.setID});
 app.field('effort','8');app.submit();
 assert.match(app.html,/保持 40 kg，尝试 9 次/);
 assert.equal(current(app.state).sets.length,1);
 assert.deepEqual(app.state.rest,rest);
 assert.deepEqual(current(app.state).sets[0].progressionTarget,progressionTarget(m.exercise));
 assert.deepEqual(current(app.state).exercise.reps,m.exercise.reps);
});
