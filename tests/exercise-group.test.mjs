import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,parseBackup,validate,identityConflict,start,usedExerciseGroups,exerciseGroupLabel,normalizeGroupName,syncExerciseGroup,uid,Repository} from '../dist/data.js';
import {exportFull,restoreFull} from '../dist/backup.js';
import {createAppHarness,Storage} from './helpers/app-harness.mjs';

const withGroup=(d,name,group)=>{d.plans[0].exercises=[{...exercise(name),group}];return d;};

test('exercises stay valid with or without a category and old backups still import',()=>{
 const plain=initial();validate(plain);
 assert.equal(plain.plans[0].exercises.every(e=>exerciseGroupLabel(e)===null),true);
 const grouped=initial();grouped.plans[0].exercises=[exercise('卧推'),{...exercise('深蹲'),group:'腿'},{...exercise('划船'),group:'上背 厚度'}];validate(grouped);
 assert.equal(exerciseGroupLabel(grouped.plans[0].exercises[2]),'上背 厚度');
 for(const bad of ['','   ','一'.repeat(25),5,{}]){const d=initial();d.plans[0].exercises[0].group=bad;assert.throws(()=>validate(d),/训练数据不正确/,JSON.stringify(bad));}
 assert.doesNotThrow(()=>validate(withGroup(initial(),'腕 curl','手臂')));
});

test('the six defaults always lead the list and custom labels only appear while in use',()=>{
 const d=initial();
 assert.deepEqual(usedExerciseGroups(d),['背','肩','胸','腿','核心','手臂']);
 d.plans[1].exercises.push({...exercise('椭圆机'),group:'有氧'},{...exercise('登山跑'),group:'有氧'});
 d.active={id:uid(),planID:d.plans[0].id,name:'临时',started:Date.now(),ended:null,note:'',movements:[{id:uid(),exercise:{...exercise('悬垂举腿'),group:'核心加强'},sets:[],skipped:false}]};
 assert.deepEqual(usedExerciseGroups(d).slice(6),['核心加强','有氧']);
 syncExerciseGroup(d,d.plans[1].exercises.at(-2).id,null);
 assert.deepEqual(usedExerciseGroups(d).slice(6),['核心加强','有氧'],'另一个动作还在用就保留');
 validate(d);
 syncExerciseGroup(d,d.plans[1].exercises.at(-1).id,null);
 assert.deepEqual(usedExerciseGroups(d).slice(6),['核心加强'],'没人用了就自动消失');
});

test('normalizeGroupName collapses spacing and caps length',()=>{
 assert.equal(normalizeGroupName('   '),null);assert.equal(normalizeGroupName(''),null);
 assert.equal(normalizeGroupName(' 上肢   推拉 '),'上肢 推拉');
 assert.equal(normalizeGroupName(null),null);
 assert.equal(normalizeGroupName('一'.repeat(24)).length,24);
 assert.throws(()=>normalizeGroupName('一'.repeat(25)),/24 字/);
});

test('a category follows the exercise identity across plans and the active session',()=>{
 const d=initial();const shared=exercise('硬拉');
 d.plans[0].exercises.push(shared);d.plans[1].exercises.push(structuredClone(shared));
 start(d,d.plans[0].id);const live=d.active.movements.find(m=>m.exercise.id===shared.id);
 d.history=[{id:uid(),planID:d.plans[0].id,name:'上周',started:Date.now()-864e5,ended:Date.now()-860e5,note:'',movements:[{id:uid(),exercise:{...structuredClone(shared),group:'腿'},sets:[{id:uid(),weight:100,reps:5,date:Date.now()-863e5}],skipped:false}]}];
 assert.equal(syncExerciseGroup(d,shared.id,'背'),3);
 validate(d);
 assert.equal(d.plans[0].exercises.find(e=>e.id===shared.id).group,'背');
 assert.equal(d.plans[1].exercises.find(e=>e.id===shared.id).group,'背');
 assert.equal(live.exercise.group,'背');
 assert.equal(d.history[0].movements[0].exercise.group,'腿','历史快照保留当时的分类');
 assert.equal(syncExerciseGroup(d,shared.id,null),3);
 assert.equal(Object.hasOwn(d.plans[1].exercises.find(e=>e.id===shared.id),'group'),false);
});

