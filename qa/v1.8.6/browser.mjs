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
const work=await mkdtemp(join(tmpdir(),'rainlift-browser-186-'));
unpackBaseline(join(work,'185'),'v1.8.5');
unpackBaseline(join(work,'184'),'v1.8.4');
const roots={base:join(work,'185/dist'),original:join(work,'184/dist'),candidate:resolve(ROOT,'dist'),recovery:join(recovery,'dist')};
const manifest=JSON.parse(await readFile(join(recovery,'rollback-manifest.json'),'utf8'));
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'};
let release='base',blockModule=false,failed=0,browser;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const name=path==='/rain-lift/'?'index.html':path.slice('/rain-lift/'.length);
 if(!path.startsWith('/rain-lift/')||!/^[\w.-]+\.(html|js|css|png|webmanifest)$/.test(name)){res.writeHead(404).end();return;}
 if(release==='candidate'&&blockModule&&name==='records-ui.js'){failed++;res.writeHead(503).end();return;}
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
const openHistory=async(page,exerciseID)=>{await nav(page,'history');await page.locator('[data-action="history-open"][data-id="'+exerciseID+'"]').first().click();};
const confirm=page=>page.locator('#modal [data-modal="confirm"]').click();
const save=page=>page.locator('#modal button[type="submit"]').click();

try{
 browser=await chromium.launch({headless:true,executablePath:process.env.RAINLIFT_CHROME,
  args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 console.log('Chrome '+browser.version()+' · 320px · isolated 127.0.0.1 · synthetic records');
 const context=await browser.newContext({...devices['iPhone 13 Mini'],viewport:{width:320,height:740},deviceScaleFactor:1,timezoneId:'Asia/Shanghai',acceptDownloads:true});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(address);
 await workerCache(page,'rainlift-shell-v1.8.5');
 const exerciseID=await page.evaluate(async()=>{
  const {initial,TRAINING_V2_KEY}=await import('./data.js?v=1.8.5');
  const db=initial(),plan=db.plans[0],exercise=plan.exercises[0],DAY=86400000;
  exercise.name='合成测试 · 卧推';db.version=2;
  for(const [age,weight,reps,mode,type] of [[1,70,8,'external','normal'],[2,65,8,'external','normal'],[5,65,6,'external','normal'],
   [7,40,8,'assisted','normal'],[8,120,4,'external','warmup'],[40,80,6,'external','normal']]){
   const started=Date.now()-age*DAY;
   const set={id:crypto.randomUUID(),weight,reps,date:started+10000,load:{schemaVersion:1,mode,unit:'kg'},
     performance:{schemaVersion:1,setType:type,toFailure:false,effort:null}};
   db.history.push({id:crypto.randomUUID(),planID:plan.id,name:'合成训练',started,ended:started+60000,note:'',
     movements:[{id:crypto.randomUUID(),exercise:{...exercise},sets:[set],skipped:false}]});
  }
  localStorage.setItem(TRAINING_V2_KEY,JSON.stringify(db));return exercise.id;
 });
 await page.reload();await openHistory(page,exerciseID);
 const original=await store(page);
 release='candidate';blockModule=true;
 await update(page);
 for(let i=0;!failed&&i<70;i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(failed);assert.equal(await notice(page).count(),0);assert.deepEqual(await store(page),original);
 console.log('PASS failed record module install preserves the v1.8.5 shell and data');

 blockModule=false;
 await update(page);await notice(page).waitFor();
 assert.equal(await page.locator('.records-card').count(),0);
 const reloaded=page.waitForEvent('load');
 await nav(page,'today');await reloaded;
 await workerCache(page,'rainlift-shell-v1.8.6');
 assert.deepEqual(await store(page),original);
 await openHistory(page,exerciseID);
 const card=page.locator('.records-card');
 const text=()=>card.innerText();
 assert.match(await text(),/最高工作重量\s+70 kg/);
 assert.match(await text(),/排除 热身 1 组 · 范围外 1 组/);
 assert.equal(await card.locator('.record-line path').count(),1);
 await page.locator('#record-range').selectOption('90');
 assert.match(await text(),/最高工作重量\s+80 kg/);
 await page.locator('#record-metric').selectOption('reps');
 await page.locator('#record-weight').selectOption('65');
 assert.match(await text(),/同重量最高次数\s+65 kg × 8 次/);
 await card.locator('summary').click();
 assert.match(await card.locator('table').innerText(),/65|8 次/);
 await page.locator('#record-group').selectOption(JSON.stringify(['assisted','kg',null]));
 assert.match(await text(),/同辅助重量下比较次数/);
 assert.doesNotMatch(await text(),/最高工作重量|估算 1RM/);
 await page.locator('#record-group').selectOption(JSON.stringify(['external','kg',null]));
 await page.locator('#record-metric').selectOption('load');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.RAINLIFT_SCREENSHOTS)await card.screenshot({path:join(process.env.RAINLIFT_SCREENSHOTS,'rainlift-186-chart-320.png')});
 assert.deepEqual(await store(page),original);
 console.log('PASS automatic idle upgrade and real action detail filtering, grouping, gaps and narrow layout without storage writes');

 const old=(await db(page)).history.at(-1),target=old.movements[0].sets[0].id;
 await page.locator('[data-action="history-edit"][data-id="'+target+'"]').click();
 await page.locator('#modal [name="weight"]').fill('68');await save(page);
 assert.match(await text(),/最高工作重量\s+70 kg/);
 await context.setOffline(true);await page.reload();await openHistory(page,exerciseID);
 assert.match(await text(),/最高工作重量\s+70 kg/);
 assert.ok(await card.locator('svg').isVisible());
 await context.setOffline(false);
 console.log('PASS saved history edit recomputes PR and complete trend modules load offline');

 await nav(page,'settings');
 const download=page.waitForEvent('download');await act(page,'full-export').click();
 const full=await readFile(await (await download).path());
 assert.equal(Object.keys(JSON.parse(full).parts).length,6);
 const beforeRecovery=await db(page);
 async function switchShell(next,cache,{automatic=true}={}){
  await nav(page,'settings');release=next;await update(page);await notice(page).waitFor();
  const loaded=page.waitForEvent('load');
  if(automatic)await nav(page,'today');else await notice(page).click();
  await loaded;await workerCache(page,cache);
 }
 await switchShell('recovery',manifest.cache);
 await context.setOffline(true);await page.reload();assert.deepEqual(await db(page),beforeRecovery);await context.setOffline(false);
 await switchShell('original','rainlift-shell-v1.8.4');
 await nav(page,'settings');
 await page.locator('#full-import-file').setInputFiles({name:'rainlift.synthetic.json',mimeType:'application/json',buffer:full});
 await confirm(page);
 assert.deepEqual(await db(page),beforeRecovery);
 await switchShell('candidate','rainlift-shell-v1.8.6',{automatic:false});
 await openHistory(page,exerciseID);
 assert.match(await text(),/最高工作重量\s+70 kg/);
 assert.deepEqual(await db(page),beforeRecovery);
 assert.deepEqual(errors,[]);
 console.log('PASS isolated v1.8.5 recovery offline, original v1.8.4 full restore, and re-upgrade preserve scores and history');
}finally{
 await browser?.close();
 server.close();
 await rm(work,{recursive:true,force:true});
}
