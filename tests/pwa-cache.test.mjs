import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scope = 'https://rainlift.test/rain-lift/';
const resolveURL = value => new URL(typeof value === 'string' ? value : value.url, scope).href;

// Run the shipped worker callbacks against CacheStorage and HTTP-cache seams.
// addAll stages its writes, matching the browser's all-or-nothing operation.
function workerHarness({failPath = null} = {}) {
 const stores = new Map(), listeners = new Map(), requests = [];
 let installedCache = null, skipped = false, claimed = false;
 const store = name => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
 };
 const fetch = async (input, options = {}) => {
  const url = resolveURL(input), request = new Request(url, typeof input === 'string' ? options : input);
  requests.push(request);
  if (new URL(url).pathname.endsWith(failPath ?? '\u0000')) return new Response('unavailable', {status: 503});
  const body = request.cache === 'reload' ? 'network:' : 'stale-http:';
  return new Response(body + new URL(url).pathname);
 };
 const caches = {
  async open(name) {
   const entries = store(name);
   return {
    async addAll(inputs) {
     installedCache = name;
     const pending = await Promise.all(inputs.map(async input => {
      const response = await fetch(input);
      if (!response.ok) throw new Error('Precache request failed');
      return [resolveURL(input), response];
     }));
     for (const [url, response] of pending) entries.set(url, response);
    },
    async match(input) { return entries.get(resolveURL(input))?.clone(); },
    async put(input, response) { entries.set(resolveURL(input), response.clone()); }
   };
  },
  async match(input) {
   const url = resolveURL(input);
   for (const entries of stores.values()) if (entries.has(url)) return entries.get(url).clone();
  },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); }
 };
 const self = {
  location: new URL('sw.js', scope), registration: {scope},
  addEventListener(type, listener) { listeners.set(type, listener); },
  async skipWaiting() { skipped = true; },
  clients: {async claim() { claimed = true; }}
 };
 // This older cache exists before a new worker's install/activate lifecycle.
 const old = store('rainlift-shell-v4');
 old.set(new URL('index.html', scope).href, new Response('old-installed-index'));
 vm.runInNewContext(fs.readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8'), {self, caches, fetch, URL, Request, Response});
 return {
  stores, old, requests,
  get installed() { return stores.get(installedCache); },
  get skipped() { return skipped; },
  get claimed() { return claimed; },
  async lifecycle(type) {
   let completion;
   listeners.get(type)({waitUntil(promise) { completion = promise; }});
   await completion;
  },
  async request(url, mode = 'cors') {
   let response;
   listeners.get('fetch')({request: {url: new URL(url, scope).href, method: 'GET', mode}, respondWith(promise) { response = promise; }});
   assert.ok(response, 'worker should handle this shell request');
   return (await response).text();
  }
 };
}

test('install fetches the complete new shell instead of repackaging a stale HTTP cache', async () => {
 const worker = workerHarness();
 await worker.lifecycle('install');
 const paths = [...worker.installed.keys()].map(url => new URL(url).pathname);
 for (const name of ['index.html', 'app.js', 'data.js', 'health.js', 'health-ui.js', 'ai-report.js', 'exercise-meta.js','body-profile.js','load.js','backup.js','body-ui.js']) assert.ok(paths.some(path => path.endsWith('/' + name)), name + ' should be precached');
 for (const response of worker.installed.values()) assert.match(await response.clone().text(), /^network:/);
 assert.equal(worker.skipped, true);
});

test('a failed shell download cannot replace the previous working installation', async () => {
 const worker = workerHarness({failPath: '/data.js'});
 await assert.rejects(worker.lifecycle('install'), /Precache request failed/);
 assert.equal(worker.skipped, false);
 assert.equal(worker.claimed, false);
 assert.equal(await worker.old.get(new URL('index.html', scope).href).clone().text(), 'old-installed-index');
 assert.equal(worker.installed.size, 0, 'partial shell must not become usable');
});