test('an unresolved identity still blocks category edits like renames do',()=>{
 const d=initial();const shared=exercise('卧推');
 d.plans[0].exercises.push(shared);d.plans[1].exercises.push({...structuredClone(shared),name:'杠铃卧推'});
 assert.equal(identityConflict(d,shared.id),true);
 assert.throws(()=>syncExerciseGroup(d,shared.id,'胸'),/旧历史关联/);
});

test('the repository stores the category so training backups keep it',()=>{
 const storage=new Storage();const d=withGroup(initial(),'坐姿划船','背');storage.setItem(KEY,JSON.stringify(d));
 const repo=new Repository(storage);
 repo.change(x=>{x.plans[0].exercises[0].group='上背';});
 assert.equal(JSON.parse(storage.getItem(KEY)).plans[0].exercises[0].group,'上背');
 const reloaded=new Repository(storage);
 assert.equal(reloaded.db.plans[0].exercises[0].group,'上背');
 repo.change(x=>{syncExerciseGroup(x,x.plans[0].exercises[0].id,null);});
 assert.equal(Object.hasOwn(JSON.parse(storage.getItem(KEY)).plans[0].exercises[0],'group'),false);
});

test('the exercise form offers the categories and writes the picked one',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('plan-edit',{id:d.plans[0].id});
 h.modalAction('edit-0');
 for(const label of ['背','肩','胸','腿','核心','手臂'])assert.ok(h.modalHtml.includes(`value="${label}"`),label);
 assert.doesNotMatch(h.modalHtml,/value="" checked/,'未分类时不预选');
 assert.doesNotMatch(h.modalHtml,/未分类/);
 h.submit({group:'背'});h.submit();
 assert.equal(h.state.plans[0].exercises[0].group,'背');
 assert.match(h.html,/宽距高位下拉/);
 h.action('plan-edit',{id:d.plans[0].id});
 assert.match(h.modalHtml,/class="editor-item"><div><b>1\. 宽距高位下拉<\/b><i class="grp-tag">背<\/i>/);
 h.modalAction('edit-0');assert.match(h.modalHtml,/value="背" checked/);
 assert.match(h.modalHtml,/name="groupNew"/);
});

test('a custom category becomes selectable for other exercises and clearing removes it',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('plan-edit',{id:d.plans[0].id});h.modalAction('edit-1');h.submit({groupNew:' 有氧 '});h.submit();
 assert.equal(h.state.plans[0].exercises[1].group,'有氧');
 h.action('plan-edit',{id:d.plans[1].id});h.modalAction('edit-0');
 assert.match(h.modalHtml,/name="group" value="有氧"/);
 h.submit({group:'有氧'});h.submit();
 assert.equal(h.state.plans[1].exercises[0].group,'有氧');
 assert.equal(new Repository(h.storage).db.plans[0].exercises[1].group,'有氧');
 h.action('plan-edit',{id:d.plans[1].id});h.modalAction('edit-0');
 assert.match(h.modalHtml,/value="有氧" checked/);assert.match(h.modalHtml,/value=""><span>清除/);
 h.submit({group:''});h.submit();
 assert.equal(Object.hasOwn(new Repository(h.storage).db.plans[1].exercises[0],'group'),false);
 h.action('plan-edit',{id:d.plans[0].id});h.modalAction('edit-1');
 assert.match(h.modalHtml,/value="有氧" checked/,'另一个动作仍在使用时候选保留');
 h.submit({group:''});h.submit();
 assert.equal(Object.hasOwn(new Repository(h.storage).db.plans[0].exercises[1],'group'),false);
 h.action('plan-edit',{id:d.plans[0].id});h.modalAction('edit-2');
 assert.doesNotMatch(h.modalHtml,/name="group" value="有氧"/,'不再被使用就退出候选');
 assert.doesNotMatch(h.modalHtml,/name="group" value=""</,'没有已选分类时不出现清除');
});

