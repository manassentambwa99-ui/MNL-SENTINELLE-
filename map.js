/* ==========================================================
   MNL SENTINEL — la carte (MapLibre GL)
   - globe 3D ou carte plate 2D (avec relief 3D réel en 2D)
   - 6 fonds : sombre, satellite, hybride, topo, nuit (NASA), terre d'hier (NASA)
   - atmosphère, rotation automatique, capture d'écran
   - petites fonctions utilitaires : vol vers un point, popup…
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL, CFG = MNL.CONFIG, U = MNL.U;
  const M = {};
  let map = null, base = 'dark', is3d = true;
  let spinning = false, spinRaf = 0, spinSpeed = 7;
  let terrainWanted = false;
  const cursorCbs = [], baseCbs = [], projCbs = [], spinCbs = [];

  M.getMap = function () { return map; };

  // Date (UTC) utilisée pour l'imagerie NASA « Terre » : hier, pour être sûr qu'elle soit publiée.
  function imageryDate() { return new Date(Date.now() - 30 * 3600 * 1000).toISOString().slice(0, 10); }

  function baseDef(id) { return CFG.basemaps.filter(function (b) { return b.id === id; })[0] || null; }

  // Lit ?base=…&v=lng,lat,zoom,bearing,pitch dans l'adresse (liens partagés)
  function urlView() {
    try {
      const q = new URLSearchParams(root.location.search);
      const out = {};
      const b = q.get('base'); if (b && baseDef(b)) out.base = b;
      const v = (q.get('v') || '').split(',').map(Number);
      if (v.length >= 3 && v.slice(0, 3).every(isFinite) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90) {
        out.view = { lng: v[0], lat: v[1], zoom: U.clamp(v[2], 1, 18), bearing: isFinite(v[3]) ? v[3] : 0, pitch: isFinite(v[4]) ? U.clamp(v[4], 0, 80) : 0 };
      }
      return out;
    } catch (e) { return {}; }
  }

  function buildStyle(startBase) {
    const date = imageryDate();
    const sources = {}, layers = [{ id: 'space', type: 'background', paint: { 'background-color': '#06030f' } }];
    // Une source par fond « réel » ; les fonds « like » réutilisent celle d'un autre.
    CFG.basemaps.forEach(function (b) {
      if (b.like) return;
      sources['src-base-' + b.id] = {
        type: 'raster', tileSize: 256, maxzoom: b.maxzoom || 18, attribution: b.attribution || '',
        tiles: b.tiles.map(function (t) { return t.replace('{DATE}', date); })
      };
    });
    sources['src-labels'] = { type: 'raster', tileSize: 256, maxzoom: 19, tiles: CFG.labelTiles, attribution: '© OpenStreetMap · © CARTO' };
    const want = 'base-' + ((baseDef(startBase) || {}).like || startBase);
    // Les couches invisibles ne téléchargent aucune tuile : on peut toutes les déclarer.
    CFG.basemaps.forEach(function (b) {
      if (b.like) return;
      layers.push({ id: 'base-' + b.id, type: 'raster', source: 'src-base-' + b.id, layout: { visibility: ('base-' + b.id) === want ? 'visible' : 'none' } });
    });
    // Ancres : les couches de relief et de ville sont insérées juste en dessous.
    layers.push({ id: 'anchor-relief', type: 'background', paint: { 'background-opacity': 0 } });
    layers.push({ id: 'anchor-city',   type: 'background', paint: { 'background-opacity': 0 } });
    layers.push({ id: 'base-labels', type: 'raster', source: 'src-labels', layout: { visibility: (baseDef(startBase) || {}).labels ? 'visible' : 'none' } });
    return { version: 8, name: 'MNL SENTINEL', projection: { type: 'globe' }, sources: sources, layers: layers };
  }

  M.init = function (containerId) {
    const uv = urlView();
    base = uv.base || (baseDef(U.store.get('base', 'dark')) ? U.store.get('base', 'dark') : 'dark');
    spinSpeed = (CFG.fx && CFG.fx.spinSpeed) || 7;
    const v = uv.view;

    map = new maplibregl.Map({
      container: containerId,
      style: buildStyle(base),
      center: v ? [v.lng, v.lat] : CFG.view.center,
      zoom: v ? v.zoom : CFG.view.zoom,
      bearing: v ? v.bearing : 0,
      pitch: v ? v.pitch : 0,
      minZoom: 1,
      maxZoom: 18,
      maxPitch: 80,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('mousemove', function (e) { cursorCbs.forEach(function (cb) { cb(e.lngLat.lng, e.lngLat.lat, map.getZoom()); }); });
    map.on('zoom', function () { cursorCbs.forEach(function (cb) { cb(null, null, map.getZoom()); }); });
    map.on('error', function (e) { console.warn('[MNL] carte :', e && e.error && e.error.message); });

    // Un geste de l'utilisateur arrête la rotation automatique
    const stopOnUser = function () { if (spinning) M.spin(false); };
    ['mousedown', 'touchstart', 'wheel'].forEach(function (ev) {
      const c = map.getCanvasContainer ? map.getCanvasContainer() : map.getCanvas();
      if (c && c.addEventListener) c.addEventListener(ev, stopOnUser, { passive: true });
    });

    // « ready » = le style est chargé : on peut ajouter des couches. On n'attend PAS 'load',
    // qui attend aussi toutes les tuiles du fond de carte (bloqué si le réseau est lent).
    M.ready = new Promise(function (resolve) {
      let done = false, poll = null;
      const go = function () { if (done) return; done = true; if (poll) clearInterval(poll); atmosphere(); resolve(); };
      const check = function () { try { if (map.getLayer('base-labels')) go(); } catch (e) { /* style pas encore prêt */ } };
      map.once('style.load', go);
      map.once('load', go);
      map.on('styledata', check);
      poll = setInterval(check, 200);
      check();
    });
    return map;
  };

  // Halo d'atmosphère autour du globe (ignoré si cette version de MapLibre ne sait pas le faire)
  function atmosphere() {
    try {
      if (!map.setSky) return;
      map.setSky({
        'sky-color': '#2a1470', 'horizon-color': '#22d3ee', 'fog-color': '#0b0720',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.3,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0.2, 10, 0]
      });
    } catch (e) { console.warn('[MNL] atmosphère :', e && e.message); }
  }

  M.onCursor = function (cb) { cursorCbs.push(cb); };

  // ---------- 3D (globe) <-> 2D (Mercator) ----------
  M.setProjection = function (want3d) {
    is3d = !!want3d;
    map.setProjection({ type: is3d ? 'globe' : 'mercator' });
    applyTerrain();
    projCbs.forEach(function (cb) { try { cb(is3d); } catch (e) { console.warn(e); } });
  };
  M.is3d = function () { return is3d; };
  M.onProjection = function (cb) { projCbs.push(cb); };

  // ---------- Fonds de carte ----------
  M.setBase = function (id) {
    if (id === true) id = 'sat'; else if (id === false) id = 'dark';     // ancien appel : booléen
    const d = baseDef(id);
    if (!d) return false;
    const target = 'base-' + (d.like || d.id);
    CFG.basemaps.forEach(function (b) {
      if (b.like) return;
      const l = 'base-' + b.id;
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', l === target ? 'visible' : 'none');
    });
    if (map.getLayer('base-labels')) map.setLayoutProperty('base-labels', 'visibility', d.labels ? 'visible' : 'none');
    base = d.id;
    U.store.set('base', base);
    baseCbs.forEach(function (cb) { try { cb(base); } catch (e) { console.warn(e); } });
    return true;
  };
  M.getBase = function () { return base; };
  M.onBase = function (cb) { baseCbs.push(cb); };
  M.nextBase = function () {
    const ids = CFG.basemaps.map(function (b) { return b.id; });
    M.setBase(ids[(ids.indexOf(base) + 1) % ids.length]);
    return base;
  };

  // ---------- Relief ----------
  // Source d'altitude (AWS Terrarium), ajoutée seulement à la première utilisation.
  M.ensureDem = function () {
    try {
      if (!map.getSource('src-dem')) {
        map.addSource('src-dem', { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14, tiles: [CFG.sources.terrarium], attribution: 'Terrain © Mapzen / AWS' });
      }
      return true;
    } catch (e) { console.warn('[MNL] relief :', e && e.message); return false; }
  };
  // Relief 3D réel : seulement en carte plate (le globe ne sait pas le faire)
  M.setTerrain = function (on) { terrainWanted = !!on; applyTerrain(); };
  function applyTerrain() {
    try {
      if (terrainWanted && !is3d && map.getSource('src-dem')) map.setTerrain({ source: 'src-dem', exaggeration: 1.5 });
      else if (map.getTerrain && map.getTerrain()) map.setTerrain(null);
    } catch (e) { console.warn('[MNL] terrain :', e && e.message); }
  }

  // ---------- Vue ----------
  M.reset = function () {
    map.flyTo({ center: CFG.view.center, zoom: CFG.view.zoom, pitch: 0, bearing: 0, duration: 1600 });
  };
  M.flyTo = function (lng, lat, zoom) {
    map.flyTo({ center: [lng, lat], zoom: zoom || 5, duration: 1800, essential: true });
  };
  M.fitBounds = function (w, s, e, n) {
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 12, duration: 1800 });
  };
  M.getView = function () {
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  // Vol « caméra de film » : cap et inclinaison choisis
  M.cinema = function (lng, lat, o) {
    o = o || {};
    map.flyTo({
      center: [lng, lat], zoom: o.zoom || 12, pitch: o.pitch == null ? 60 : o.pitch, bearing: o.bearing == null ? 0 : o.bearing,
      duration: o.duration || 4500, curve: 1.6, essential: true
    });
  };

  // ---------- Rotation automatique du globe ----------
  M.spin = function (on) {
    on = !!on;
    if (on === spinning) return spinning;
    spinning = on;
    if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; }
    if (on) {
      let last = performance.now();
      const tick = function (now) {
        if (!spinning) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (map.getZoom() > 5.5) { M.spin(false); return; }               // inutile de tourner quand on est tout près
        if (!document.hidden && !(map.isMoving && map.isMoving())) {
          const c = map.getCenter();
          map.jumpTo({ center: [((c.lng - spinSpeed * dt + 540) % 360) - 180, c.lat] });
        }
        spinRaf = requestAnimationFrame(tick);
      };
      spinRaf = requestAnimationFrame(tick);
    }
    spinCbs.forEach(function (cb) { try { cb(spinning); } catch (e) { console.warn(e); } });
    return spinning;
  };
  M.isSpinning = function () { return spinning; };
  M.onSpin = function (cb) { spinCbs.push(cb); };

  // ---------- Capture d'écran (PNG avec filigrane MNL) ----------
  M.capture = function (label) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('capture : délai dépassé')); } }, 6000);
      map.once('render', function () {
        if (settled) return;
        try {
          const c = map.getCanvas(), out = document.createElement('canvas');
          out.width = c.width; out.height = c.height;
          const g = out.getContext('2d');
          g.drawImage(c, 0, 0);
          const k = Math.max(1, out.width / 900), pad = 10 * k, h = 30 * k;
          g.fillStyle = 'rgba(8,4,20,.72)'; g.fillRect(0, out.height - h - pad, out.width, h + pad);
          g.fillStyle = '#f43f9d'; g.fillRect(0, out.height - h - pad, 4 * k, h + pad);
          g.font = 'bold ' + 15 * k + 'px monospace'; g.textBaseline = 'middle';
          g.fillStyle = '#ffffff'; g.fillText('MNL SENTINEL', 14 * k, out.height - (h + pad) / 2);
          g.font = 13 * k + 'px monospace'; g.fillStyle = '#22d3ee'; g.textAlign = 'right';
          g.fillText(label || '', out.width - 12 * k, out.height - (h + pad) / 2);
          out.toBlob(function (b) {
            settled = true; clearTimeout(timer);
            if (b) resolve(b); else reject(new Error('capture vide'));
          }, 'image/png');
        } catch (e) { settled = true; clearTimeout(timer); reject(e); }
      });
      map.triggerRepaint();
    });
  };

  // Popup stylé (le contenu HTML doit déjà être échappé par l'appelant)
  M.popup = function (lngLat, html) {
    return new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(lngLat).setHTML(html).addTo(map);
  };

  MNL.Map = M;
})(typeof window !== 'undefined' ? window : globalThis);
