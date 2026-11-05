import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {ROOT,unpackBaseline} from '../v1.8.5/baseline.mjs';

const recovery=process.argv[2];
if(!recovery||!process.env.RAINLIFT_PLAYWRIGHT||!process.env.RAINLIFT_CHROME)throw Error('Provide recovery directory, RAINLIFT_PLAYWRIGHT and RAINLIFT_CHROME.');
const {chromium,devices}=createRequire(import.meta.url)(process.env.RAINLIFT_PLAYWRIGHT);
const work=await mkdtemp(join(tmpdir(),'rainlift-browser-191-'));
unpackBaseline(join(work,'190'),'v1.9.0');
const roots={base:join(work,'190/dist'),candidate:resolve(ROOT,'dist'),recovery:join(recovery,'dist')};
const manifest=JSON.parse(await readFile(join(recovery,'rollback-manifest.json'),'utf8'));
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'};
let release='base',blockModule=false,failed=0,browser;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const name=path==='/rain-lift/'?'index.html':path.slice('/rain-lift/'.length);
 if(!path.startsWith('/rain-lift/')||!/^[\w.-]+\.(html|js|css|png|webmanifest)$/.test(name)){res.writeHead(404).end();return;}
 if(release==='candidate'&&blockModule&&name==='load.js'){failed++;res.writeHead(503).end();return;}
 try{const body=await readFile(join(roots[release],name));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)],'Cache-Control':'no-store'}).end(body);}
 catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const address='http://127.0.0.1:'+server.address().port+'/rain-lift/';
const db=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('rainlift.web.v2')));
const store=page=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)])));
const nav=(page,to)=>page.locator('nav [data-view="'+to+'"]').click();
const act=(page,name)=>page.locator('[data-action="'+name+'"]');
const notice=page=>page.locator('#update-notice [data-action="app-reload"]');
const workerCache=(page,key)=>page.waitForFunction(async cache=>!!navigator.serviceWorker.controller&&(await caches.keys()).includes(cache),key);
const update=page=>page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
const confirm=page=>page.locator('#modal [data-modal="confirm"]').click();
const save=page=>page.locator('#modal button[type="submit"]').click();


