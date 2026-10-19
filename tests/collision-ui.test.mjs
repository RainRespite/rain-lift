import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,exercise,initial,start,record,finish,previous} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function collision(){
 const d=initial(),chest=exercise('龙下胸',45),raise={...structuredClone(chest),name:'龙侧平举',weight:10};
 d.plans[0].exercises=[chest];d.plans[1].exercises=[raise];
 start(d,d.plans[0].id);record(d,d.active.movements[0].id,20,45);finish(d);d.history[0].started=1000;
 start(d,d.plans[1].id);record(d,d.active.movements[0].id,25,10);finish(d);d.history[0].started=2000;
 return d;
}

test('history exposes a collision and explicit repair separates both histories with a recoverable backup',()=>{
 const d=collision(),app=createAppHarness(d),id=d.plans[0].exercises[0].id,raw=app.storage.getItem(KEY);
 app.action('nav',{view:'history'});
 assert.match(app.html,/history-resolve/);
 app.action('history-resolve',{id});app.modalAction('split');
 const next=app.state,chest=next.plans[0].exercises[0],raise=next.plans[1].exercises[0];
 assert.notEqual(chest.id,raise.id);
 assert.equal(previous(next,chest.id).sets[0].weight,45);
 assert.equal(previous(next,raise.id).sets[0].weight,10);
 assert.equal(app.storage.getItem(KEY+'.before-identity-repair'),raw);
 const reloaded=createAppHarness(JSON.parse(app.storage.getItem(KEY)));
 reloaded.action('history-open',{id:chest.id});
 assert.match(reloaded.html,/45/);assert.doesNotMatch(reloaded.html,/龙侧平举/);
});

test('editing an unresolved collision opens the resolver before it can rename the other plan',()=>{
 const d=collision(),app=createAppHarness(d);
 app.action('plan-edit',{id:d.plans[0].id});app.modalAction('edit-0');
 assert.match(app.modalHtml,/data-modal="split"/);
 assert.deepEqual(app.state,d);
});

test('an explicit same-action confirmation preserves one identity and every historical snapshot',()=>{
 const d=collision(),app=createAppHarness(d),id=d.plans[0].exercises[0].id;
 app.action('history-resolve',{id});app.modalAction('same');app.submit({canonical:'龙下胸'});
 assert.equal(app.state.plans[0].exercises[0].id,id);
 assert.equal(app.state.plans[1].exercises[0].id,id);
 assert.equal(app.state.plans[1].exercises[0].name,'龙下胸');
 assert.deepEqual(app.state.history,d.history);
});

test('failure to save the repair backup cannot acknowledge or persist a split',()=>{
 const d=collision(),app=createAppHarness(d),raw=app.storage.getItem(KEY);
 app.action('history-resolve',{id:d.plans[0].exercises[0].id});app.storage.fail=true;app.modalAction('split');
 assert.deepEqual(app.state,d);assert.equal(app.storage.getItem(KEY),raw);
 assert.equal(app.modalOpen,true);
});

test('removing or deleting a plan cannot make unresolved mixed histories appear valid',()=>{
 for(const operation of ['remove','delete']){
  const d=collision(),app=createAppHarness(d);app.action('plan-edit',{id:d.plans[1].id});
  if(operation==='remove'){app.modalAction('remove-0');app.submit();}
  else{app.modalAction('delete');app.modalAction('confirm');}
  assert.deepEqual(app.state,d);
  assert.match(app.toast,/整理|关联|归属/);
 }
});

test('the picker shows both unresolved names and routes a selection to the resolver',()=>{
 const d=collision(),app=createAppHarness(d);app.action('start',{id:d.plans[0].id});
 app.action('manage');app.modalAction('add');
 assert.match(app.modalHtml,/龙下胸/);assert.match(app.modalHtml,/龙侧平举/);
 const before=app.state;app.modalAction('choose-1');
 assert.match(app.modalHtml,/data-modal="split"/);
 assert.deepEqual(app.state,before);
});