test('an ambiguous category entry keeps the typed name over the radio and survives a reload',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('plan-edit',{id:d.plans[0].id});h.modalAction('edit-2');
 h.submit({group:'腿',groupNew:'小腿'});h.submit();
 assert.equal(new Repository(h.storage).db.plans[0].exercises[2].group,'小腿');
 h.action('plan-edit',{id:d.plans[0].id});assert.match(h.modalHtml,/grp-tag">小腿/);
});

test('training rows show the category and the in-session editor syncs plans',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');
 assert.match(h.modalHtml,/宽距高位下拉<\/b><i class="grp-tag">背<\/i>/);
 assert.match(h.html,/宽距高位下拉/);
 h.modalAction('add');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-0">背<\/button>/,'顶部先选主类');
 assert.match(h.modalHtml,/class="grp-tab" data-modal="tab-1">无主类<\/button>/);
 assert.match(h.modalHtml,/class="library-item"[^>]*>宽距高位下拉<span>/);
 assert.doesNotMatch(h.modalHtml,/>坐姿划船<span>/,'只列出当前主类的动作');
 h.modalAction('tab-1');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-1">无主类<\/button>/);
 assert.match(h.modalHtml,/>坐姿划船<span>/);
 assert.doesNotMatch(h.modalHtml,/>宽距高位下拉<span>/);
 h.modalAction('tab-0');
 assert.match(h.modalHtml,/>宽距高位下拉<span>/);
 h.modalAction('back');
 h.modalAction('edit-0');h.submit({group:'胸'});
 const state=h.state;
 assert.equal(state.active.movements[0].exercise.group,'胸');
 assert.equal(state.plans[0].exercises[0].group,'胸','计划里的同一动作一起更新');
 assert.equal(state.active.movements[0].sets.length,0);
});

test('replacing a movement opens the picker on its own category',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';d.plans[0].exercises[1].group='肩';start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');h.modalAction('replace-1');
 assert.match(h.modalHtml,/更换动作/);
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-1">肩<\/button>/);
 assert.match(h.modalHtml,/>坐姿划船<span>/);
 assert.doesNotMatch(h.modalHtml,/>宽距高位下拉<span>/,'别的类不混进当前列表');
});

test('training and full backups carry the category across devices',()=>{
 const d=withGroup(initial(),'杠铃划船','背');
 assert.equal(parseBackup(JSON.stringify(d)).plans[0].exercises[0].group,'背');
 const storage=new Storage();storage.setItem(KEY,JSON.stringify(d));
 const backup=exportFull(storage,d);
 assert.match(backup.parts[KEY],/"group":"背"/);
 const phone=new Storage();restoreFull(phone,backup);
 assert.equal(JSON.parse(phone.getItem(KEY)).plans[0].exercises[0].group,'背');
 const legacy=new Storage();legacy.setItem(KEY,JSON.stringify(initial()));
 assert.equal(new Repository(legacy).db.plans[0].exercises[0].group,undefined,'旧备份没有这个字段也能打开');
});

test('a category used only by the live session still joins the candidates and the plan later',()=>{
 const d=initial();start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');h.modalAction('add');h.modalAction('new');
 h.submit({name:'保加利亚分腿蹲',group:'腿'});
 assert.equal(h.state.active.movements.at(-1).exercise.group,'腿');
 assert.match(h.modalHtml,/保加利亚分腿蹲<\/b><i class="grp-tag">腿<\/i>/);
 h.modalAction('edit-3');
 assert.match(h.modalHtml,/name="group" value="腿" checked/,'还没写进计划也进入候选');
 h.modalAction('back');h.modalAction('template');h.modalAction('confirm');
 const saved=new Repository(h.storage).db;
 const added=saved.plans[0].exercises.at(-1);
 assert.equal(added.name,'保加利亚分腿蹲');assert.equal(added.group,'腿','更新固定计划把主类一起带过去');
 h.action('manage');h.modalAction('add');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-0">腿<\/button>/);
 assert.match(h.modalHtml,/class="library-item"[^>]*>保加利亚分腿蹲<span>/);
});
