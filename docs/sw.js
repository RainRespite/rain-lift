const CACHE='rainlift-shell-v2';
const ASSETS=['./','./index.html','./style.css','./app.js','./data.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('rainlift-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){
  event.respondWith(caches.match('./index.html').then(cached=>cached||fetch(event.request)));return;
 }
 const allowed=ASSETS.map(path=>new URL(path,self.registration.scope).href);
 if(allowed.includes(url.href))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
