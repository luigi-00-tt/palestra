/* Service worker: cache-first sull'app, che e' un file solo.
   Il nome della cache cambia a ogni build, quindi una versione nuova
   sostituisce sempre la precedente invece di restare in coda. */
var CACHE = 'palestra-vmtj2mm8e';
var FILE = ['./', './index.html', './manifest.webmanifest', './icona-192.png', './icona-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILE); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomi) {
    return Promise.all(nomi.map(function (n) { return n === CACHE ? null : caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  /* Le richieste a Open Food Facts non vanno mai in cache: devono passare
     direttamente in rete, e se non c'e' rete deve fallire subito perche'
     l'app possa proporre l'inserimento a mano. */
  if (u.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) {
        var copia = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copia); }).catch(function () {});
        return r;
      });
    })
  );
});
