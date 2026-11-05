/* ==========================================================
   MNL SENTINEL — effets « film d'action » + visionneuse de caméras
   Tout est facultatif : si ce fichier manque, le reste de l'application marche.

   - HUD (viseur, balayage, coins), impulsions sur les alertes, ciel étoilé
   - visite cinématique, rotation du globe, bandeau « lower-third »
   - indicateur NIVEAU, bandeau d'actualités défilant
   - règle de distance, capture PNG, lien partageable, barre de commandes
   - onglet SITES (vol vers une ville : fond hybride + bâtiments 3D + routes)
   - onglet CAMS : caméras proches, visionneuse vidéo/photo, MUR de caméras,
     ajout de tes propres caméras
   - sons (désactivés par défaut)

   Aucune reconnaissance de visages, aucun suivi de personnes.
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL, U = MNL.U, CFG = MNL.CONFIG, L = MNL.Layers, M = MNL.Map;
  const FX = CFG.fx || {};
  const fx = {};
  let map = null, inited = false;

  const $ = function (s, el) { return (el || document).querySelector(s); };
  const $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function h(tag, props, kids) {
    const e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  const toast = function (m, c) { if (MNL.ui && MNL.ui.toast) MNL.ui.toast(m, c); };
  const safe = function (name, fn) { try { fn(); } catch (e) { console.warn('[MNL] fx.' + name + ' :', e); } };
  const norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  const pad = function (n, w) { return String(Math.round(n)).padStart(w || 2, '0'); };

  const pref = { hud: !!U.store.get('fx.hud', true), ticker: !!U.store.get('fx.ticker', true), sound: false };
  const btns = {};                                        // nom -> bouton de la barre flottante
  const setBtn = function (name, on) { if (btns[name]) btns[name].classList.toggle('on', !!on); };

  // ==========================================================
  // Sons (WebAudio, désactivés par défaut : le navigateur exige un geste pour les autoriser)
  // ==========================================================
  let ac = null;
  function audio() {
    try {
      if (!ac) { const C = root.AudioContext || root.webkitAudioContext; if (!C) return null; ac = new C(); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) { return null; }
  }
  function tone(freq, start, dur, type, vol) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + start;
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  fx.sound = function (name) {
    if (!pref.sound) return;
    if (name === 'alert') { tone(880, 0, 0.13, 'square', 0.05); tone(660, 0.16, 0.13, 'square', 0.05); tone(880, 0.32, 0.18, 'square', 0.05); }
    else if (name === 'blip') tone(1200, 0, 0.06, 'sine', 0.05);
    else if (name === 'on') { tone(520, 0, 0.1, 'triangle', 0.06); tone(780, 0.11, 0.14, 'triangle', 0.06); }
    else if (name === 'shot') { tone(200, 0, 0.05, 'sawtooth', 0.05); tone(1500, 0.03, 0.08, 'square', 0.03); }
  };
  fx.setSound = function (on) {
    pref.sound = !!on; setBtn('sound', pref.sound);
    if (pref.sound) { audio(); fx.sound('on'); }
    toast(pref.sound ? 'Sons activés' : 'Sons coupés', '#a78bfa');
  };

  // ==========================================================
  // Ciel étoilé (derrière le globe)
  // ==========================================================
  function buildStars() {
    const c = h('canvas', { id: 'stars', 'aria-hidden': 'true' });
    const mapEl = $('#map');
    if (mapEl && mapEl.parentNode) mapEl.parentNode.insertBefore(c, mapEl); else document.body.appendChild(c);
    const draw = function () {
      const w = c.width = root.innerWidth, hh = c.height = root.innerHeight, g = c.getContext('2d');
      if (!g) return;
      let seed = 7; const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };   // toujours les mêmes étoiles
      const cols = ['#ffffff', '#c4b5fd', '#67e8f9', '#f9a8d4', '#fde68a'];
      for (let i = 0; i < Math.round(w * hh / 5200); i++) {
        g.globalAlpha = 0.25 + rnd() * 0.75; g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        const r = 0.3 + rnd() * 1.1; g.beginPath(); g.arc(rnd() * w, rnd() * hh, r, 0, 6.2832); g.fill();
      }
    };
    draw();
    root.addEventListener('resize', U.debounce(draw, 300));
  }

  // ==========================================================
  // HUD
  // ==========================================================
  let hud = null, hudRead = null, hudQueued = false;
  function buildHud() {
    hudRead = h('div', { class: 'hud-read', id: 'hud-read' });
    hud = h('div', { id: 'hud', 'aria-hidden': 'true' }, [
      h('i', { class: 'hud-scan' }), h('i', { class: 'hud-vig' }),
      h('i', { class: 'hud-c tl' }), h('i', { class: 'hud-c tr' }), h('i', { class: 'hud-c bl' }), h('i', { class: 'hud-c br' }),
      h('div', { class: 'hud-cross' }, [h('i'), h('i'), h('i')]),
      hudRead
    ]);
    document.body.appendChild(hud);
    fx.setHud(pref.hud, true);
    const upd = function () {
      if (hudQueued) return; hudQueued = true;
      requestAnimationFrame(function () { hudQueued = false; hudRefresh(); });
    };
    map.on('move', upd);
    setInterval(hudRefresh, 1000);
    hudRefresh();
  }
  function dms(v, pos, neg) { return Math.abs(v).toFixed(3) + '°' + (v >= 0 ? pos : neg); }
  function hudRefresh() {
    if (!hudRead || !pref.hud) return;
    const v = M.getView();
    const alt = 40075 / Math.pow(2, v.zoom) * 0.8;                                   // altitude de la « caméra » (approximative)
    hudRead.textContent = 'LAT ' + dms(v.lat, 'N', 'S') + '  LNG ' + dms(v.lng, 'E', 'W') +
      '  ALT ≈ ' + (alt >= 10 ? U.fmt(Math.round(alt)) + ' km' : Math.round(alt * 1000) + ' m') +
      '  CAP ' + pad(((v.bearing % 360) + 360) % 360, 3) + '°  INCL ' + pad(v.pitch) + '°  ' + U.utc();
  }
  fx.setHud = function (on, quiet) {
    pref.hud = !!on; U.store.set('fx.hud', pref.hud);
    if (hud) hud.classList.toggle('on', pref.hud);
    document.body.classList.toggle('hud-on', pref.hud);
    setBtn('hud', pref.hud);
    if (pref.hud) hudRefresh();
    if (!quiet) fx.sound('blip');
  };

  // ==========================================================
  // Impulsions (anneaux qui s'étendent) sur les alertes
  // ==========================================================
  const pulses = [];
  let pulseRaf = 0, pulseLast = 0;
  function setupPulses() {
    map.addSource('fx-pulse', { type: 'geojson', data: U.emptyFC() });
    map.addLayer({
      id: 'fx-pulse', type: 'circle', source: 'fx-pulse',
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 2.2, 'circle-stroke-opacity': ['get', 'o'] }
    });
  }
  fx.pulse = function (lng, lat, color) {
    if (!isFinite(lng) || !isFinite(lat) || !map.getSource('fx-pulse')) return;
    pulses.push({ lng: lng, lat: lat, c: color || '#f43f9d', t0: performance.now(), dur: 3000 });
    if (pulses.length > 40) pulses.shift();
    if (!pulseRaf) pulseRaf = requestAnimationFrame(pulseTick);
  };
  function pulseTick(now) {
    pulseRaf = 0;
    if (now - pulseLast >= 50) {
      pulseLast = now;
      const feats = [];
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], k = (now - p.t0) / p.dur;
        if (k >= 1.36) { pulses.splice(i, 1); continue; }
        [0, 0.18, 0.36].forEach(function (off) {
          const q = k - off; if (q <= 0 || q >= 1) return;
          feats.push(U.point(p.lng, p.lat, { r: 6 + 80 * (1 - Math.pow(1 - q, 2)), o: Math.max(0, 1 - q), c: p.c }));
        });
      }
      const s = map.getSource('fx-pulse'); if (s) s.setData({ type: 'FeatureCollection', features: feats });
    }
    if (pulses.length) pulseRaf = requestAnimationFrame(pulseTick);
  }

  // ==========================================================
  // Bandeau « lower-third » (titre qui glisse en bas, comme à la télé / au cinéma)
  // ==========================================================
  let l3 = null, l3Timer = 0;
  function buildL3() {
    l3 = h('div', { id: 'l3' }, [h('div', { class: 'l3-bar' }, [h('b', { id: 'l3-t' }), h('small', { id: 'l3-s' })])]);
    document.body.appendChild(l3);
  }
  function showL3(title, sub, color, ms) {
    if (!l3) return;
    $('#l3-t').textContent = title || ''; $('#l3-s').textContent = sub || '';
    l3.style.setProperty('--c', color || '#22d3ee');
    l3.classList.add('show');
    clearTimeout(l3Timer);
    if (ms) l3Timer = setTimeout(hideL3, ms);
  }
  function hideL3() { if (l3) l3.classList.remove('show'); clearTimeout(l3Timer); }

  // ==========================================================
  // Visite cinématique et vol vers un site
  // ==========================================================
  const tour = { on: false, i: 0, timer: 0 };
  fx.goSite = function (s, o) {
    o = o || {};
    if (!s) return;
    const bearing = Math.round(Math.random() * 80 - 40);
    if (s.type === 'relief') {
      L.set('relief', true, true);
      M.setBase('sat', true);
      M.cinema(s.lng, s.lat, { zoom: 11.2, pitch: 68, bearing: bearing, duration: o.tour ? 6000 : 4500 });
    } else {
      L.set('buildings', true, true); L.set('roads', true, true);
      M.setBase('hybrid', true);
      M.cinema(s.lng, s.lat, { zoom: 15.2, pitch: 62, bearing: bearing, duration: o.tour ? 6000 : 4500 });
    }
    showL3(s.name.toUpperCase(), s.sub + '  ·  ' + dms(s.lat, 'N', 'S') + '  ' + dms(s.lng, 'E', 'W'), s.type === 'relief' ? '#c4b5fd' : '#22d3ee', (FX.tourDwell || 7000) - 800);
    fx.sound('blip');
    if (MNL.ui && MNL.ui.closeSide) MNL.ui.closeSide();
  };
  fx.tour = function (on) {
    if (on === undefined) on = !tour.on;
    on = !!on;
    if (on === tour.on) return tour.on;
    tour.on = on; setBtn('tour', on);
    clearTimeout(tour.timer);
    if (!on) { hideL3(); return false; }
    M.spin(false);
    const list = CFG.hotspots || [];
    if (!list.length) { tour.on = false; setBtn('tour', false); return false; }
    toast('Visite cinématique — touche l\'écran ou Échap pour arrêter', '#f43f9d');
    const step = function () {
      if (!tour.on) return;
      fx.goSite(list[tour.i % list.length], { tour: true });
      tour.i++;
      tour.timer = setTimeout(step, FX.tourDwell || 7000);
    };
    step();
    return true;
  };
  fx.isTouring = function () { return tour.on; };

  // ==========================================================
  // Indicateur NIVEAU (calculé sur les données affichées ; rien d'officiel)
  // ==========================================================
  const LEVELS = [
    { k: 0, name: 'CALME',      color: '#a3e635' },
    { k: 1, name: 'VIGILANCE',  color: '#fbbf24' },
    { k: 2, name: 'ÉLEVÉ',      color: '#fb923c' },
    { k: 3, name: 'CRITIQUE',   color: '#f43f5e' }
  ];
  let level = -1;
  function buildThreat() {
    const stats = $('.stats'); if (!stats) return;
    const chip = h('div', { class: 'chip', id: 'chip-threat', title: 'Indicateur simple calculé sur les séismes M5+, les alertes d\'avions (7500/7600/7700) et les incidents NASA affichés. Ce n\'est PAS un niveau de menace officiel.' },
      [h('label', { text: 'NIVEAU' }), h('span', { id: 'threat', text: '—' })]);
    stats.appendChild(chip);
    setInterval(threatRefresh, 5000);
    L.onUpdate(function (id) { if (id === 'earthquakes' || id === 'aircraft' || id === 'incidents') threatRefresh(); });
    threatRefresh();
  }
  function threatRefresh() {
    const chip = $('#chip-threat'), val = $('#threat'); if (!chip || !val) return;
    const any = L.isOn('earthquakes') || L.isOn('aircraft') || L.isOn('incidents');
    if (!any) { val.textContent = '—'; chip.style.setProperty('--c', '#8f86bd'); chip.className = 'chip'; level = -1; return; }
    const s = L.stats();
    const score = 8 * (L.isOn('earthquakes') ? s.m5 : 0) + 20 * (L.isOn('earthquakes') ? s.m6 : 0) + 30 * (L.isOn('aircraft') ? s.sq : 0) + 2 * Math.min(10, L.isOn('incidents') ? s.severe : 0);
    const k = score < 15 ? 0 : score < 40 ? 1 : score < 70 ? 2 : 3;
    const lv = LEVELS[k];
    val.textContent = lv.name; val.style.color = lv.color;
    chip.style.setProperty('--c', lv.color);
    chip.className = 'chip' + (k === 3 ? ' blink' : '');
    if (level >= 0 && k > level) { toast('NIVEAU : ' + lv.name, lv.color); fx.sound('alert'); }
    level = k;
  }

  // ==========================================================
  // Bandeau d'actualités défilant
  // ==========================================================
  let ticker = null, tickTrack = null, headlines = [], recent = [], tickQueued = false;
  function buildTicker() {
    tickTrack = h('div', { class: 'tk-track' });
    ticker = h('div', { id: 'ticker', 'aria-label': 'Bandeau d\'informations' }, [h('span', { class: 'tk-tag', text: 'MNL' }), h('div', { class: 'tk-view' }, [tickTrack])]);
    document.body.appendChild(ticker);
    fx.setTicker(pref.ticker, true);
    setInterval(tickerBuild, 30000);
    tickerBuild();
  }
  function tickerQueue() { if (tickQueued) return; tickQueued = true; setTimeout(function () { tickQueued = false; tickerBuild(); }, 1500); }
  function tickerBuild() {
    if (!tickTrack || !pref.ticker) return;
    const items = [];
    const s = L.stats();
    items.push({ t: 'MNL SENTINEL EN LIGNE', c: '#f43f9d' });
    if (L.isOn('aircraft') && s.aircraft) items.push({ t: 'AVIONS SUIVIS : ' + U.fmt(s.aircraft), c: '#fbbf24' });
    if (L.isOn('earthquakes') && s.quakes) items.push({ t: 'SÉISMES 24 H : ' + U.fmt(s.quakes) + (s.top ? '  ·  PLUS FORT : M' + s.top.mag.toFixed(1) + ' ' + s.top.place : ''), c: '#fb923c' });
    if (L.isOn('incidents') && s.severe) items.push({ t: 'INCIDENTS GRAVES (NASA) : ' + s.severe, c: '#f87171' });
    recent.slice(0, 6).forEach(function (a) { items.push({ t: 'ALERTE · ' + a.t, c: a.c }); });
    headlines.slice(0, 20).forEach(function (a) { items.push({ t: a.title, c: '#22d3ee', href: a.href }); });
    tickTrack.textContent = '';
    let chars = 0;
    for (let pass = 0; pass < 2; pass++) {                                           // contenu doublé : défilement sans à-coup
      items.forEach(function (it) {
        const e = it.href ? h('a', { href: it.href, target: '_blank', rel: 'noopener noreferrer' }) : h('span');
        e.className = 'tk-i'; e.style.setProperty('--c', it.c); e.textContent = it.t;
        tickTrack.appendChild(e); if (!pass) chars += it.t.length + 6;
      });
    }
    tickTrack.style.setProperty('--dur', Math.max(40, Math.round(chars * 0.2)) + 's');
  }
  fx.setTicker = function (on, quiet) {
    pref.ticker = !!on; U.store.set('fx.ticker', pref.ticker);
    if (ticker) ticker.classList.toggle('on', pref.ticker);
    document.body.classList.toggle('has-ticker', pref.ticker);
    if (pref.ticker) tickerBuild();
    if (!quiet) fx.sound('blip');
  };
  fx.headlines = function (arts) {
    headlines = (arts || []).map(function (a) { return { title: String(a.title || ''), href: U.safeUrl(a.url) }; }).filter(function (a) { return a.title; });
    tickerQueue();
  };

  // Appelé par l'interface à chaque alerte
  fx.onAlert = function (msg, color, toastIt, lng, lat) {
    recent.unshift({ t: msg, c: color || '#fb923c' });
    if (recent.length > 10) recent.pop();
    if (lng != null && lat != null) fx.pulse(Number(lng), Number(lat), color);
    if (toastIt) { fx.sound('alert'); showL3('ALERTE', msg, color || '#f43f5e', 7000); }
    tickerQueue();
  };

  // ==========================================================
  // Règle de distance
  // ==========================================================
  const ruler = { on: false, pts: [] };
  const R_EARTH = 6371;
  function hav(a, b) {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  // Points intermédiaires d'un grand cercle (pour que la ligne suive la courbure de la Terre)
  function greatCircle(a, b) {
    const r = Math.PI / 180, d = hav(a, b) / R_EARTH;
    if (d < 0.02) return [a, b];
    const n = Math.min(120, Math.ceil(d / 0.03)), out = [];
    const p1 = [a[1] * r, a[0] * r], p2 = [b[1] * r, b[0] * r];
    for (let i = 0; i <= n; i++) {
      const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
      const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
      const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
      out.push([Math.atan2(y, x) / r, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]);
    }
    return out;
  }
  function setupRuler() {
    map.addSource('fx-ruler', { type: 'geojson', data: U.emptyFC() });
    map.addLayer({ id: 'fx-ruler-line', type: 'line', source: 'fx-ruler', filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#22d3ee', 'line-width': 2.2, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'fx-ruler-pt', type: 'circle', source: 'fx-ruler', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': '#f43f9d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    map.on('click', function (e) {
      if (!ruler.on) return;
      ruler.pts.push([e.lngLat.lng, e.lngLat.lat]);
      rulerDraw();
    });
  }
  function rulerDraw() {
    const feats = ruler.pts.map(function (p) { return U.point(p[0], p[1], {}); });
    let total = 0, coords = [];
    for (let i = 1; i < ruler.pts.length; i++) {
      total += hav(ruler.pts[i - 1], ruler.pts[i]);
      const seg = greatCircle(ruler.pts[i - 1], ruler.pts[i]);
      coords = coords.concat(i === 1 ? seg : seg.slice(1));
    }
    if (coords.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    map.getSource('fx-ruler').setData({ type: 'FeatureCollection', features: feats });
    const out = $('#ruler-out');
    if (out) {
      out.hidden = !ruler.on;
      out.textContent = ruler.pts.length < 2 ? 'RÈGLE : touche la carte pour poser des points' : 'RÈGLE : ' + (total >= 100 ? U.fmt(Math.round(total)) : total.toFixed(1)) + ' km  (' + (total / 1.852 >= 100 ? U.fmt(Math.round(total / 1.852)) : (total / 1.852).toFixed(1)) + ' nœuds-mer · ' + ruler.pts.length + ' points)';
    }
  }
  fx.ruler = function (on) {
    if (on === undefined) on = !ruler.on;
    ruler.on = !!on; setBtn('ruler', ruler.on);
    if (!ruler.on) ruler.pts = [];
    rulerDraw();
    map.getCanvas().style.cursor = ruler.on ? 'crosshair' : '';
    if (ruler.on) toast('Règle : touche la carte pour poser des points', '#22d3ee');
    return ruler.on;
  };
  fx.rulerInfo = function () {
    let total = 0; for (let i = 1; i < ruler.pts.length; i++) total += hav(ruler.pts[i - 1], ruler.pts[i]);
    return { on: ruler.on, points: ruler.pts.length, km: total };
  };

  // ==========================================================
  // Capture d'écran et lien partageable
  // ==========================================================
  fx.capture = async function () {
    try {
      const v = M.getView();
      const blob = await M.capture(dms(v.lat, 'N', 'S') + ' ' + dms(v.lng, 'E', 'W') + '  ·  ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC');
      const a = h('a', { href: URL.createObjectURL(blob), download: 'MNL-SENTINEL-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      const f = h('div', { id: 'flash' }); document.body.appendChild(f); setTimeout(function () { f.remove(); }, 500);
      fx.sound('shot'); toast('Capture enregistrée (PNG)', '#f43f9d');
      return blob;
    } catch (e) { toast('Capture impossible : ' + (e && e.message || e), '#f43f5e'); return null; }
  };
  fx.shareUrl = function () {
    const v = M.getView();
    const on = CFG.layers.filter(function (l) { return l.isOption ? L.getOption(l.id) : L.isOn(l.id); }).map(function (l) { return l.id; });
    return root.location.origin + root.location.pathname + '?layers=' + on.join(',') + '&base=' + M.getBase() +
      '&v=' + [v.lng.toFixed(3), v.lat.toFixed(3), v.zoom.toFixed(2), v.bearing.toFixed(0), v.pitch.toFixed(0)].join(',');
  };
  fx.share = async function () {
    const url = fx.shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Lien copié : même vue, mêmes couches', '#22d3ee'); }
    catch (e) { root.prompt('Copie ce lien :', url); }
    return url;
  };

  // ==========================================================
  // Barre de commandes ( / )
  // ==========================================================
  let cmd = null, cmdIn = null, cmdOut = null;
  function buildCmd() {
    cmdIn = h('input', { type: 'text', id: 'cmd-in', placeholder: 'tour · spin · go Goma · base hybride · on relief · wall · help', autocomplete: 'off', spellcheck: 'false' });
    cmdOut = h('div', { id: 'cmd-out' });
    cmd = h('div', { id: 'cmd', hidden: '' }, [h('div', { class: 'cmd-card' }, [h('span', { class: 'cmd-p', text: '›' }), cmdIn, cmdOut])]);
    document.body.appendChild(cmd);
    cmd.addEventListener('click', function (e) { if (e.target === cmd) fx.cmdClose(); });
    cmdIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); const t = cmdIn.value; cmdIn.value = ''; runCmd(t); }
      else if (e.key === 'Escape') fx.cmdClose();
      e.stopPropagation();
    });
  }
  fx.cmdOpen = function () { cmd.hidden = false; cmdOut.textContent = ''; cmdIn.value = ''; setTimeout(function () { cmdIn.focus(); }, 30); setBtn('cmd', true); };
  fx.cmdClose = function () { if (cmd) cmd.hidden = true; setBtn('cmd', false); };
  const say = function (t, err) { cmdOut.textContent = t; cmdOut.className = err ? 'err' : ''; };
  function findLayer(q) {
    q = norm(q); if (!q) return null;
    return CFG.layers.filter(function (l) { return !l.isOption; }).filter(function (l) { return norm(l.id) === q || norm(l.label).indexOf(q) >= 0; })[0] || null;
  }
  fx.runCmd = function (t) { return runCmd(t); };
  async function runCmd(text) {
    const t = norm(text).trim(); if (!t) return;
    const w = t.split(/\s+/), c = w[0], arg = t.slice(c.length).trim();
    if (c === 'help' || c === 'aide' || c === '?') {
      say('tour · spin · hud · photo · lien · mur · regle · son · reset · base <sombre|satellite|hybride|topo|nuit|terre> · on/off <couche> · go <lieu> · cam');
    } else if (c === 'tour' || c === 'visite') { fx.cmdClose(); fx.tour(); }
    else if (c === 'spin' || c === 'rotation') { fx.cmdClose(); fx.spin(); }
    else if (c === 'hud') { fx.setHud(!pref.hud); say('HUD ' + (pref.hud ? 'activé' : 'coupé')); }
    else if (c === 'photo' || c === 'capture') { fx.cmdClose(); fx.capture(); }
    else if (c === 'lien' || c === 'share' || c === 'partager') { fx.cmdClose(); fx.share(); }
    else if (c === 'mur' || c === 'wall') { fx.cmdClose(); fx.wallOpen(); }
    else if (c === 'regle' || c === 'ruler' || c === 'mesure') { fx.cmdClose(); fx.ruler(); }
    else if (c === 'son' || c === 'sound') { fx.setSound(!pref.sound); say('Sons ' + (pref.sound ? 'activés' : 'coupés')); }
    else if (c === 'reset' || c === 'recentrer') { M.reset(); say('Vue recentrée'); }
    else if (c === 'cam' || c === 'cams' || c === 'cameras') { fx.cmdClose(); if (MNL.ui) MNL.ui.openTab('cams'); fx.camsRefresh(); }
    else if (c === 'base' || c === 'fond') {
      const map2 = { sombre: 'dark', dark: 'dark', satellite: 'sat', sat: 'sat', hybride: 'hybrid', hybrid: 'hybrid', topo: 'topo', nuit: 'night', night: 'night', terre: 'live', live: 'live', jour: 'live' };
      const id = map2[arg.split(' ')[0]];
      if (id) { M.setBase(id); say('Fond : ' + id); } else say('Fonds : sombre, satellite, hybride, topo, nuit, terre', true);
    } else if (c === 'on' || c === 'off') {
      const l = findLayer(arg);
      if (l) { L.set(l.id, c === 'on'); say(l.label + ' : ' + c.toUpperCase()); } else say('Couche inconnue : ' + arg, true);
    } else {
      const q = c === 'go' || c === 'aller' ? arg : t;
      await goPlace(q);
    }
  }
  async function goPlace(q) {
    if (!q) { say('Dis où aller : go Goma', true); return; }
    const hs = (CFG.hotspots || []).filter(function (s) { return norm(s.name).indexOf(q) >= 0; })[0];
    if (hs) { fx.cmdClose(); fx.goSite(hs); return; }
    say('Recherche…');
    try {
      const res = await U.fetchJSON(CFG.sources.nominatim + '?format=jsonv2&limit=1&accept-language=fr&q=' + encodeURIComponent(q));
      if (!res.length) { say('Aucun résultat pour « ' + q + ' »', true); return; }
      const r = res[0], bb = r.boundingbox;
      fx.cmdClose();
      if (bb && bb.length === 4) M.fitBounds(+bb[2], +bb[0], +bb[3], +bb[1]); else M.flyTo(+r.lon, +r.lat, 9);
      showL3(String(r.display_name).split(',')[0].toUpperCase(), String(r.display_name).split(',').slice(1, 3).join(','), '#22d3ee', 5000);
    } catch (e) { say('Erreur : ' + e.message, true); }
  }

  // ==========================================================
  // Barre flottante
  // ==========================================================
  function buildFxbar() {
    const defs = [
      ['hud', 'HUD', 'HUD (H)', function () { fx.setHud(!pref.hud); }],
      ['tour', 'TOUR', 'Visite cinématique (T)', function () { fx.tour(); }],
      ['spin', 'SPIN', 'Rotation du globe (S)', function () { fx.spin(); }],
      ['ruler', 'RÈGLE', 'Mesurer une distance (M)', function () { fx.ruler(); }],
      ['sound', 'SON', 'Sons (X)', function () { fx.setSound(!pref.sound); }],
      ['photo', 'PHOTO', 'Capture d\'écran (C)', function () { fx.capture(); }],
      ['link', 'LIEN', 'Copier le lien de cette vue (L)', function () { fx.share(); }],
      ['wall', 'MUR', 'Mur de caméras (W)', function () { fx.wallOpen(); }],
      ['cmd', 'CMD', 'Commandes ( / )', function () { if (cmd.hidden) fx.cmdOpen(); else fx.cmdClose(); }]
    ];
    const bar = h('div', { id: 'fxbar' });
    defs.forEach(function (d) {
      const b = h('button', { type: 'button', title: d[2], 'aria-label': d[2], text: d[1], onclick: d[3] });
      btns[d[0]] = b; bar.appendChild(b);
    });
    document.body.appendChild(bar);
    document.body.appendChild(h('div', { id: 'ruler-out', hidden: '' }));
    setBtn('hud', pref.hud);
  }

  fx.spin = function (on) {
    return M.spin(on === undefined ? !M.isSpinning() : on);
  };

  // ==========================================================
  // SITES (onglet du dock)
  // ==========================================================
  function buildSites() {
    const host = $('#sites-out'); if (!host) return;
    host.textContent = '';
    const groups = [['RDC', function (s) { return /^RDC/.test(s.sub); }], ['VILLES DU MONDE', function (s) { return s.type === 'city' && !/^RDC/.test(s.sub); }], ['RELIEF', function (s) { return s.type === 'relief'; }]];
    groups.forEach(function (g) {
      const list = (CFG.hotspots || []).filter(g[1]);
      if (!list.length) return;
      host.appendChild(h('div', { class: 'sec-t', text: g[0] }));
      list.forEach(function (s) {
        const d = h('div', { class: 'res', style: '--c:' + (s.type === 'relief' ? '#c4b5fd' : '#fbbf24'), role: 'button', tabindex: '0' }, [h('b', { text: s.name }), h('small', { text: s.sub + (s.type === 'relief' ? ' · vue 3D relief' : ' · vue 3D ville') })]);
        const go = function () { fx.goSite(s); };
        d.addEventListener('click', go);
        d.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        host.appendChild(d);
      });
    });
  }

  // ==========================================================
  // CAMÉRAS : normalisation, visionneuse, mur, onglet CAMS
  // ==========================================================
  const YT_VID = /^[A-Za-z0-9_-]{11}$/, YT_CH = /^UC[A-Za-z0-9_-]{22}$/;
  function camNorm(c) {
    return {
      id: c.id, name: c.name || 'CAMÉRA', src: c.src || '', lng: c.lng, lat: c.lat, kind: c.kind || 'image', ref: c.ref || '',
      img: c.img || (c.kind === 'image' ? c.ref : '') || '', vid: c.vid || (c.kind === 'video' ? c.ref : '') || '',
      refresh: c.refresh || 20, note: c.note || '', approx: !!c.approx, mine: !!c.mine
    };
  }
  function ytUrl(ref) {
    if (YT_VID.test(ref)) return { embed: 'https://www.youtube-nocookie.com/embed/' + ref + '?autoplay=1&mute=1', open: 'https://www.youtube.com/watch?v=' + ref };
    if (YT_CH.test(ref)) return { embed: 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + ref + '&autoplay=1&mute=1', open: 'https://www.youtube.com/channel/' + ref + '/live' };
    return null;
  }
  const bust = function (u) { return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(); };

  // ---------- Visionneuse ----------
  const V = { el: null, media: null, cam: null, list: [], idx: 0, timer: 0, auto: true, mode: 'video', stamp: null, badge: null };
  function buildViewer() {
    V.badge = h('span', { class: 'vw-live', text: '● IMAGE' });
    V.stamp = h('span', { class: 'vw-time' });
    V.media = h('div', { class: 'vw-media' });
    const hud = h('div', { class: 'vw-hud' }, [V.badge, V.stamp, h('span', { class: 'vw-co', id: 'vw-co' })]);
    const mk = function (id, label, title, fn) { return h('button', { type: 'button', 'data-v': id, title: title, text: label, onclick: fn }); };
    V.el = h('div', { id: 'viewer', hidden: '' }, [h('div', { class: 'vw-card' }, [
      h('div', { class: 'vw-h' }, [h('b', { id: 'vw-t' }), h('small', { id: 'vw-s' }), mk('x', '✕', 'Fermer (Échap)', function () { fx.viewerClose(); })]),
      h('div', { class: 'vw-stage' }, [V.media, h('i', { class: 'vw-scan' }), h('i', { class: 'hud-c tl' }), h('i', { class: 'hud-c tr' }), h('i', { class: 'hud-c bl' }), h('i', { class: 'hud-c br' }), hud]),
      h('div', { class: 'vw-bar' }, [
        mk('prev', '◀', 'Caméra précédente (proche)', function () { vwStep(-1); }),
        mk('mode', 'VIDÉO', 'Basculer vidéo / image', function () { V.mode = V.mode === 'video' ? 'image' : 'video'; vwRender(); }),
        mk('refresh', '⟳', 'Rafraîchir maintenant', function () { vwRefresh(true); }),
        mk('auto', 'AUTO', 'Rafraîchissement automatique', function () { V.auto = !V.auto; vwTimer(); vwButtons(); }),
        mk('pin', '+ MUR', 'Ajouter au mur de caméras', function () { if (V.cam) { wallAdd(V.cam); toast('Ajoutée au mur', '#34d399'); } }),
        mk('full', '⛶', 'Plein écran', function () { const st = $('.vw-stage', V.el); if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen(); }),
        h('a', { id: 'vw-src', class: 'btn-a', target: '_blank', rel: 'noopener noreferrer', text: 'SOURCE ↗' }),
        mk('next', '▶', 'Caméra suivante (proche)', function () { vwStep(1); })
      ]),
      h('div', { class: 'vw-note', id: 'vw-note' })
    ])]);
    V.el.addEventListener('click', function (e) { if (e.target === V.el) fx.viewerClose(); });
    document.body.appendChild(V.el);
  }
  fx.viewerOpen = function (cam, list) {
    cam = camNorm(cam);
    V.cam = cam;
    V.list = list && list.length ? list : L.camsNear(cam.lng, cam.lat, 14).map(function (x) { return camNorm(x.cam); });
    V.idx = Math.max(0, V.list.findIndex(function (c) { return c.id === cam.id; }));
    V.mode = cam.vid ? 'video' : 'image';
    V.el.hidden = false;
    vwRender();
  };
  fx.viewerClose = function () {
    if (!V.el || V.el.hidden) return;
    V.el.hidden = true; clearInterval(V.timer); V.timer = 0;
    V.media.textContent = '';
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* rien */ } }
  };
  function vwStep(d) {
    if (V.list.length < 2) return;
    V.idx = (V.idx + d + V.list.length) % V.list.length;
    V.cam = V.list[V.idx]; V.mode = V.cam.vid ? 'video' : 'image';
    vwRender();
  }
  function vwButtons() {
    const c = V.cam; if (!c) return;
    const set = function (id, on, show) { const b = $('[data-v="' + id + '"]', V.el); if (b) { b.classList.toggle('on', !!on); if (show !== undefined) b.hidden = !show; } };
    set('auto', V.auto, c.kind === 'image' || (c.kind === 'video' ? false : !!c.img));
    set('mode', V.mode === 'video', !!(c.vid && c.img));
    $('[data-v="mode"]', V.el).textContent = V.mode === 'video' ? 'VIDÉO' : 'IMAGE';
    set('refresh', false, !!c.img && V.mode === 'image');
    set('prev', false, V.list.length > 1); set('next', false, V.list.length > 1);
  }
  function vwRender() {
    const c = V.cam; if (!c) return;
    clearInterval(V.timer); V.timer = 0;
    V.media.textContent = '';
    $('#vw-t').textContent = c.name;
    $('#vw-s').textContent = c.src + (V.list.length > 1 ? '  ·  ' + (V.idx + 1) + '/' + V.list.length : '');
    $('#vw-co').textContent = dms(c.lat, 'N', 'S') + ' ' + dms(c.lng, 'E', 'W') + (c.approx ? ' (approx.)' : '');
    const note = $('#vw-note'); note.textContent = c.note || '';
    const src = $('#vw-src');
    let open = U.safeUrl(c.kind === 'link' ? c.ref : c.img);
    const yt = c.kind === 'youtube' ? ytUrl(c.ref) : null;
    if (yt) open = yt.open;
    if (open) { src.href = open; src.hidden = false; } else src.hidden = true;
    V.badge.textContent = '● IMAGE'; V.badge.className = 'vw-live';

    if (c.kind === 'youtube') {
      if (yt) {
        V.media.appendChild(h('iframe', { src: yt.embed, title: c.name, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin' }));
        V.badge.textContent = '● DIRECT'; V.badge.className = 'vw-live on';
        note.textContent = (c.note ? c.note + ' · ' : '') + 'Si rien ne s\'affiche, l\'intégration est désactivée par son auteur : utilise « SOURCE ».';
      } else vwMsg('Identifiant YouTube invalide.');
    } else if (c.kind === 'link') {
      vwMsg('Cette caméra ne peut pas être intégrée : elle s\'ouvre sur son site.');
    } else if (V.mode === 'video' && c.vid && U.safeUrl(c.vid)) {
      const v = h('video', { src: U.safeUrl(c.vid), muted: '', autoplay: '', loop: '', playsinline: '', controls: '', preload: 'auto' });
      v.muted = true;
      v.addEventListener('error', function () {
        if (c.img) { V.mode = 'image'; vwRender(); note.textContent = 'Vidéo indisponible pour cette caméra : image affichée.'; }
        else vwMsg('Vidéo indisponible.');
      });
      v.addEventListener('playing', function () { V.badge.textContent = '● VIDÉO'; V.badge.className = 'vw-live on'; });
      V.media.appendChild(v);
      const p = v.play && v.play(); if (p && p.catch) p.catch(function () { /* lecture automatique refusée : le bouton de lecture reste */ });
    } else if (c.img) {
      const im = h('img', { alt: c.name, referrerpolicy: 'no-referrer', decoding: 'async' });
      V.media.appendChild(im);
      vwRefresh(true);
      vwTimer();
    } else vwMsg('Aucune image disponible.');
    vwButtons();
  }
  function vwMsg(t) { V.media.appendChild(h('div', { class: 'vw-msg', text: t })); }
  function vwTimer() {
    clearInterval(V.timer); V.timer = 0;
    const c = V.cam;
    if (!c || !V.auto || V.mode !== 'image' || !c.img) return;
    V.timer = setInterval(function () { if (!document.hidden) vwRefresh(false); }, Math.max(5, c.refresh) * 1000);
  }
  function vwRefresh() {
    const c = V.cam, im = $('img', V.media); if (!c || !im) return;
    const u = U.safeUrl(c.img); if (!u) return;
    const pre = new Image(); pre.referrerPolicy = 'no-referrer';
    const b = bust(u);
    pre.onload = function () { im.src = b; V.media.classList.remove('off'); V.stamp.textContent = U.utc(); V.badge.textContent = '● IMAGE ' + U.utc(); V.badge.className = 'vw-live on'; };
    pre.onerror = function () { V.media.classList.add('off'); V.badge.textContent = '● HORS LIGNE'; V.badge.className = 'vw-live err'; };
    pre.src = b;
  }

  // ---------- Mur de caméras ----------
  const W = { el: null, grid: null, n: 4, tiles: [], timer: 0, cams: [] };
  function wallLoad() { const v = U.store.get('wall', []); W.cams = Array.isArray(v) ? v.slice(0, 9) : []; W.n = U.store.get('wall.n', 4); }
  function wallSave() { U.store.set('wall', W.cams); U.store.set('wall.n', W.n); }
  function wallAdd(c) {
    c = camNorm(c);
    if (W.cams.some(function (x) { return x.id === c.id; })) return;
    W.cams.push(c); if (W.cams.length > 9) W.cams.shift();
    wallSave(); if (W.el && !W.el.hidden) wallRender(); camsMurRefresh();
  }
  function buildWall() {
    W.grid = h('div', { class: 'wl-grid' });
    const mk = function (label, fn, title) { return h('button', { type: 'button', text: label, title: title || '', onclick: fn }); };
    W.el = h('div', { id: 'wall', hidden: '' }, [
      h('div', { class: 'wl-h' }, [
        h('b', { text: 'MUR DE CAMÉRAS' }), h('small', { id: 'wl-n' }),
        h('span', { class: 'wl-sp' }),
        mk('AUTO', function () { wallAuto(); }, 'Remplir avec les caméras les plus proches du centre de la carte'),
        mk('1', function () { W.n = 1; wallRender(); }), mk('2×2', function () { W.n = 4; wallRender(); }), mk('3×3', function () { W.n = 9; wallRender(); }),
        mk('VIDER', function () { W.cams = []; wallSave(); wallRender(); camsMurRefresh(); }),
        mk('✕', function () { fx.wallClose(); }, 'Fermer (Échap)')
      ]),
      W.grid
    ]);
    document.body.appendChild(W.el);
  }
  function wallAuto() {
    const v = M.getView();
    const near = L.camsNear(v.lng, v.lat, 60).map(function (x) { return camNorm(x.cam); }).filter(function (c) { return c.img || c.kind === 'image'; });
    if (!near.length) { toast('Active « Caméras publiques » puis zoome sur une ville (Londres, New York, Helsinki).', '#fbbf24'); return; }
    W.cams = near.slice(0, W.n); wallSave(); wallRender(); camsMurRefresh();
  }
  fx.wallOpen = function () {
    if (!W.el) return;
    if (!L.isOn('cctv') && !W.cams.length) { L.set('cctv', true); toast('Caméras publiques activées', '#f43f9d'); }
    W.el.hidden = false; setBtn('wall', true);
    wallRender();
    if (!W.cams.length) setTimeout(function () { if (!W.el.hidden && !W.cams.length) wallAuto(); }, 1200);
  };
  fx.wallClose = function () { if (!W.el) return; W.el.hidden = true; clearInterval(W.timer); W.timer = 0; setBtn('wall', false); };
  function wallRender() {
    W.grid.textContent = ''; W.tiles = [];
    const cols = W.n === 1 ? 1 : W.n <= 4 ? 2 : 3;
    W.grid.style.setProperty('--cols', cols);
    const show = W.cams.slice(0, W.n);
    $('#wl-n').textContent = show.length + ' / ' + W.n + ' caméras';
    if (!show.length) W.grid.appendChild(h('p', { class: 'hint wl-empty', text: 'Aucune caméra épinglée. Touche AUTO, ou ouvre une caméra sur la carte puis « + MUR ».' }));
    show.forEach(function (c) {
      const im = h('img', { alt: c.name, referrerpolicy: 'no-referrer', loading: 'lazy' });
      const st = h('span', { class: 'wl-st', text: c.img ? '…' : (c.kind === 'youtube' ? '▶ DIRECT' : c.kind === 'video' ? '▶ VIDÉO' : '↗') });
      const rm = h('button', { type: 'button', class: 'wl-x', title: 'Retirer du mur', text: '✕', onclick: function (e) { e.stopPropagation(); W.cams = W.cams.filter(function (x) { return x.id !== c.id; }); wallSave(); wallRender(); camsMurRefresh(); } });
      const el = h('div', { class: 'wl-t', role: 'button', tabindex: '0' }, [im, h('i', { class: 'vw-scan' }), h('div', { class: 'wl-l' }, [h('b', { text: c.name }), h('small', { text: c.src })]), st, rm]);
      const open = function () { fx.viewerOpen(c, show); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
      W.grid.appendChild(el);
      W.tiles.push({ cam: c, el: el, img: im, st: st, last: 0 });
    });
    wallTick(true);
    clearInterval(W.timer);
    W.timer = setInterval(function () { wallTick(false); }, 4000);
  }
  function wallTick(force) {
    if (!W.el || W.el.hidden || document.hidden) return;
    const now = Date.now();
    W.tiles.forEach(function (t) {
      const u = U.safeUrl(t.cam.img); if (!u) return;
      if (!force && now - t.last < Math.max(10, t.cam.refresh) * 1000) return;
      t.last = now;
      const b = bust(u), pre = new Image(); pre.referrerPolicy = 'no-referrer';
      pre.onload = function () { t.img.src = b; t.el.classList.remove('off'); t.st.textContent = U.utc(); };
      pre.onerror = function () { t.el.classList.add('off'); t.st.textContent = 'HORS LIGNE'; };
      pre.src = b;
    });
  }

  // ---------- Onglet CAMS ----------
  let camsSub = 'near';
  function buildCams() {
    const near = $('#cams-near'), mur = $('#cams-wall'), add = $('#cams-add');
    if (!near || !mur || !add) return;
    $('#tab-cams .subtabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      camsSub = b.dataset.sub;
      $$('#tab-cams .subtabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      near.hidden = camsSub !== 'near'; mur.hidden = camsSub !== 'wall'; add.hidden = camsSub !== 'add';
      fx.camsRefresh();
    });
    $('#cams-enable').addEventListener('click', function () { L.set('cctv', true); L.set('cctv_drc', true); fx.camsRefresh(); });
    $('#cams-open-wall').addEventListener('click', function () { fx.wallOpen(); });
    $('#cam-here').addEventListener('click', function () { const v = M.getView(); $('#cam-lat').value = v.lat.toFixed(5); $('#cam-lng').value = v.lng.toFixed(5); });
    $('#cam-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const r = L.addMyCam({ name: $('#cam-name').value, kind: $('#cam-kind').value, ref: $('#cam-ref').value, lat: $('#cam-lat').value, lng: $('#cam-lng').value });
      const out = $('#cam-msg');
      if (!r.ok) { out.textContent = r.error; out.className = 'err-t'; return; }
      out.textContent = 'Caméra ajoutée (visible avec la couche « Caméras RDC / mes caméras »).'; out.className = 'hint';
      L.set('cctv_drc', true);
      $('#cam-name').value = ''; $('#cam-ref').value = '';
      camsMineRender();
    });
    L.onUpdate(function (id) { if (id === 'cctv' || id === 'cctv_drc') fx.camsRefresh(); });
    map.on('moveend', U.debounce(function () { if (!$('#tab-cams').hidden && camsSub === 'near') camsNearRender(); }, 900));
    camsMineRender(); camsMurRefresh();
  }
  fx.camsRefresh = function () {
    if (!$('#tab-cams') || $('#tab-cams').hidden) return;
    if (camsSub === 'near') camsNearRender(); else if (camsSub === 'wall') camsMurRefresh(); else camsMineRender();
  };
  function camsNearRender() {
    const out = $('#cams-list'), hint = $('#cams-hint');
    const on = L.isOn('cctv') || L.isOn('cctv_drc');
    $('#cams-enable').hidden = on;
    if (!on) { hint.textContent = 'Les couches de caméras sont éteintes.'; out.textContent = ''; return; }
    const v = M.getView();
    const list = L.camsNear(v.lng, v.lat, 12);
    out.textContent = '';
    if (!list.length) {
      const st = L.state('cctv');
      hint.textContent = st && st.status === 'loading' ? 'Chargement des caméras…' : 'Aucune caméra chargée pour l\'instant. Zoome sur une ville couverte (Londres, New York, Helsinki) ou attends un instant.';
      return;
    }
    const fails = (L.camInfo().failed || []);
    hint.textContent = 'Les 12 caméras les plus proches du centre de la carte.' + (fails.length && L.isOn('cctv') ? ' Indisponibles pour l\'instant : ' + fails.join(', ') + '.' : '');
    const cams = list.map(function (x) { return camNorm(x.cam); });
    list.forEach(function (x, i) {
      const c = cams[i];
      const th = c.img ? h('img', { src: c.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cam-ph', text: c.kind === 'youtube' ? '▶' : '↗' });
      const d = h('div', { class: 'cam-i', role: 'button', tabindex: '0' }, [
        h('div', { class: 'cam-th' }, [th]),
        h('div', { class: 'cam-tx' }, [h('b', { text: c.name }), h('small', { text: c.src + ' · ' + (x.km < 10 ? x.km.toFixed(1) : Math.round(x.km)) + ' km' + (c.vid ? ' · vidéo' : '') })]),
        h('button', { type: 'button', class: 'cam-pin', title: 'Ajouter au mur', text: '+', onclick: function (e) { e.stopPropagation(); wallAdd(c); toast('Ajoutée au mur', '#34d399'); } })
      ]);
      const open = function () { fx.viewerOpen(c, cams); };
      d.addEventListener('click', open);
      d.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
      out.appendChild(d);
    });
  }
  function camsMurRefresh() {
    const out = $('#cams-wall-list'); if (!out) return;
    out.textContent = '';
    if (!W.cams.length) { out.appendChild(h('p', { class: 'hint', text: 'Le mur est vide. Ajoute des caméras avec « + », ou ouvre le mur et touche AUTO.' })); return; }
    W.cams.forEach(function (c) { out.appendChild(h('div', { class: 'kv' }, [h('span', { text: c.src }), h('b', { text: c.name })])); });
  }
  function camsMineRender() {
    const out = $('#cams-mine'); if (!out) return;
    out.textContent = '';
    const mine = L.getMyCams();
    if (!mine.length) { out.appendChild(h('p', { class: 'hint', text: 'Tu n\'as ajouté aucune caméra.' })); return; }
    mine.forEach(function (c) {
      out.appendChild(h('div', { class: 'cam-i' }, [
        h('div', { class: 'cam-tx' }, [h('b', { text: c.name }), h('small', { text: c.kind + ' · ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3) })]),
        h('button', { type: 'button', class: 'cam-pin', title: 'Supprimer', text: '✕', onclick: function () { L.removeMyCam(c.id); camsMineRender(); } })
      ]));
    });
  }

  // ==========================================================
  // Clavier et clics « AGRANDIR » dans les popups
  // ==========================================================
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input, select, textarea')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (V.el && !V.el.hidden) fx.viewerClose();
        else if (W.el && !W.el.hidden) fx.wallClose();
        else if (cmd && !cmd.hidden) fx.cmdClose();
        else if (tour.on) fx.tour(false);
        else if (ruler.on) fx.ruler(false);
        return;
      }
      if ((V.el && !V.el.hidden) || (W.el && !W.el.hidden)) {
        if (V.el && !V.el.hidden) { if (e.key === 'ArrowRight') vwStep(1); else if (e.key === 'ArrowLeft') vwStep(-1); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); fx.cmdOpen(); }
      else if (k === 't') fx.tour();
      else if (k === 's') fx.spin();
      else if (k === 'h') fx.setHud(!pref.hud);
      else if (k === 'm') fx.ruler();
      else if (k === 'x') fx.setSound(!pref.sound);
      else if (k === 'b') { M.nextBase(); }
      else if (k === 'c') fx.capture();
      else if (k === 'l') fx.share();
      else if (k === 'w') fx.wallOpen();
    });
    // Bouton « AGRANDIR » des popups de caméras
    document.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('[data-open-cam]'); if (!b) return;
      const cam = L.getCam(b.getAttribute('data-open-cam'));
      if (cam) fx.viewerOpen(cam);
    });
    // Toucher la carte arrête la visite
    const stop = function () { if (tour.on) fx.tour(false); };
    const cont = map.getCanvasContainer ? map.getCanvasContainer() : map.getCanvas();
    ['mousedown', 'touchstart', 'wheel'].forEach(function (ev) { cont.addEventListener(ev, stop, { passive: true }); });
  }

  // Curseur d'inclinaison du panneau des couches
  function bindPitch() {
    const p = $('#pitch'); if (!p) return;
    p.addEventListener('input', function () { map.setPitch(Number(p.value)); });
    map.on('pitchend', function () { p.value = String(Math.round(map.getPitch())); });
    const n = $('#north');
    if (n) n.addEventListener('click', function () { map.easeTo({ bearing: 0, pitch: 0, duration: 800 }); p.value = '0'; });
  }

  // ==========================================================
  // Démarrage
  // ==========================================================
  fx.init = function () {
    if (inited) return;
    inited = true;
    map = M.getMap();
    wallLoad();
    safe('stars', buildStars);
    safe('pulses', setupPulses);
    safe('ruler', setupRuler);
    safe('hud', buildHud);
    safe('l3', buildL3);
    safe('ticker', buildTicker);
    safe('fxbar', buildFxbar);
    safe('threat', buildThreat);
    safe('cmd', buildCmd);
    safe('sites', buildSites);
    safe('viewer', buildViewer);
    safe('wall', buildWall);
    safe('cams', buildCams);
    safe('pitch', bindPitch);
    safe('keys', bindKeys);
    M.onSpin(function (on) { setBtn('spin', on); });
    // Un lien partagé (?v=…) : on annonce où l'on est
    if (/[?&]v=/.test(root.location.search)) safe('l3-link', function () { const v = M.getView(); showL3('VUE PARTAGÉE', dms(v.lat, 'N', 'S') + '  ' + dms(v.lng, 'E', 'W'), '#a78bfa', 4500); });
    // Les titres d'actualité alimentent le bandeau (une seule requête, la même que l'onglet NEWS)
    if (MNL.ui && MNL.ui.preloadNews) setTimeout(function () { MNL.ui.preloadNews(); }, 4000);
    MNL.fxReady = true;
  };

  MNL.fx = fx;
})(typeof window !== 'undefined' ? window : globalThis);