test('navigation reads this worker shell even while older generation caches still exist', async () => {
 const worker = workerHarness();
 await worker.lifecycle('install');
 for (const url of worker.installed.keys()) worker.old.set(url, new Response('other-generation'));
 assert.equal(await worker.request('./?from=home-screen', 'navigate'), 'network:/rain-lift/index.html');
});

test('module requests read this worker shell instead of the first matching cache', async () => {
 const worker = workerHarness();
 await worker.lifecycle('install');
 const appURL = [...worker.installed.keys()].find(url => new URL(url).pathname.endsWith('/app.js'));
 assert.ok(appURL);
 worker.old.set(appURL, new Response('other-generation-app'));
 assert.equal(await worker.request(appURL), 'network:/rain-lift/app.js');
});

test('health and report modules are available from the installed cache without new network requests', async () => {
 const worker = workerHarness();await worker.lifecycle('install');await worker.lifecycle('activate');
 const count=worker.requests.length;
 for(const name of ['health.js','health-ui.js','ai-report.js', 'exercise-meta.js','body-profile.js','load.js','backup.js','body-ui.js']){
  const url=[...worker.installed.keys()].find(url=>new URL(url).pathname.endsWith('/'+name));
  assert.equal(await worker.request(url),'network:/rain-lift/'+name);
 }
 assert.equal(worker.requests.length,count);
});

test('a health-module precache failure cannot activate an incomplete upgrade',async()=>{
 const worker=workerHarness({failPath:'/health.js'});
 await assert.rejects(worker.lifecycle('install'),/Precache request failed/);
 assert.equal(worker.skipped,false);assert.equal(worker.claimed,false);assert.equal(worker.installed.size,0);
 assert.equal(await worker.old.get(new URL('index.html',scope).href).clone().text(),'old-installed-index');
});

test('metadata module is cached for offline type editing and report generation',async()=>{
 const worker=workerHarness();await worker.lifecycle('install');await worker.lifecycle('activate');
 const count=worker.requests.length;
 const url=[...worker.installed.keys()].find(url=>new URL(url).pathname.endsWith('/exercise-meta.js'));
 assert.ok(url);assert.equal(await worker.request(url),'network:/rain-lift/exercise-meta.js');
 assert.equal(worker.requests.length,count);
});

test('a failed metadata download retains the previous complete app cache',async()=>{
 const worker=workerHarness({failPath:'/exercise-meta.js'});
 await assert.rejects(worker.lifecycle('install'),/Precache request failed/);
 assert.equal(worker.skipped,false);assert.equal(worker.claimed,false);assert.equal(worker.installed.size,0);
 assert.equal(await worker.old.get(new URL('index.html',scope).href).clone().text(),'old-installed-index');
});

test('Pages and Sites ship identical versioned shells and the worker never clears local data',()=>{
 const names=['index.html','app.js','data.js','health.js','health-ui.js','ai-report.js', 'exercise-meta.js','body-profile.js','load.js','backup.js','body-ui.js','style.css','sw.js','manifest.webmanifest'];
 for(const name of names)assert.equal(fs.readFileSync(new URL('../docs/'+name,import.meta.url),'utf8'),fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'),name);
 const sw=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
 assert.doesNotMatch(sw,/localStorage|indexedDB|Clear-Site-Data|\.clear\(/);
 for(const name of ['app.js','data.js','health.js','health-ui.js','ai-report.js', 'exercise-meta.js','body-profile.js','load.js','backup.js','body-ui.js','style.css'])assert.ok(sw.includes('./'+name+'?v=1.8.2'),name);
 for(const name of ['app.js','health-ui.js','ai-report.js', 'exercise-meta.js','body-profile.js','load.js','backup.js','body-ui.js']){
  for(const match of fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8').matchAll(/from '(\.\/[^']+)'/g))assert.match(match[1],/\?v=1\.8\.2$/);
 }
});
