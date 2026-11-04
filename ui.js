/* ==========================================================
   MNL SENTINEL — interface
   panneau des couches, barre du haut, dock (SEARCH / RECON /
   SPACE / ALERTS / NEWS), raccourcis clavier, notifications
   ========================================================== */
(function (root) {
  'use strict';
  const MNL = root.MNL, U = MNL.U, CFG = MNL.CONFIG, SRC = CFG.sources, L = MNL.Layers, M = MNL.Map;
  const ui = {};
  const $ = function (s, el) { return (el || document).querySelector(s); };
  const $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  let issFollow = false, lastFollow = 0, reconPin = null, newsLoaded = false;

  // ---------- Notifications ----------
  ui.toast = function (msg, color) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--c', color || '#fbbf24');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  };
  ui.alert = function (msg, color, toast) {
    const box = $('#alerts-out');
    if (box.querySelector('.hint')) box.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'alert-item';
    el.style.setProperty('--c', color || '#fb923c');
    const time = document.createElement('time');
    time.textContent = U.utc();
    const txt = document.createElement('span');
    txt.textContent = msg;
    el.appendChild(time); el.appendChild(txt);
    box.insertBefore(el, box.firstChild);
    while (box.children.length > 50) box.removeChild(box.lastChild);
    $('[data-tab="alerts"]').textContent = 'ALERTS (' + box.children.length + ')';
    if (toast) ui.toast(msg, color);
  };

  // ---------- Panneau des couches ----------
  function buildLayers() {
    const host = $('#layer-list');
    CFG.groups.forEach(function (g) {
      const h = document.createElement('div');
      h.className = 'grp'; h.textContent = g.label;
      host.appendChild(h);
      CFG.layers.filter(function (l) { return l.group === g.id; }).forEach(function (l) {
        const row = document.createElement('label');
        row.className = 'row' + (l.isOption ? ' sub' : '');
        row.dataset.id = l.id;
        row.style.setProperty('--c', l.color);
        const checked = l.isOption ? L.getOption(l.id) : L.isOn(l.id);
        row.innerHTML =
          '<input type="checkbox"' + (checked ? ' checked' : '') + '>' +
          '<span class="sw"></span><span class="dot"></span>' +
          '<span class="name">' + U.esc(l.label) + '</span>' +
          (l.isOption ? '' : '<span class="cnt" id="cnt-' + l.id + '">—</span>');
        if (checked) row.classList.add('on');
        $('input', row).addEventListener('change', function (e) {
          const on = e.target.checked;
          row.classList.toggle('on', on);
          if (l.isOption) L.setOption(l.id, on); else L.set(l.id, on);
        });
        host.appendChild(row);
      });
    });
  }

  function onLayerUpdate(id) {
    const s = L.state(id);
    if (s) {
      const row = $('.row[data-id="' + id + '"]');
      if (row) {
        row.classList.toggle('on', s.on);
        const cb = $('input', row); if (cb) cb.checked = s.on;
      }
      const c = $('#cnt-' + id);
      if (c) {
        c.classList.remove('err', 'load');
        if (!s.on) c.textContent = '—';
        else if (s.status === 'error') { c.textContent = '⚠'; c.classList.add('err'); c.title = s.error; }
        else if (s.status === 'loading' && !s.count) { c.textContent = '…'; c.classList.add('load'); }
        else { c.textContent = id === 'day_night' || id === 'live_news' ? 'ON' : U.fmt(s.count); c.title = ''; }
      }
    }
    // Contrôles contextuels
    $('#ctl-ais').hidden = !(L.isOn('maritime') || L.isOn('naval'));
    $('#ctl-wind').hidden = !L.isOn('wind');
    $('#ctl-rain').hidden = !L.isOn('rain');
    if (id === 'maritime' || id === 'naval') {
      const msg = L.aisState();
      $('#ais-state').textContent = msg || (L.hasAisKey() ? 'Clé enregistrée.' : 'Inscris-toi sur aisstream.io pour obtenir une clé.');
    }
    if (id === 'rain') {
      const r = L.rainInfo();
      $('#rain-time').textContent = r.time ? (U.stamp(r.time) + ' · image ' + (r.idx + 1) + '/' + r.n) : '—';
      $('#rain-play').textContent = r.playing ? '⏸' : '▶';
    }
    if (id === 'iss' || id === 'satellites') renderIss();
    refreshStats();
  }

  function refreshStats() {
    let layers = 0, ents = 0, anyOk = false, anyErr = false;
    CFG.layers.forEach(function (l) {
      if (l.isOption) return;
      const s = L.state(l.id);
      if (!s || !s.on) return;
      layers++;
      if (l.entity) ents += s.count || 0;
      if (s.status === 'ok') anyOk = true;
      if (s.status === 'error') anyErr = true;
    });
    $('#n-layers').textContent = layers;
    $('#n-ents').textContent = U.fmt(ents);
    const el = $('#status');
    if (!navigator.onLine) { el.textContent = 'HORS LIGNE'; el.className = 'st-offline'; }
    else if (anyOk) { el.textContent = anyErr ? 'PARTIEL' : 'EN LIGNE'; el.className = 'st-online'; }
    else { el.textContent = 'CONNEXION'; el.className = 'st-connecting'; }
  }

  // ---------- Barre du haut ----------
  function bindTopbar() {
    $('#seg-proj').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      $$('#seg-proj button').forEach(function (x) { x.classList.toggle('on', x === b); });
      M.setProjection(b.dataset.v === '3d');
    });
    $('#seg-base').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      $$('#seg-base button').forEach(function (x) { x.classList.toggle('on', x === b); });
      M.setBase(b.dataset.v === 'sat');
    });
    $('#btn-menu').addEventListener('click', function () { document.body.classList.toggle('side-open'); });
    M.getMap().on('click', function () { document.body.classList.remove('side-open'); });
    setInterval(function () { $('#clock').textContent = U.utc(); }, 1000);
    $('#clock').textContent = U.utc();
    M.onCursor(function (lng, lat, zoom) {
      if (lng !== null) $('#sb-cursor').textContent = lat.toFixed(3) + '°, ' + lng.toFixed(3) + '°';
      $('#sb-zoom').textContent = zoom.toFixed(1);
    });
    window.addEventListener('online', refreshStats);
    window.addEventListener('offline', refreshStats);
  }

  // ---------- Contrôles contextuels ----------
  function bindControls() {
    $('#ais-key').value = '';
    $('#ais-save').addEventListener('click', function () {
      L.setAisKey($('#ais-key').value);
      $('#ais-key').value = '';
    });
    $('#wind-step').value = String(L.getWindStep());
    $('#wind-step').addEventListener('change', function (e) { L.setWindStep(e.target.value); });
    $('#rain-opacity').value = String(L.getRainOpacity());
    $('#rain-opacity').addEventListener('input', function (e) { L.setRainOpacity(e.target.value); });
    $('#rain-play').addEventListener('click', function () { L.toggleRain(); });
  }

  // ---------- Dock ----------
  ui.openTab = function (name) {
    $$('#dock-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $$('#dock .tab').forEach(function (t) { t.hidden = t.id !== 'tab-' + name; });
  };
  function closeDock() {
    $$('#dock-tabs button').forEach(function (b) { b.classList.remove('on'); });
    $$('#dock .tab').forEach(function (t) { t.hidden = true; });
  }
  function bindDock() {
    $('#dock-tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('on')) { closeDock(); return; }
      ui.openTab(b.dataset.tab);
      if (b.dataset.tab === 'news') loadNews();
    });
  }

  // ---------- SEARCH (Nominatim / OpenStreetMap) ----------
  function bindSearch() {
    $('#search-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const q = $('#search-q').value.trim(); if (!q) return;
      const out = $('#search-out');
      out.innerHTML = '<p class="hint">Recherche…</p>';
      try {
        const res = await U.fetchJSON(SRC.nominatim + '?format=jsonv2&limit=6&accept-language=fr&q=' + encodeURIComponent(q));
        if (!res.length) { out.innerHTML = '<p class="hint">Aucun résultat.</p>'; return; }
        out.innerHTML = '';
        res.forEach(function (r) {
          const d = document.createElement('div');
          d.className = 'res';
          d.style.setProperty('--c', '#22d3ee');
          const parts = String(r.display_name).split(',');
          d.innerHTML = '<b>' + U.esc(parts[0]) + '</b><small>' + U.esc(parts.slice(1, 4).join(',')) + '</small>';
          d.addEventListener('click', function () {
            const bb = r.boundingbox;           // [sud, nord, ouest, est]
            if (bb && bb.length === 4) M.fitBounds(+bb[2], +bb[0], +bb[3], +bb[1]);
            else M.flyTo(+r.lon, +r.lat, 9);
          });
          out.appendChild(d);
        });
      } catch (err) { out.innerHTML = '<p class="err-t">Erreur : ' + U.esc(err.message) + '</p>'; }
    });
  }

  // ---------- RECON passif : DNS public + géolocalisation IP ----------
  const kv = function (k, v) { return '<div class="kv"><span>' + U.esc(k) + '</span><b>' + U.esc(v) + '</b></div>'; };
  function isIP(s) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || (s.indexOf(':') >= 0 && /^[0-9a-f:]+$/i.test(s)); }
  function bindRecon() {
    $('#recon-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const q = $('#recon-q').value.trim().toLowerCase();
      const out = $('#recon-out');
      if (!q) return;
      if (!isIP(q) && !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(q)) { out.innerHTML = '<p class="err-t">Entrée invalide.</p>'; return; }
      out.innerHTML = '<p class="hint">Analyse…</p>';
      let html = '', ip = isIP(q) ? q : null;
      try {
        if (!ip) {
          const types = ['A', 'AAAA', 'MX', 'NS', 'TXT'];
          const res = await Promise.allSettled(types.map(function (t) { return U.fetchJSON(SRC.dns + '?name=' + encodeURIComponent(q) + '&type=' + t); }));
          html += '<div class="sec-t">DNS</div>';
          let any = false;
          res.forEach(function (r, i) {
            if (r.status !== 'fulfilled' || !r.value.Answer) return;
            r.value.Answer.filter(function (a) { return a.type === ({ A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16 })[types[i]]; })
              .slice(0, 6).forEach(function (a) { any = true; html += kv(types[i], String(a.data).slice(0, 120)); if (types[i] === 'A' && !ip) ip = a.data; });
          });
          if (!any) html += '<p class="hint">Aucun enregistrement trouvé.</p>';
        }
        if (ip) {
          const j = await U.fetchJSON(SRC.ipwho + encodeURIComponent(ip));
          html += '<div class="sec-t">IP ' + U.esc(ip) + '</div>';
          if (j && j.success !== false) {
            html += kv('Pays', (j.country || '—') + (j.city ? ' · ' + j.city : '')) +
              kv('Région', j.region || '—') +
              kv('ASN', j.connection && j.connection.asn ? 'AS' + j.connection.asn : '—') +
              kv('Organisation', (j.connection && (j.connection.org || j.connection.isp)) || '—') +
              kv('Fuseau', (j.timezone && j.timezone.id) || '—') +
              kv('Coordonnées', j.latitude + ', ' + j.longitude);
            if (j.latitude != null && j.longitude != null) {
              if (reconPin) reconPin.remove();
              const el = document.createElement('div');
              el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#a3e635;border:2px solid #fff;box-shadow:0 0 14px #a3e635';
              reconPin = new maplibregl.Marker({ element: el }).setLngLat([j.longitude, j.latitude]).addTo(M.getMap());
              M.flyTo(j.longitude, j.latitude, 6);
            }
          } else html += '<p class="hint">Géolocalisation indisponible.</p>';
        }
        out.innerHTML = html;
      } catch (err) { out.innerHTML = html + '<p class="err-t">Erreur : ' + U.esc(err.message) + '</p>'; }
    });
  }

  // ---------- SPACE : Station spatiale internationale ----------
  function renderIss() {
    const s = L.iss(), box = $('#space-out');
    if (!s) return;
    box.innerHTML = '<div class="sec-t">STATION SPATIALE (ISS)</div>' +
      kv('Latitude', s.lat.toFixed(3) + '°') + kv('Longitude', s.lng.toFixed(3) + '°') +
      kv('Altitude', Math.round(s.alt) + ' km') + kv('Vitesse', (s.vel * 3600).toFixed(0) + ' km/h');
    if (issFollow && Date.now() - lastFollow > 4000) { lastFollow = Date.now(); M.getMap().easeTo({ center: [s.lng, s.lat], duration: 2000 }); }
  }
  function bindSpace() {
    $('#iss-go').addEventListener('click', function () {
      const s = L.iss();
      if (s) M.flyTo(s.lng, s.lat, 3.5); else ui.toast('Active d\'abord la couche Satellites.', '#a78bfa');
    });
    $('#iss-follow').addEventListener('click', function (e) {
      if (!L.iss()) { ui.toast('Active d\'abord la couche Satellites.', '#a78bfa'); return; }
      issFollow = !issFollow;
      e.target.textContent = issFollow ? 'ARRÊTER' : 'SUIVRE';
    });
  }

  // ---------- NEWS : titres (GDELT) + chaînes en direct ----------
  ui.showNews = function (on) {
    if (on) { ui.openTab('news'); loadNews(); }
    else if (!$('#tab-news').hidden) closeDock();
  };
  async function loadNews(force) {
    if (newsLoaded && !force) return;
    const list = $('#news-list');
    const q = $('#news-q').value.trim() || CFG.newsQuery;
    list.innerHTML = '<p class="hint">Chargement des titres…</p>';
    try {
      const url = SRC.gdelt + '?query=' + encodeURIComponent(q) + '&mode=ArtList&maxrecords=40&format=json&sort=DateDesc&timespan=3h';
      const data = await U.fetchJSON(url, { timeout: 30000 });
      const arts = (data && data.articles) || [];
      if (!arts.length) { list.innerHTML = '<p class="hint">Aucun article.</p>'; return; }
      list.innerHTML = '';
      arts.forEach(function (a) {
        const href = U.safeUrl(a.url); if (!href) return;
        const el = document.createElement('a');
        el.className = 'news-item'; el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer';
        el.innerHTML = U.esc(a.title || href) + '<small>' + U.esc(a.domain || '') + ' · ' + U.esc(a.sourcecountry || '') + '</small>';
        list.appendChild(el);
      });
      newsLoaded = true;
    } catch (err) { list.innerHTML = '<p class="err-t">Titres indisponibles : ' + U.esc(err.message) + '</p>'; }
  }
  function bindNews() {
    $('#news-q').placeholder = 'mots-clés (anglais)';
    $('#news-form').addEventListener('submit', function (e) { e.preventDefault(); loadNews(true); });
    $('#tab-news .subtabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      $$('#tab-news .subtabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#news-headlines').hidden = b.dataset.sub !== 'headlines';
      $('#news-live').hidden = b.dataset.sub !== 'live';
    });
    const box = $('#news-streams');
    CFG.newsStreams.forEach(function (s) {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.addEventListener('click', function () {
        $$('#news-streams button').forEach(function (x) { x.classList.toggle('on', x === b); });
        const fr = document.createElement('iframe');
        fr.src = 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + encodeURIComponent(s.channel) + '&autoplay=1&mute=1';
        fr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        fr.title = s.name;
        const frame = $('#news-frame'); frame.innerHTML = ''; frame.appendChild(fr);
      });
      box.appendChild(b);
    });
  }

  // ---------- Aide + clavier ----------
  function bindKeys() {
    const help = $('#help');
    $('#help-close').addEventListener('click', function () { help.hidden = true; });
    help.addEventListener('click', function (e) { if (e.target === help) help.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === '?') help.hidden = !help.hidden;
      else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
      else if (k === 'r') M.reset();
      else if (e.key === 'Escape') { help.hidden = true; document.body.classList.remove('side-open'); }
    });
  }

  // ---------- Démarrage ----------
  ui.init = function () {
    buildLayers();
    bindTopbar();
    bindControls();
    bindDock();
    bindSearch();
    bindRecon();
    bindSpace();
    bindNews();
    bindKeys();
    L.onUpdate(onLayerUpdate);
    L.onAlert(function (m, c, t) { ui.alert(m, c, t); });
    CFG.layers.forEach(function (l) { if (!l.isOption) onLayerUpdate(l.id); });
    refreshStats();
  };

  MNL.ui = ui;
})(typeof window !== 'undefined' ? window : globalThis);
