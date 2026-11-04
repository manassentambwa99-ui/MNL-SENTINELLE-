/* ==========================================================
   MNL SENTINEL — les couches de données
   Chaque couche a : setup(map) -> crée sources + styles (cachés)
                     start()    -> démarre le chargement / la mise à jour
                     stop()     -> l'arrête
   Le gestionnaire (L) allume / éteint les couches et prévient l'interface.
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL, U = MNL.U, CFG = MNL.CONFIG, SRC = CFG.sources;
  const L = {};
  const st = {};            // id -> { on, count, status, error, timer, run }
  const impls = {};         // id -> implémentation
  const upCbs = [], alertCbs = [];
  const opt = {};           // options (ex. cctv_previews)

  const gm = function () { return MNL.Map.getMap(); };
  const emit = function (id) { upCbs.forEach(function (cb) { try { cb(id); } catch (e) { console.warn(e); } }); };
  const alertUI = function (msg, color, toast) { alertCbs.forEach(function (cb) { try { cb(msg, color, toast); } catch (e) { console.warn(e); } }); };
  const setCount = function (id, n) { if (st[id]) { st[id].count = n; emit(id); } };
  const setData = function (src, feats) {
    const s = gm().getSource(src);
    if (s) s.setData({ type: 'FeatureCollection', features: feats });
  };

  // ---------- Mise à jour périodique ----------
  function startPoll(id, fn, ms) {
    stopPoll(id);
    const s = st[id];
    s.run = async function (force) {
      if (document.hidden && force !== true) { s.stale = true; return; }   // onglet caché : on économise les quotas
      s.stale = false;
      s.status = 'loading'; emit(id);
      try { await fn(); s.status = 'ok'; s.error = ''; }
      catch (e) { s.status = 'error'; s.error = (e && e.message) || String(e); console.warn('[MNL]', id, e); }
      emit(id);
    };
    s.run(true);
    if (ms) s.timer = setInterval(function () { s.run(); }, ms);
  }
  function stopPoll(id) {
    const s = st[id];
    if (s && s.timer) { clearInterval(s.timer); s.timer = null; }
  }
  function vis(ids, on) {
    const map = gm();
    ids.forEach(function (i) { if (map.getLayer(i)) map.setLayoutProperty(i, 'visibility', on ? 'visible' : 'none'); });
  }

  // ---------- Popups ----------
  function card(title, color, rows, extra) {
    return '<div class="pp" style="--c:' + U.esc(color) + '"><div class="pp-h">' + U.esc(title) + '</div>' +
      rows.map(function (r) { return '<div class="pp-r"><span>' + U.esc(r[0]) + '</span><b>' + U.esc(r[1]) + '</b></div>'; }).join('') +
      (extra || '') + '</div>';
  }
  function popupOn(layerId, render) {
    const map = gm();
    map.on('click', layerId, function (e) {
      const f = e.features && e.features[0];
      if (!f) return;
      const html = render(f.properties || {}, f);
      if (!html) return;
      const at = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates.slice() : e.lngLat;
      MNL.Map.popup(at, html);
    });
    map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
  }

  // ==========================================================
  // 1) SÉISMES — USGS (M2.5+, dernières 24 h)
  // ==========================================================
  const eqSeen = new Set();
  let eqFirst = true;
  impls.earthquakes = {
    layers: ['eq-glow', 'eq-dot'],
    setup: function (map) {
      map.addSource('eq', { type: 'geojson', data: U.emptyFC() });
      const color = ['interpolate', ['linear'], ['get', 'mag'], 2.5, '#fde047', 4, '#fb923c', 5, '#ef4444', 6, '#d946ef', 7.5, '#a855f7'];
      const radius = ['interpolate', ['linear'], ['get', 'mag'], 2.5, 3, 5, 8, 7, 18, 9, 30];
      map.addLayer({ id: 'eq-glow', type: 'circle', source: 'eq', layout: { visibility: 'none' },
        paint: { 'circle-color': color, 'circle-radius': ['*', radius, 2.4], 'circle-opacity': 0.2, 'circle-blur': 1 } });
      map.addLayer({ id: 'eq-dot', type: 'circle', source: 'eq', layout: { visibility: 'none' },
        paint: { 'circle-color': color, 'circle-radius': radius, 'circle-opacity': 0.85, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.8 } });
      popupOn('eq-dot', function (p) {
        const extra = U.safeUrl(p.url) ? '<div class="pp-x"><a href="' + U.esc(U.safeUrl(p.url)) + '" target="_blank" rel="noopener">Fiche USGS ↗</a></div>' : '';
        return card('SÉISME M' + Number(p.mag).toFixed(1), '#fb923c', [['Lieu', p.place], ['Profondeur', Math.round(p.depth) + ' km'], ['Heure', U.stamp(p.time)]], extra);
      });
    },
    start: function () { startPoll('earthquakes', fetchQuakes, 5 * 60 * 1000); },
    stop: function () {}
  };
  async function fetchQuakes() {
    const data = await U.fetchJSON(SRC.earthquakes);
    const feats = [];
    (data.features || []).forEach(function (f) {
      if (!f.geometry || !f.geometry.coordinates) return;
      const c = f.geometry.coordinates, p = f.properties || {};
      feats.push(U.point(c[0], c[1], { id: f.id, mag: p.mag || 0, place: p.place || '', time: p.time, depth: c[2] || 0, url: p.url || '' }));
      if ((p.mag || 0) >= 5.5 && !eqSeen.has(f.id)) {
        eqSeen.add(f.id);
        alertUI('Séisme M' + Number(p.mag).toFixed(1) + ' — ' + (p.place || ''), '#fb923c', !eqFirst);
      }
    });
    eqFirst = false;
    setData('eq', feats);
    setCount('earthquakes', feats.length);
  }

  // ==========================================================
  // 2) AVIATION — OpenSky Network (ADS-B)
  //    Quota anonyme : 400 crédits / jour (requête mondiale = 4, zone = 1 à 3).
  //    On compte nos crédits, on espace les requêtes, et on déplace les avions
  //    « à l'estime » (cap + vitesse) entre deux mises à jour pour rester fluide.
  // ==========================================================
  const air = { items: [], box: null, t: 0, timer: null, backoff: 0, lastErr: '' };
  const AIR_DAILY = 380;                                   // marge sous les 400 crédits
  const sqSeen = new Set();

  function airCost(box) {
    if (!box) return 4;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
  }
  function airBudget() {
    const day = new Date().toISOString().slice(0, 10);
    const b = U.store.get('opensky', null);
    return (b && b.day === day) ? b : { day: day, used: 0 };
  }
  function airDraw() {
    if (document.hidden) return;
    const now = Date.now(), feats = [];
    air.items.forEach(function (a) {
      let lng = a.lng, lat = a.lat;
      const sec = Math.min((now - a.t0) / 1000, 1200);      // 20 min d'extrapolation maximum
      if (a.spd > 20 && sec > 1) {
        const d = a.spd * sec, h = a.hdg * Math.PI / 180;
        lat += (d * Math.cos(h)) / 111320;
        lng += (d * Math.sin(h)) / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
        if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
      }
      feats.push(U.point(lng, U.clamp(lat, -89, 89), a.p));
    });
    setData('air', feats);
  }
  impls.aircraft = {
    layers: ['air-sym'],
    setup: function (map) {
      map.addImage('plane', U.makeIcon('plane'), { sdf: true });
      map.addSource('air', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({
        id: 'air-sym', type: 'symbol', source: 'air',
        layout: {
          visibility: 'none', 'icon-image': 'plane', 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.14, 5, 0.26, 9, 0.45]
        },
        paint: {
          'icon-color': ['interpolate', ['linear'], ['get', 'alt'], 0, '#22d3ee', 3000, '#a3e635', 8000, '#fbbf24', 12000, '#fb7185'],
          'icon-halo-color': 'rgba(0,0,0,0.65)', 'icon-halo-width': 1
        }
      });
      popupOn('air-sym', function (p) {
        const emergency = ['7500', '7600', '7700'].indexOf(String(p.sq)) >= 0;
        return card(p.call || p.icao || 'AVION', emergency ? '#f43f5e' : '#fbbf24', [
          ['ICAO24', p.icao], ['Pays', p.country], ['Altitude', Math.round(p.alt || 0) + ' m'],
          ['Vitesse', Math.round((p.spd || 0) * 3.6) + ' km/h'], ['Cap', Math.round(p.hdg || 0) + '°'], ['Squawk', p.sq || '—']
        ]);
      });
      // Quand on déplace la carte : fetchAircraft décide s'il faut vraiment une nouvelle requête
      map.on('moveend', U.debounce(function () {
        if (st.aircraft.on && st.aircraft.run) st.aircraft.run();
      }, 1500));
    },
    start: function () {
      startPoll('aircraft', function () { return fetchAircraft(); }, 60 * 1000);
      if (air.timer) clearInterval(air.timer);
      air.timer = setInterval(airDraw, 5000);
      airDraw();
    },
    stop: function () { if (air.timer) { clearInterval(air.timer); air.timer = null; } }
  };
  async function fetchAircraft() {
    if (Date.now() < air.backoff) throw new Error(air.lastErr);
    const map = gm();
    let box = null;
    if (map.getZoom() >= 4.5) {
      const b = map.getBounds();
      const c = [U.clamp(b.getSouth(), -90, 90), U.clamp(b.getWest(), -180, 180), U.clamp(b.getNorth(), -90, 90), U.clamp(b.getEast(), -180, 180)];
      if (c[0] < c[2] && c[1] < c[3]) box = c;
    }
    const age = Date.now() - air.t;
    const covered = !!air.t && (!air.box || (!!box && box[0] >= air.box[0] && box[1] >= air.box[1] && box[2] <= air.box[2] && box[3] <= air.box[3]));
    if (covered && age < (box ? 90 * 1000 : 10 * 60 * 1000)) return;       // données encore valables
    if (!covered && air.t && age < 20 * 1000) return;                      // évite de brûler le quota en bougeant la carte
    const cost = airCost(box), bud = airBudget();
    if (bud.used + cost > AIR_DAILY) {
      air.lastErr = 'Quota OpenSky du jour presque atteint (' + bud.used + ' / 400 crédits). Il se renouvelle chaque jour.';
      air.backoff = Date.now() + 10 * 60 * 1000;
      throw new Error(air.lastErr);
    }
    let url = SRC.opensky;
    if (box) url += '?lamin=' + box[0].toFixed(3) + '&lomin=' + box[1].toFixed(3) + '&lamax=' + box[2].toFixed(3) + '&lomax=' + box[3].toFixed(3);
    let data;
    try { data = await U.fetchJSON(url, { timeout: 30000 }); }
    catch (e) {
      air.lastErr = /429/.test(e.message) ? 'OpenSky : trop de requêtes (429) — nouvel essai dans quelques minutes' : e.message;
      air.backoff = Date.now() + 5 * 60 * 1000;
      throw new Error(air.lastErr);
    }
    bud.used += cost; U.store.set('opensky', bud);
    air.t = Date.now(); air.box = box;
    const t0def = (data.time || Math.floor(Date.now() / 1000)) * 1000;
    const items = [];
    (data.states || []).forEach(function (s) {
      if (s[5] == null || s[6] == null || s[8]) return;               // pas de position, ou au sol
      const alt = s[13] != null ? s[13] : (s[7] != null ? s[7] : 0);
      const sq = s[14] || '', call = (s[1] || '').trim();
      items.push({
        lng: s[5], lat: s[6], hdg: s[10] || 0, spd: s[9] || 0, t0: s[3] ? s[3] * 1000 : t0def,
        p: { icao: s[0], call: call, country: s[2] || '', alt: alt, spd: s[9] || 0, hdg: s[10] || 0, sq: sq }
      });
      if (['7500', '7600', '7700'].indexOf(sq) >= 0 && !sqSeen.has(s[0] + sq)) {
        sqSeen.add(s[0] + sq);
        const label = { '7500': 'détournement', '7600': 'panne radio', '7700': 'urgence générale' }[sq];
        alertUI('Squawk ' + sq + ' (' + label + ') — ' + (call || s[0]), '#f43f5e', true);
      }
    });
    air.items = items;
    airDraw();
    setCount('aircraft', items.length);
  }

  // ==========================================================
  // 3) SATELLITES — CelesTrak + satellite.js (SGP4)
  // ==========================================================
  const sat = { objs: [], index: new Map(), timer: null, iss: null, loaded: false };
  impls.satellites = {
    layers: ['sat-track', 'sat-dot', 'sat-iss'],
    setup: function (map) {
      map.addSource('sat', { type: 'geojson', data: U.emptyFC() });
      map.addSource('sat-track', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({ id: 'sat-track', type: 'line', source: 'sat-track', layout: { visibility: 'none' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#a78bfa'], 'line-width': 1.6, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'sat-dot', type: 'circle', source: 'sat', layout: { visibility: 'none' },
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4], 'circle-opacity': 0.9, 'circle-stroke-color': '#000', 'circle-stroke-width': 0.5 } });
      map.addLayer({ id: 'sat-iss', type: 'circle', source: 'sat', filter: ['==', ['get', 'id'], 25544], layout: { visibility: 'none' },
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 9, 'circle-stroke-color': '#f9a8d4', 'circle-stroke-width': 2 } });
      popupOn('sat-dot', function (p) {
        const o = sat.index.get(p.id);
        if (o) drawTrack(o);
        return card(p.name, p.color, [['NORAD', p.id], ['Groupe', p.grp], ['Altitude', U.fmt(p.alt) + ' km'], ['Vitesse', Number(p.vel).toFixed(2) + ' km/s']],
          '<div class="pp-x"><small style="color:#8f86bd">Trace de l\'orbite affichée (≈ 2 h).</small></div>');
      });
    },
    start: function () {
      startPoll('satellites', loadSatellites, 0);
    },
    stop: function () {
      if (sat.timer) { clearInterval(sat.timer); sat.timer = null; }
    }
  };
  async function loadSatDefs() {
    const cache = U.store.get('satcache', null);
    if (cache && cache.items && Date.now() - cache.t < 2 * 3600 * 1000) return cache.items;   // CelesTrak demande de ne pas abuser
    const results = await Promise.allSettled(CFG.satGroups.map(function (g) {
      return U.fetchJSON(SRC.celestrak.replace('{GROUP}', g.id), { timeout: 30000 });
    }));
    const items = [], seen = new Set();
    results.forEach(function (r, i) {
      const g = CFG.satGroups[i];
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
      r.value.slice(0, g.limit || 100000).forEach(function (o) {
        if (seen.has(o.NORAD_CAT_ID)) return;
        seen.add(o.NORAD_CAT_ID);
        items.push({ n: o.OBJECT_NAME, id: o.NORAD_CAT_ID, g: g.id, c: g.color, omm: o });
      });
    });
    if (!items.length) throw new Error('CelesTrak indisponible');
    U.store.set('satcache', { t: Date.now(), items: items });
    return items;
  }
  async function loadSatellites() {
    if (typeof satellite === 'undefined' || typeof satellite.json2satrec !== 'function') throw new Error('satellite.js indisponible');
    if (!sat.loaded) {
      const items = await loadSatDefs();
      sat.objs = []; sat.index.clear();
      items.forEach(function (it) {
        try {
          const rec = satellite.json2satrec(it.omm);
          const o = { n: it.n, id: it.id, g: it.g, c: it.c, rec: rec };
          sat.objs.push(o); sat.index.set(it.id, o);
        } catch (e) { /* élément orbital invalide : on saute */ }
      });
      sat.loaded = true;
    }
    updateSatellites();
    if (sat.timer) clearInterval(sat.timer);
    sat.timer = setInterval(updateSatellites, 2000);
  }
  function updateSatellites() {
    if (document.hidden) return;
    const now = new Date(), gmst = satellite.gstime(now), feats = [];
    sat.objs.forEach(function (o) {
      try {
        const pv = satellite.propagate(o.rec, now);
        if (!pv || !pv.position) return;
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const lat = satellite.degreesLat(gd.latitude), lng = satellite.degreesLong(gd.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return;
        const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0;
        feats.push(U.point(lng, lat, { name: o.n, id: o.id, grp: o.g, color: o.c, alt: Math.round(gd.height), vel: +v.toFixed(2) }));
        if (o.id === 25544) sat.iss = { lat: lat, lng: lng, alt: gd.height, vel: v };
      } catch (e) { /* propagation impossible : on saute */ }
    });
    setData('sat', feats);
    setCount('satellites', feats.length);
    emit('iss');
  }
  function drawTrack(o) {
    const now = Date.now(), lines = [];
    let cur = [], prev = null;
    for (let m = -10; m <= 110; m++) {
      const d = new Date(now + m * 60000);
      const pv = satellite.propagate(o.rec, d);
      if (!pv || !pv.position) continue;
      const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(d));
      const lng = satellite.degreesLong(gd.longitude), lat = satellite.degreesLat(gd.latitude);
      if (prev !== null && Math.abs(lng - prev) > 180) { lines.push(cur); cur = []; }   // coupe à l'antiméridien
      cur.push([lng, lat]); prev = lng;
    }
    lines.push(cur);
    gm().getSource('sat-track').setData({
      type: 'Feature', properties: { color: o.c },
      geometry: { type: 'MultiLineString', coordinates: lines.filter(function (l) { return l.length > 1; }) }
    });
  }

  // ==========================================================
  // 4) MARITIME + NAVAL
  //    - sans clé : Digitraffic (Finlande, données ouvertes) — mer Baltique
  //    - avec une clé AISStream : flux mondial par WebSocket
  //      (si le navigateur refuse la connexion, on revient à Digitraffic)
  // ==========================================================
  const ais = { ws: null, ships: new Map(), timer: null, retry: 0, retryT: null, status: '', fail: 0, opened: false, blocked: false };
  const ships = { users: new Set() };
  const dtr = { meta: new Map(), metaAt: 0 };

  function aisKey() { return U.store.get('aiskey', ''); }
  function aisSet(msg) { ais.status = msg; emit('maritime'); }
  function shipsUse(id) { ships.users.add(id); shipsStart(); }
  function shipsRelease(id) {
    ships.users.delete(id);
    if (ships.users.size) { shipsStart(); return; }
    aisClose(); dtrStop();
    setData('ships', []); setCount('maritime', 0); setCount('naval', 0); aisSet('');
  }
  function shipsStart() {
    if (aisKey() && !ais.blocked) { dtrStop(); aisClose(); aisConnect(); }
    else { aisClose(); dtrStart(); }
  }

  // --- Source ouverte Digitraffic ---
  function dtrStop() { stopPoll('maritime'); stopPoll('naval'); }
  function dtrStart() {
    dtrStop();
    startPoll(ships.users.has('maritime') ? 'maritime' : 'naval', fetchDigitraffic, 90 * 1000);
  }
  async function fetchDigitraffic() {
    aisSet(ais.blocked
      ? 'AISStream refusé par le navigateur — source ouverte Digitraffic (Baltique) utilisée à la place.'
      : 'Source ouverte Digitraffic (Finlande) : mer Baltique uniquement. Pour le monde entier, ajoute une clé AISStream.');
    const base = SRC.digitraffic;
    const loc = await U.fetchJSON(base + '/locations', { timeout: 45000 });
    if (Date.now() - dtr.metaAt > 3600 * 1000) {                      // noms et types : une fois par heure
      try {
        const v = await U.fetchJSON(base + '/vessels', { timeout: 45000 });
        dtr.meta.clear();
        (Array.isArray(v) ? v : []).forEach(function (x) { dtr.meta.set(x.mmsi, { name: (x.name || '').trim(), type: x.shipType }); });
        dtr.metaAt = Date.now();
      } catch (e) { console.warn('[MNL] Digitraffic /vessels :', e.message); }
    }
    const ms = function (x) { return x ? (x < 1e12 ? x * 1000 : x) : 0; };
    const now = Date.now(), feats = []; let mil = 0;
    (loc.features || []).forEach(function (f) {
      const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
      if (!c || c.length < 2) return;
      const t = ms(p.timestampExternal) || ms(p.timestamp);
      if (t && now - t > 30 * 60 * 1000) return;                      // position trop ancienne
      const mmsi = p.mmsi || f.mmsi, m = dtr.meta.get(mmsi) || {};
      const hdg = (p.heading != null && p.heading < 360) ? p.heading : ((p.cog != null && p.cog < 360) ? p.cog : 0);
      const isMil = m.type === 35;
      if (isMil) mil++;
      feats.push(U.point(c[0], c[1], { mmsi: mmsi, name: m.name || '', hdg: hdg, sog: (p.sog != null && p.sog <= 102) ? p.sog : 0, type: m.type || 0, mil: isMil }));
    });
    setData('ships', feats);
    setCount('maritime', feats.length);
    setCount('naval', mil);
  }

  // --- Flux mondial AISStream (clé gratuite) ---
  function aisClose() {
    if (ais.retryT) { clearTimeout(ais.retryT); ais.retryT = null; }
    if (ais.ws) { try { ais.ws.onclose = null; ais.ws.close(); } catch (e) {} ais.ws = null; }
    if (ais.timer) { clearInterval(ais.timer); ais.timer = null; }
  }
  function aisConnect() {
    const key = aisKey();
    if (!key || ais.ws) return;
    aisSet('Connexion à AISStream…');
    let ws;
    try { ws = new WebSocket(SRC.aisstream); } catch (e) { ais.blocked = true; shipsStart(); return; }
    ais.ws = ws; ais.opened = false;
    ws.onopen = function () {
      ais.opened = true; ais.retry = 0; ais.fail = 0;
      ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
      aisSet('AISStream connecté (flux mondial)');
    };
    ws.onmessage = async function (ev) {
      try {
        const txt = typeof ev.data === 'string' ? ev.data : await ev.data.text();
        const m = JSON.parse(txt);
        if (m.error) { aisSet('AISStream : ' + m.error); return; }
        const md = m.MetaData || {}, mmsi = md.MMSI;
        if (!mmsi) return;
        const rec = ais.ships.get(mmsi) || { mmsi: mmsi };
        if (md.ShipName && md.ShipName.trim()) rec.name = md.ShipName.trim();
        if (m.MessageType === 'PositionReport' && m.Message && m.Message.PositionReport) {
          const p = m.Message.PositionReport;
          rec.lat = md.latitude != null ? md.latitude : p.Latitude;
          rec.lng = md.longitude != null ? md.longitude : p.Longitude;
          rec.sog = p.Sog; rec.hdg = (p.TrueHeading != null && p.TrueHeading < 360) ? p.TrueHeading : (p.Cog || 0);
          rec.t = Date.now();
        } else if (m.MessageType === 'ShipStaticData' && m.Message && m.Message.ShipStaticData) {
          rec.type = m.Message.ShipStaticData.Type;
          rec.mil = rec.type === 35;                                    // 35 = opérations militaires (norme AIS)
          if (!rec.t) rec.t = Date.now();
        }
        ais.ships.set(mmsi, rec);
      } catch (e) { /* message illisible */ }
    };
    ws.onerror = function () { /* le détail arrive dans onclose */ };
    ws.onclose = function () {
      ais.ws = null;
      if (!ships.users.size) return;
      if (!ais.opened) {
        ais.fail++;
        if (ais.fail >= 2) { ais.blocked = true; shipsStart(); return; }    // refusé : retour à la source ouverte
      }
      ais.retry = Math.min(ais.retry + 1, 6);
      aisSet('AISStream déconnecté — nouvel essai…');
      ais.retryT = setTimeout(aisConnect, 3000 * ais.retry);
    };
    if (!ais.timer) ais.timer = setInterval(flushShips, 3000);
  }
  function flushShips() {
    if (document.hidden) return;
    const now = Date.now(), feats = []; let mil = 0;
    ais.ships.forEach(function (s, k) {
      if (!s.t || now - s.t > 15 * 60 * 1000) { if (s.t) ais.ships.delete(k); return; }
      if (s.lat == null || s.lng == null) return;
      feats.push(U.point(s.lng, s.lat, { mmsi: s.mmsi, name: s.name || '', hdg: s.hdg || 0, sog: s.sog || 0, type: s.type || 0, mil: !!s.mil }));
      if (s.mil) mil++;
    });
    setData('ships', feats);
    setCount('maritime', feats.length);
    setCount('naval', mil);
  }
  impls.maritime = {
    layers: ['ship-sym'],
    setup: function (map) {
      map.addImage('ship', U.makeIcon('ship'), { sdf: true });
      map.addSource('ships', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({
        id: 'ship-sym', type: 'symbol', source: 'ships',
        layout: { visibility: 'none', 'icon-image': 'ship', 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.12, 6, 0.24, 10, 0.4] },
        paint: { 'icon-color': '#22d3ee', 'icon-halo-color': 'rgba(0,0,0,0.65)', 'icon-halo-width': 1 }
      });
      popupOn('ship-sym', shipPopup);
    },
    start: function () { shipsUse('maritime'); },
    stop: function () { shipsRelease('maritime'); }
  };
  impls.naval = {
    layers: ['navy-sym'],
    setup: function (map) {
      map.addLayer({
        id: 'navy-sym', type: 'symbol', source: 'ships', filter: ['==', ['get', 'mil'], true],
        layout: { visibility: 'none', 'icon-image': 'ship', 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.2, 6, 0.36, 10, 0.55] },
        paint: { 'icon-color': '#f43f5e', 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.2 }
      });
      popupOn('navy-sym', shipPopup);
    },
    start: function () { shipsUse('naval'); },
    stop: function () { shipsRelease('naval'); }
  };
  function shipPopup(p) {
    return card(p.name || ('MMSI ' + p.mmsi), p.mil ? '#f43f5e' : '#22d3ee', [
      ['MMSI', p.mmsi], ['Vitesse', Number(p.sog || 0).toFixed(1) + ' nœuds'], ['Cap', Math.round(p.hdg || 0) + '°'], ['Type AIS', p.type || '—']
    ]);
  }

  // ==========================================================
  // 5) CAMÉRAS PUBLIQUES — données ouvertes (Londres TfL, New York DOT)
  // ==========================================================
  impls.cctv = {
    layers: ['cctv-glow', 'cctv-dot'],
    setup: function (map) {
      map.addSource('cctv', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({ id: 'cctv-glow', type: 'circle', source: 'cctv', layout: { visibility: 'none' },
        paint: { 'circle-color': '#f43f9d', 'circle-radius': 9, 'circle-opacity': 0.2, 'circle-blur': 1 } });
      map.addLayer({ id: 'cctv-dot', type: 'circle', source: 'cctv', layout: { visibility: 'none' },
        paint: { 'circle-color': '#f43f9d', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 8, 4, 12, 6], 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
      popupOn('cctv-dot', function (p) {
        const img = U.safeUrl(p.img);
        let extra = '';
        if (img) {
          const bust = img + (img.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
          extra = opt.cctv_previews
            ? '<div class="pp-x"><img src="' + U.esc(bust) + '" alt="aperçu caméra" loading="lazy" referrerpolicy="no-referrer"></div>'
            : '<div class="pp-x"><a href="' + U.esc(img) + '" target="_blank" rel="noopener">Ouvrir l\'image ↗</a></div>';
        }
        return card(p.name || 'CAMÉRA', '#f43f9d', [['Source', p.src]], extra);
      });
    },
    start: function () { startPoll('cctv', fetchCams, 15 * 60 * 1000); },
    stop: function () {}
  };
  async function fetchCams() {
    const res = await Promise.allSettled([U.fetchJSON(SRC.tfl, { timeout: 30000 }), U.fetchJSON(SRC.nyc, { timeout: 30000 })]);
    const feats = [];
    if (res[0].status === 'fulfilled' && Array.isArray(res[0].value)) {
      res[0].value.forEach(function (c) {
        if (c.lat == null || c.lon == null) return;
        const props = c.additionalProperties || [];
        const find = function (k) { const p = props.find(function (x) { return x.key === k; }); return p ? p.value : ''; };
        feats.push(U.point(c.lon, c.lat, { name: c.commonName || '', img: find('imageUrl'), src: 'Londres · TfL JamCam' }));
      });
    }
    if (res[1].status === 'fulfilled' && Array.isArray(res[1].value)) {
      res[1].value.forEach(function (c) {
        const lat = c.latitude != null ? c.latitude : c.lat, lng = c.longitude != null ? c.longitude : c.lng;
        if (lat == null || lng == null) return;
        feats.push(U.point(Number(lng), Number(lat), { name: c.name || '', img: c.imageUrl || (c.id ? SRC.nyc + '/' + c.id + '/image' : ''), src: 'New York · NYC DOT' }));
      });
    }
    if (!feats.length) throw new Error('Aucune source de caméras disponible');
    setData('cctv', feats);
    setCount('cctv', feats.length);
  }

  // ==========================================================
  // 5b) CAMÉRAS RDC (liste vérifiée dans config.js) + CAMÉRAS AJOUTÉES PAR L'UTILISATEUR
  //     Aucune donnée simulée : chaque caméra pointe vers une vraie page / vidéo / image.
  // ==========================================================
  const YT_VID = /^[A-Za-z0-9_-]{11}$/, YT_CH = /^UC[A-Za-z0-9_-]{22}$/;
  function myCams() { const v = U.store.get('mycams', []); return Array.isArray(v) ? v : []; }
  function drcFeatures() {
    const feats = [];
    (CFG.drcCameras || []).forEach(function (c) {
      feats.push(U.point(c.lng, c.lat, { id: c.id, name: c.name, city: c.city || '', kind: c.kind, ref: c.ref || '', approx: !!c.approx, mine: false, note: c.note || '' }));
    });
    myCams().forEach(function (c) {
      feats.push(U.point(c.lng, c.lat, { id: c.id, name: c.name, city: '', kind: c.kind, ref: c.ref, approx: false, mine: true, note: 'Ajoutée par toi' }));
    });
    return feats;
  }
  function drcPopup(p) {
    const ref = String(p.ref || ''), kind = p.kind;
    let extra = '';
    if (kind === 'youtube') {
      const src = YT_VID.test(ref) ? 'https://www.youtube-nocookie.com/embed/' + ref
        : (YT_CH.test(ref) ? 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + ref : '');
      const open = YT_VID.test(ref) ? 'https://www.youtube.com/watch?v=' + ref : (YT_CH.test(ref) ? 'https://www.youtube.com/channel/' + ref + '/live' : '');
      if (src) extra = '<div class="pp-x"><iframe src="' + U.esc(src) + '" title="' + U.esc(p.name) + '" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>' +
        '<a href="' + U.esc(open) + '" target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube ↗</a></div>';
    } else if (kind === 'image') {
      const u = U.safeUrl(ref);
      if (u) extra = '<div class="pp-x"><img src="' + U.esc(u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now()) + '" alt="image caméra" loading="lazy" referrerpolicy="no-referrer">' +
        '<a href="' + U.esc(u) + '" target="_blank" rel="noopener noreferrer">Ouvrir l\'image ↗</a></div>';
    } else {
      const u = U.safeUrl(ref);
      if (u) extra = '<div class="pp-x"><a href="' + U.esc(u) + '" target="_blank" rel="noopener noreferrer">Ouvrir la caméra ↗</a></div>';
    }
    const rows = [['Type', { youtube: 'Vidéo (YouTube)', image: 'Image rafraîchie', link: 'Page externe' }[kind] || kind]];
    if (p.city) rows.unshift(['Lieu', p.city]);
    if (p.note) rows.push(['Nature', p.note]);
    if (p.approx) rows.push(['Position', 'approximative (région)']);
    return card(p.name || 'CAMÉRA', p.mine ? '#38bdf8' : '#34d399', rows, extra);
  }
  impls.cctv_drc = {
    layers: ['drc-glow', 'drc-dot'],
    setup: function (map) {
      map.addSource('drc', { type: 'geojson', data: U.emptyFC() });
      const col = ['case', ['==', ['get', 'mine'], true], '#38bdf8', '#34d399'];
      map.addLayer({ id: 'drc-glow', type: 'circle', source: 'drc', layout: { visibility: 'none' },
        paint: { 'circle-color': col, 'circle-radius': 16, 'circle-opacity': 0.25, 'circle-blur': 1 } });
      map.addLayer({ id: 'drc-dot', type: 'circle', source: 'drc', layout: { visibility: 'none' },
        paint: { 'circle-color': col, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 8, 7], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } });
      popupOn('drc-dot', drcPopup);
    },
    start: function () { startPoll('cctv_drc', function () { const f = drcFeatures(); setData('drc', f); setCount('cctv_drc', f.length); return Promise.resolve(); }, 0); },
    stop: function () {}
  };

  // ==========================================================
  // 6) CÂBLES SOUS-MARINS — TeleGeography
  // ==========================================================
  impls.cables = {
    layers: ['cable-glow', 'cable-line'],
    setup: function (map) {
      map.addSource('cables', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({ id: 'cable-glow', type: 'line', source: 'cables', layout: { visibility: 'none' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#2dd4bf'], 'line-width': 5, 'line-opacity': 0.15, 'line-blur': 3 } });
      map.addLayer({ id: 'cable-line', type: 'line', source: 'cables', layout: { visibility: 'none' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#2dd4bf'], 'line-width': 1.2, 'line-opacity': 0.85 } });
      popupOn('cable-line', function (p) { return card(p.name || 'CÂBLE', p.color || '#2dd4bf', [['Identifiant', p.id || '—']]); });
    },
    start: function () { startPoll('cables', fetchCables, 0); },
    stop: function () {}
  };
  async function fetchCables() {
    const data = await U.fetchJSON(SRC.cables, { timeout: 40000 });
    if (!data || !Array.isArray(data.features)) throw new Error('Format de câbles inattendu');
    gm().getSource('cables').setData(data);
    setCount('cables', data.features.length);
  }

  // ==========================================================
  // 7) INCIDENTS MONDIAUX — NASA EONET (feux, tempêtes, volcans…)
  // ==========================================================
  const incSeen = new Set();
  let incFirst = true;
  impls.incidents = {
    layers: ['inc-glow', 'inc-dot'],
    setup: function (map) {
      map.addSource('inc', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({ id: 'inc-glow', type: 'circle', source: 'inc', layout: { visibility: 'none' },
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 14, 'circle-opacity': 0.22, 'circle-blur': 1 } });
      map.addLayer({ id: 'inc-dot', type: 'circle', source: 'inc', layout: { visibility: 'none' },
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 8, 6], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      popupOn('inc-dot', function (p) {
        const extra = U.safeUrl(p.link) ? '<div class="pp-x"><a href="' + U.esc(U.safeUrl(p.link)) + '" target="_blank" rel="noopener">Détails NASA ↗</a></div>' : '';
        return card(p.title, p.color, [['Catégorie', p.cat], ['Dernière mise à jour', p.date ? String(p.date).slice(0, 10) : '—']], extra);
      });
    },
    start: function () { startPoll('incidents', fetchIncidents, 15 * 60 * 1000); },
    stop: function () {}
  };
  async function fetchIncidents() {
    const data = await U.fetchJSON(SRC.eonet, { timeout: 30000 });
    const feats = [];
    (data.events || []).forEach(function (ev) {
      const g = (ev.geometry || [])[ev.geometry.length - 1];
      if (!g) return;
      let lng, lat;
      if (g.type === 'Point') { lng = g.coordinates[0]; lat = g.coordinates[1]; }
      else if (g.type === 'Polygon' && g.coordinates[0] && g.coordinates[0].length) {
        const ring = g.coordinates[0];
        lng = ring.reduce(function (a, c) { return a + c[0]; }, 0) / ring.length;
        lat = ring.reduce(function (a, c) { return a + c[1]; }, 0) / ring.length;
      } else return;
      const cat = (ev.categories && ev.categories[0]) || {};
      const color = CFG.incidentColors[cat.id] || '#f87171';
      feats.push(U.point(lng, lat, { id: ev.id, title: ev.title || '', cat: cat.title || '—', color: color, date: g.date, link: ev.link || '' }));
      if (!incSeen.has(ev.id)) {
        incSeen.add(ev.id);
        if (!incFirst && ['volcanoes', 'severeStorms', 'floods'].indexOf(cat.id) >= 0) alertUI((cat.title || 'Incident') + ' — ' + ev.title, color, true);
      }
    });
    incFirst = false;
    setData('inc', feats);
    setCount('incidents', feats.length);
  }

  // ==========================================================
  // 8) JOUR / NUIT — calcul local (aucune donnée externe)
  // ==========================================================
  impls.day_night = {
    layers: ['night-0', 'night-1', 'night-2', 'night-3', 'sun-glow', 'sun-dot'],
    setup: function (map) {
      map.addSource('night', { type: 'geojson', data: U.emptyFC() });
      map.addSource('sun', { type: 'geojson', data: U.emptyFC() });
      const fills = [['night-0', 0, '#1b0b4a', 0.22], ['night-1', 1, '#1b0b4a', 0.18], ['night-2', 2, '#0a0420', 0.2], ['night-3', 3, '#04010f', 0.22]];
      fills.forEach(function (f) {
        map.addLayer({ id: f[0], type: 'fill', source: 'night', filter: ['==', ['get', 'k'], f[1]], layout: { visibility: 'none' },
          paint: { 'fill-color': f[2], 'fill-opacity': f[3] } });
      });
      map.addLayer({ id: 'sun-glow', type: 'circle', source: 'sun', layout: { visibility: 'none' }, paint: { 'circle-color': '#fbbf24', 'circle-radius': 22, 'circle-opacity': 0.25, 'circle-blur': 1 } });
      map.addLayer({ id: 'sun-dot', type: 'circle', source: 'sun', layout: { visibility: 'none' }, paint: { 'circle-color': '#fde047', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    },
    start: function () { startPoll('day_night', function () { updateNight(); return Promise.resolve(); }, 60 * 1000); },
    stop: function () {}
  };
  function updateNight() {
    const now = new Date(), alts = [0, -6, -12, -18], feats = [];
    alts.forEach(function (a, k) {
      const rings = U.nightPolygons(now, a);
      feats.push({ type: 'Feature', properties: { k: k }, geometry: { type: 'MultiPolygon', coordinates: rings.map(function (r) { return [r]; }) } });
    });
    gm().getSource('night').setData({ type: 'FeatureCollection', features: feats });
    const s = U.sun(now);
    gm().getSource('sun').setData({ type: 'FeatureCollection', features: [U.point(s.lng, s.lat, {})] });
    setCount('day_night', 0);
  }

  // ==========================================================
  // 9) VENT — Open-Meteo (grille de points, flèches orientées)
  // ==========================================================
  let windStep = U.store.get('windstep', 20);
  impls.wind = {
    layers: ['wind-sym'],
    setup: function (map) {
      map.addImage('arrow', U.makeIcon('arrow'), { sdf: true });
      map.addSource('wind', { type: 'geojson', data: U.emptyFC() });
      map.addLayer({
        id: 'wind-sym', type: 'symbol', source: 'wind',
        layout: { visibility: 'none', 'icon-image': 'arrow', 'icon-rotate': ['+', ['get', 'dir'], 180], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['get', 'spd'], 0, 0.2, 60, 0.5] },
        paint: { 'icon-color': ['interpolate', ['linear'], ['get', 'spd'], 0, '#60a5fa', 15, '#22d3ee', 30, '#a3e635', 50, '#fbbf24', 80, '#f43f5e'], 'icon-opacity': 0.9 }
      });
      popupOn('wind-sym', function (p) { return card('VENT', '#a3e635', [['Vitesse', Math.round(p.spd) + ' km/h'], ['Vient du', Math.round(p.dir) + '°']]); });
    },
    start: function () { startPoll('wind', fetchWind, 60 * 60 * 1000); },
    stop: function () {}
  };
  async function fetchWind() {
    const pts = [];
    for (let lat = -70; lat <= 70; lat += windStep) for (let lng = -180; lng < 180; lng += windStep) pts.push([lat, lng]);
    const url = SRC.openmeteo + '?latitude=' + pts.map(function (p) { return p[0]; }).join(',') +
      '&longitude=' + pts.map(function (p) { return p[1]; }).join(',') +
      '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh';
    const data = await U.fetchJSON(url, { timeout: 40000 });
    const arr = Array.isArray(data) ? data : [data];
    const feats = [];
    arr.forEach(function (d, i) {
      if (!d || !d.current || !pts[i]) return;
      feats.push(U.point(pts[i][1], pts[i][0], { spd: d.current.wind_speed_10m || 0, dir: d.current.wind_direction_10m || 0 }));
    });
    setData('wind', feats);
    setCount('wind', feats.length);
  }

  // ==========================================================
  // 10) RADAR DE PLUIE — RainViewer (images animées)
  // ==========================================================
  const rain = { frames: [], idx: 0, opacity: U.store.get('rainopacity', 0.7), playing: true, timer: null };
  impls.rain = {
    get layers() { return rain.frames.map(function (f) { return f.id; }); },
    setup: function (map) {
      // Calque "ancre" invisible : les images de pluie sont insérées juste en dessous
      map.addLayer({ id: 'rain-anchor', type: 'background', paint: { 'background-opacity': 0 } });
    },
    start: function () { startPoll('rain', loadRain, 10 * 60 * 1000); startRainAnim(); },
    stop: function () { stopRainAnim(); }
  };
  async function loadRain() {
    const j = await U.fetchJSON(SRC.rainviewer);
    const host = j.host || 'https://tilecache.rainviewer.com';
    const past = (j.radar && j.radar.past) || [], now = (j.radar && j.radar.nowcast) || [];
    const frames = past.concat(now);
    if (!frames.length) throw new Error('Aucune image radar');
    const map = gm();
    rain.frames.forEach(function (f) {
      if (map.getLayer(f.id)) map.removeLayer(f.id);
      if (map.getSource(f.id)) map.removeSource(f.id);
    });
    rain.frames = frames.map(function (f, i) { return { id: 'rain-' + i, time: f.time }; });
    frames.forEach(function (f, i) {
      const id = 'rain-' + i;
      map.addSource(id, { type: 'raster', tileSize: 256, maxzoom: 7, tiles: [host + f.path + '/256/{z}/{x}/{y}/2/1_1.png'] });
      map.addLayer({ id: id, type: 'raster', source: id, layout: { visibility: st.rain.on ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, 'rain-anchor');
    });
    rain.idx = Math.max(0, past.length - 1);
    showRain();
    setCount('rain', rain.frames.length);
  }
  function showRain() {
    const map = gm();
    rain.frames.forEach(function (f, i) {
      if (map.getLayer(f.id)) map.setPaintProperty(f.id, 'raster-opacity', i === rain.idx ? rain.opacity : 0);
    });
    emit('rain');
  }
  function startRainAnim() {
    stopRainAnim();
    if (!rain.playing) return;
    rain.timer = setInterval(function () {
      if (!rain.frames.length || document.hidden) return;
      rain.idx = (rain.idx + 1) % rain.frames.length;
      showRain();
    }, 800);
  }
  function stopRainAnim() { if (rain.timer) { clearInterval(rain.timer); rain.timer = null; } }

  // ==========================================================
  // 11) ACTUALITÉS — pilotée par l'interface (panneau NEWS)
  // ==========================================================
  impls.live_news = {
    layers: [],
    setup: function () {},
    start: function () { if (MNL.ui && MNL.ui.showNews) MNL.ui.showNews(true); },
    stop: function () { if (MNL.ui && MNL.ui.showNews) MNL.ui.showNews(false); }
  };

  // ==========================================================
  // API PUBLIQUE
  // ==========================================================
  // Noms utilisés dans les liens OSIRIS -> noms de MNL SENTINEL
  const ALIAS = { global_incidents: 'incidents', sdk_sea: 'maritime', sdk_air: 'aircraft', sdk_naval: 'naval', wind_controls: 'wind', rain_controls: 'rain' };
  function urlLayers() {
    try {
      const raw = new URLSearchParams(root.location.search).get('layers');
      if (!raw) return null;
      const set = new Set(raw.split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return ALIAS[x] || x; }));
      if (set.has('all')) CFG.layers.forEach(function (l) { set.add(l.id); });
      return set;
    } catch (e) { return null; }
  }

  L.setup = function (map) {
    CFG.layers.forEach(function (l) {
      st[l.id] = { on: false, count: 0, status: 'idle', error: '', timer: null, run: null };
    });
    // Ordre d'empilement : du dessous vers le dessus
    ['day_night', 'rain', 'wind', 'cables', 'earthquakes', 'incidents', 'satellites', 'cctv', 'cctv_drc', 'aircraft', 'maritime', 'naval', 'live_news']
      .forEach(function (id) { if (impls[id] && impls[id].setup) impls[id].setup(map); });
    const forced = urlLayers();           // ?layers=… : choix de ce lien, non mémorisé
    CFG.layers.forEach(function (l) {
      if (l.isOption) { opt[l.id] = forced ? forced.has(l.id) : !!U.store.get('opt.' + l.id, !!l.defaultOn); return; }
      const saved = U.store.get('layer.' + l.id, null);
      const on = forced ? forced.has(l.id) : (saved === null ? !!l.defaultOn : !!saved);
      if (on) L.set(l.id, true, !!forced);
    });
  };
  L.set = function (id, on, transient) {
    const s = st[id], im = impls[id];
    if (!s || !im) return;
    s.on = !!on;
    vis(im.layers, s.on);
    if (s.on) { if (im.start) im.start(); }
    else { if (im.stop) im.stop(); stopPoll(id); s.status = 'idle'; }
    if (!transient) U.store.set('layer.' + id, s.on);
    emit(id);
  };
  L.isOn = function (id) { return !!(st[id] && st[id].on); };
  L.state = function (id) { return st[id]; };
  L.onUpdate = function (cb) { upCbs.push(cb); };
  L.onAlert = function (cb) { alertCbs.push(cb); };

  L.setOption = function (id, v) { opt[id] = !!v; U.store.set('opt.' + id, !!v); };
  L.getOption = function (id) { return !!opt[id]; };

  L.setAisKey = function (k) {
    U.store.set('aiskey', (k || '').trim());
    ais.blocked = false; ais.fail = 0;
    if (ships.users.size) shipsStart(); else aisSet('Clé enregistrée.');
  };
  L.hasAisKey = function () { return !!aisKey(); };
  L.aisState = function () { return ais.status; };

  L.setWindStep = function (v) {
    windStep = Number(v) || 20;
    U.store.set('windstep', windStep);
    if (st.wind.on && st.wind.run) st.wind.run();
  };
  L.getWindStep = function () { return windStep; };

  L.setRainOpacity = function (v) { rain.opacity = Number(v); U.store.set('rainopacity', rain.opacity); showRain(); };
  L.getRainOpacity = function () { return rain.opacity; };
  L.toggleRain = function () {
    rain.playing = !rain.playing;
    if (rain.playing && st.rain.on) startRainAnim(); else stopRainAnim();
    emit('rain');
    return rain.playing;
  };
  L.rainInfo = function () {
    const f = rain.frames[rain.idx];
    return { time: f ? f.time * 1000 : null, idx: rain.idx, n: rain.frames.length, playing: rain.playing };
  };

  L.iss = function () { return sat.iss; };

  // ---- Mes caméras (stockées dans ce navigateur uniquement) ----
  L.getMyCams = function () { return myCams().slice(); };
  L.addMyCam = function (c) {
    const name = String(c.name || '').trim().slice(0, 60);
    const lat = Number(c.lat), lng = Number(c.lng), kind = c.kind;
    let ref = String(c.ref || '').trim();
    if (!name) return { ok: false, error: 'Donne un nom à la caméra.' };
    if (!isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'Latitude invalide (entre -90 et 90).' };
    if (!isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'Longitude invalide (entre -180 et 180).' };
    if (kind === 'youtube') {
      const m = ref.match(/(?:v=|youtu\.be\/|embed\/|channel\/)([A-Za-z0-9_-]{11,24})/);
      if (m) ref = m[1];
      if (!YT_VID.test(ref) && !YT_CH.test(ref)) return { ok: false, error: 'Identifiant YouTube invalide (vidéo : 11 caractères ; chaîne : commence par UC).' };
    } else if (kind === 'image' || kind === 'link') {
      if (!U.safeUrl(ref)) return { ok: false, error: 'Adresse invalide (elle doit commencer par https://).' };
    } else return { ok: false, error: 'Type de caméra inconnu.' };
    const list = myCams();
    if (list.length >= 100) return { ok: false, error: 'Maximum 100 caméras.' };
    list.push({ id: 'my-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, lat: lat, lng: lng, kind: kind, ref: ref });
    U.store.set('mycams', list);
    if (st.cctv_drc && st.cctv_drc.on && st.cctv_drc.run) st.cctv_drc.run(true);
    emit('cctv_drc');
    return { ok: true };
  };
  L.removeMyCam = function (id) {
    U.store.set('mycams', myCams().filter(function (c) { return c.id !== id; }));
    if (st.cctv_drc && st.cctv_drc.on && st.cctv_drc.run) st.cctv_drc.run(true);
    emit('cctv_drc');
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    Object.keys(st).forEach(function (id) { const s = st[id]; if (s.on && s.stale && s.run) s.run(); });
  });

  MNL.Layers = L;
})(typeof window !== 'undefined' ? window : globalThis);
