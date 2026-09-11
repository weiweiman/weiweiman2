const CACHE='tw-daytrade-pro-v2.1.0';
const SHELL=['./','./index.html','./technical.html','./manifest.webmanifest','./icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);

  // Never cache external market, chart or screener responses.
  // External finance data must always come from the network so stale bars are not silently reused.
  if(url.origin!==self.location.origin){
    event.respondWith(fetch(req));
    return;
  }

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req)
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy));
          return resp;
        })
        .catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const fresh=fetch(req).then(resp=>{
        if(resp && resp.ok){const copy=resp.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
        return resp;
      });
      return cached || fresh;
    })
  );
});
