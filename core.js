/* Paris Invisible — core.js
 * Fonctions pures extraites de index.html pour être testables (node --test).
 * ⚠️ Règle : toute évolution de ces fonctions passe par le cycle TDD
 *    rouge (test qui échoue) → vert (code minimal) → refactor.
 * Chargé par index.html (global PICore) ET par les tests Node (module.exports).
 */
(function (root) {
  'use strict';
  const EXTRA_I18N = root.PIExtraI18N || (typeof require === 'function' ? require('./i18n-extra.js') : {});

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
  const DIRECTION_LABELS = Object.freeze({
    fr: Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']),
    en: Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
    zh: Object.freeze(['北', '东北', '东', '东南', '南', '西南', '西', '西北']),
    es: Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']),
    de: Object.freeze(['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']),
    it: Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']),
    ja: Object.freeze(['北', '北東', '東', '南東', '南', '南西', '西', '北西']),
  });
  const DIRS = DIRECTION_LABELS.fr;
  const dirIdx = h => Math.round(normHeading(h) / 45) % 8;
  const bearingDir = (b, lang = 'fr') => (DIRECTION_LABELS[lang] || DIRS)[dirIdx(b)];

  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const arrowChar = r => ARROWS[dirIdx(r)];

  // Ruban HUD : les caps croissent vers la droite.
  // Retourne [l2, l1, cur, r1, r2] pour un cap h.
  const ribbon = (h, lang = 'fr') => {
    const labels = DIRECTION_LABELS[lang] || DIRS;
    return [
      labels[dirIdx(h - 90)],
      labels[dirIdx(h - 45)],
      labels[dirIdx(h)],
      labels[dirIdx(h + 45)],
      labels[dirIdx(h + 90)],
    ];
  };

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
  const CAT_LABELS = Object.freeze({
    fr: Object.freeze({ monument: 'Monument', cinema: 'Cinéma', histoire: 'Histoire', insolite: 'Insolite', artiste: 'Artiste', parc: "Parc d'attractions" }),
    en: Object.freeze({ monument: 'Monument', cinema: 'Cinema', histoire: 'History', insolite: 'Hidden gem', artiste: 'Artist', parc: 'Theme park' }),
    zh: Object.freeze({ monument: '名胜', cinema: '电影', histoire: '历史', insolite: '秘境', artiste: '艺术家', parc: '主题乐园' }),
    es: Object.freeze({ monument: 'Monumento', cinema: 'Cine', histoire: 'Historia', insolite: 'Lugar insólito', artiste: 'Artista', parc: 'Parque temático' }),
    de: Object.freeze({ monument: 'Monument', cinema: 'Kino', histoire: 'Geschichte', insolite: 'Geheimtipp', artiste: 'Künstler', parc: 'Freizeitpark' }),
    it: Object.freeze({ monument: 'Monumento', cinema: 'Cinema', histoire: 'Storia', insolite: 'Curiosità', artiste: 'Artista', parc: 'Parco tematico' }),
    ja: Object.freeze({ monument: '名所', cinema: '映画', histoire: '歴史', insolite: '秘境', artiste: '芸術家', parc: 'テーマパーク' }),
  });
  const catLabel = (c, lang = 'fr') => (CAT_LABELS[lang] || CAT_LABELS.fr)[c] || c;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ---------- INTERNATIONALISATION ----------
  const I18N = Object.freeze({
    fr: Object.freeze({
      tagline: 'La ville qui vous parle', start: 'Explorer Paris', included_note: '5 histoires variées gratuites. Un achat unique ouvre les 44 lieux. Sans publicité, sans compte ni analytics. La caméra reste votre choix.',
      privacy_summary: 'Confidentialité', privacy_splash: 'La position et l’orientation ne sont pas stockées par l’app. Aucune image caméra n’est enregistrée ni transmise. Les découvertes, la langue et le choix sans caméra restent sur cet appareil.', creation: 'Une création', directions_approx: 'Directions approximatives',
      around: '🔭 Autour', map: '🗺️ Carte', list: '📜 Liste', location_loading: 'Localisation…', precise_location: 'Position précise', approx_location: 'Position approx.', gps_denied: 'GPS refusé · simulé', gps_unavailable: 'GPS indispo · simulé',
      explore_mode: 'Mode Exploration', explore_text: 'Activez la caméra pour l’expérience AR. Les flèches directionnelles fonctionnent en permanence.', enable_camera: 'Activer la caméra', without_camera: 'Continuer sans caméra', camera_privacy: '🔒 Le flux caméra ne quitte jamais votre téléphone : aucune image n’est enregistrée, stockée ni envoyée. Tout fonctionne aussi sans caméra.',
      show_plan: 'Afficher le plan', show_camera: 'Afficher la caméra', compass_unavailable: '🧭 Boussole indisponible — afficher le plan', radar_north: 'Plan orienté nord — le nord est en haut · Choisissez un lieu', radar_heading: 'Le plan tourne avec vous — ce qui est devant est en haut · Choisissez un lieu',
      around_me: '📍 Autour de moi', key_dates: '📅 Repères', buried_people: '★ Personnalités inhumées', did_you_know: 'Le saviez-vous ?', place_site: '🌐 Site du lieu', official_page: 'Page officielle ou institutionnelle', access_mode: 'Moyen d’accès', listen: '🔊 Écouter', stop: '⏸️ Stop', back: '← Retour', go: '📍 Y aller',
      fly_book: 'Réserver avec F.L.Y Taxi', fly_yvelines: 'Pour cette destination dans le 78 · Service proposé par l’éditeur', fly_qr: 'Afficher le QR code contact F.L.Y Taxi', fly_contact: 'Contact F.L.Y Taxi', fly_scan: 'Scannez avec un autre téléphone pour enregistrer directement la fiche contact.', call: '☎ Appeler', add_contact: '＋ Ajouter le contact', book_online: 'Réserver en ligne ↗',
      privacy_title: 'Vie privée, sans compte ni publicité', privacy_body: 'Paris Invisible n’intègre aucun SDK publicitaire ni outil de mesure d’audience. La caméra n’enregistre ni ne transmet aucune image ; l’application ne stocke pas votre position sur un serveur.',
      external_title: 'Services externes', external_body: 'La carte charge les tuiles OpenStreetMap seulement à son ouverture. Les itinéraires ouvrent Google Maps. Chaque fiche peut ouvrir une page officielle après votre appui. F.L.Y Taxi apparaît uniquement dans « Y aller » pour une destination des Yvelines (78).',
      access_title: 'Accès et achat', access_body: 'Le téléchargement gratuit comprend 5 histoires. Un achat définitif facultatif à 4,99 € ouvre les 44 lieux. Il est géré par l’App Store ou Google Play. Aucun abonnement et aucune publicité.', privacy_link: 'Confidentialité', sources_link: 'Sources & crédits', close: 'Fermer',
      my_access: 'Version complète', store_intro: 'L’application est gratuite avec 5 histoires, sans publicité. Un achat unique débloque les 44 lieux.', base_title: '5 histoires gratuites', base_detail: 'Tour Eiffel, Notre-Dame, Amélie Poulain, la plus petite maison de Paris et château de Monte-Cristo.', paris_pack: 'Paris complet', paris_detail: 'Les 44 lieux, récits, repères, anecdotes et audios dans une version complète définitive.', discover: 'À débloquer', connecting_store: 'Connexion au Store…', restore: 'Restaurer mon achat', store_note: 'Achat unique · Aucun abonnement · Paiement traité par Apple ou Google',
      acquired: '✓ Version complète', acquired_extension: '✓ Version complète acquise', wait: 'Veuillez patienter…', unlock_price: 'Tout débloquer', store_unavailable: 'Store momentanément indisponible', native_only: 'Disponible dans l’app iOS et Android', pending: 'Achat en attente de validation par le Store. Aucun accès n’est accordé avant confirmation.',
      pack_paris_badge: 'Version complète', pack_parks_badge: 'Version complète', locked_paris: 'Disponible avec la version complète.', locked_parks: 'Disponible avec la version complète.', visited: '✓ découvert', locked_label: 'contenu verrouillé, ouvrir Version complète', suggested: 'conseillé',
      all: 'Tout', parks_filter: '🎢 Parcs', monuments_filter: '🏛️ Monuments', cinema_filter: '🎬 Cinéma', history_filter: '👑 Histoire', hidden_filter: '🕵️ Insolite', artists_filter: '🎨 Artistes',
      location_denied_toast: 'Localisation refusée — position simulée au centre de Paris', camera_unsupported: 'Caméra non prise en charge sur cet appareil', camera_unavailable: 'Caméra indisponible — vous pouvez continuer sans caméra', map_unavailable: 'Carte indisponible — les autres modes restent accessibles', audio_unavailable: 'Audio non disponible sur cet appareil', audio_error: 'Erreur audio', restored: 'Achats restaurés et vérifiés', restore_failed: 'Restauration impossible pour le moment', purchase_pending: 'Achat en attente de validation', unlocked: 'Extension déverrouillée', purchase_failed: 'Achat non finalisé — aucun débit dans l’app', content_failed: 'Contenu acquis mais illisible : relancez l’app en ligne',
      all_discovered: '🏅 Toutes les histoires accessibles sont découvertes !', you: 'Vous', map_fallback: '🗺️ Carte indisponible. La liste, le radar et les itinéraires restent utilisables.', discover_action: 'Découvrir', centered: 'Centré sur votre position', simulated_position: 'Position simulée (centre de Paris)',
    }),
    en: Object.freeze({
      tagline: 'The city that speaks to you', start: 'Explore Paris', included_note: '5 varied stories are free. One purchase opens all 44 places. No ads, account or analytics. The camera is always your choice.',
      privacy_summary: 'Privacy', privacy_splash: 'Location and orientation are not stored by the app. Camera images are never recorded or sent. Discoveries, language and the no-camera preference remain on this device.', creation: 'Created by', directions_approx: 'Approximate directions',
      around: '🔭 Around', map: '🗺️ Map', list: '📜 List', location_loading: 'Locating…', precise_location: 'Precise location', approx_location: 'Approx. location', gps_denied: 'GPS denied · simulated', gps_unavailable: 'GPS unavailable · simulated',
      explore_mode: 'Exploration mode', explore_text: 'Enable the camera for the AR experience. Direction arrows always remain available.', enable_camera: 'Enable camera', without_camera: 'Continue without camera', camera_privacy: '🔒 The camera feed never leaves your phone: no image is recorded, stored or sent. Everything also works without the camera.',
      show_plan: 'Show radar', show_camera: 'Show camera', compass_unavailable: '🧭 Compass unavailable — show radar', radar_north: 'North-up radar — north is at the top · Choose a place', radar_heading: 'The radar rotates with you — ahead is at the top · Choose a place',
      around_me: '📍 Around me', key_dates: '📅 Key dates', buried_people: '★ Notable people buried here', did_you_know: 'Did you know?', place_site: '🌐 Place website', official_page: 'Official or institutional page', access_mode: 'How to get there', listen: '🔊 Listen', stop: '⏸️ Stop', back: '← Back', go: '📍 Directions',
      fly_book: 'Book with F.L.Y Taxi', fly_yvelines: 'For this destination in the Yvelines · Service by the publisher', fly_qr: 'Show the F.L.Y Taxi contact QR code', fly_contact: 'F.L.Y Taxi contact', fly_scan: 'Scan with another phone to save the contact card directly.', call: '☎ Call', add_contact: '＋ Add contact', book_online: 'Book online ↗',
      privacy_title: 'Private, with no account or advertising', privacy_body: 'Paris Invisible includes no advertising SDK or audience analytics. The camera never records or sends images, and the app does not store your location on a server.',
      external_title: 'External services', external_body: 'The map loads OpenStreetMap tiles only when opened. Directions open Google Maps. Each card can open an official page after your tap. F.L.Y Taxi appears only under Directions for destinations in the Yvelines (78).',
      access_title: 'Access and purchase', access_body: 'The free download includes 5 stories. One optional €4.99 one-time purchase opens all 44 places. It is managed by the App Store or Google Play. No subscription or advertising.', privacy_link: 'Privacy', sources_link: 'Sources & credits', close: 'Close',
      my_access: 'Full version', store_intro: 'The app is free with 5 stories and no advertising. One purchase unlocks all 44 places.', base_title: '5 free stories', base_detail: 'Eiffel Tower, Notre-Dame, Amélie, Paris’s smallest house and Château de Monte-Cristo.', paris_pack: 'Full Paris', paris_detail: 'All 44 places, stories, timelines, anecdotes and audio in one permanent full version.', discover: 'Unlock', connecting_store: 'Connecting to Store…', restore: 'Restore my purchase', store_note: 'One-time purchase · No subscription · Payment handled by Apple or Google',
      acquired: '✓ Full version', acquired_extension: '✓ Full version purchased', wait: 'Please wait…', unlock_price: 'Unlock everything', store_unavailable: 'Store temporarily unavailable', native_only: 'Available in the iOS and Android app', pending: 'Purchase awaiting Store approval. Access remains locked until confirmation.',
      pack_paris_badge: 'Full version', pack_parks_badge: 'Full version', locked_paris: 'Available with the full version.', locked_parks: 'Available with the full version.', visited: '✓ visited', locked_label: 'locked content, open Full version', suggested: 'suggested',
      all: 'All', parks_filter: '🎢 Parks', monuments_filter: '🏛️ Monuments', cinema_filter: '🎬 Cinema', history_filter: '👑 History', hidden_filter: '🕵️ Hidden gems', artists_filter: '🎨 Artists',
      location_denied_toast: 'Location denied — using a simulated central Paris position', camera_unsupported: 'Camera is not supported on this device', camera_unavailable: 'Camera unavailable — you can continue without it', map_unavailable: 'Map unavailable — the other modes still work', audio_unavailable: 'Audio is not available on this device', audio_error: 'Audio error', restored: 'Purchases restored and verified', restore_failed: 'Purchases cannot be restored right now', purchase_pending: 'Purchase awaiting confirmation', unlocked: 'Pack unlocked', purchase_failed: 'Purchase not completed — no in-app charge', content_failed: 'Purchased content could not be read: reopen the app while online',
      all_discovered: '🏅 Every accessible story has been discovered!', you: 'You', map_fallback: '🗺️ Map unavailable. The list, radar and directions still work.', discover_action: 'Open', centered: 'Centred on your position', simulated_position: 'Simulated position (central Paris)',
    }),
    zh: Object.freeze({
      tagline: '会说话的巴黎', start: '探索巴黎', included_note: '免费下载，含5个多样化故事。一次购买可开启全部44个地点。无广告、无账号、无分析工具；相机始终由您决定是否开启。',
      privacy_summary: '隐私', privacy_splash: '应用不会存储位置或方向，也不会记录或发送相机图像。探索记录、语言和无相机偏好仅保留在本机。', creation: '出品', directions_approx: '方向为近似值',
      around: '🔭 周围', map: '🗺️ 地图', list: '📜 列表', location_loading: '正在定位…', precise_location: '精确定位', approx_location: '大致定位', gps_denied: '定位被拒 · 模拟', gps_unavailable: '定位不可用 · 模拟',
      explore_mode: '探索模式', explore_text: '开启相机可体验AR；方向箭头始终可以使用。', enable_camera: '开启相机', without_camera: '不用相机继续', camera_privacy: '🔒 相机画面不会离开手机：不记录、不存储、不发送任何图像。不用相机也可使用全部功能。',
      show_plan: '显示雷达', show_camera: '显示相机', compass_unavailable: '🧭 指南针不可用—显示雷达', radar_north: '雷达朝北—北方在上 · 请选择地点', radar_heading: '雷达随您转动—前方在上 · 请选择地点',
      around_me: '📍 回到附近', key_dates: '📅 大事记', buried_people: '★ 安葬于此的名人', did_you_know: '你知道吗？', place_site: '🌐 地点网站', official_page: '官方或机构页面', access_mode: '出行方式', listen: '🔊 朗读', stop: '⏸️ 停止', back: '← 返回', go: '📍 前往',
      fly_book: '预约 F.L.Y Taxi', fly_yvelines: '前往伊夫林省（78）此目的地 · 由发行方提供', fly_qr: '显示 F.L.Y Taxi 联系二维码', fly_contact: '联系 F.L.Y Taxi', fly_scan: '请用另一部手机扫描，直接保存联系人。', call: '☎ 致电', add_contact: '＋ 保存联系人', book_online: '在线预约 ↗',
      privacy_title: '隐私、无账号、无广告', privacy_body: 'Paris Invisible 不含广告 SDK 或受众分析工具。相机不会记录或发送图像，应用也不会在服务器上存储您的位置。',
      external_title: '外部服务', external_body: '只有打开地图时才会加载 OpenStreetMap 瓦片；路线会打开 Google Maps。地点卡片仅在您点击后打开官方页面。F.L.Y Taxi 只在前往伊夫林省（78）目的地时显示。',
      access_title: '访问与购买', access_body: '免费下载含5个故事。一次可选的4.99欧元永久购买可开启全部44个地点，由 App Store 或 Google Play 管理。无订阅、无广告。', privacy_link: '隐私政策', sources_link: '来源与鸣谢', close: '关闭',
      my_access: '完整版本', store_intro: '应用可免费下载，含5个故事且无广告。一次购买即可解锁全部44个地点。', base_title: '5个免费故事', base_detail: '埃菲尔铁塔、巴黎圣母院、《天使爱美丽》、巴黎最小的房子和蒙特克里斯托城堡。', paris_pack: '完整巴黎', paris_detail: '一次永久购买即可获得全部44个地点、故事、年代、趣闻和音频。', discover: '解锁', connecting_store: '正在连接商店…', restore: '恢复购买', store_note: '一次性购买 · 无订阅 · 付款由 Apple 或 Google 处理',
      acquired: '✓ 完整版本', acquired_extension: '✓ 已购买完整版本', wait: '请稍候…', unlock_price: '全部解锁', store_unavailable: '商店暂时不可用', native_only: '可在 iOS 和 Android 应用内购买', pending: '购买正在等待商店确认，确认前不会解锁。',
      pack_paris_badge: '完整版本', pack_parks_badge: '完整版本', locked_paris: '完整版本可用。', locked_parks: '完整版本可用。', visited: '✓ 已探索', locked_label: '内容已锁定，请打开完整版本', suggested: '推荐',
      all: '全部', parks_filter: '🎢 乐园', monuments_filter: '🏛️ 名胜', cinema_filter: '🎬 电影', history_filter: '👑 历史', hidden_filter: '🕵️ 秘境', artists_filter: '🎨 艺术家',
      location_denied_toast: '定位被拒—已模拟为巴黎市中心', camera_unsupported: '此设备不支持相机功能', camera_unavailable: '相机不可用—您可以不用相机继续', map_unavailable: '地图不可用—其他模式仍可使用', audio_unavailable: '此设备不支持朗读', audio_error: '朗读出错', restored: '购买已恢复并验证', restore_failed: '暂时无法恢复购买', purchase_pending: '购买等待确认', unlocked: '礼包已解锁', purchase_failed: '购买未完成—应用内未扣款', content_failed: '已购内容无法读取，请联网后重新打开应用',
      all_discovered: '🏅 已探索所有可访问的故事！', you: '您', map_fallback: '🗺️ 地图不可用。列表、雷达和路线仍可使用。', discover_action: '打开', centered: '已回到您的位置', simulated_position: '模拟位置（巴黎市中心）',
    }),
    es: Object.freeze({
      tagline: 'La ciudad que te habla', start: 'Explorar París', included_note: '5 historias variadas gratis. Una compra abre los 44 lugares. Sin publicidad, cuenta ni analítica. Tú decides siempre si activar la cámara.',
      privacy_summary: 'Privacidad', privacy_splash: 'La aplicación no guarda la ubicación ni la orientación. Las imágenes de la cámara nunca se graban ni se envían. Los descubrimientos, el idioma y la preferencia sin cámara permanecen en este dispositivo.', creation: 'Una creación de', directions_approx: 'Direcciones aproximadas',
      around: '🔭 Alrededor', map: '🗺️ Mapa', list: '📜 Lista', location_loading: 'Localizando…', precise_location: 'Ubicación precisa', approx_location: 'Ubicación aprox.', gps_denied: 'GPS denegado · simulado', gps_unavailable: 'GPS no disponible · simulado',
      explore_mode: 'Modo exploración', explore_text: 'Activa la cámara para la experiencia de RA. Las flechas de dirección están siempre disponibles.', enable_camera: 'Activar la cámara', without_camera: 'Continuar sin cámara', camera_privacy: '🔒 La imagen de la cámara nunca sale de tu teléfono: no se graba, guarda ni envía. Todo funciona también sin cámara.',
      show_plan: 'Mostrar el radar', show_camera: 'Mostrar la cámara', compass_unavailable: '🧭 Brújula no disponible — mostrar el radar', radar_north: 'Radar orientado al norte — el norte está arriba · Elige un lugar', radar_heading: 'El radar gira contigo — lo que tienes delante está arriba · Elige un lugar',
      around_me: '📍 A mi alrededor', key_dates: '📅 Fechas clave', buried_people: '★ Personalidades enterradas aquí', did_you_know: '¿Sabías que…?', place_site: '🌐 Sitio del lugar', official_page: 'Página oficial o institucional', access_mode: 'Cómo llegar', listen: '🔊 Escuchar', stop: '⏸️ Detener', back: '← Volver', go: '📍 Cómo llegar',
      fly_book: 'Reservar con F.L.Y Taxi', fly_yvelines: 'Para este destino de Yvelines (78) · Servicio del editor', fly_qr: 'Mostrar el QR de contacto de F.L.Y Taxi', fly_contact: 'Contacto F.L.Y Taxi', fly_scan: 'Escanéalo con otro teléfono para guardar directamente la ficha de contacto.', call: '☎ Llamar', add_contact: '＋ Añadir contacto', book_online: 'Reservar en línea ↗',
      privacy_title: 'Privacidad, sin cuenta ni publicidad', privacy_body: 'Paris Invisible no integra SDK publicitarios ni herramientas de analítica de audiencia. La cámara no graba ni envía imágenes, y la aplicación no guarda tu ubicación en un servidor.',
      external_title: 'Servicios externos', external_body: 'El mapa carga teselas de OpenStreetMap solo al abrirlo. Las rutas se abren en Google Maps. Cada ficha puede abrir una página oficial después de tocarla. F.L.Y Taxi solo aparece en «Cómo llegar» para destinos de Yvelines (78).',
      access_title: 'Acceso y compra', access_body: 'La descarga gratuita incluye 5 historias. Una compra única opcional de 4,99 € abre los 44 lugares. La gestionan App Store o Google Play. Sin suscripción ni publicidad.', privacy_link: 'Privacidad', sources_link: 'Fuentes y créditos', close: 'Cerrar',
      my_access: 'Versión completa', store_intro: 'La aplicación es gratuita con 5 historias y sin publicidad. Una compra desbloquea los 44 lugares.', base_title: '5 historias gratuitas', base_detail: 'Torre Eiffel, Notre-Dame, Amélie, la casa más pequeña de París y castillo de Montecristo.', paris_pack: 'París completo', paris_detail: 'Los 44 lugares, relatos, fechas, anécdotas y audios en una versión completa permanente.', discover: 'Desbloquear', connecting_store: 'Conectando con la tienda…', restore: 'Restaurar mi compra', store_note: 'Compra única · Sin suscripción · Pago gestionado por Apple o Google',
      acquired: '✓ Versión completa', acquired_extension: '✓ Versión completa comprada', wait: 'Espera…', unlock_price: 'Desbloquear todo', store_unavailable: 'Tienda temporalmente no disponible', native_only: 'Disponible en la aplicación iOS y Android', pending: 'La compra espera la validación de la tienda. El acceso seguirá bloqueado hasta su confirmación.',
      pack_paris_badge: 'Versión completa', pack_parks_badge: 'Versión completa', locked_paris: 'Disponible con la versión completa.', locked_parks: 'Disponible con la versión completa.', visited: '✓ descubierto', locked_label: 'contenido bloqueado; abre Versión completa', suggested: 'recomendado',
      all: 'Todo', parks_filter: '🎢 Parques', monuments_filter: '🏛️ Monumentos', cinema_filter: '🎬 Cine', history_filter: '👑 Historia', hidden_filter: '🕵️ Lugares insólitos', artists_filter: '🎨 Artistas',
      location_denied_toast: 'Ubicación denegada — se usa una posición simulada en el centro de París', camera_unsupported: 'La cámara no es compatible con este dispositivo', camera_unavailable: 'Cámara no disponible — puedes continuar sin ella', map_unavailable: 'Mapa no disponible — los demás modos siguen funcionando', audio_unavailable: 'El audio no está disponible en este dispositivo', audio_error: 'Error de audio', restored: 'Compras restauradas y verificadas', restore_failed: 'No se pueden restaurar las compras en este momento', purchase_pending: 'Compra pendiente de confirmación', unlocked: 'Pack desbloqueado', purchase_failed: 'Compra no completada — sin cargo dentro de la aplicación', content_failed: 'No se puede leer el contenido comprado: vuelve a abrir la aplicación con conexión',
      all_discovered: '🏅 ¡Has descubierto todas las historias accesibles!', you: 'Tú', map_fallback: '🗺️ Mapa no disponible. La lista, el radar y las rutas siguen funcionando.', discover_action: 'Abrir', centered: 'Centrado en tu ubicación', simulated_position: 'Posición simulada (centro de París)',
    }),
    ...EXTRA_I18N,
  });
  const normLang = value => {
    const lang = String(value || '').toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('en')) return 'en';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('it')) return 'it';
    if (lang.startsWith('ja')) return 'ja';
    return 'fr';
  };
  const t = (lang, key) => I18N[normLang(lang)]?.[key] ?? I18N.fr[key] ?? key;
  const progressLabel = (n, total, lang = 'fr') => {
    if (normLang(lang) === 'zh') return `已探索 ${n}/${total} 个故事`;
    if (normLang(lang) === 'en') return `${n}/${total} ${n === 1 ? 'story' : 'stories'} discovered`;
    if (normLang(lang) === 'es') return `${n}/${total} historia${n === 1 ? '' : 's'} descubierta${n === 1 ? '' : 's'}`;
    if (normLang(lang) === 'de') return `${n}/${total} ${n === 1 ? 'Geschichte' : 'Geschichten'} entdeckt`;
    if (normLang(lang) === 'it') return `${n}/${total} stori${n === 1 ? 'a scoperta' : 'e scoperte'}`;
    if (normLang(lang) === 'ja') return `${total}話中${n}話を発見`;
    return `${n}/${total} histoire${n === 1 ? '' : 's'} découverte${n === 1 ? '' : 's'}`;
  };

  // Seules les URL HTTPS sans identifiants intégrés peuvent quitter l'app.
  // Les domaines autorisés restent, eux, définis dans le registre éditorial.
  const isSafeHttpsUrl = value => {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  };

  // ---------- ACCÈS COMMERCIAUX ----------
  // Cinq histoires variées sont gratuites. Un achat définitif unique
  // déverrouille les deux packs chiffrés. L'application ne contient aucune publicité.
  const BASE_POI_IDS = Object.freeze([1, 2, 8, 19, 44]);
  const PRODUCT_IDS = Object.freeze({
    full: 'fr.fly.parisinvisible.paris_complet',
  });
  const normalizeEntitlements = value => {
    const full = Boolean(value && (value.full || (value.paris && value.parks)));
    return { full, paris: full, parks: full };
  };
  const contentPackForPoi = poi => {
    if (!poi || !Number.isInteger(Number(poi.id))) return 'unknown';
    if (BASE_POI_IDS.includes(Number(poi.id))) return 'base';
    return poi.pack === 'parks' || poi.cat === 'parc' ? 'parks' : 'paris';
  };
  const canAccessPoi = (poi, entitlements = {}) => {
    const pack = contentPackForPoi(poi);
    if (pack === 'base') return true;
    const access = normalizeEntitlements(entitlements);
    return pack === 'parks' ? access.parks : pack === 'paris' ? access.paris : false;
  };

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
  const MODE_LABELS = Object.freeze({
    fr: Object.freeze({ walking: 'À pied', transit: 'Transports', driving: 'Voiture', bicycling: 'Vélo' }),
    en: Object.freeze({ walking: 'Walk', transit: 'Transit', driving: 'Drive', bicycling: 'Bike' }),
    zh: Object.freeze({ walking: '步行', transit: '公交', driving: '驾车', bicycling: '骑行' }),
    es: Object.freeze({ walking: 'A pie', transit: 'Transporte público', driving: 'Coche', bicycling: 'Bicicleta' }),
    de: Object.freeze({ walking: 'Zu Fuß', transit: 'ÖPNV', driving: 'Auto', bicycling: 'Fahrrad' }),
    it: Object.freeze({ walking: 'A piedi', transit: 'Trasporto pubblico', driving: 'Auto', bicycling: 'Bicicletta' }),
    ja: Object.freeze({ walking: '徒歩', transit: '公共交通', driving: '車', bicycling: '自転車' }),
  });
  const modeLabel = (id, lang = 'fr') => (MODE_LABELS[normLang(lang)] || MODE_LABELS.fr)[id] || id;

  // URL Google Maps universelle (l'app Maps s'ouvre si installée, le web sinon).
  // Origine omise = position actuelle de l'utilisateur, gérée par Maps.
  const mapsDirUrl = (lat, lng, mode) => {
    if (!TRANSPORT_MODES.some(m => m.id === mode)) mode = 'walking';
    return 'https://www.google.com/maps/dir/?api=1&destination='
      + encodeURIComponent(lat + ',' + lng) + '&travelmode=' + mode;
  };

  // L'offre F.L.Y Taxi est réservée aux destinations des Yvelines (78).
  // Le code postal rend la règle automatique pour les futurs lieux du département.
  const isYvelinesDestination = poi => Boolean(
    poi && /\b78\d{3}\b/.test(String(poi.addr || ''))
  );

  // Libellé du compteur d'en-tête : jamais un "0" décourageant —
  // si rien à proximité (< 5 km), on donne la distance du plus proche.
  const nearbyLabel = (n, nearestDist, lang = 'fr') => {
    if (normLang(lang) === 'zh') return n > 0 ? `周围有 ${n} 个故事` : `最近地点距此 ${fmtDist(nearestDist)}`;
    if (normLang(lang) === 'en') return n > 0 ? `${n} ${n === 1 ? 'story' : 'stories'} nearby` : `nearest place ${fmtDist(nearestDist)} away`;
    if (normLang(lang) === 'es') return n > 0 ? `${n} historia${n === 1 ? '' : 's'} cerca` : `lugar más cercano a ${fmtDist(nearestDist)}`;
    if (normLang(lang) === 'de') return n > 0 ? `${n} ${n === 1 ? 'Geschichte' : 'Geschichten'} in der Nähe` : `nächster Ort in ${fmtDist(nearestDist)}`;
    if (normLang(lang) === 'it') return n > 0 ? `${n} stori${n === 1 ? 'a' : 'e'} nelle vicinanze` : `luogo più vicino a ${fmtDist(nearestDist)}`;
    if (normLang(lang) === 'ja') return n > 0 ? `周辺に${n}話` : `最寄りの場所まで${fmtDist(nearestDist)}`;
    if (n > 0) return n + ' histoire' + (n > 1 ? 's' : '') + ' autour';
    return 'la plus proche à ' + fmtDist(nearestDist);
  };

  // La caméra ne doit tourner que lorsqu'elle a été explicitement choisie et
  // que son flux est effectivement visible. Centraliser cette décision évite
  // les courses entre permission, changement d'onglet et ouverture du radar.
  const shouldRunCamera = ({
    cameraWanted = false,
    cameraDeclined = false,
    currentTab = '',
    documentHidden = true,
    radarOpen = true,
    modalOpen = false,
  } = {}) => Boolean(
    cameraWanted && !cameraDeclined && currentTab === 'ar' && !documentHidden && !radarOpen && !modalOpen
  );

  // ---------- RADAR (plan 2D) ----------
  // Projection "cap en haut" : ce qui est devant soi apparaît en haut du radar.
  // Échelle en racine carrée : le proche est dilaté, le lointain compressé.
  const radarPoint = (bearing, heading, dist, range, radius) => {
    const rel = (((bearing - heading) % 360) + 360) % 360;
    const a = rel * Math.PI / 180;
    const clamped = dist > range;
    const r = radius * Math.sqrt(Math.min(dist, range) / range);
    return { x: r * Math.sin(a), y: -r * Math.cos(a), clamped };
  };
  // Portée "ronde" 1-2-5 englobant d (10 800 m → 20 km)
  const niceRange = d => {
    if (d <= 0) return 1000;
    const p = Math.pow(10, Math.floor(Math.log10(d)));
    for (const m of [1, 2, 5, 10]) if (m * p >= d) return m * p;
  };

  const PICore = {
    haversine, bearingTo, normHeading,
    DIRS, DIRECTION_LABELS, dirIdx, bearingDir, ARROWS, arrowChar, ribbon, smoothStep,
    arProject, arProjectClamped,
    fmtDist, catLabel, esc, isSafeHttpsUrl, I18N, normLang, t, progressLabel,
    BASE_POI_IDS, PRODUCT_IDS, normalizeEntitlements, contentPackForPoi, canAccessPoi,
    addVisited, progressPct,
    walkMinutes, suggestedMode, TRANSPORT_MODES, modeLabel, mapsDirUrl, isYvelinesDestination,
    nearbyLabel, shouldRunCamera, radarPoint, niceRange,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PICore;
  root.PICore = PICore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
