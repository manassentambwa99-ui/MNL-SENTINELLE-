# MNL SENTINEL

**Plateforme de renseignement global** : un globe 3D (ou carte 2D) qui affiche en temps réel les avions, les navires, les satellites, les caméras publiques, les séismes, les incidents naturels, la météo et l'actualité. Installable comme une application (PWA) et utilisable hors ligne avec les dernières données reçues.

Signature : **MNL** · Version 1.2 · Licence MIT

> **Code original.** MNL SENTINEL reprend l'idée générale des tableaux de bord OSINT comme OSIRIS (mêmes types de couches, même lien `?layers=…`), mais tout le code est écrit de zéro. Toutes les sources de données sont publiques.

---

## 1. Structure : tout est à la racine, aucun dossier

```
index.html              la page
style.css               le style (couleurs néon)
config.js               nom, couleurs, couches, sources  <- à personnaliser en premier
utils.js                outils, calcul du Soleil et de la nuit, icônes
map.js                  la carte (globe 3D / 2D, fond sombre / satellite)
layers.js               les 12 couches de données
ui.js                   l'interface (panneaux, recherche, RECON, NEWS…)
pwa.js                  installation de l'application et mises à jour
main.js                 le démarrage
sw.js                   le service worker (cache et mode hors ligne)
manifest.webmanifest    la carte d'identité de l'application
offline.html            page affichée si rien n'est en cache
diagnostic.html         teste chaque service depuis ton navigateur
icon.svg, icon-192.png, icon-512.png,
icon-maskable-512.png, apple-touch-icon.png      les icônes
README.md, LICENSE
```

L'ordre des `<script>` dans `index.html` compte : `utils` → `config` → `map` → `layers` → `ui` → `pwa` → `main`. Pas de bundler, pas de npm : tout passe par un objet global `MNL`.

---

## 2. Mettre le projet sur GitHub (sans dossier)

Comme il n'y a aucun dossier, l'envoi par le site web est simple :

1. Ouvre ton dépôt sur github.com.
2. **Add file → Upload files**.
3. Glisse (ou sélectionne) **tous les fichiers d'un coup**, puis **Commit changes**.
4. **Settings → Pages → Branch: main / root → Save**.
5. Après une minute, l'application est en ligne à `https://TON_PSEUDO.github.io/NOM_DU_DEPOT/`.

En ligne de commande :

```bash
git init && git add . && git commit -m "MNL SENTINEL v1.2"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/NOM_DU_DEPOT.git
git push -u origin main
```

**GitHub Pages est obligatoire pour la PWA** : le service worker et l'installation exigent HTTPS (ou `localhost`). Ouvrir `index.html` directement depuis un dossier fonctionne pour la carte, mais pas pour l'installation.

---

## 3. Installer l'application

- **Android / Chrome / Edge** : bouton **INSTALLER** en haut de l'écran (ou menu ⋮ → Installer l'application).
- **iPhone / iPad (Safari)** : bouton Partager → **Sur l'écran d'accueil**.
- Ensuite l'application s'ouvre en plein écran, et hors ligne elle affiche les dernières données reçues.

Raccourcis d'icône (appui long) : Séismes, Ciel (avions et satellites), Météo.

---

## 4. Les couches

| Couche | Source | Mise à jour | Remarques |
|---|---|---|---|
| **Aviation** | OpenSky Network | 60 s | Flèches orientées, couleur selon l'altitude. Le quota gratuit est de 400 crédits par jour : l'appli les compte, espace les requêtes et déplace les avions « à l'estime » entre deux mises à jour. Alerte pour les codes 7500, 7600, 7700. |
| **Maritime** | Digitraffic (sans clé) ou AISStream (clé gratuite) | 90 s / direct | Sans clé : mer Baltique (Finlande). Avec une clé AISStream : flux mondial. Si le navigateur refuse la connexion AISStream, l'appli revient seule sur Digitraffic. |
| **Naval** | idem | idem | Navires déclarant le type AIS 35 (opérations militaires). Beaucoup ne le déclarent pas : c'est une partie seulement. |
| **Satellites** | CelesTrak + satellite.js | calcul toutes les 2 s | Plusieurs centaines d'objets, position calculée dans ton navigateur. Clic sur un satellite : trace de son orbite. |
| **Caméras publiques** | TfL (Londres), NYC DOT (New York) | 15 min | Caméras de trafic en données ouvertes, avec aperçu. |
| **Câbles sous-marins** | TeleGeography | une fois | |
| **Séismes** | USGS | 5 min | Alerte pour M5.5+. |
| **Incidents** | NASA EONET | 15 min | Feux, tempêtes, volcans, inondations… |
| **Jour / Nuit** | calcul local | 60 s | Nuit et trois crépuscules, point du Soleil. |
| **Vent** | Open-Meteo | 60 min | Grille de flèches, densité réglable. |
| **Radar de pluie** | RainViewer | 10 min | Animation, opacité réglable. |
| **Actualités** | GDELT + YouTube | à l'ouverture | Titres et chaînes en direct. |

