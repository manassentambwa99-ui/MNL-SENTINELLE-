/* ==========================================================
   MNL SENTINEL — point d'entrée
   Démarre l'application étape par étape et AFFICHE chaque étape
   sur l'écran de démarrage, pour ne jamais rester bloqué sans
   savoir pourquoi :

     1. fichiers de l'application présents ?
     2. WebGL disponible (carte 3D) ?
     3. MapLibre chargé ? (sinon : serveurs de secours)
     4. style de la carte prêt ?  (on N'ATTEND PAS les tuiles)
     5. couches, interface

   En cas de problème : message précis + boutons RÉESSAYER,
   VIDER LE CACHE, CONTINUER, DIAGNOSTIC.
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL = root.MNL || {};
  const $ = function (s) { return document.querySelector(s); };
  // Délais (ms). root.MNL_BOOT permet de les changer (utile pour les tests).
  const T = Object.assign({ cdn: 12000, style: 15000, slow: 12000 }, root.MNL_BOOT || {});
  const B = root.mnlBoot || { say: function (t) { console.log('[MNL]', t); }, actions: function () {} };
  const say = function (t, level) { B.say(t, level); };
  const msg = function (t) { const e = $('#boot-msg'); if (e) e.textContent = t; };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  let step = 'démarrage', finished = false;

  // Serveurs de secours (même contenu, autres adresses)
  const ML_JS  = [
    'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js',
    'https://fastly.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js',
    'https://gcore.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js'
  ];
  const ML_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css';
  const SAT_JS = [
    'https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js',
    'https://fastly.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js'
  ];
  const mlOk  = function () { return !!root.maplibregl && typeof root.maplibregl.Map === 'function'; };
  const satOk = function () { return !!root.satellite && typeof root.satellite.json2satrec === 'function'; };

  function fail(title, detail) {
    finished = true;
    msg(title);
    if (detail) say(detail, 'err');
    const b = $('#boot'); if (b) b.classList.add('error');
    B.actions();
  }

  function loadScript(url, ms) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      const t = setTimeout(function () { s.remove(); reject(new Error('trop lent')); }, ms);
      s.src = url; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = function () { clearTimeout(t); resolve(); };
      s.onerror = function () { clearTimeout(t); s.remove(); reject(new Error('inaccessible')); };
      document.head.appendChild(s);
    });
  }
  function loadCss(url) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = url; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
  async function ensureLib(label, test, urls, css) {
    if (test()) return true;
    for (let i = 0; i < urls.length; i++) {
      const host = urls[i].replace(/^https?:\/\//, '').split('/')[0];
      say(label + ' : essai via ' + host + '…', 'warn');
      try {
        await loadScript(urls[i], T.cdn);
        if (test()) { say(label + ' chargé via ' + host, 'ok'); if (css) loadCss(css); return true; }
      } catch (e) { say(label + ' : ' + host + ' ' + e.message, 'warn'); }
    }
    return false;
  }
  function webgl() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
    catch (e) { return false; }
  }

  async function start() {
    const slow = setTimeout(function () {
      if (finished) return;
      say('Le démarrage est lent — étape en cours : ' + step, 'warn');
      B.actions();
    }, T.slow);

    try {
      // 1) fichiers de l'application
      step = "fichiers de l'application";
      msg('VÉRIFICATION DES FICHIERS…');
      const need = [['U', 'utils.js'], ['CONFIG', 'config.js'], ['Map', 'map.js'], ['Layers', 'layers.js'], ['ui', 'ui.js']];
      const missing = need.filter(function (n) { return !MNL[n[0]]; }).map(function (n) { return n[1]; });
      if (missing.length) {
        return fail('FICHIER MANQUANT', 'Introuvable ou en erreur : ' + missing.join(', ') + ". Vérifie qu'il est bien à la racine du dépôt GitHub (même dossier que index.html).");
      }
      say("Fichiers de l'application : OK", 'ok');

      // 2) WebGL
      step = 'WebGL';
      if (!webgl()) {
        return fail('WEBGL INDISPONIBLE', "Ce navigateur ne peut pas afficher la carte 3D (WebGL désactivé ou non pris en charge). Essaie Chrome ou Firefox à jour, ou désactive l'économiseur de batterie.");
      }
      say('WebGL : OK', 'ok');

      // satellite.js en arrière-plan (la couche Satellites l'attend si besoin)
      const satP = ensureLib('satellite.js', satOk, SAT_JS, null).catch(function () { return false; });

      // 3) MapLibre
      step = 'bibliothèque de carte (MapLibre)';
      msg('CHARGEMENT DE LA CARTE…');
      if (!(await ensureLib('MapLibre', mlOk, ML_JS, ML_CSS))) {
        return fail('CARTE INDISPONIBLE', "MapLibre n'a pu être chargé depuis aucun serveur (unpkg.com, jsDelivr). Vérifie ta connexion, désactive le bloqueur de publicités, puis réessaie.");
      }
      say('MapLibre : OK', 'ok');

      // 4) carte : on attend le STYLE, pas les tuiles
      step = 'création de la carte';
      msg('INITIALISATION DE LA CARTE…');
      MNL.Map.init('map');
      let errs = 0;
      MNL.Map.getMap().on('error', function (e) {
        if (!MNL.booted && errs++ < 3) say('Carte : ' + ((e && e.error && e.error.message) || 'erreur de chargement'), 'warn');
      });
      step = 'style de la carte';
      await Promise.race([
        MNL.Map.ready,
        sleep(T.style).then(function () { throw new Error('Le style de la carte ne se charge pas (' + Math.round(T.style / 1000) + ' s).'); })
      ]);
      say('Carte : OK (les tuiles continuent de se charger)', 'ok');
      await Promise.race([satP, sleep(2500)]);

      // 5) couches + interface
      step = 'couches de données';
      msg('CHARGEMENT DES COUCHES…');
      MNL.Layers.setup(MNL.Map.getMap());
      say('Couches : OK', 'ok');
      step = 'interface';
      MNL.ui.init();
      say('Interface : OK', 'ok');

      MNL.booted = true; finished = true; clearTimeout(slow);
      msg('SYSTÈME EN LIGNE');
      setTimeout(function () {
        const b = $('#boot');
        if (!b) return;
        b.classList.add('done');
        setTimeout(function () { b.remove(); }, 800);
      }, 600);
    } catch (e) {
      console.error(e);
      clearTimeout(slow);
      fail('ERREUR AU DÉMARRAGE', ((e && e.message) || String(e)) + ' — étape : ' + step);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
