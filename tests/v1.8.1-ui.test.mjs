import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,exercise,start,record,finish,KEY} from '../dist/data.js';
import {HEALTH_KEY} from '../dist/health.js';
import {EXERCISE_META_KEY,ExerciseMetaRepository,getExerciseLoadType,getSessionBodyWeight} from '../dist/exercise-meta.js';
import {Storage,createAppHarness} from './helpers/app-harness.mjs';

function fixture({active=false,history=false}={}){
 const d=initial();d.plans.splice(1);d.plans[0].name='合成 UI 测试计划';
 d.plans[0].exercises=['用户已命名的自重动作','器械甲','器械乙','辅助动作','明确未确认'].map(name=>exercise(name));
 if(history){start(d,d.plans[0].id);record(d,d.active.movements[0].id,8,73);finish(d);const s=d.history[0];s.started=Date.now()-86400000;s.ended=s.started+3600000;for(const m of s.movements)for(const set of m.sets)set.date=s.started+600000;}
 if(active)start(d,d.plans[0].id);
 return d;
}
function setup(d=fixture()){
 const storage=new Storage(),meta=new ExerciseMetaRepository(storage);meta.set(d,d.plans[0].exercises[0],'bodyweight');meta.set(d,d.plans[0].exercises[3],'assisted');meta.set(d,d.plans[0].exercises[4],'unknown');
 const app=createAppHarness(d,{storage});return {app,storage};
}
const metadata=storage=>JSON.parse(storage.getItem(EXERCISE_META_KEY));

test('bulk UI previews all actual names and counts, cancels without changing records, then saves atomically',()=>{
 const d=fixture(),{app,storage}=setup(d),train=storage.getItem(KEY),before=storage.getItem(EXERCISE_META_KEY);app.action('health-open');
 assert.match(app.html,/一键设置未确认动作/);assert.doesNotMatch(app.html,/龙悬/);app.action('health-meta-bulk');
 assert.match(app.modalHtml,/本次将 2 个/);assert.match(app.modalHtml,/查看本次全部 2 个动作/);assert.match(app.modalHtml,/器械甲/);assert.match(app.modalHtml,/器械乙/);assert.match(app.modalHtml,/保留显式的/);
 app.modalAction('cancel');assert.equal(storage.getItem(EXERCISE_META_KEY),before);app.action('health-meta-bulk');app.submit();
 const saved=metadata(storage);assert.equal(saved.defaultLoadType,'external');assert.equal(saved.entries.length,5);assert.match(app.toast,/已设置 2 个动作/);
 for(const [index,type] of [[0,'bodyweight'],[1,'external'],[2,'external'],[3,'assisted'],[4,'unknown']])assert.equal(getExerciseLoadType(d,d.plans[0].exercises[index],saved),type);
 assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(HEALTH_KEY),null);assert.deepEqual(app.state,d);
});

test('bulk future-default checkbox may be disabled and later default toggles never rewrite explicit types',()=>{
 const d=fixture(),{app,storage}=setup(d);app.action('health-open');app.action('health-meta-bulk');app.run("delete $('#modal').form.fields.defaultForNew");app.submit();assert.equal(metadata(storage).defaultLoadType,'unknown');
 app.action('health-meta-default');app.submit();assert.equal(metadata(storage).defaultLoadType,'external');
 const newExercise=exercise('用户新增动作');d.plans[0].exercises.push(newExercise);assert.equal(getExerciseLoadType(d,newExercise,metadata(storage)),'external');
 app.action('health-meta-default');app.modalAction('cancel');assert.equal(metadata(storage).defaultLoadType,'external');
 app.action('health-meta-default');app.submit();assert.equal(metadata(storage).defaultLoadType,'unknown');assert.equal(getExerciseLoadType(d,newExercise,metadata(storage)),'unknown');assert.equal(getExerciseLoadType(d,d.plans[0].exercises[1],metadata(storage)),'external');
});

