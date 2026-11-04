/* ==========================================================
   MNL SENTINEL — configuration centrale
   Tout ce que tu peux vouloir changer est ici : nom, couleurs,
   liste des couches, adresses des sources de données, chaînes TV.
   ========================================================== */
(function (root) {
  'use strict';
  root.MNL = root.MNL || {};

  root.MNL.CONFIG = {
    brand: { name: 'MNL SENTINEL', short: 'MNL', tagline: 'GLOBAL INTELLIGENCE PLATFORM', version: 'V1.0' },

    // Vue de départ de la carte
    view: { center: [12, 18], zoom: 2.1 },

    // Groupes affichés dans le panneau des couches
    groups: [
      { id: 'tracking', label: 'SUIVI TEMPS RÉEL' },
      { id: 'infra',    label: 'INFRASTRUCTURE' },
      { id: 'earth',    label: 'TERRE & CLIMAT' },
      { id: 'media',    label: 'MÉDIAS' }
    ],

    // Couches. "entity: true" = compte dans le total « ENTITÉS » de la barre du haut.
    layers: [
      { id: 'aircraft',      label: 'Aviation (ADS-B)',         group: 'tracking', color: '#fbbf24', defaultOn: true, entity: true },
      { id: 'maritime',      label: 'Maritime (AIS)',           group: 'tracking', color: '#22d3ee', entity: true },
      { id: 'naval',         label: 'Naval (militaire)',        group: 'tracking', color: '#f43f5e' },
      { id: 'satellites',    label: 'Satellites',               group: 'tracking', color: '#a78bfa', defaultOn: true, entity: true },

      { id: 'cctv',          label: 'Caméras publiques',        group: 'infra',    color: '#f43f9d', entity: true },
      { id: 'cctv_previews', label: 'Aperçu des images',        group: 'infra',    color: '#f9a8d4', isOption: true, defaultOn: true },
      { id: 'cables',        label: 'Câbles sous-marins',       group: 'infra',    color: '#2dd4bf', entity: true },
      { id: 'cctv_drc',      label: 'Caméras RDC / mes caméras', group: 'infra',   color: '#34d399', entity: true },

      { id: 'earthquakes',   label: 'Séismes (USGS)',           group: 'earth',    color: '#fb923c', defaultOn: true, entity: true },
      { id: 'incidents',     label: 'Incidents (NASA EONET)',   group: 'earth',    color: '#f87171', defaultOn: true, entity: true },
      { id: 'day_night',     label: 'Jour / Nuit',              group: 'earth',    color: '#818cf8', defaultOn: true },
      { id: 'wind',          label: 'Vent',                     group: 'earth',    color: '#a3e635' },
      { id: 'rain',          label: 'Radar de pluie',           group: 'earth',    color: '#60a5fa' },

      { id: 'live_news',     label: 'Actualités en direct',     group: 'media',    color: '#f9a8d4' }
    ],

    // Sources de données (toutes publiques)
    sources: {
      earthquakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
      opensky:     'https://opensky-network.org/api/states/all',
      celestrak:   'https://celestrak.org/NORAD/elements/gp.php?GROUP={GROUP}&FORMAT=json',
      aisstream:   'wss://stream.aisstream.io/v0/stream',
      digitraffic: 'https://meri.digitraffic.fi/api/ais/v1',
      tfl:         'https://api.tfl.gov.uk/Place/Type/JamCam',
      nyc:         'https://webcams.nyctmc.org/api/cameras',
      cables:      'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
      eonet:       'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300',
      openmeteo:   'https://api.open-meteo.com/v1/forecast',
      rainviewer:  'https://api.rainviewer.com/public/weather-maps.json',
      gdelt:       'https://api.gdeltproject.org/api/v2/doc/doc',
      nominatim:   'https://nominatim.openstreetmap.org/search',
      dns:         'https://dns.google/resolve',
      ipwho:       'https://ipwho.is/'
    },

    // Groupes de satellites (CelesTrak). "limit" = nombre max pris dans le groupe.
    satGroups: [
      { id: 'stations', color: '#f9a8d4' },
      { id: 'visual',   color: '#a78bfa' },
      { id: 'gps-ops',  color: '#22d3ee' },
      { id: 'galileo',  color: '#a3e635' },
      { id: 'weather',  color: '#fbbf24' },
      { id: 'science',  color: '#fb923c' },
      { id: 'starlink', color: '#60a5fa', limit: 400 }
    ],

    // Caméras publiques de RDC, trouvées par recherche web (novembre 2026).
    // IMPORTANT : je n'ai trouvé AUCUNE caméra de rue officielle à Kinshasa, Goma ou Lubumbashi.
    // Il n'existe, à ma connaissance, que des caméras animalières et scientifiques ci-dessous.
    // Les positions sont approximatives (régions), pas des coordonnées exactes.
    // kind : 'link' (page externe), 'youtube' (ref = identifiant de vidéo de 11 caractères
    //        ou identifiant de chaîne commençant par UC), 'image' (ref = adresse d'une image rafraîchie).
    // Pour ajouter une caméra sans toucher au code : onglet CAMS de l'application.
    drcCameras: [
      { id: 'lola-enclos',  name: 'Lola ya Bonobo — enclos',   city: 'Kinshasa (Kinsele)',       lat: -4.52, lng: 15.20, kind: 'link', approx: true,
        note: 'Refuge de bonobos (caméra animalière)', ref: 'https://worldcam.io/webcams/dr-congo/kinshasa-city/lola-ya-bonobo-sanctuary-enclosure--b3BlbmNjdHY6ZXhwbG9yZS1vcmctMzU1' },
      { id: 'lola-nursery', name: 'Lola ya Bonobo — nurserie', city: 'Kinshasa (Kinsele)',       lat: -4.53, lng: 15.21, kind: 'link', approx: true,
        note: 'Refuge de bonobos (caméra animalière)', ref: 'https://worldcam.io/webcams/dr-congo/kinshasa-city/lola-ya-bonobo-sanctuary-nursery--b3BlbmNjdHY6ZXhwbG9yZS1vcmctMzU2' },
      { id: 'gorille-corridor', name: 'Corridor forestier des gorilles', city: 'Nord-Kivu',        lat: -0.25, lng: 29.20, kind: 'link', approx: true,
        note: 'Caméra animalière', ref: 'https://worldcam.io/webcams/dr-congo/nord-kivu/gorilla-forest-corridor--b3BlbmNjdHY6ZXhwbG9yZS1vcmctMjQ0' },
      { id: 'gorille-grace', name: 'Centre GRACE — gorilles',   city: 'Nord-Kivu',                lat: -0.28, lng: 29.22, kind: 'link', approx: true,
        note: 'Caméra animalière', ref: 'https://worldcam.io/webcams/dr-congo/nord-kivu/gorilla-grace-center--b3BlbmNjdHY6d2ViY2FtdGF4aS1kci1jb25nby1ub3J0aC1raXZ1LWdvcmlsbGEtZ3JhY2UtY2VudGVy' },
      { id: 'gorille-kasugho', name: 'Forêt des gorilles (YouTube)', city: 'Kasugho, Nord-Kivu', lat: -0.30, lng: 29.18, kind: 'youtube', approx: true,
        note: 'Flux YouTube annoncé « en direct » ; s\'il ne s\'affiche pas, l\'intégration est désactivée par son auteur', ref: '672cUSe69J0' },
      { id: 'congoflux', name: 'Tour Congoflux (forêt tropicale)', city: 'Yangambi, Tshopo',    lat: 0.77,  lng: 24.47, kind: 'link', approx: true,
        note: 'Image fixe scientifique, rafraîchie périodiquement', ref: 'https://worldcam.io/app?cam=opencctv%3Aphenocam-congoflux' }
    ],

    // Chaînes en direct (YouTube). Les identifiants de chaîne peuvent changer :
    // si une chaîne ne s'affiche pas, remplace l'identifiant ici.
    newsStreams: [
      { name: 'Al Jazeera EN', channel: 'UCNye-wNBqNL5ZzHSJj3l8Bg' },
      { name: 'DW News',       channel: 'UCknLrEdhRCp1aegoMqRaCZg' },
      { name: 'France 24 EN',  channel: 'UCQfwfsi5VrQ8yKZ-UWmAEFg' },
      { name: 'Sky News',      channel: 'UCoMdktPbSTixAyNGwb-UYkQ' }
    ],

    // Requête par défaut pour les titres d'actualité (syntaxe GDELT)
    newsQuery: '(war OR earthquake OR hurricane OR protest OR explosion) sourcelang:english',

    // Couleurs des catégories d'incidents NASA EONET
    incidentColors: {
      wildfires: '#fb923c', severeStorms: '#60a5fa', volcanoes: '#ef4444', floods: '#22d3ee',
      drought: '#fbbf24', dustHaze: '#d6a05a', earthquakes: '#f43f9d', landslides: '#a16207',
      manmade: '#a78bfa', seaLakeIce: '#bae6fd', snow: '#e0f2fe', tempExtremes: '#f87171', waterColor: '#2dd4bf'
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
