import test from 'node:test';
import assert from 'node:assert/strict';
import {initial, exercise, start, record, finish, Repository, KEY} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function fixture({active=false, recorded=false}={}) {
 const d=initial();
 d.plans[0].exercises=['器械卧推','哑铃推肩','侧平举','绳索面拉','坐姿划船'].map(name=>exercise(name));
 if(active){start(d,d.plans[0].id);if(recorded)record(d,d.active.movements[0].id,10,68);}
 return d;
}
const names=xs=>xs.map(x=>x.exercise?.name??x.name);
function planMove(h,from,to){h.modalAction('order-'+from);h.submit({position:String(to)});}
function activeMove(h,from,to){h.modalAction('order-'+from);h.submit({position:String(to)});}

test('regression: moving the implicit first selection keeps the current training movement',()=>{
 const d=fixture({active:true}),id=d.active.movements[0].id,h=createAppHarness(d);
 h.action('manage');h.modalAction('down-0');
 assert.equal(h.run('movement().id'),id);
});

test('regression: training sorting preserves legal weight and note before change/blur',()=>{
 const d=fixture({active:true}),id=d.active.movements[0].id,h=createAppHarness(d);
 h.run("$('#weight').value='67.5';$('#note').value='尚未失焦的备注'");
 h.action('manage');h.modalAction('down-0');
 assert.equal(h.state.active.movements.find(m=>m.id===id).overrideWeight,67.5);
 assert.equal(h.state.active.note,'尚未失焦的备注');
 assert.equal(h.run("$('#weight').value"),'67.5');
});

for(const [from,to,expected] of [
 [4,1,['坐姿划船','器械卧推','哑铃推肩','侧平举','绳索面拉']],
 [4,2,['器械卧推','坐姿划船','哑铃推肩','侧平举','绳索面拉']],
 [0,5,['哑铃推肩','侧平举','绳索面拉','坐姿划船','器械卧推']]
])test(`fixed draft move ${from+1} to ${to} saves exact stable order and reloads`,()=>{
 const d=fixture(),other=structuredClone(d.plans[1]),h=createAppHarness(d);
 h.action('plan-edit',{id:d.plans[0].id});planMove(h,from,to);
 assert.deepEqual(h.state,d);assert.ok(expected.every((name,i)=>h.modalHtml.indexOf(name)<(i===expected.length-1?Infinity:h.modalHtml.indexOf(expected[i+1]))));
 h.submit();const reloaded=new Repository(h.storage).db;
 assert.deepEqual(names(reloaded.plans[0].exercises),expected);
 assert.deepEqual(reloaded.plans[1],other);
 assert.deepEqual(new Set(reloaded.plans[0].exercises.map(e=>e.id)),new Set(d.plans[0].exercises.map(e=>e.id)));
});

test('consecutive moves and repeated same position preserve the plan name and other relative order',()=>{
 const d=fixture(),h=createAppHarness(d);h.action('plan-edit',{id:d.plans[0].id});h.field('planName','新的计划名称');
 planMove(h,4,1);planMove(h,4,2);planMove(h,1,2);h.submit();
 assert.equal(h.state.plans[0].name,'新的计划名称');
 assert.deepEqual(names(h.state.plans[0].exercises),['坐姿划船','绳索面拉','器械卧推','哑铃推肩','侧平举']);
});

test('cancelling position selection or the fixed plan leaves persistent data unchanged',()=>{
 const d=fixture(),h=createAppHarness(d);h.action('plan-edit',{id:d.plans[0].id});
 h.modalAction('order-4');h.modalAction('back');assert.deepEqual(h.state,d);
 planMove(h,4,1);h.modalAction('close');assert.deepEqual(new Repository(h.storage).db,d);
 h.action('plan-edit',{id:d.plans[0].id});assert.ok(h.modalHtml.indexOf('器械卧推')<h.modalHtml.indexOf('坐姿划船'));
});

test('active move preserves all sets, timestamps, note, selection and rest; fixed plan/history are unchanged',()=>{
 const d=fixture({active:true,recorded:true});d.active.note='已有训练备注';
 const activeID=d.active.movements[0].id,h=createAppHarness(d),before=h.state;
 h.action('manage');activeMove(h,0,5);
 assert.equal(h.run('movement().id'),activeID);
 assert.equal(h.state.active.note,before.active.note);
 assert.deepEqual(h.state.active.movements.find(m=>m.id===activeID).sets,before.active.movements[0].sets);
 assert.deepEqual(h.state.rest,before.rest);assert.deepEqual(h.state.plans,before.plans);assert.deepEqual(h.state.history,before.history);
 assert.deepEqual(names(new Repository(h.storage).db.active.movements),['哑铃推肩','侧平举','绳索面拉','坐姿划船','器械卧推']);
});

