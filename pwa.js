/* ==========================================================
   MNL SENTINEL — PWA
   - enregistre le service worker (sw.js)
   - affiche le bouton « INSTALLER » quand le navigateur le permet
   - prévient quand la connexion tombe / revient
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL = root.MNL || {};
  const $ = function (s) { return document.querySelector(s); };
  const toast = function (m, c) { if (MNL.ui && MNL.ui.toast) MNL.ui.toast(m, c); };
  const standalone = function () {
    return (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || root.navigator.standalone === true;
  };

  let deferred = null;
  const btn = $('#btn-install');

  root.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();                       // on affiche notre propre bouton
    deferred = e;
    if (btn) btn.hidden = false;
  });
  root.addEventListener('appinstalled', function () {
    deferred = null;
    if (btn) btn.hidden = true;
    toast('MNL SENTINEL est installée ✔', '#a3e635');
  });
  if (btn) btn.addEventListener('click', async function () {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* ignoré */ }
    deferred = null;
    btn.hidden = true;
  });

  // iPhone / iPad : pas d'événement d'installation, on explique la manip dans l'aide
  const tip = $('#ios-tip');
  if (tip) tip.hidden = !(/iphone|ipad|ipod/i.test(root.navigator.userAgent) && !standalone());

  // Service worker (HTTPS ou localhost uniquement)
  const secure = root.location.protocol === 'https:' || root.location.hostname === 'localhost' || root.location.hostname === '127.0.0.1';
  if ('serviceWorker' in root.navigator && secure) {
    root.addEventListener('load', function () {
      root.navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
        if (!reg) return;
        reg.addEventListener('updatefound', function () {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && root.navigator.serviceWorker.controller) {
              toast('Mise à jour installée — recharge la page pour l\'appliquer.', '#22d3ee');
            }
          });
        });
      }).catch(function (err) { console.warn('[MNL] service worker :', err); });
    });
  }

  root.addEventListener('offline', function () { toast('Hors ligne — dernières données en cache', '#fb923c'); });
  root.addEventListener('online', function () { toast('Connexion rétablie', '#a3e635'); });

  MNL.pwa = { isStandalone: standalone };
})(typeof window !== 'undefined' ? window : globalThis);
