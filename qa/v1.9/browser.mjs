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
const work=await mkdtemp(join(tmpdir(),'rainlift-browser-190-'));
unpackBaseline(join(work,'186'),'v1.8.6');
unpackBaseline(join(work,'184'),'v1.8.4');
const roots={base:join(work,'186/dist'),original:join(work,'184/dist'),candidate:resolve(ROOT,'dist'),recovery:join(recovery,'dist')};
const manifest=JSON.parse(await readFile(join(recovery,'rollback-manifest.json'),'utf8'));
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'};
let release='base',blockModule=false,failed=0,browser;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const name=path==='/rain-lift/'?'index.html':path.slice('/rain-lift/'.length);
 if(!path.startsWith('/rain-lift/')||!/^[\w.-]+\.(html|js|css|png|webmanifest)$/.test(name)){res.writeHead(404).end();return;}
 if(release==='candidate'&&blockModule&&name==='progression.js'){failed++;res.writeHead(503).end();return;}
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
 await page.goto(address);await workerCache(page,'rainlift-shell-v1.8.6');
 const quick=()=>page.locator('[data-action="record"][data-reps="8"]').click();
 const recommendation=page.locator('#progression-panel');
 const weight=page.locator('#weight');
 await page.evaluate(async()=>{
  const {initial,start,record,finish,TRAINING_V2_KEY}=await import('./data.js?v=1.8.6');
  const {unknownSnapshot,makeLoad}=await import('./load.js?v=1.8.6');
  const {ExerciseMetaRepository}=await import('./exercise-meta.js?v=1.8.6');
  const d=initial(),plan=d.plans[0],e=plan.exercises[0];e.name='合成测试 · 卧推';e.target=2;
  new ExerciseMetaRepository(localStorage).set(d,e,'external');
  for(const age of [7,5]){
   const end=Date.now()-age*86400000;
   start(d,plan.id,unknownSnapshot());d.active.started=end-60000;
   const m=d.active.movements[0];
   for(const n of [12,13])record(d,m.id,n,40,false,end-5000,makeLoad('external','kg',40),{setType:'normal',toFailure:false,effort:{kind:'exact',rpe:8}});
   finish(d);d.history[0].ended=end;
  }
  localStorage.setItem(TRAINING_V2_KEY,JSON.stringify(d));
 });
 await page.reload();await nav(page,'settings');
 const original=await store(page);
 release='candidate';blockModule=true;
 await update(page);
 for(let i=0;!failed&&i<70;i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(failed);assert.equal(await notice(page).count(),0);assert.deepEqual(await store(page),original);
 blockModule=false;
 await update(page);await notice(page).waitFor();
 const reloaded=page.waitForEvent('load');await nav(page,'today');await reloaded;
 await workerCache(page,'rainlift-shell-v1.9.0');
 assert.deepEqual(await store(page),original);
 console.log('PASS failed install leaves old shell usable; completed v1.9.0 install auto-loads on idle home with equal storage');

 await act(page,'plan-edit').first().click();
 await page.locator('#modal [data-modal="edit-0"]').click();
 await page.locator('#modal .progression-settings summary').click();
 await page.locator('#modal [name="progressionEnabled"]').check();
 await page.locator('#modal [name="progressionMin"]').fill('8');
 await page.locator('#modal [name="progressionMax"]').fill('12');
 await save(page);await save(page);
 await act(page,'start').first().click();
 assert.match(await recommendation.innerText(),/最近两次训练需有记组时保存的目标/);
 assert.equal(await weight.inputValue(),'40');
 await quick();
 const recorded=await db(page);
 await act(page,'rest-performance').click();await page.locator('#modal [name="effort"]').selectOption('8');await save(page);
 assert.match(await recommendation.innerText(),/保持 40 kg，尝试 9 次/);
 assert.deepEqual((await db(page)).rest,recorded.rest);
 assert.equal((await db(page)).active.movements[0].sets.length,1);
 await weight.fill('41');
 assert.match(await recommendation.innerText(),/记录重量与当前输入不同/);
 assert.equal(await weight.inputValue(),'41');
 console.log('PASS actual opt-in, cold start, quick record, RPE annotation and advisory reps respect manual weight and timer');

 // Build two completed synthetic exposures with the shipped recorder so their
 // per-set goal snapshots use exactly the same path as a real workout.
 await page.evaluate(async()=>{
  const {start,record,finish,TRAINING_V2_KEY}=await import('./data.js?v=1.9.0');
  const {unknownSnapshot,makeLoad}=await import('./load.js?v=1.9.0');
  const d=JSON.parse(localStorage.getItem(TRAINING_V2_KEY));d.active=null;d.rest=null;
  for(const age of [2,1]){
   const end=Date.now()-age*86400000;
   start(d,d.plans[0].id,unknownSnapshot());d.active.started=end-60000;
   const m=d.active.movements[0];
   for(const n of [12,13])record(d,m.id,n,40,false,end-5000,makeLoad('external','kg',40),{setType:'normal',toFailure:false,effort:{kind:'exact',rpe:8}});
   finish(d);d.history[0].ended=end;
  }
  localStorage.setItem(TRAINING_V2_KEY,JSON.stringify(d));
 });
 await page.reload();await act(page,'start').first().click();
 assert.match(await recommendation.innerText(),/本次可试 42.5 kg/);
 assert.equal(await weight.inputValue(),'40');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.RAINLIFT_SCREENSHOTS)await recommendation.screenshot({path:join(process.env.RAINLIFT_SCREENSHOTS,'rainlift-190-progression-320.png')});
 await weight.fill('41');assert.equal(await act(page,'progression-apply').count(),0);
 await weight.fill('40');await act(page,'progression-apply').click();
 assert.equal(await weight.inputValue(),'42.5');
 const adopted=await db(page);
 assert.equal(adopted.active.movements[0].sets.length,0);
 assert.equal(adopted.active.movements[0].overrideWeight,42.5);
 assert.equal(adopted.rest,null);
 assert.deepEqual(adopted.plans[0].exercises[0].reps,[8,9,10]);
 assert.equal(adopted.plans[0].exercises[0].weight,40);
 await context.setOffline(true);await page.reload();
 assert.equal(await weight.inputValue(),'42.5');assert.deepEqual(await db(page),adopted);
 await context.setOffline(false);
 console.log('PASS same-weight two-session evidence, explicit adoption, manual priority, narrow layout and offline reload');

 await nav(page,'settings');
 const download=page.waitForEvent('download');await act(page,'full-export').click();
 const full=await readFile(await (await download).path());
 assert.equal(Object.keys(JSON.parse(full).parts).length,6);
 async function switchShell(next,cache){
  await nav(page,'settings');release=next;await update(page);await notice(page).waitFor();
  const loaded=page.waitForEvent('load');await notice(page).click();await loaded;await workerCache(page,cache);
 }
 await switchShell('recovery',manifest.cache);
 await context.setOffline(true);await page.reload();assert.deepEqual(await db(page),adopted);await context.setOffline(false);
 await switchShell('original','rainlift-shell-v1.8.4');
 await nav(page,'settings');
 await page.locator('#full-import-file').setInputFiles({name:'rainlift.synthetic.json',mimeType:'application/json',buffer:full});
 await confirm(page);
 assert.deepEqual(await db(page),adopted);
 await nav(page,'today');await quick();
 const throughOld=await db(page);
 assert.equal(throughOld.active.movements[0].sets[0].progressionTarget,undefined);
 await switchShell('candidate','rainlift-shell-v1.9.0');
 assert.deepEqual(await db(page),throughOld);
 assert.deepEqual(errors,[]);
 console.log('PASS adjacent recovery offline and original v1.8.4 full restore/record/re-upgrade preserve new evidence and legacy absence');
}finally{
 await browser?.close();
 server.close();
 await rm(work,{recursive:true,force:true});
}
