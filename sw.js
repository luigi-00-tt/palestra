/* Service worker: cache-first sull'app, che e' un file solo.
   Il nome della cache cambia a ogni build, quindi una versione nuova
   sostituisce sempre la precedente invece di restare in coda. */
var CACHE = 'palestra-vmu3af98x';
/* Le animazioni degli esercizi fuori scheda arrivano dal CDN e stanno in una
   cache SENZA versione: scaricate una volta, restano anche dopo le build
   successive. Sarebbe un peccato rifarle scaricare a ogni pubblicazione. */
var CACHE_LIB = 'palestra-libreria';
var CDN = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset';
var FILE = ['./', './index.html', './manifest.webmanifest', './icona-192.png', './icona-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILE); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomi) {
    return Promise.all(nomi.map(function (n) {
      /* si cancellano le build vecchie, non la cache delle animazioni */
      return (n === CACHE || n === CACHE_LIB) ? null : caches.delete(n);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  /* Animazioni della libreria: cache-first, e una volta prese restano. */
  if (e.request.url.indexOf(CDN) === 0) {
    e.respondWith(caches.open(CACHE_LIB).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (r) {
          if (r && r.ok) c.put(e.request, r.clone()).catch(function () {});
          return r;
        });
      });
    }));
    return;
  }
  /* Le richieste a Open Food Facts non vanno mai in cache: devono passare
     direttamente in rete, e se non c'e' rete deve fallire subito perche'
     l'app possa proporre l'inserimento a mano. */
  if (u.origin !== location.origin) return;
  /* Si cerca dentro LA cache di questa versione, non fra tutte quelle
     dell'origine: caches.match() senza nome guarda ovunque, e finche' le
     vecchie non sono state cancellate risponderebbe con la pagina di ieri. */
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (r) {
          var copia = r.clone();
          c.put(e.request, copia).catch(function () {});
          return r;
        });
      });
    })
  );
});
