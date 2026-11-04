/* ==========================================================
   MNL SENTINEL — service worker
   Rôle : faire marcher l'appli installée (PWA) et hors ligne.

   Stratégies :
   - fichiers de l'appli (même site)  -> réseau d'abord, cache en secours
   - bibliothèques CDN + polices      -> cache d'abord, mise à jour en arrière-plan
   - tuiles de carte (CARTO, Esri)    -> cache d'abord, plafonné
   - API de données (USGS, etc.)      -> réseau d'abord, dernières données en secours
   - tout le reste (caméras, YouTube, recherche, DNS…) -> non intercepté

   Pour forcer une mise à jour chez tout le monde : change VERSION.
   ========================================================== */
'use strict';

const VERSION = 'v1.2.0';
const C_SHELL = 'mnl-shell-' + VERSION;
const C_LIBS  = 'mnl-libs-' + VERSION;
const C_TILES = 'mnl-tiles-v1';
const C_DATA  = 'mnl-data-v1';
const KEEP = [C_SHELL, C_LIBS, C_TILES, C_DATA];

// Indispensables : si l'un manque, le service worker ne s'installe pas.
const CORE = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest',
  'style.css',
  'utils.js', 'config.js', 'map.js', 'layers.js', 'ui.js', 'pwa.js', 'main.js'
];
// Utiles mais non bloquants.
const OPTIONAL = [
  'diagnostic.html', 'README.md',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'
];
// Doivent être EXACTEMENT les mêmes adresses que dans index.html.
const LIBS = [
  'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js'
];

const LIB_HOSTS  = new Set(['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const TILE_HOSTS = /(^|\.)basemaps\.cartocdn\.com$|^server\.arcgisonline\.com$/;
const DATA_HOSTS = new Set([
  'earthquake.usgs.gov', 'opensky-network.org', 'celestrak.org', 'api.tfl.gov.uk',
  'www.submarinecablemap.com', 'eonet.gsfc.nasa.gov', 'api.open-meteo.com',
  'api.rainviewer.com', 'api.gdeltproject.org', 'meri.digitraffic.fi'
]);

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const shell = await caches.open(C_SHELL);
    await shell.addAll(CORE);
    await Promise.all(OPTIONAL.map(function (u) { return shell.add(u).catch(function () {}); }));
    const libs = await caches.open(C_LIBS);
    await Promise.all(LIBS.map(function (u) { return libs.add(new Request(u, { mode: 'cors' })).catch(function () {}); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k.indexOf('mnl-') === 0 && KEEP.indexOf(k) < 0; })
      .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) { e.respondWith(sameOrigin(req, url)); return; }
  if (LIB_HOSTS.has(url.hostname)) { e.respondWith(staleWhileRevalidate(req, C_LIBS)); return; }
  if (TILE_HOSTS.test(url.hostname)) { e.respondWith(cacheFirst(req, C_TILES, 800)); return; }
  if (DATA_HOSTS.has(url.hostname)) { e.respondWith(dataFirst(req)); return; }
  // sinon : on laisse le navigateur faire
});

// ---------- Même site : réseau d'abord ----------
async function sameOrigin(req, url) {
  const cache = await caches.open(C_SHELL);
  // Pour les pages, on range une seule copie par adresse, sans ?layers=… ni #…
  const key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status === 200) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: req.mode !== 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || (await cache.match('offline.html')) || Response.error();
    }
    throw err;
  }
}

// ---------- API de données : réseau d'abord, dernières données en secours ----------
async function dataFirst(req) {
  const cache = await caches.open(C_DATA);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status === 200) { cache.put(req, res.clone()); trim(cache, 60); return res; }
    const hit = await cache.match(req);            // 429, 5xx… : mieux vaut des données un peu anciennes
    return hit || res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

// ---------- Bibliothèques : cache d'abord + rafraîchissement ----------
async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(function () { return null; });
  return hit || (await net) || Response.error();
}

// ---------- Tuiles : cache d'abord, plafonné ----------
async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status === 200) { cache.put(req, res.clone()); trim(cache, max); }
    return res;
  } catch (err) { return Response.error(); }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
