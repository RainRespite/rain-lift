import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,start,KEY} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function events(target={}) {
 const listeners={};
 return Object.assign(target,{addEventListener(type,fn){(listeners[type]??=[]).push(fn);},async emit(type){for(const fn of listeners[type]??[])await fn();}});
}
function phone(database=initial(),controlled=true) {
 let reloads=0,checks=0,registrationOptions;
 const registration=events({active:{},installing:null,waiting:null,async update(){checks++;}});
 const worker=events({controller:controlled?{}:null,ready:Promise.resolve(registration),async register(path,options){registrationOptions=options;return registration;}});
 const window=events({location:{href:'https://example.test/rain-lift/',reload(){reloads++;}}});
 const app=createAppHarness(database,{globals:{window,navigator:{onLine:true,serviceWorker:worker},location:window.location}});
 return {app,window,worker,registration,get options(){return registrationOptions;},get checks(){return checks;},get reloads(){return reloads;}};
}

test('opening the saved app checks for updates without the worker HTTP cache',async()=>{
 const p=phone();await p.window.emit('load');
 assert.equal(p.options?.updateViaCache,'none');
 assert.equal(p.checks,1);
});

test('a new controlling worker shows a refresh action without reloading or touching records or an open draft',async()=>{
 const p=phone();await p.window.emit('load');
 p.app.action('plan-edit',{id:p.app.state.plans[0].id});p.app.field('planName','尚未保存的计划名称');
 const draft=p.app.modalHtml,raw=p.app.storage.getItem(KEY);
 await p.worker.emit('controllerchange');
 assert.match(p.app.updateNotice,/刷新到新版/);
 assert.equal(p.reloads,0);assert.equal(p.app.modalOpen,true);assert.equal(p.app.modalHtml,draft);
 assert.equal(p.app.storage.getItem(KEY),raw);
 p.app.action('app-reload');assert.equal(p.reloads,0);assert.match(p.app.toast,/保存|关闭/);
 p.app.submit();p.app.action('app-reload');assert.equal(p.reloads,1);
 assert.equal(p.app.state.plans[0].name,'尚未保存的计划名称');
});

test('foreground checks are throttled but the manual check always checks',async()=>{
 const p=phone();await p.window.emit('load');await p.window.emit('online');
 assert.equal(p.checks,1);
 p.app.action('app-update');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.checks,2);
});

test('a first offline installation does not claim a new version needs reloading',async()=>{
 const p=phone(initial(),false);await p.window.emit('load');
 await p.worker.emit('controllerchange');assert.equal(p.app.updateNotice,'');assert.equal(p.reloads,0);
});

test('network changes and update checks preserve unsaved training input',async()=>{
 const d=initial();start(d,d.plans[0].id);const p=phone(d);await p.window.emit('load');
 p.app.run("$('#weight').value='48';$('#note').value='草稿'");
 await p.window.emit('online');await p.window.emit('offline');
 assert.equal(p.app.run("$('#weight').value"),'48');assert.equal(p.app.run("$('#note').value"),'草稿');
});

test('refresh saves current training input before navigating',async()=>{
 const d=initial();start(d,d.plans[0].id);const p=phone(d);await p.window.emit('load');
 p.app.run("$('#weight').value='37.5';$('#note').value='还没失焦的备注'");
 p.app.action('app-reload');
 assert.equal(p.reloads,1);assert.equal(p.app.state.active.movements[0].overrideWeight,37.5);
 assert.equal(p.app.state.active.note,'还没失焦的备注');
});