try{
 browser=await chromium.launch({headless:true,executablePath:process.env.RAINLIFT_CHROME,
  args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 console.log('Chrome '+browser.version()+' · 320px · isolated 127.0.0.1 · synthetic records');
 const context=await browser.newContext({...devices['iPhone 13 Mini'],viewport:{width:320,height:740},deviceScaleFactor:1,timezoneId:'Asia/Shanghai',acceptDownloads:true});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(address);await workerCache(page,'rainlift-shell-v1.9.0');
 const weight=page.locator('#weight'),heading=page.locator('.training-heading');
 const pick=type=>page.locator('[data-action="next-set-type"][data-type="'+type+'"]').click();
 const quick=()=>page.locator('[data-action="record"][data-reps="8"]').click();
 const exerciseID=await page.evaluate(async()=>{
  const {initial,start,record,finish,TRAINING_V2_KEY}=await import('./data.js?v=1.9.0');
  const {unknownSnapshot,makeLoad}=await import('./load.js?v=1.9.0');
  const {ExerciseMetaRepository}=await import('./exercise-meta.js?v=1.9.0');
  const d=initial(),plan=d.plans[0],e=plan.exercises[0];e.name='合成测试 · 卧推';e.target=3;
  new ExerciseMetaRepository(localStorage).set(d,e,'external');
  for(const age of [3,2,1]){
   const end=Date.now()-age*86400000;
   start(d,plan.id,unknownSnapshot());d.active.started=end-60000;
   const m=d.active.movements[0];
   for(const [type,weight,reps] of [['warmup',20,10-age],['warmup',30,8],['normal',40,8],['drop',25,8]]){
    record(d,m.id,reps,weight,false,end-5000,makeLoad('external','kg',weight),{setType:type,toFailure:false,effort:null});
   }
   finish(d);d.history[0].ended=end;
  }
  localStorage.setItem(TRAINING_V2_KEY,JSON.stringify(d));
  return e.id;
 });
 await page.reload();await act(page,'start').first().click();
 assert.equal(await weight.inputValue(),'20');
 const before=await store(page);
 await nav(page,'settings');
 release='candidate';blockModule=true;await update(page);
 for(let i=0;!failed&&i<70;i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(failed);assert.equal(await notice(page).count(),0);assert.deepEqual(await store(page),before);
 blockModule=false;await update(page);await notice(page).waitFor();
 const loaded=page.waitForEvent('load');await notice(page).click();await loaded;
 await workerCache(page,'rainlift-shell-v1.9.1');
 assert.deepEqual(await store(page),before);assert.equal(await weight.inputValue(),'40');
 console.log('PASS exact v1.9.0 reproduction, failed install safety and adjacent upgrade without rewriting data');

 await pick('warmup');assert.equal(await weight.inputValue(),'20');await quick();
 await pick('warmup');await weight.fill('30');await page.waitForTimeout(680);await quick();
 assert.equal(await weight.inputValue(),'40');
 assert.match(await heading.innerText(),/已完成\s+0 \/ 3 个普通工作组/);
 await pick('drop');assert.equal(await weight.inputValue(),'25');
 await pick('normal');assert.equal(await weight.inputValue(),'40');
 await page.waitForTimeout(680);await quick();
 assert.match(await heading.innerText(),/已完成\s+1 \/ 3 个普通工作组/);
 assert.match(await page.locator('.set-counts').innerText(),/总记录 3 组.*普通工作组 1.*热身 2/);
 const recorded=await db(page);
 await act(page,'rest-performance').click();await page.locator('#modal [name="effort"]').selectOption('8');await save(page);
 assert.deepEqual((await db(page)).rest,recorded.rest);
 assert.equal((await db(page)).active.movements[0].sets[2].performance.effort.rpe,8);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.RAINLIFT_SCREENSHOTS){
  await page.locator('#toast.visible').waitFor({state:'hidden'});
  await heading.screenshot({path:join(process.env.RAINLIFT_SCREENSHOTS,'rainlift-191-work-target-320.png')});
 }
 await act(page,'set-new').click();
 const formWeight=page.locator('#modal [name="weight"]'),formType=page.locator('#modal [name="setType"]');
 assert.equal(await formWeight.inputValue(),'40');
 await formType.selectOption('drop');assert.equal(await formWeight.inputValue(),'25');
 await formWeight.fill('24');await formType.selectOption('warmup');assert.equal(await formWeight.inputValue(),'24');
 await page.locator('#modal [data-modal="close"]').click();
 assert.equal((await db(page)).active.movements[0].sets.length,3);
 console.log('PASS group switching, working target, RPE/timer and manual entry default/override in the live 320px UI');

 await page.evaluate(()=>{
  const weight=document.querySelector('#weight');weight.value='46.5';
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
 });
 assert.equal(await weight.inputValue(),'46.5');
 const draft=await db(page);
 assert.equal(draft.active.movements[0].overrideWeight,46.5);
 await context.setOffline(true);await page.reload();
 assert.equal(await weight.inputValue(),'46.5');assert.deepEqual(await db(page),draft);
 await nav(page,'history');
 await page.locator('[data-action="history-open"][data-id="'+exerciseID+'"]').first().click();
 assert.match(await page.locator('.records-card').innerText(),/最高工作重量\s+40 kg/);
 await nav(page,'settings');await act(page,'health-open').click();await act(page,'health-report').click();
 const text=await page.locator('#health-report-text').inputValue();
 assert.match(text,/普通工作组对照/);assert.match(text,/对应次数持平/);assert.doesNotMatch(text,/对应次数连续上升/);
 await page.locator('#modal [data-modal="close"]').click();
 await context.setOffline(false);
 console.log('PASS simulated background/foreground preserves an unblurred weight, and PR plus working-set report open offline');

 await nav(page,'settings');
 const download=page.waitForEvent('download');await act(page,'full-export').click();
 const full=await readFile(await (await download).path());
 assert.equal(Object.keys(JSON.parse(full).parts).length,6);
 async function switchShell(next,cache){
  await nav(page,'settings');release=next;await update(page);await notice(page).waitFor();
  const reloaded=page.waitForEvent('load');await notice(page).click();await reloaded;await workerCache(page,cache);
 }
 await switchShell('recovery',manifest.cache);
 assert.deepEqual(await db(page),draft);
 await context.setOffline(true);await page.reload();assert.deepEqual(await db(page),draft);await context.setOffline(false);
 await switchShell('base','rainlift-shell-v1.9.0');
 await nav(page,'settings');
 await page.locator('#full-import-file').setInputFiles({name:'rainlift.synthetic.json',mimeType:'application/json',buffer:full});
 await confirm(page);assert.deepEqual(await db(page),draft);
 await switchShell('candidate','rainlift-shell-v1.9.1');
 assert.deepEqual(await db(page),draft);
 assert.match(await heading.innerText(),/已完成\s+1 \/ 3/);
 assert.deepEqual(errors,[]);
 console.log('PASS unique v1.9.0 recovery cache and offline open, original v1.9.0 six-part restore, and v1.9.1 re-upgrade');
}finally{
 await browser?.close();
 server.close();
 await rm(work,{recursive:true,force:true});
}
