const CACHE='rainlift-shell-v6';
const ASSETS=['./','./index.html','./style.css?v=1.4','./app.js?v=1.4','./data.js?v=1.4','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const assetURL=path=>new URL(path,self.registration.scope).href;
// Revalidate the complete shell together; a new worker must not repackage old HTTP assets.
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(path=>new Request(assetURL(path),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('rainlift-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(assetURL('./index.html'))).then(cached=>cached||fetch(event.request)));return;
 }
 const allowed=ASSETS.map(assetURL);
 if(allowed.includes(url.href))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));
});
