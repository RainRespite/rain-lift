import test from 'node:test';
import assert from 'node:assert/strict';
import {exercise,initial,start,record,finish,KEY} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

test('editing a planned exercise directly renames it and keeps its history after reload',()=>{
 const d=initial(),p=d.plans[0],id=p.exercises[0].id;
 start(d,p.id);record(d,d.active.movements[0].id,10,32.5);finish(d);
 const originalHistory=structuredClone(d.history),app=createAppHarness(d);
 app.action('plan-edit',{id:p.id});app.modalAction('edit-0');
 assert.doesNotMatch(app.modalHtml,/name="identity"/);
 app.submit({name:'龙下胸'});app.submit();
 assert.equal(app.state.plans[0].exercises[0].id,id);
 assert.equal(app.state.plans[0].exercises[0].name,'龙下胸');
 assert.deepEqual(app.state.history,originalHistory);
 const reloaded=createAppHarness(JSON.parse(app.storage.getItem(KEY)));
 reloaded.action('nav',{view:'history'});
 assert.match(reloaded.html,/<b>龙下胸<\/b>/);
 reloaded.action('history-open',{id});
 assert.match(reloaded.html,/<h1>龙下胸<\/h1>/);
 assert.match(reloaded.html,/32.5/);
 assert.doesNotMatch(reloaded.html,/归属待确认/);
});

test('legacy same-ID renamed history remains visible under current name and retains original session names',()=>{
 const d=initial(),p=d.plans[0];p.exercises=[exercise('绳索侧平举',5)];
 const e=p.exercises[0];start(d,p.id);record(d,d.active.movements[0].id,15,7.5);finish(d);
 e.name='龙侧平举';const app=createAppHarness(d);
 app.action('nav',{view:'history'});
 assert.match(app.html,/<b>龙侧平举<\/b>/);
 assert.doesNotMatch(app.html,/归属待确认/);
 app.action('history-open',{id:e.id});
 assert.match(app.html,/<h1>龙侧平举<\/h1>/);
 assert.match(app.html,/绳索侧平举/);
 assert.match(app.html,/7.5/);
});

test('renaming a recorded active movement preserves recorded sets and exercise identity',()=>{
 const d=initial(),p=d.plans[0];start(d,p.id);
 const m=d.active.movements[0];record(d,m.id,12,20);
 const app=createAppHarness(d);app.action('manage');app.modalAction('edit-0');
 assert.doesNotMatch(app.modalHtml,/name="identity"/);
 app.submit({name:'龙下胸'});
 assert.equal(app.state.active.movements[0].exercise.id,m.exercise.id);
 assert.equal(app.state.active.movements[0].exercise.name,'龙下胸');
 assert.deepEqual(app.state.active.movements[0].sets,m.sets);
 assert.equal(app.state.plans[0].exercises[0].name,'龙下胸');
 assert.equal(app.state.rest.name,'龙下胸');
 app.action('finish');app.modalAction('confirm');
 app.action('nav',{view:'history'});
 assert.match(app.html,/<b>龙下胸<\/b>/);
});

test('a saved rename updates current references across plans while a cancelled draft does not',()=>{
 const d=initial(),p=d.plans[0],e=p.exercises[0];
 d.plans[1].exercises=[structuredClone(e)];start(d,p.id);
 const app=createAppHarness(d);
 app.run('planEditor(structuredClone(db().plans[0]))');app.modalAction('edit-0');
 app.submit({name:'龙下胸'});app.modalAction('close');
 assert.equal(app.state.plans[1].exercises[0].name,e.name);
 assert.equal(app.state.active.movements[0].exercise.name,e.name);
 app.run('planEditor(structuredClone(db().plans[0]))');app.modalAction('edit-0');
 app.submit({name:'龙下胸',weight:'99'});app.submit();
 assert.equal(app.state.plans[1].exercises[0].name,'龙下胸');
 assert.equal(app.state.active.movements[0].exercise.name,'龙下胸');
 assert.equal(app.state.active.movements[0].exercise.weight,e.weight);
 assert.equal(app.state.plans[1].exercises[0].weight,e.weight);
});

test('saving todays arrangement cannot let later renames rewrite completed session snapshots',()=>{
 const d=initial(),p=d.plans[0];start(d,p.id);record(d,d.active.movements[0].id,10,30);
 const app=createAppHarness(d);
 app.action('manage');app.modalAction('template');app.modalAction('confirm');
 app.action('finish');app.modalAction('confirm');
 const history=structuredClone(app.state.history);
 app.action('start',{id:p.id});app.action('manage');app.modalAction('edit-0');
 app.submit({name:'龙下胸'});
 assert.deepEqual(app.state.history,history);
 assert.equal(app.state.plans[0].exercises[0].name,'龙下胸');
});

test('saving an unrelated plan setting tolerates older aliases without renaming other references',()=>{
 const d=initial(),p=d.plans[0],e=p.exercises[0];
 d.plans[1].exercises=[{...structuredClone(e),name:'另一个旧名',knownNames:['另一个旧名']}];
 const app=createAppHarness(d);app.action('plan-edit',{id:p.id});app.submit({planName:'肩计划'});
 assert.equal(app.state.plans[0].name,'肩计划');
 assert.equal(app.state.plans[1].exercises[0].name,'另一个旧名');
 assert.equal(app.modalOpen,false);
});
