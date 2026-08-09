/* Paris Invisible — core.js
 * Fonctions pures extraites de index.html pour être testables (node --test).
 * ⚠️ Règle : toute évolution de ces fonctions passe par le cycle TDD
 *    rouge (test qui échoue) → vert (code minimal) → refactor.
 * Chargé par index.html (global PICore) ET par les tests Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------- GÉOMÉTRIE ----------
  // Distance en mètres entre deux points GPS (formule de haversine)
  const haversine = (a, b, c, d) => {
    const R = 6371000, dL = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180;
    const x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };

  // Cap (0-360°, 0 = Nord) du point (a,b) vers (c,d)
  const bearingTo = (a, b, c, d) => {
    const dl = (d - b) * Math.PI / 180, l1 = a * Math.PI / 180, l2 = c * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(l2), x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  // Normalise un cap dans [0, 360)
  const normHeading = h => ((h % 360) + 360) % 360;

  // ---------- BOUSSOLE ----------
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const dirIdx = h => Math.round(normHeading(h) / 45) % 8;
  const bearingDir = b => DIRS[dirIdx(b)];

  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const arrowChar = r => ARROWS[dirIdx(r)];

  // Ruban HUD : les caps croissent vers la droite.
  // Retourne [l2, l1, cur, r1, r2] pour un cap h.
  const ribbon = h => [
    DIRS[dirIdx(h - 90)],
    DIRS[dirIdx(h - 45)],
    DIRS[dirIdx(h)],
    DIRS[dirIdx(h + 45)],
    DIRS[dirIdx(h + 90)],
  ];

  // Filtre passe-bas circulaire : un pas de lissage de `current` vers `raw`.
  // Prend toujours le plus court chemin (359°→1° = +2°, pas −358°).
  const smoothStep = (current, raw, k = 0.15) => {
    let diff = raw - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return normHeading(current + diff * k);
  };

  // ---------- PROJECTION AR ----------
  // rel = cap relatif POI − smoothHeading, dans [0, 360).
  // Champ ~120° : rel ∈ [0,60] → moitié droite, rel ∈ [300,360) → moitié gauche.
  // Retourne x ∈ [0,1] (0 = bord gauche) ou null si hors champ.
  const arProject = rel => {
    rel = normHeading(rel);
    if (rel <= 60) return 0.5 + rel / 120;
    if (rel >= 300) return 0.5 - (360 - rel) / 120;
    return null;
  };
  // Variante clampée aux marges d'affichage (marqueurs jamais collés au bord)
  const arProjectClamped = rel => {
    const x = arProject(rel);
    return x === null ? null : Math.max(0.06, Math.min(0.94, x));
  };

  // ---------- AFFICHAGE ----------
  const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
  const catLabel = c => ({ monument: 'Monument', cinema: 'Cinéma', histoire: 'Histoire', insolite: 'Insolite', artiste: 'Artiste', parc: "Parc d'attractions" }[c] || c);
  const esc = s => s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ---------- PROGRESSION (logique pure, stockage injecté) ----------
  // Ajoute id à l'ensemble ; retourne true si c'est une découverte (nouvelle entrée).
  const addVisited = (set, id) => {
    if (set.has(id)) return false;
    set.add(id);
    return true;
  };
  const progressPct = (n, total) => total > 0 ? Math.round(n / total * 100) : 0;

  // ---------- TRANSPORTS & ITINÉRAIRE ----------
  // Estimation à pied à 4,5 km/h (75 m/min), arrondi supérieur
  const walkMinutes = m => Math.ceil(m / 75);

  // À Paris : < 1,5 km on marche, au-delà les transports en commun sont le bon défaut
  const suggestedMode = d => d < 1500 ? 'walking' : 'transit';

  const TRANSPORT_MODES = [
    { id: 'walking',   label: 'À pied',     icon: '🚶' },
    { id: 'transit',   label: 'Transports', icon: '🚇' },
    { id: 'driving',   label: 'Voiture',    icon: '🚗' },
    { id: 'bicycling', label: 'Vélo',       icon: '🚴' },
  ];

  // URL Google Maps universelle (l'app Maps s'ouvre si installée, le web sinon).
  // Origine omise = position actuelle de l'utilisateur, gérée par Maps.
  const mapsDirUrl = (lat, lng, mode) => {
    if (!TRANSPORT_MODES.some(m => m.id === mode)) mode = 'walking';
    return 'https://www.google.com/maps/dir/?api=1&destination='
      + encodeURIComponent(lat + ',' + lng) + '&travelmode=' + mode;
  };

  // Libellé du compteur d'en-tête : jamais un "0" décourageant —
  // si rien à proximité (< 5 km), on donne la distance du plus proche.
  const nearbyLabel = (n, nearestDist) => {
    if (n > 0) return n + ' histoire' + (n > 1 ? 's' : '') + ' autour';
    return 'la plus proche à ' + fmtDist(nearestDist);
  };

  const PICore = {
    haversine, bearingTo, normHeading,
    DIRS, dirIdx, bearingDir, ARROWS, arrowChar, ribbon, smoothStep,
    arProject, arProjectClamped,
    fmtDist, catLabel, esc,
    addVisited, progressPct,
    walkMinutes, suggestedMode, TRANSPORT_MODES, mapsDirUrl,
    nearbyLabel,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PICore;
  root.PICore = PICore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
