import {mkdirSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const PAGE = 'http://127.0.0.1:8791/index.html';
const PROFILE = '/tmp/rainlift-chrome-1101-run';
const OUT = fileURLToPath(new URL('./browser/', import.meta.url));
mkdirSync(OUT, {recursive: true});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = [];
const log = (...parts) => { const s = parts.join(' '); lines.push(s); console.log(s); };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], {stdio: 'ignore'});

async function target() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

let ws, nextId = 1;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({id, method, params}));
  return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
}
async function evaluate(fnBody) {
  const r = await send('Runtime.evaluate', {expression: `(async()=>{${fnBody}})()`, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', {format: 'png'});
  writeFileSync(OUT + name + '.png', Buffer.from(r.data, 'base64'));
  log('screenshot → qa/v1.10.1/browser/' + name + '.png');
}
const mainText = () => evaluate('return document.querySelector("main").innerText.replace(/\\n+/g," | ");');
async function clickText(selector, label) {
  const found = await evaluate(`
    const el=[...document.querySelectorAll('${selector}')].find(b=>b.textContent.replace(/\\s+/g,' ').trim().includes('${label}'));
    if(!el) return false; el.click(); return true;`);
  if (!found) throw new Error('找不到按钮：' + label);
  await sleep(180);
  log(`点击「${label}」`);
}
async function waitForText(needle, ms = 4000) {
  for (let i = 0; i * 200 < ms; i++) {
    if ((await mainText()).includes(needle)) return true;
    await sleep(200);
  }
  throw new Error('页面没有出现文本：' + needle);
}

try {
  const t = await target();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method) events.push(m.method);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
  await send('Page.navigate', {url: PAGE});
  await sleep(2200);

  log('== Rain Lift v1.10.1 浏览器核验（iPhone 390×844 视口，' + await evaluate('return navigator.userAgent') + ' headless）==');
  log('入口：' + PAGE + '（直接服务 dist/，全新临时 profile，无旧 Service Worker）');

  log('\n[1] 首页计划卡片');
  await waitForText('今天练什么？');
  log('页面文本：' + (await mainText()).slice(0, 300));
  log('卡片含「固定」段：' + await evaluate('return [...document.querySelectorAll(".plan-card")].every(c=>!!c.querySelector(".slot-label"))'));
  log('卡片含「今日训练」按钮：' + await evaluate('return [...document.querySelectorAll(".plan-card [data-action=day-open]")].length'));
  log('卡片不再直接出现「开始训练」：' + await evaluate('return [...document.querySelectorAll(".plan-card [data-action=start]")].length'));
  await shot('01-home');

  log('\n[2] 当日页 + 勾选今天多练的动作');
  await clickText('[data-action="day-open"]', '今日训练');
  await waitForText('固定动作');
  log('页面文本：' + (await mainText()).slice(0, 320));
  await clickText('[data-action="day-add"]', '从动作库添加当日动作');
  log('弹窗标题：' + await evaluate('return document.querySelector("#modal h2")?.textContent'));
  log('候选不含固定动作：' + await evaluate('return !document.querySelector("#modal").textContent.includes("宽距高位下拉")'));
  await clickText('#modal [data-modal^="pick-"]', '卧推');
  log('确认按钮：' + await evaluate('return document.querySelector("#modal [data-modal=confirm]")?.textContent + " disabled=" + document.querySelector("#modal [data-modal=confirm]")?.disabled'));
  await clickText('#modal [data-modal="confirm"]', '添加动作（已选 1）');
  await waitForText('今日已选');
  log('勾选后页面：' + (await mainText()).slice(0, 320));
  log('toast：' + await evaluate('return document.querySelector("#toast").textContent'));
  log('localStorage 里的 daily：' + await evaluate(`
    const d=(JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')));
    return JSON.stringify(d.plans[0].daily)+' / optional='+JSON.stringify(d.plans[0].exercises.map(e=>!!e.optional));`));
  await shot('02-day-picked');

  log('训练数据存放分区：' + await evaluate(`return ['rainlift.web.v1','rainlift.web.v2'].filter(k=>localStorage.getItem(k)).join(' + ')`));
  log('\n[3] 开始训练：固定动作在前，今天的勾选补在后面');
  await clickText('[data-action="start"]', '开始训练');
  await waitForText('结束训练');
  log('本次动作：' + await evaluate(`return JSON.stringify((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')).active?.movements??[]).map(m=>m.exercise.name))`));
  await shot('03-session');

  log('\n[4] 刷新后仍在同一次训练，今天的勾选没丢');
  await send('Page.reload', {ignoreCache: true});
  await sleep(1200);
  for (let i = 0; i < 20 && !(await mainText()).includes('结束训练'); i++) {
    await sleep(700);
    if (i === 19) log('刷新诊断：' + await evaluate(`
      return 'readyState=' + document.readyState + ' appLen=' + document.querySelector('#app').innerHTML.length +
        ' controlled=' + !!navigator.serviceWorker.controller + ' svReg=' + !!(await navigator.serviceWorker.getRegistration()) +
        ' caches=' + JSON.stringify(await caches.keys()) + ' scripts=' + JSON.stringify([...document.querySelectorAll('script')].map(s=>s.src))`));
  }
  log('刷新后停在：' + (await mainText()).slice(0, 46));
  log('训练数据分区：' + await evaluate(`return ['rainlift.web.v1','rainlift.web.v2'].filter(k=>localStorage.getItem(k)).join(' + ')`));
  log('刷新后本次动作：' + await evaluate(`return JSON.stringify((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')).active?.movements??[]).map(m=>m.exercise.name))`));
  log('刷新后 daily：' + await evaluate(`return JSON.stringify((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1'))).plans[0].daily)`));

  log('\n[5] 结束训练');
  await clickText('button', '结束训练');
  await clickText('#modal [data-modal="confirm"]', '结束');
  await sleep(400);
  log('结束后首页：' + (await mainText()).slice(0, 200));
  log('active：' + await evaluate(`return String((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1'))).active)`));
  log('history 条数：' + await evaluate(`return (JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1'))).history.length`));
  await shot('05-after-finish');

  log('\n[6] 一键把今天的动作设为固定');
  await clickText('[data-action="day-open"]', '今日训练');
  await waitForText('固定动作');
  await clickText('[data-action="day-pin"]', '设为固定');
  log('toast：' + await evaluate('return document.querySelector("#toast").textContent'));
  log('设为固定后：' + (await mainText()).slice(0, 320));
  log('计划字段：' + await evaluate(`
    const d=(JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')));
    return 'daily='+JSON.stringify(d.plans[0].daily)+' / 固定 '+d.plans[0].exercises.filter(e=>!e.optional).length+' 个 / 当日选 '+d.plans[0].exercises.filter(e=>e.optional).length+' 个';`));
  await shot('06-pinned');

  log('\n[7] 计划编辑器里的固定 / 当日选开关');
  await clickText('[data-action="day-back"]', '');
  await clickText('[data-action="plan-edit"]', '');
  log('编辑器标题：' + await evaluate('return document.querySelector("#modal h2")?.textContent'));
  log('段计数：' + await evaluate('return document.querySelector("#modal").textContent.match(/固定 \\d+ · 当日选 \\d+/)?.[0]'));
  await clickText('#modal [data-modal="slot-0"]', '');
  log('切换后：' + await evaluate('return document.querySelector("#modal").textContent.match(/固定 \\d+ · 当日选 \\d+/)?.[0]'));
  await evaluate(`const f=document.querySelector('#modal form'); f.requestSubmit(); return true;`);
  await sleep(500);
  log('保存后计划字段：' + await evaluate(`
    const d=(JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')));
    return '固定 '+d.plans[0].exercises.filter(e=>!e.optional).length+' 个 / 当日选 '+d.plans[0].exercises.filter(e=>e.optional).length+' 个 / daily='+JSON.stringify(d.plans[0].daily);`));
  log('首页卡片：' + (await mainText()).slice(0, 220));
  await shot('07-editor-slot');

  log('\n[8] 训练中的「调整动作 / 更新固定计划」仍保留槽位');
  await clickText('[data-action="day-open"]', '今日训练');
  await waitForText('固定动作');
  await clickText('[data-action="start"]', '开始训练');
  await waitForText('结束训练');
  log('本次动作：' + await evaluate(`return JSON.stringify((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')).active?.movements??[]).map(m=>m.exercise.name))`));
  await clickText('button', '调整动作');
  await clickText('#modal [data-modal="template"]', '更新固定计划');
  log('确认文案：' + await evaluate(`return document.querySelector('#modal').innerText.replace(/\\n+/g,' | ')`));
  await clickText('#modal [data-modal="cancel"]', '取消');
  await sleep(200);
  log('计划字段（取消后不变）：' + await evaluate(`
    const d=(JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1')));
    return '固定 '+d.plans[0].exercises.filter(e=>!e.optional).length+' 个 / 当日选 '+d.plans[0].exercises.filter(e=>e.optional).length+' 个';`));
  await clickText('button', '结束训练');
  await clickText('#modal [data-modal="confirm"]', '结束');
  await sleep(400);
  log('收尾后 active：' + await evaluate(`return String((JSON.parse(localStorage.getItem('rainlift.web.v2')??localStorage.getItem('rainlift.web.v1'))).active)`));

  log('\n[9] 离线与版本');
  log('设置页版本：' + await evaluate(`
    document.querySelector('[data-action="nav"][data-view="settings"]').click();
    return new Promise(r=>setTimeout(()=>r(document.querySelector("main").innerText.match(/当前版本[^\\n]*/)?.[0]),400));`));
  log('Service Worker：' + await evaluate(`
    const r=await navigator.serviceWorker.getRegistration();
    return (r?.active?.state ?? 'none') + ' / scope ' + (r?.scope ?? '-');`));
  log('缓存名：' + await evaluate('return JSON.stringify(await caches.keys())'));
  await shot('08-settings');
  log('\nconsole errors 事件：' + events.filter(m => m === 'Runtime.exceptionThrown').length);
} catch (e) {
  log('!! 核验中断：' + (e?.message ?? e));
  log('最后一次页面文本：' + await mainText().catch(() => '(读不到)'));
} finally {
  writeFileSync(fileURLToPath(new URL('./browser.txt', import.meta.url)), lines.join('\n') + '\n');
  chrome.kill('SIGKILL');
  process.exit(0);
}
