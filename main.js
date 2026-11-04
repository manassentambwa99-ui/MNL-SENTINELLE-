/* ==========================================================
   MNL SENTINEL — point d'entrée
   1) crée la carte  2) installe les couches  3) construit l'interface
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL;
  const $ = function (s) { return document.querySelector(s); };
  const bootMsg = function (t) { const e = $('#boot-msg'); if (e) e.textContent = t; };

  async function start() {
    try {
      if (!root.maplibregl) throw new Error('MapLibre GL introuvable (connexion ou CDN bloqué ?)');
      bootMsg('INITIALISATION DE LA CARTE…');
      MNL.Map.init('map');
      await MNL.Map.ready;
      bootMsg('CHARGEMENT DES COUCHES…');
      MNL.Layers.setup(MNL.Map.getMap());
      MNL.ui.init();
      bootMsg('SYSTÈME EN LIGNE');
      setTimeout(function () {
        const b = $('#boot');
        if (!b) return;
        b.classList.add('done');
        setTimeout(function () { b.remove(); }, 800);
      }, 600);
    } catch (e) {
      console.error(e);
      bootMsg('ERREUR : ' + e.message);
      const b = $('#boot'); if (b) b.classList.add('error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
