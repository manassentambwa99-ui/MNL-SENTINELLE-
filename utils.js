/* ==========================================================
   MNL SENTINEL — utilitaires
   - fabrique de GeoJSON, échappement HTML, fetch avec délai
   - stockage local, calcul de la position du Soleil
   - tracé de la nuit (terminateur) et icônes dessinées en code
   ========================================================== */
(function (root) {
  'use strict';
  root.MNL = root.MNL || {};
  const U = {};

  // ---------- GeoJSON ----------
  U.emptyFC = function () { return { type: 'FeatureCollection', features: [] }; };
  U.point = function (lng, lat, props) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props || {} };
  };

  // ---------- Sécurité : tout texte venant d'Internet passe par esc() ----------
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.safeUrl = function (u) {
    try {
      const x = new URL(u);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '';
    } catch (e) { return ''; }
  };

  // ---------- Réseau ----------
  U.fetchJSON = async function (url, opts) {
    opts = opts || {};
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, opts.timeout || 25000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: opts.headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      try { return JSON.parse(txt); }
      catch (e) { throw new Error('Réponse non JSON : ' + txt.slice(0, 80)); }
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Délai dépassé');
      throw e;
    } finally { clearTimeout(timer); }
  };

  // ---------- Divers ----------
  U.fmt = function (n) { return new Intl.NumberFormat('fr-FR').format(n); };
  U.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  U.debounce = function (fn, ms) {
    let t;
    return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  };
  U.utc = function (d) {
    d = d || new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + 'Z';
  };
  U.stamp = function (ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; };

  // ---------- Stockage local (préférences) ----------
  const ls = (function () { try { return root.localStorage || null; } catch (e) { return null; } })();
  U.store = {
    get: function (k, d) {
      try { const v = ls && ls.getItem('mnl.' + k); return (v === null || v === undefined) ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { if (ls) ls.setItem('mnl.' + k, JSON.stringify(v)); } catch (e) { /* quota */ } }
  };

  // ---------- Astronomie : position du Soleil ----------
  // Formules simplifiées (précision ~0,01°) : suffisantes pour une carte jour/nuit.
  U.sun = function (date) {
    const rad = Math.PI / 180;
    const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;        // jours depuis J2000
    const L = (280.460 + 0.9856474 * n) % 360;                            // longitude moyenne
    const g = ((357.528 + 0.9856003 * n) % 360) * rad;                    // anomalie moyenne
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad; // longitude écliptique
    const eps = (23.439 - 0.0000004 * n) * rad;                           // obliquité
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));                 // déclinaison
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));  // ascension droite
    const gmstH = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24; // temps sidéral (heures)
    let lng = ra / rad - gmstH * 15;                                      // point subsolaire
    lng = (((lng + 180) % 360) + 360) % 360 - 180;
    return { lat: dec / rad, lng: lng, dec: dec };
  };

  // Zone où le Soleil est sous l'altitude altDeg (0 = nuit ; -6 / -12 / -18 = crépuscules
  // civil / nautique / astronomique). Mathématiquement c'est une « calotte » sphérique
  // centrée sur le point opposé au Soleil, de rayon angulaire 90° + altDeg.
  // Renvoie une liste de contours (polygones) prêts pour GeoJSON.
  //  - si la calotte contient un pôle : on suit le terminateur méridien par méridien
  //    puis on referme par le pôle ;
  //  - sinon : simple cercle sur la sphère (copié de ±360° s'il traverse l'antiméridien).
  U.nightPolygons = function (date, altDeg) {
    const s = U.sun(date);
    const phi0 = -s.lat, lam0 = s.lng + 180, rho = 90 + altDeg;
    if (Math.abs(phi0) + rho >= 90 - 1e-6) return [poleRing(s, altDeg)];
    return capRings(phi0, lam0, rho);
  };

  function poleRing(s, altDeg) {
    const rad = Math.PI / 180;
    const dec = s.dec;
    const C = Math.sin(altDeg * rad);
    let A = Math.sin(dec); if (Math.abs(A) < 1e-9) A = 1e-9;
    const poleLat = A > 0 ? -89.99 : 89.99;                 // pôle plongé dans la nuit
    const norm = function (x) { return Math.atan2(Math.sin(x), Math.cos(x)); };
    const ring = [];
    for (let lng = -180; lng <= 180; lng += 2) {
      const H = (lng - s.lng) * rad;
      const B = Math.cos(dec) * Math.cos(H);
      const R = Math.hypot(A, B);
      let lat = null;
      if (Math.abs(C) <= R) {
        // sin(alt) = A·sin(lat) + B·cos(lat) = R·sin(lat + phi)  ->  deux solutions possibles
        const phi = Math.atan2(B, A), a = Math.asin(C / R);
        const ok = [norm(a - phi), norm(Math.PI - a - phi)].filter(function (x) { return Math.abs(x) <= Math.PI / 2 + 1e-9; });
        if (ok.length) {
          const target = poleLat * rad;                       // on garde la solution la plus proche du pôle nocturne
          lat = ok.reduce(function (best, x) { return Math.abs(x - target) < Math.abs(best - target) ? x : best; }, ok[0]) / rad;
        }
      }
      if (lat === null) {
        // pas de croisement sur ce méridien : tout est sous le seuil, ou tout est au-dessus
        const fPole = A * Math.sin(poleLat * rad) + B * Math.cos(poleLat * rad);
        lat = fPole < C ? -poleLat : poleLat;
      }
      ring.push([lng, U.clamp(lat, -89.99, 89.99)]);
    }
    ring.push([180, poleLat], [-180, poleLat], ring[0]);
    return ring;
  }

  // Découpe un contour fermé contre une droite (Sutherland–Hodgman).
  function clipRing(pts, keep, cut) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ka = keep(a), kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(cut(a, b));
    }
    if (out.length) out.push([out[0][0], out[0][1]]);
    return out;
  }
  // Garde seulement la partie du contour située entre les longitudes xmin et xmax.
  function clipLng(ring, xmin, xmax) {
    const cutAt = function (x) {
      return function (a, b) { const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + t * (b[1] - a[1])]; };
    };
    let r = clipRing(ring, function (p) { return p[0] >= xmin; }, cutAt(xmin));
    if (r.length < 4) return null;
    r = clipRing(r, function (p) { return p[0] <= xmax; }, cutAt(xmax));
    return r.length >= 4 ? r : null;
  }

  function capRings(phi0d, lam0d, rhoD) {
    const rad = Math.PI / 180, phi0 = phi0d * rad, lam0 = lam0d * rad, rho = rhoD * rad, N = 180;
    const pts = [];
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const th = 2 * Math.PI * i / N;
      const sinPhi = Math.sin(phi0) * Math.cos(rho) + Math.cos(phi0) * Math.sin(rho) * Math.cos(th);
      const phi = Math.asin(U.clamp(sinPhi, -1, 1));
      const lam = lam0 + Math.atan2(Math.sin(th) * Math.sin(rho) * Math.cos(phi0), Math.cos(rho) - Math.sin(phi0) * sinPhi);
      let lng = lam / rad;
      if (prev === null) lng = (((lng + 180) % 360) + 360) % 360 - 180;
      else { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
      pts.push([lng, phi / rad]);
      prev = lng;
    }
    pts[N] = [pts[0][0], pts[0][1]];                         // contour parfaitement fermé
    // Le contour peut sortir de [-180, 180] : on le copie à ±360° et on découpe chaque copie à l'antiméridien.
    const rings = [];
    [-360, 0, 360].forEach(function (off) {
      const r = clipLng(pts.map(function (p) { return [p[0] + off, p[1]]; }), -180, 180);
      if (r) rings.push(r);
    });
    return rings;
  }

  // ---------- Icônes dessinées en code (SDF : la couleur se règle dans la carte) ----------
  U.makeIcon = function (kind, size) {
    size = size || 48;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const s = size / 48;
    x.fillStyle = '#ffffff';
    x.beginPath();
    if (kind === 'plane') {
      const p = [[24,3],[28,16],[46,28],[46,33],[28,27],[26.5,40],[33,45],[33,47],[24,45],[15,47],[15,45],[21.5,40],[20,27],[2,33],[2,28],[20,16]];
      p.forEach(function (q, i) { x[i ? 'lineTo' : 'moveTo'](q[0] * s, q[1] * s); });
    } else if (kind === 'ship') {
      const p = [[24,3],[36,22],[34,45],[14,45],[12,22]];
      p.forEach(function (q, i) { x[i ? 'lineTo' : 'moveTo'](q[0] * s, q[1] * s); });
    } else {
      const p = [[24,2],[40,40],[24,31],[8,40]];
      p.forEach(function (q, i) { x[i ? 'lineTo' : 'moveTo'](q[0] * s, q[1] * s); });
    }
    x.closePath();
    x.fill();
    return x.getImageData(0, 0, size, size);
  };

  root.MNL.U = U;
})(typeof window !== 'undefined' ? window : globalThis);
