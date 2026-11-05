import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {ROOT, unpackBaseline} from './baseline.mjs';

const recovery = process.argv[2];
if (!recovery || !process.env.RAINLIFT_PLAYWRIGHT || !process.env.RAINLIFT_CHROME) {
  throw Error('Provide the recovery directory and set RAINLIFT_PLAYWRIGHT and RAINLIFT_CHROME.');
}
const {chromium,devices}=createRequire(import.meta.url)(process.env.RAINLIFT_PLAYWRIGHT);
const work=await mkdtemp(join(tmpdir(),'rainlift-browser-185-'));
unpackBaseline(work);
const recoveryManifest=JSON.parse(await readFile(join(recovery,'rollback-manifest.json'),'utf8'));
const roots={original:join(work,'dist'),candidate:resolve(ROOT,'dist'),recovery:join(recovery,'dist')};
let release='original', blockModule=false, failedDownloads=0, browser;
const mime={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'};
const server=createServer(async (req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const name=path==='/rain-lift/'?'index.html':path.slice('/rain-lift/'.length);
  if (!path.startsWith('/rain-lift/') || !/^[\w.-]+\.(html|js|css|png|webmanifest)$/.test(name)) {res.writeHead(404).end();return;}
  if (release==='candidate' && blockModule && name==='performance.js') {failedDownloads++;res.writeHead(503).end();return;}
  try {
    const bytes=await readFile(join(roots[release],name));
    res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)],'Cache-Control':'no-store'}).end(bytes);
  } catch {res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const address='http://127.0.0.1:'+server.address().port+'/rain-lift/';
const repoData=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')));
const actions=(page,name)=>page.locator('[data-action="'+name+'"]');
const settings=page=>page.locator('[data-view="settings"]').click();
const today=page=>page.locator('nav [data-view="today"]').click();
const modal=page=>page.locator('#modal');
const confirm=page=>modal(page).locator('[data-modal="confirm"]').click();
const save=page=>modal(page).locator('button[type="submit"]').click();
const setRows=(db)=>db.active.movements[0].sets;
const waitForCache=(page,name)=>page.waitForFunction(async version=>
  !!navigator.serviceWorker.controller&&(await caches.keys()).includes(version),name);
const getDownload=async(page,action)=>{
  const pending=page.waitForEvent('download');
  await actions(page,action).click();
  return readFile(await (await pending).path());
};
async function activate(page,next,cache){
  release=next;
  await settings(page);
  await actions(page,'app-update').click();
  await waitForCache(page,cache);
  await page.locator('#update-notice [data-action="app-reload"]').click();
  await page.locator('main h1').waitFor();
}

try {
  browser=await chromium.launch({headless:true,executablePath:process.env.RAINLIFT_CHROME,
    args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  console.log('Chrome '+browser.version()+' · isolated 127.0.0.1 · synthetic data');
  const context=await browser.newContext({...devices['iPhone 13 Mini'],viewport:{width:320,height:740},deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(address);
  await waitForCache(page,'rainlift-shell-v1.8.4');
  await actions(page,'start').first().click();
  await actions(page,'record').first().click();
  const baseline=await repoData(page),restBaseline=baseline.rest;
  assert.equal(setRows(baseline).length,1);

  const oldTab=await context.newPage();
  // Exercise the race where the old page has not processed its storage event.
  await oldTab.addInitScript(()=>window.addEventListener('storage',event=>event.stopImmediatePropagation(),true));
  await oldTab.goto(address);
  await actions(oldTab,'record').first().waitFor();

  await settings(page);
  release='candidate';blockModule=true;
  await actions(page,'app-update').click();
  for(let i=0;!failedDownloads&&i<80;i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(failedDownloads,'test must fail a new module precache request');
  assert.equal(await page.locator('#update-notice button').count(),0);
  assert.deepEqual(await repoData(page),baseline);
  assert.ok((await page.evaluate(()=>caches.keys())).includes('rainlift-shell-v1.8.4'));
  console.log('PASS incomplete v1.8.5 install leaves the running v1.8.4 shell and data usable');

  blockModule=false;
  await activate(page,'candidate','rainlift-shell-v1.8.5');
  assert.deepEqual(await repoData(page),baseline);
  await settings(page);
  assert.match(await page.locator('main').innerText(),/当前版本：1\.8\.5/);
  await today(page);
  assert.ok(await page.locator('#island-start').isVisible());
  await page.locator('[data-type="drop"]').click();
  await actions(page,'next-set-failure').click();
  await actions(page,'record').first().click();
  const marked=await repoData(page),setID=setRows(marked)[1].id;
  assert.equal(setRows(marked).length,2);
  assert.equal(setRows(marked)[1].performance.toFailure,true);
  assert.notEqual(marked.rest.setID,restBaseline.setID);
  assert.equal(await page.locator('[data-type="normal"]').getAttribute('aria-pressed'),'true');
  await actions(oldTab,'record').first().click();
  assert.match(await oldTab.locator('#toast').innerText(),/其他页面修改/);
  assert.deepEqual(await repoData(page),marked);
  await oldTab.close();
  console.log('PASS original → candidate retains the live session and rejects writes from a stale old tab');

  await settings(page);
  await page.getByLabel('评分显示').selectOption('rir');
  await today(page);
  const secondCandidate=await context.newPage();
  await secondCandidate.goto(address);
  await actions(secondCandidate,'rest-performance').click();
  await modal(secondCandidate).getByLabel('RIR（选填）').selectOption('8.5');
  await actions(page,'rest-performance').click();
  assert.ok(await modal(page).isVisible());
  assert.equal(await modal(page).getByLabel('RIR（选填）').locator('option[value="5"]').innerText(),'RIR 5');
  assert.equal(await modal(page).getByLabel('RIR（选填）').locator('option[value="bound"]').innerText(),'RIR 5+');
  await modal(page).getByLabel('RIR（选填）').selectOption('bound');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if (process.env.RAINLIFT_SCREENSHOTS) await page.screenshot({path:join(process.env.RAINLIFT_SCREENSHOTS,'rir-320.png')});
  await save(page);
  const rated=await repoData(page);
  assert.deepEqual(rated.rest,marked.rest);
  assert.deepEqual(setRows(rated)[1].performance.effort,{kind:'at_most',rpe:5});
  await secondCandidate.waitForFunction(()=>document.querySelector('#toast').textContent.includes('记录已从另一窗口更新'));
  await save(secondCandidate);
  assert.match(await secondCandidate.locator('#toast').innerText(),/这组记录已修改/);
  assert.deepEqual(await repoData(page),rated);
  await secondCandidate.close();
  await context.setOffline(true);
  await page.reload();
  assert.match(await page.locator('.set-performance').innerText(),/递减 · 力竭 · RIR 5\+/);
  assert.deepEqual(await repoData(page),rated);
  await context.setOffline(false);
  console.log('PASS 320px touch-layout emulation, RIR 5+, stale edit rejection, unchanged timer and offline reload');

  await settings(page);
  const full=await getDownload(page,'full-export'),fullData=JSON.parse(full);
  assert.equal(Object.keys(fullData.parts).length,6);
  const training=await getDownload(page,'export');
  assert.deepEqual(JSON.parse(training),rated);

  await activate(page,'original','rainlift-shell-v1.8.4');
  await settings(page);
  await page.locator('#full-import-file').setInputFiles({name:'full.synthetic.json',mimeType:'application/json',buffer:full});
  await confirm(page);
  assert.deepEqual(JSON.parse(await getDownload(page,'full-export')).parts,fullData.parts);
  await page.locator('#import-file').setInputFiles({name:'training.synthetic.json',mimeType:'application/json',buffer:training});
  await confirm(page);
  assert.deepEqual(await repoData(page),rated);
  await today(page);
  await page.locator('[data-action="set-edit"][data-id="'+setID+'"]').click();
  await modal(page).locator('[name="reps"]').fill('7');
  await save(page);
  const edited=await repoData(page);
  assert.deepEqual(setRows(edited)[1].performance,setRows(rated)[1].performance);
  assert.equal(setRows(edited)[1].date,setRows(rated)[1].date);
  assert.equal(setRows(edited)[1].reps,7);
  await actions(page,'record').first().click();
  assert.equal(setRows(await repoData(page))[2].performance,undefined);
  await actions(page,'finish').click();await confirm(page);
  await page.locator('[data-view="history"]').click();
  await page.locator('[data-tab="session"]').click();
  const beforeDelete=(await repoData(page)).history[0];
  await actions(page,'history-delete').click();await confirm(page);
  await page.locator('[data-tab="deleted"]').click();
  await actions(page,'history-restore').click();
  assert.deepEqual((await repoData(page)).history[0],beforeDelete);
  await today(page);
  await actions(page,'plan-edit').first().click();
  await modal(page).locator('[name="planName"]').fill('合成回滚计划');
  await save(page);
  const afterOld=await repoData(page);
  assert.equal(afterOld.plans[0].name,'合成回滚计划');
  assert.deepEqual(afterOld.history[0],beforeDelete);
  console.log('PASS original v1.8.4 imports and re-exports both files, edits a set, appends an unclassified set, saves a plan and restores history');

  await activate(page,'recovery',recoveryManifest.cache);
  await settings(page);
  assert.ok((await page.locator('main').innerText()).includes(recoveryManifest.version));
  await context.setOffline(true);
  await page.reload();
  assert.deepEqual(await repoData(page),afterOld);
  await context.setOffline(false);
  console.log('PASS recovery build activated with a unique cache and reopened offline with identical storage');

  await activate(page,'candidate','rainlift-shell-v1.8.5');
  await page.locator('[data-view="history"]').click();
  await page.locator('[data-tab="session"]').click();
  assert.match(await page.locator('.set-performance').innerText(),/评分待确认/);
  assert.deepEqual(await repoData(page),afterOld);
  assert.deepEqual(errors,[]);
  console.log('PASS re-upgrade preserves every stored field and visibly excludes the original rating from current coverage');
} finally {
  await browser?.close();
  server.close();
  await rm(work,{recursive:true,force:true});
}