test('an explicitly selected movement remains selected after another movement crosses it',()=>{
 const d=fixture({active:true}),id=d.active.movements[2].id,h=createAppHarness(d);h.action('select',{id});h.action('manage');
 activeMove(h,4,1);activeMove(h,0,5);activeMove(h,2,3);
 assert.equal(h.run('movement().id'),id);
});

test('only an explicit confirmed fixed-plan update synchronizes active order',()=>{
 const d=fixture({active:true,recorded:true}),h=createAppHarness(d);h.action('manage');activeMove(h,4,2);
 assert.deepEqual(h.state.plans,d.plans);h.modalAction('template');h.modalAction('cancel');assert.deepEqual(h.state.plans,d.plans);
 h.action('manage');h.modalAction('template');h.modalAction('confirm');
 assert.deepEqual(names(h.state.plans[0].exercises),names(h.state.active.movements));
 assert.deepEqual(h.state.active.movements.find(m=>m.id===d.active.movements[0].id).sets,d.active.movements[0].sets);
});

test('fixed save failure retains the order draft and reports failure without claiming success',()=>{
 const d=fixture(),h=createAppHarness(d);h.action('plan-edit',{id:d.plans[0].id});planMove(h,4,1);h.storage.fail=true;h.submit();
 assert.deepEqual(h.state,d);assert.equal(h.modalOpen,true);assert.doesNotMatch(h.toast,/已保存|成功/);
 assert.deepEqual(JSON.parse(h.storage.getItem(KEY)),d);
});

test('active order save failure preserves the old preview, records, timer and storage',()=>{
 const d=fixture({active:true,recorded:true}),h=createAppHarness(d);h.action('manage');h.modalAction('order-4');h.storage.fail=true;h.submit({position:'1'});
 assert.deepEqual(h.state,d);assert.equal(h.modalOpen,true);assert.doesNotMatch(h.toast,/已保存|成功/);
 assert.deepEqual(JSON.parse(h.storage.getItem(KEY)),d);
});

test('failed pending input save prevents opening a sort dialog and keeps entered inputs',()=>{
 const d=fixture({active:true}),h=createAppHarness(d);h.run("$('#weight').value='77.5';$('#note').value='仍保留'");h.storage.fail=true;h.action('manage');
 assert.equal(h.modalOpen,false);assert.equal(h.run("$('#weight').value"),'77.5');assert.equal(h.run("$('#note').value"),'仍保留');assert.deepEqual(h.state,d);
});

test('position menu lists every destination, marks the current position and supports one item',()=>{
 const d=fixture(),h=createAppHarness(d);h.action('plan-edit',{id:d.plans[0].id});h.modalAction('order-2');
 assert.equal((h.modalHtml.match(/<option /g)??[]).length,5);assert.match(h.modalHtml,/<option value="3" selected>/);assert.match(h.modalHtml,/最后一位/);
 const one=fixture();one.plans[0].exercises.splice(1);const x=createAppHarness(one);x.action('plan-edit',{id:one.plans[0].id});planMove(x,0,1);x.submit();assert.deepEqual(x.state,one);
});

test('invalid destinations cannot corrupt a plan or active workout',()=>{
 for(const active of [false,true]){
  const d=fixture({active}),h=createAppHarness(d);if(active)h.action('manage');else h.action('plan-edit',{id:d.plans[0].id});
  h.modalAction('order-0');for(const position of ['0','6','1.5','NaN']){h.submit({position});assert.deepEqual(h.state,d);assert.equal(h.modalOpen,true);}
 }
});

test('a stale active-order callback resolves by movement ID instead of an old array index',()=>{
 const d=fixture({active:true}),h=createAppHarness(d),id=d.active.movements[4].id;h.action('manage');h.modalAction('order-4');
 h.run('repo.change(d=>d.active.movements.unshift(d.active.movements.pop()))');h.submit({position:'2'});
 assert.equal(h.state.active.movements[1].id,id);
 assert.deepEqual(names(h.state.active.movements),['器械卧推','坐姿划船','哑铃推肩','侧平举','绳索面拉']);
});