test('bulk storage failure preserves preview, all stores and selected names without false success',()=>{
 const d=fixture(),{app,storage}=setup(d),train=storage.getItem(KEY),before=storage.getItem(EXERCISE_META_KEY);app.action('health-open');app.action('health-meta-bulk');storage.fail=true;app.submit();
 assert.equal(app.modalOpen,true);assert.match(app.toast,/未保存/);assert.equal(storage.getItem(KEY),train);assert.equal(storage.getItem(EXERCISE_META_KEY),before);assert.equal(storage.getItem(HEALTH_KEY),null);
 storage.fail=false;app.submit();assert.equal(app.modalOpen,false);assert.match(app.toast,/已设置 2 个/);assert.deepEqual(app.state,d);
});

test('conflict UI preview skips identities instead of bulk-resolving or renaming them',()=>{
 const d=fixture();d.plans.push({id:'other-plan',name:'另一合成计划',exercises:[{...d.plans[0].exercises[1],name:'冲突快照名称'}]});const {app,storage}=setup(d),train=storage.getItem(KEY);app.action('health-open');app.action('health-meta-bulk');
 assert.match(app.modalHtml,/本次将 1 个/);assert.match(app.modalHtml,/跳过 1 个身份冲突/);app.submit();assert.equal(getExerciseLoadType(d,d.plans[0].exercises[1],metadata(storage)),'unknown');assert.equal(storage.getItem(KEY),train);
});

test('stale bulk preview refuses to overwrite a changed metadata page',()=>{
 const d=fixture(),{app,storage}=setup(d);app.action('health-open');app.action('health-meta-bulk');new ExerciseMetaRepository(storage).set(d,d.plans[0].exercises[1],'assisted');const before=storage.getItem(EXERCISE_META_KEY);app.submit();assert.equal(app.modalOpen,true);assert.match(app.toast,/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY),before);
});

test('active bodyweight entry preserves pending input and stores only the explicit current-session baseline',()=>{
 const d=fixture({active:true,history:true}),{app,storage}=setup(d),historyBefore=structuredClone(d.history),restBefore=structuredClone(d.rest);app.run("$('#weight').value='73';$('#note').value='未失焦备注'");app.action('session-bodyweight');
 assert.match(app.modalHtml,/本次体重 \/ 自重加重/);assert.match(app.modalHtml,/原记录重量 = 体重 \+ 额外负重/);assert.equal(app.run("$('#modal [name=\"bodyWeight\"]').value"),'');app.submit({bodyWeight:'68',bodyUnit:'kg'});
 assert.equal(app.modalOpen,false);assert.equal(getSessionBodyWeight(app.state,d.active.id,'kg',metadata(storage)),68);assert.equal(getSessionBodyWeight(app.state,d.history[0].id,'kg',metadata(storage)),null);
 assert.equal(app.state.active.note,'未失焦备注');assert.equal(app.state.active.movements[0].overrideWeight,73);assert.deepEqual(app.state.history,historyBefore);assert.deepEqual(app.state.rest,restBefore);assert.equal(storage.getItem(HEALTH_KEY),null);assert.equal(app.state.plans[0].exercises[0].name,'用户已命名的自重动作');
 app.action('session-bodyweight');assert.equal(app.run("$('#modal [name=\"bodyWeight\"]').value"),'68');app.modalAction('clear');assert.equal(getSessionBodyWeight(app.state,d.active.id,'kg',metadata(storage)),null);assert.equal(app.state.active.movements[0].overrideWeight,73);
});

