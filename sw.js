const CACHE = 'zyntra-fc-v11';
const ASSETS = ['/zyntra-fc/mobile.css','/zyntra-fc/manifest.json','/zyntra-fc/icon-192.png','/zyntra-fc/icon-512.png','/zyntra-fc/_files/css2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.endsWith('/zyntra-fc/') || url.includes('index.html')) { e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))); return; }
  if (url.includes('fonts.gstatic.com')||url.includes('fonts.googleapis.com')) { e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{caches.open(CACHE).then(c=>c.put(e.request,res.clone()));return res;}))); return; }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res&&res.status===200&&!url.includes('data.json'))caches.open(CACHE).then(c=>c.put(e.request,res.clone()));return res;})));
});
self.addEventListener('push', e => {
  let d={title:'Zyntra FC',body:'Dados atualizados',icon:'/zyntra-fc/icon-192.png',badge:'/zyntra-fc/icon-192.png'};
  try{if(e.data)Object.assign(d,JSON.parse(e.data.text()));}catch(err){}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:d.icon,badge:d.badge,tag:'zyntra-fc',renotify:true,vibrate:[200,100,200]}));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(list=>{for(const c of list){if(c.url.includes('/zyntra-fc/')&&'focus'in c)return c.focus();}if(clients.openWindow)return clients.openWindow('/zyntra-fc/');}));});