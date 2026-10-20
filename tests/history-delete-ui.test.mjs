import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,start,record,finish,KEY,previous} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function fixture(){
 const d=initial(),plan=d.plans[0];
 for(const weight of [30,40]){start(d,plan.id);record(d,d.active.movements[0].id,10,weight);finish(d);}
 d.history[0].started=2000;d.history[0].ended=3000;d.history[1].started=1000;d.history[1].ended=1500;
 start(d,plan.id);record(d,d.active.movements[0].id,12,50);
 return d;
}

test('session deletion requires confirmation, supports cancel, and removes only the selected finished session',()=>{
 const d=fixture(),app=createAppHarness(d),id=d.history[0].id;
 app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 assert.match(app.html,/删除这次训练/);
 app.action('history-delete',{session:id});
 assert.match(app.modalHtml,/整次训练|所有动作/);assert.match(app.modalHtml,/最近删除/);
 assert.deepEqual(app.state,d);
 app.modalAction('cancel');assert.deepEqual(app.state,d);
 app.action('history-delete',{session:id});app.modalAction('confirm');
 assert.equal(app.modalOpen,false);assert.equal(app.state.history.length,1);
 assert.deepEqual(app.state.deletedHistory[0].session,d.history[0]);
 assert.deepEqual(app.state.history[0],d.history[1]);
 assert.deepEqual(app.state.plans,d.plans);assert.deepEqual(app.state.active,d.active);assert.deepEqual(app.state.rest,d.rest);
 assert.equal(previous(app.state,d.plans[0].exercises[0].id).sets[0].weight,30);
});

test('recently deleted survives reload and restores the complete session including every set',()=>{
 const d=fixture(),app=createAppHarness(d),id=d.history[0].id;
 app.action('history-delete',{session:id});app.modalAction('confirm');
 const reloaded=createAppHarness(JSON.parse(app.storage.getItem(KEY)));
 reloaded.action('nav',{view:'history'});reloaded.action('history-tab',{tab:'deleted'});
 assert.match(reloaded.html,/恢复这次训练/);assert.doesNotMatch(reloaded.html,/data-action="history-edit"/);
 assert.doesNotMatch(reloaded.html,/data-action="history-delete"/);
 reloaded.action('history-restore',{session:id});
 assert.deepEqual(reloaded.state,d);assert.match(reloaded.html,/没有已删除的训练/);
});

test('failed deletion or recovery never acknowledges success or changes persisted records',()=>{
 const d=fixture(),app=createAppHarness(d),id=d.history[0].id,raw=app.storage.getItem(KEY);
 app.action('history-delete',{session:id});app.storage.fail=true;app.modalAction('confirm');
 assert.equal(app.modalOpen,true);assert.equal(app.storage.getItem(KEY),raw);assert.deepEqual(app.state,d);
 app.storage.fail=false;app.modalAction('confirm');const removed=app.state,removedRaw=app.storage.getItem(KEY);
 app.storage.fail=true;app.action('history-restore',{session:id});
 assert.deepEqual(app.state,removed);assert.equal(app.storage.getItem(KEY),removedRaw);
});

test('action-specific history leads to the whole training before deletion',()=>{
 const d=fixture(),app=createAppHarness(d),session=d.history[0],id=session.movements[0].exercise.id;
 app.action('history-open',{id});assert.match(app.html,/查看整次训练/);
 assert.doesNotMatch(app.html,/data-action="history-delete"/);
 app.action('history-session-open',{session:session.id});
 assert.match(app.html,/data-action="history-delete"/);assert.match(app.html,/data-tab="session" class="selected"/);
});

test('the last deleted session is still reachable when normal history becomes empty',()=>{
 const d=fixture();d.history.splice(1);const app=createAppHarness(d),id=d.history[0].id;
 app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 app.action('history-delete',{session:id});app.modalAction('confirm');
 assert.match(app.html,/还没有完成的训练/);assert.match(app.html,/最近删除 \(1\)/);
 app.action('history-tab',{tab:'deleted'});assert.match(app.html,/恢复这次训练/);
 app.action('nav',{view:'settings'});assert.match(app.html,/查看最近删除的训练 \(1\)/);
 app.action('history-deleted');assert.match(app.html,/恢复这次训练/);
});

test('a stale confirmation cannot remove another training after its target was removed',()=>{
 const d=fixture(),app=createAppHarness(d),id=d.history[0].id;
 app.action('history-delete',{session:id});app.run(`repo.change(d=>deleteHistory(d,${JSON.stringify(id)}))`);
 const state=app.state;app.modalAction('confirm');assert.deepEqual(app.state,state);assert.equal(app.modalOpen,true);
});