test('history bodyweight picker lists only actual recorded sessions and never copies current baseline backwards',()=>{
 const d=fixture({active:true,history:true}),{app,storage}=setup(d);new ExerciseMetaRepository(storage).setSessionBodyWeight(d,d.active.id,'kg',68);app.action('health-open');app.action('health-bodyweight-picker');
 assert.match(app.modalHtml,/正在训练/);assert.equal((app.modalHtml.match(/data-modal="session-/g)??[]).length,2);app.modalAction('session-1');assert.equal(app.run("$('#modal [name=\"bodyWeight\"]').value"),'');const train=storage.getItem(KEY);app.submit({bodyWeight:'67',bodyUnit:'kg'});
 assert.equal(getSessionBodyWeight(d,d.history[0].id,'kg',metadata(storage)),67);assert.equal(getSessionBodyWeight(d,d.active.id,'kg',metadata(storage)),68);assert.equal(storage.getItem(KEY),train);
});

test('invalid bodyweight and quota errors keep dialog and raw values, then clear is scoped to selected unit',()=>{
 const d=fixture({active:true}),{app,storage}=setup(d);app.action('session-bodyweight');const before=storage.getItem(EXERCISE_META_KEY),train=storage.getItem(KEY);
 for(const bodyWeight of ['', '0','-1','NaN','10001']){app.submit({bodyWeight,bodyUnit:'kg'});assert.equal(app.modalOpen,true);assert.match(app.toast,/未保存/);assert.equal(storage.getItem(EXERCISE_META_KEY),before);}
 storage.fail=true;app.submit({bodyWeight:'68',bodyUnit:'kg'});assert.equal(app.modalOpen,true);assert.equal(storage.getItem(EXERCISE_META_KEY),before);assert.equal(storage.getItem(KEY),train);storage.fail=false;app.submit({bodyWeight:'68',bodyUnit:'kg'});assert.match(app.toast,/已保存/);
});

test('failed pending training input save prevents bodyweight modal without losing legal input',()=>{
 const d=fixture({active:true}),{app,storage}=setup(d);app.run("$('#weight').value='77.5';$('#note').value='仍保留'");storage.fail=true;app.action('session-bodyweight');assert.equal(app.modalOpen,false);assert.equal(app.run("$('#weight').value"),'77.5');assert.equal(app.run("$('#note').value"),'仍保留');assert.equal(metadata(storage).bodyweightSessions,undefined);
});

test('bodyweight selection uses only real session units and does not convert or carry values across units',()=>{
 const d=fixture({active:true});d.active.movements[1].exercise.unit='lb';const {app,storage}=setup(d);new ExerciseMetaRepository(storage).setSessionBodyWeight(d,d.active.id,'kg',68);app.action('session-bodyweight');assert.match(app.modalHtml,/<option value="lb"/);
 app.run("$('#modal [name=\"bodyUnit\"]').value='lb';for(const listener of $('#modal [name=\"bodyUnit\"]').listeners.change??[])listener();");assert.equal(app.run("$('#modal [name=\"bodyWeight\"]').value"),'');app.submit({bodyWeight:'150',bodyUnit:'lb'});assert.equal(getSessionBodyWeight(d,d.active.id,'lb',metadata(storage)),150);assert.equal(getSessionBodyWeight(d,d.active.id,'kg',metadata(storage)),68);
 app.action('session-bodyweight');app.run("$('#modal [name=\"bodyUnit\"]').value='lb'");app.modalAction('clear');assert.equal(getSessionBodyWeight(d,d.active.id,'lb',metadata(storage)),null);assert.equal(getSessionBodyWeight(d,d.active.id,'kg',metadata(storage)),68);
});

test('complete UI flow records 73, confirms session bodyweight 68, finishes and reports extra 5 with original names and old history intact',()=>{
 const d=fixture({active:true,history:true}),{app,storage}=setup(d),beforeHistory=structuredClone(d.history),sessionID=d.active.id,names=d.plans[0].exercises.map(e=>e.name);
 app.run("$('#weight').value='73'");app.action('session-bodyweight');app.submit({bodyWeight:'68',bodyUnit:'kg'});app.action('record',{reps:'8'});
 assert.equal(app.state.active.movements[0].sets[0].weight,73);assert.equal(app.state.active.movements[0].sets[0].reps,8);app.action('finish');app.modalAction('confirm');
 assert.equal(app.state.active,null);assert.equal(app.state.history[0].id,sessionID);assert.deepEqual(app.state.history.slice(1),beforeHistory);assert.deepEqual(app.state.plans[0].exercises.map(e=>e.name),names);
 const raw=storage.getItem(KEY);app.action('health-open');app.action('health-report');assert.match(app.modalHtml,/用户已命名的自重动作/);assert.match(app.modalHtml,/体重68kg＋额外负重5kg（原记录73kg）/);assert.match(app.modalHtml,/体重与附加未拆分/);assert.doesNotMatch(app.modalHtml,/龙悬/);assert.equal(storage.getItem(KEY),raw);assert.equal(storage.getItem(HEALTH_KEY),null);
});
