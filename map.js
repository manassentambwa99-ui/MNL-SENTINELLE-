/* ==========================================================
   MNL SENTINEL — la carte (MapLibre GL)
   - globe 3D ou carte plate 2D
   - fond sombre (CARTO) ou satellite (Esri)
   - petites fonctions utilitaires : vol vers un point, popup…
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL;
  const M = {};
  let map = null;
  const cursorCbs = [];

  M.getMap = function () { return map; };

  M.init = function (containerId) {
    const style = {
      version: 8,
      name: 'MNL SENTINEL',
      projection: { type: 'globe' },
      sources: {
        'src-base-dark': {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
          ],
          attribution: '© OpenStreetMap · © CARTO'
        },
        'src-base-sat': {
          type: 'raster', tileSize: 256, maxzoom: 18,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri'
        }
      },
      layers: [
        { id: 'space',     type: 'background', paint: { 'background-color': '#06030f' } },
        { id: 'base-dark', type: 'raster', source: 'src-base-dark' },
        { id: 'base-sat',  type: 'raster', source: 'src-base-sat', layout: { visibility: 'none' } }
      ]
    };

    map = new maplibregl.Map({
      container: containerId,
      style: style,
      center: MNL.CONFIG.view.center,
      zoom: MNL.CONFIG.view.zoom,
      minZoom: 1,
      maxZoom: 17,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('mousemove', function (e) { cursorCbs.forEach(function (cb) { cb(e.lngLat.lng, e.lngLat.lat, map.getZoom()); }); });
    map.on('zoom', function () { cursorCbs.forEach(function (cb) { cb(null, null, map.getZoom()); }); });
    map.on('error', function (e) { console.warn('[MNL] carte :', e && e.error && e.error.message); });

    // « ready » = le style est chargé : on peut ajouter des couches. On n'attend PAS 'load',
    // qui attend aussi toutes les tuiles du fond de carte (bloqué si le réseau est lent).
    M.ready = new Promise(function (resolve) {
      let done = false, poll = null;
      const go = function () { if (done) return; done = true; if (poll) clearInterval(poll); resolve(); };
      const check = function () { try { if (map.getLayer('base-dark')) go(); } catch (e) { /* style pas encore prêt */ } };
      map.once('style.load', go);
      map.once('load', go);
      map.on('styledata', check);
      poll = setInterval(check, 200);
      check();
    });
    return map;
  };

  M.onCursor = function (cb) { cursorCbs.push(cb); };

  // 3D (globe) <-> 2D (Mercator)
  M.setProjection = function (is3d) {
    map.setProjection({ type: is3d ? 'globe' : 'mercator' });
  };

  // Fond sombre <-> satellite
  M.setBase = function (sat) {
    map.setLayoutProperty('base-dark', 'visibility', sat ? 'none' : 'visible');
    map.setLayoutProperty('base-sat', 'visibility', sat ? 'visible' : 'none');
  };

  M.reset = function () {
    map.flyTo({ center: MNL.CONFIG.view.center, zoom: MNL.CONFIG.view.zoom, pitch: 0, bearing: 0, duration: 1600 });
  };

  M.flyTo = function (lng, lat, zoom) {
    map.flyTo({ center: [lng, lat], zoom: zoom || 5, duration: 1800, essential: true });
  };

  M.fitBounds = function (w, s, e, n) {
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 12, duration: 1800 });
  };

  // Popup stylé (le contenu HTML doit déjà être échappé par l'appelant)
  M.popup = function (lngLat, html) {
    return new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(lngLat).setHTML(html).addTo(map);
  };

  MNL.Map = M;
})(typeof window !== 'undefined' ? window : globalThis);