Les couches se règlent aussi par l'adresse : `?layers=aircraft,earthquakes,wind`. Les noms du site d'origine (`sdk_air`, `sdk_sea`, `sdk_naval`, `global_incidents`, `wind_controls`, `rain_controls`) sont reconnus.

### Le dock de droite
SEARCH (lieux), RECON (DNS public et géolocalisation d'une adresse IP, passif, aucun scan de ports), SPACE (Station spatiale), ALERTS, NEWS.

---

## 5. Vérifier que tout est réel : diagnostic.html

Ouvre `diagnostic.html` (lien en bas de l'application). Elle appelle **réellement**, depuis ton navigateur, chaque service : USGS, OpenSky, CelesTrak, TfL, NYC, câbles, NASA, Open-Meteo, RainViewer, GDELT, Digitraffic, recherche, DNS, géolocalisation IP, tuiles de carte et bibliothèques. Pastille verte = ça marche, rouge = indisponible, limité ou bloqué, avec la raison. Le bouton **COPIER LE RAPPORT** te permet de me le renvoyer si quelque chose est rouge.

---

## 6. Caméras en RDC : ce que j'ai trouvé

Je n'ai trouvé **aucune caméra publique de rue ou de bâtiment à Kinshasa, Goma ou Lubumbashi** dans des sources ouvertes vérifiables. Les seules caméras listées pour le pays sont des caméras de faune (sanctuaires de bonobos à Kinshasa, gorilles au Nord-Kivu), et je n'ai pas pu confirmer qu'elles diffusent en direct. Je n'ai donc rien inventé : aucune adresse de caméra de la RDC n'est dans le projet.

Pour en ajouter une toi-même, si tu en connais une réellement publique (flux officiel d'une ville, d'un hôtel, d'une chaîne), ajoute ses coordonnées et son adresse dans la couche `cctv` de `layers.js` (fonction `fetchCams`), comme pour Londres et New York.

---

## 7. Personnaliser

Dans `config.js` : nom, couleurs de chaque couche, couches actives au démarrage (`defaultOn`), vue de départ, chaînes TV, groupes de satellites. Dans `style.css`, les couleurs globales sont en haut (`:root`). Pour forcer la mise à jour de l'application chez tout le monde, change `VERSION` dans `sw.js`.

---

## 8. Limites honnêtes

- Les tests automatiques (Chromium, 101 vérifications : couches, popups, quotas, PWA, mode hors ligne) ont été faits avec un **réseau simulé**, car l'environnement où j'ai travaillé n'a pas accès à ces services. Le code fonctionne dans ce cadre, mais les vraies réponses des services, je ne les ai pas vues. Utilise `diagnostic.html` pour le vérifier chez toi.
- Les services gratuits changent : OpenSky limite les requêtes anonymes, certains refusent les appels depuis un navigateur (CORS). Une couche en ⚠ affiche la raison au survol.
- Pas de scan de ports, pas de caméras privées ou piratées, et pas de reconnaissance de visages : ce projet n'identifie ni ne suit des personnes.

---

## 9. Sources

OpenSky Network · CelesTrak · satellite.js · Digitraffic · AISStream · Transport for London · NYC DOT · TeleGeography · USGS · NASA EONET · Open-Meteo · RainViewer · GDELT · OpenStreetMap / Nominatim · Google Public DNS · ipwho.is · CARTO · Esri · MapLibre GL JS. Respecte les conditions d'utilisation de chacun.

© 2026 **MNL** — MNL SENTINEL
