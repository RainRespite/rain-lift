import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,uid,exercise,initial,start,record} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function legacy(){
 const d=initial();d.plans[0].exercises=[exercise('已练动作',0),exercise('龙悬',10),exercise('龙卷',10),exercise('反龙',10),exercise('练过后跳过',20)];
 start(d,d.plans[0].id);record(d,d.active.movements[0].id,10,0);record(d,d.active.movements[4].id,12,20);
 d.active.movements[1].skipped=true;d.active.movements[2].skipped=true;d.active.movements[4].skipped=true;
 d.active.ended=Date.now();d.history=[structuredClone(d.active)];d.active=null;d.rest=null;return d;
}

test('old session history hides skipped and unskipped zero-set actions without rewriting local records',()=>{
 const d=legacy(),app=createAppHarness(d),raw=app.storage.getItem(KEY);
 app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 assert.match(app.html,/已练动作/);assert.match(app.html,/练过后跳过/);
 assert.doesNotMatch(app.html,/龙悬|龙卷|反龙|未记录组数/);
 assert.match(app.html,/共 2 组/);assert.match(app.html,/>0 <small>/);
 assert.deepEqual(app.state,d);assert.equal(app.storage.getItem(KEY),raw);
});

test('an old completely empty workout does not leave a blank history card',()=>{
 const d=legacy(),empty=structuredClone(d.history[0]);empty.id=uid();empty.name='空训练';empty.movements.forEach(m=>m.sets=[]);d.history.unshift(empty);
 const app=createAppHarness(d);app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 assert.doesNotMatch(app.html,/空训练/);assert.match(app.html,/已练动作/);assert.deepEqual(app.state,d);
 const onlyEmpty=createAppHarness({...d,history:[empty]});onlyEmpty.action('nav',{view:'history'});onlyEmpty.action('history-tab',{tab:'session'});
 assert.match(onlyEmpty.html,/还没有完成的训练/);assert.doesNotMatch(onlyEmpty.html,/history-session/);
});

test('deleted history and restoration also hide zero-set actions while preserving the original stored snapshot',()=>{
 const d=legacy(),app=createAppHarness(d),id=d.history[0].id;
 app.action('history-delete',{session:id});app.modalAction('confirm');app.action('history-deleted');
 assert.doesNotMatch(app.html,/龙悬|龙卷|反龙|未记录组数/);assert.match(app.html,/恢复这次训练/);
 assert.deepEqual(app.state.deletedHistory[0].session,d.history[0]);
 app.action('history-restore',{session:id});app.action('history-tab',{tab:'session'});
 assert.doesNotMatch(app.html,/龙悬|龙卷|反龙|未记录组数/);assert.deepEqual(app.state,d);
});

test('deleting the last recorded set hides that movement while keeping the other performed movement',()=>{
 const d=legacy(),app=createAppHarness(d),s=d.history[0],m=s.movements[0];
 app.action('history-edit',{session:s.id,movement:m.id,id:m.sets[0].id});app.modalAction('delete');
 app.action('nav',{view:'history'});app.action('history-tab',{tab:'session'});
 assert.doesNotMatch(app.html,/已练动作|未记录组数/);assert.match(app.html,/练过后跳过/);assert.match(app.html,/共 1 组/);
});

test('ending without any recorded sets clearly confirms that it creates no history',()=>{
 const d=initial();start(d,d.plans[0].id);const app=createAppHarness(d),plans=structuredClone(d.plans);
 app.action('finish');assert.match(app.modalHtml,/不会生成训练历史/);app.modalAction('confirm');
 assert.equal(app.state.active,null);assert.deepEqual(app.state.history,[]);assert.deepEqual(app.state.plans,plans);
 assert.match(app.toast,/未生成历史/);
});
