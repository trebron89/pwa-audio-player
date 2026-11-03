'use strict';

const VERSION = '2.2.1';

/* =========================================================
   Ikony
   ========================================================= */
const st = d => `<svg class="st" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const fl = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  play: fl('<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.66.95l10.3-6.4a1.1 1.1 0 0 0 0-1.9L9.66 4.65A1.1 1.1 0 0 0 8 5.6z"/>'),
  pause: fl('<rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>'),
  prev: fl('<rect x="4" y="5" width="2.4" height="14" rx="1"/><path d="M20 6.3v11.4a1.1 1.1 0 0 1-1.7.92L9.5 13a1.2 1.2 0 0 1 0-2l8.8-5.62A1.1 1.1 0 0 1 20 6.3z"/>'),
  next: fl('<rect x="17.6" y="5" width="2.4" height="14" rx="1"/><path d="M4 6.3v11.4a1.1 1.1 0 0 0 1.7.92L14.5 13a1.2 1.2 0 0 0 0-2L5.7 5.38A1.1 1.1 0 0 0 4 6.3z"/>'),
  down: st('<path d="M6 9.5l6 6 6-6"/>'),
  back: st('<path d="M15 5l-7 7 7 7"/>'),
  more: fl('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>'),
  plus: st('<path d="M12 5v14M5 12h14"/>'),
  folder: st('<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  sort: st('<path d="M7 5v14M3.5 15.5L7 19l3.5-3.5M17 19V5M13.5 8.5L17 5l3.5 3.5"/>'),
  lib: st('<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  lists: st('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M15.5 14v6.5l5-3.25z" fill="currentColor" stroke="none"/>'),
  settings: st('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  up: st('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  dn: st('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  x: st('<path d="M6 6l12 12M18 6L6 18"/>'),
  none: st('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
  note: st('<path d="M10 17.5V5.2l9-2.2v3.2l-9 2.2"/><circle cx="7" cy="17.5" r="3"/>'),
  moon: st('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  queue: st('<path d="M4 6h16M4 11h16M4 16h8"/><path d="M16 13.5v7l5-3.5z" fill="currentColor" stroke="none"/>'),
};

/* =========================================================
   IndexedDB: utwory, pliki audio, playlisty, okładki, stan
   ========================================================= */
const DB_NAME = 'odtwarzacz'; // nazwa z wersji 1 – dzięki temu dane zostają po aktualizacji
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const stores = [['tracks', { keyPath: 'id' }], ['blobs'], ['playlists', { keyPath: 'id' }], ['kv'], ['art']];
        for (const [name, opts] of stores) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let result;
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transakcja przerwana'));
  });
}

const idb = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  getAll: store => tx(store, 'readonly', s => s.getAll()),
  put: (store, value, key) => tx(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
};

async function saveTrack(meta, blob, art) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'blobs', 'art'], 'readwrite');
    t.objectStore('blobs').put(blob, meta.id);
    if (art) t.objectStore('art').put(art, 'tr:' + meta.id);
    t.objectStore('tracks').put(meta);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transakcja przerwana'));
  });
}

/* =========================================================
   Stan
   ========================================================= */
const state = {
  tracks: [],
  trackMap: new Map(),
  playlists: [],
  positions: {},            // id utworu -> sekundy
  queue: [],                // id utworów w bieżącej kolejce
  index: -1,
  source: null,             // { type: 'folder', id, name } | { type: 'playlist', id } | { type: 'library' }
  view: 'library',          // library | folder | playlists | playlist | settings
  openPlaylistId: null,
  openFolder: null,         // klucz folderu w widoku „folder”
  editing: false,
  settings: { rate: 1, librarySort: 'name-asc', numberMode: 'version' },
};

const $ = s => document.querySelector(s);
const main = $('#main');
const audio = $('#audio');
const seek = $('#seek');
const dock = $('#dock');
const full = $('#full');
const sheetEl = $('#sheet');
const sheetBody = $('#sheetBody');

let currentUrl = null;
let loadedId = null;
let pendingSeek = 0;
let prefetched = null;
let seeking = false;
let lastSave = 0;
let lastPosState = 0;
let lastPlayingIcon;
let shownArtSig = null;
let coverTarget = null;
let onSheetClose = null;

/* =========================================================
   Pomocnicze
   ========================================================= */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function fmtLong(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} godz. ${m} min` : `${Math.max(1, m)} min`;
}
const fmtSize = b => (b >= 1e9 ? (b / 1e9).toFixed(2).replace('.', ',') + ' GB' : (b / 1e6).toFixed(1).replace('.', ',') + ' MB');
const fmtRate = r => String(r).replace('.', ',') + '×';
const stripExt = n => String(n).replace(/\.[^.]+$/, '');
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const abs = p => new URL(p, location.href).href;

const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4|aac|wav|aif|aiff|caf|flac|alac|opus|ogg|oga)$/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i;
const COVER_NAME = /(cover|folder|front|album|okładka|okladka|artwork)/i;
const isAudio = f => (f.type || '').startsWith('audio/') || AUDIO_EXT.test(f.name);
const isImage = f => (f.type || '').startsWith('image/') || IMG_EXT.test(f.name);

function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({
    mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', alac: 'audio/mp4',
    aac: 'audio/aac', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf',
    flac: 'audio/flac', opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg',
  })[ext] || 'application/octet-stream';
}


const currentId = () => (state.index >= 0 ? state.queue[state.index] : undefined);
const titleOf = id => (id && state.trackMap.get(id)?.title) || (id ? stripExt(id.split('|')[0]) : '?');
const loaded = () => !!currentUrl && loadedId === currentId() && audio.src === currentUrl;
const getPl = id => state.playlists.find(p => p.id === id);
const openPl = () => getPl(state.openPlaylistId);
const existing = p => p.trackIds.filter(id => state.trackMap.has(id));

function sourceName() {
  if (state.source?.type === 'playlist') return getPl(state.source.id)?.name || 'Playlista';
  if (state.source?.type === 'folder') return state.source.name || 'Biblioteka';
  return 'Biblioteka';
}

let statusTimer = null;
function setStatus(msg, sticky) {
  $('#status').textContent = msg || '';
  clearTimeout(statusTimer);
  if (msg && !sticky) statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 4000);
}

const persistPositions = () => idb.put('kv', state.positions, 'positions').catch(() => {});
const saveSettings = () => idb.put('kv', state.settings, 'settings').catch(() => {});
const saveLast = () => idb.put('kv', { queue: state.queue, index: state.index, source: state.source }, 'last').catch(() => {});

/* =========================================================
   Sortowanie
   Liczba na końcu nazwy (np. „Rozdział 1.10”) jest porównywana
   jako numer wersji (1.9 < 1.10) albo liczba dziesiętna (1.10 < 1.9).
   ========================================================= */
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
const TRAIL = /^(.*?)(\d+(?:[.,]\d+)*)[\s)\]\-_.]*$/;

function compareNumbers(a, b, mode) {
  const sa = a.split(/[.,]/), sb = b.split(/[.,]/);
  if (mode === 'decimal' && sa.length <= 2 && sb.length <= 2) {
    const d = parseFloat(a.replace(',', '.')) - parseFloat(b.replace(',', '.'));
    if (d) return d < 0 ? -1 : 1;
  }
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] === undefined) return -1;
    if (sb[i] === undefined) return 1;
    const d = Number(sa[i]) - Number(sb[i]);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function compareNames(a, b) {
  a = String(a || '').trim();
  b = String(b || '').trim();
  const ma = a.match(TRAIL), mb = b.match(TRAIL);
  if (ma && mb) {
    const c = collator.compare(ma[1].trim(), mb[1].trim());
    if (c) return c;
    const n = compareNumbers(ma[2], mb[2], state.settings.numberMode);
    if (n) return n;
  }
  return collator.compare(a, b);
}

const byFile = (a, b) => compareNames(stripExt(a.name), stripExt(b.name));
const SORTS = {
  'name-asc': byFile,
  'name-desc': (a, b) => byFile(b, a),
  'title-asc': (a, b) => compareNames(a.title, b.title) || byFile(a, b),
  'title-desc': (a, b) => compareNames(b.title, a.title) || byFile(b, a),
  'added-desc': (a, b) => (b.added - a.added) || byFile(a, b),
};
const SORT_LABELS = {
  'name-asc': 'Nazwa pliku A–Z',
  'name-desc': 'Nazwa pliku Z–A',
  'title-asc': 'Tytuł (tag) A–Z',
  'title-desc': 'Tytuł (tag) Z–A',
  'added-desc': 'Ostatnio dodane',
};
const sortedTracks = () => state.tracks.slice().sort(SORTS[state.settings.librarySort] || SORTS['name-asc']);
const sortPl = () => state.playlists.sort((a, b) => compareNames(a.name, b.name));

/* =========================================================
   Foldery biblioteki
   Klucz: „d:<ścieżka katalogu>” (zapamiętana przy imporcie folderu),
   „p:<id playlisty>” dla utworów sprzed wersji 2.1 (bez pola folder), które
   należą do dokładnie jednej playlisty, oraz „” dla pozostałych („Inne pliki”,
   m.in. pojedyncze pliki dodane przyciskiem „Pliki”).
   ========================================================= */
const dirOf = f => (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');

function folders() {
  const plOf = new Map();
  for (const p of state.playlists) {
    for (const id of new Set(p.trackIds)) {
      if (!plOf.has(id)) plOf.set(id, []);
      plOf.get(id).push(p);
    }
  }
  const groups = new Map();
  for (const t of state.tracks) {
    let key = '', name = 'Inne pliki';
    if (t.folder) {
      key = 'd:' + t.folder;
      name = t.folder.split('/').pop();
    } else if (t.folder === undefined) {
      // Tylko utwory sprzed wersji 2.1 (bez zapisanego folderu): folder = jedyna playlista.
      // Pliki wczytane przyciskiem „Pliki” mają folder '' i zawsze trafiają do „Inne pliki”.
      const ps = plOf.get(t.id);
      if (ps && ps.length === 1) { key = 'p:' + ps[0].id; name = ps[0].name; }
    }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, tracks: [] }));
    g.tracks.push(t);
  }
  const sort = SORTS[state.settings.librarySort] || SORTS['name-asc'];
  const list = [...groups.values()];
  list.forEach(g => g.tracks.sort(sort));
  return list.sort((a, b) => (a.key === '') - (b.key === '') || compareNames(a.name, b.name));
}
const getFolder = key => folders().find(g => g.key === key);
const folderOfTrack = id => folders().find(g => g.tracks.some(t => t.id === id));

function playFolder(g, id) {
  if (!g) return;
  const ids = g.tracks.map(t => t.id);
  playFrom(ids, id ? Math.max(0, ids.indexOf(id)) : 0, { type: 'folder', id: g.key, name: g.name });
}

/* =========================================================
   Okładki
   Klucze w magazynie „art”: „tr:<id utworu>” (z tagów), „pl:<id playlisty>”.
   ========================================================= */
const artUrls = new Map();
const artDataUrls = new Map();

async function artUrl(key) {
  if (artUrls.has(key)) return artUrls.get(key);
  const blob = await idb.get('art', key).catch(() => null);
  const url = blob ? URL.createObjectURL(blob) : null;
  artUrls.set(key, url);
  return url;
}

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
async function artDataUrl(key) {
  if (artDataUrls.has(key)) return artDataUrls.get(key);
  const blob = await idb.get('art', key).catch(() => null);
  const d = blob ? await blobToDataUrl(blob) : null;
  artDataUrls.set(key, d);
  return d;
}

function forgetArt(key) {
  const u = artUrls.get(key);
  if (u) URL.revokeObjectURL(u);
  artUrls.delete(key);
  artDataUrls.delete(key);
}

const trackArtKey = id => (state.trackMap.get(id)?.hasArt ? 'tr:' + id : null);
function playlistArtKey(p) {
  if (p.hasCover) return 'pl:' + p.id;
  const withArt = p.trackIds.find(id => state.trackMap.get(id)?.hasArt);
  return withArt ? 'tr:' + withArt : null;
}
function nowArtKey() {
  const id = currentId();
  if (!id) return null;
  if (state.source?.type === 'playlist') {
    const p = getPl(state.source.id);
    if (p && p.hasCover) return 'pl:' + p.id;
  }
  return trackArtKey(id);
}

function artHtml(key, cls = '', glyph = 'note') {
  return `<div class="art ${cls}"${key ? ` data-art="${esc(key)}"` : ''}>${ICON[glyph] || ''}</div>`;
}
const trackArt = (t, cls = 'art-md') => artHtml(t.hasArt ? 'tr:' + t.id : null, cls);

const artObservers = new Map(); // kontener przewijania -> IntersectionObserver
async function loadArtEl(el) {
  const url = await artUrl(el.dataset.art);
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('loaded');
  }
}
function hydrateArt(root, scroller = main) {
  const els = root.querySelectorAll('[data-art]:not(.loaded)');
  if (!('IntersectionObserver' in window)) { els.forEach(loadArtEl); return; }
  let obs = artObservers.get(scroller);
  if (!obs) {
    obs = new IntersectionObserver((entries, o) => {
      for (const e of entries) {
        if (e.isIntersecting) { o.unobserve(e.target); loadArtEl(e.target); }
      }
    }, { root: scroller, rootMargin: '400px' });
    artObservers.set(scroller, obs);
  }
  els.forEach(el => obs.observe(el));
}

/* Zmniejsza obraz do kwadratu (środek) i zapisuje jako JPEG. */
async function resizeImage(blob, max = 600) {
  let src, w, h, bitmap = null, url = null;
  try {
    bitmap = await createImageBitmap(blob);
    src = bitmap; w = bitmap.width; h = bitmap.height;
  } catch {
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return null; }
    src = img; w = img.naturalWidth; h = img.naturalHeight;
  }
  try {
    if (!w || !h) return null;
    const side = Math.min(w, h);
    const out = Math.min(max, side);
    const c = document.createElement('canvas');
    c.width = c.height = out;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  } finally {
    if (bitmap && bitmap.close) bitmap.close();
    if (url) URL.revokeObjectURL(url);
  }
}

/* =========================================================
   Dziennik diagnostyczny
   ========================================================= */
let logLines = [];
try { logLines = JSON.parse(localStorage.getItem('log') || '[]'); } catch { logLines = []; }

function log(msg) {
  const t = new Date().toLocaleTimeString('pl-PL');
  const where = document.visibilityState === 'visible' ? 'ekran' : 'tło';
  logLines.unshift(`${t} [${where}] ${msg}`);
  if (logLines.length > 80) logLines.length = 80;
  try { localStorage.setItem('log', JSON.stringify(logLines)); } catch { /* brak miejsca */ }
  renderLog();
}
function renderLog() {
  const el = document.getElementById('log');
  if (el) el.textContent = logLines.length ? logLines.join('\n') : '(pusto)';
}

/* =========================================================
   Odblokowanie audio na iOS (pierwsze dotknięcie odtwarza ułamek ciszy)
   ========================================================= */
let silentUrl = null;
let unlocked = false;

function makeSilentWav() {
  const rate = 8000, n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const isSilent = () => !!silentUrl && audio.src === silentUrl;

function setupUnlock() {
  const handler = () => {
    if (unlocked) return;
    unlocked = true;
    if (currentUrl && audio.src === currentUrl) return;
    silentUrl = silentUrl || makeSilentWav();
    audio.src = silentUrl;
    const p = audio.play();
    if (p) {
      p.then(() => { if (isSilent()) audio.pause(); })
        .catch(e => { if (e.name === 'NotAllowedError') unlocked = false; });
    }
  };
  document.addEventListener('touchend', handler, true);
  document.addEventListener('click', handler, true);
}

/* =========================================================
   Import plików i folderów
   ========================================================= */
function folderNameOf(files) {
  const dirs = files.map(f => (f.webkitRelativePath || '').split('/').slice(0, -1)).filter(d => d.length);
  if (!dirs.length) return '';
  let common = dirs[0];
  for (const d of dirs) {
    let k = 0;
    while (k < common.length && k < d.length && common[k] === d[k]) k++;
    common = common.slice(0, k);
  }
  return common.length ? common[common.length - 1] : dirs[0][0];
}

async function importSelection(fileList, fromFolder) {
  const files = [...fileList].filter(f => !f.name.startsWith('.'));
  const audios = files.filter(isAudio).sort((a, b) => compareNames(stripExt(a.name), stripExt(b.name)));
  const images = files.filter(f => !isAudio(f) && isImage(f));
  if (!audios.length) {
    alert(images.length ? 'W wybranych plikach nie ma plików audio.' : 'Nie wybrano plików audio.');
    return;
  }
  await requestPersist(false);

  const ids = [];
  const artCache = new Map();
  let added = 0, existed = 0, failed = 0, artTrack = null;

  for (let i = 0; i < audios.length; i++) {
    const f = audios[i];
    setStatus(`Wczytywanie ${i + 1}/${audios.length}…`, true);
    const id = `${f.name}|${f.size}`;
    const known = state.trackMap.get(id);
    const dir = dirOf(f);
    if (known) {
      ids.push(id);
      existed++;
      if (dir && !known.folder) {
        known.folder = dir;
        await idb.put('tracks', known).catch(() => {});
      }
      if (known.hasArt && !artTrack) artTrack = id;
      continue;
    }
    try {
      const buf = await f.arrayBuffer();
      const type = f.type || guessType(f.name);
      const blob = new Blob([buf], { type });
      const tags = await Tags.read(blob);

      let art = null;
      if (tags.picture) {
        const pic = tags.picture.data;
        const sig = pic.length + ':' + pic[0] + pic[pic.length >> 1] + pic[pic.length - 1];
        if (artCache.has(sig)) art = artCache.get(sig);
        else {
          art = await resizeImage(new Blob([pic], { type: tags.picture.mime }), 600).catch(() => null);
          artCache.set(sig, art);
        }
      }

      const meta = {
        id, name: f.name, type, size: f.size, duration: 0, added: Date.now() + i,
        title: tags.title || stripExt(f.name), tagTitle: tags.title || '',
        artist: tags.artist || '', album: tags.album || '', trackNo: parseInt(tags.track, 10) || 0,
        hasArt: !!art, folder: dir,
      };
      await saveTrack(meta, blob, art);
      state.tracks.push(meta);
      state.trackMap.set(id, meta);
      ids.push(id);
      added++;
      if (art && !artTrack) artTrack = id;
    } catch (e) {
      failed++;
      log(`błąd importu ${f.name}: ${e && e.name}`);
      if (e && e.name === 'QuotaExceededError') {
        alert('Brak miejsca w pamięci aplikacji. Usuń część utworów lub zwolnij miejsce na iPhonie.');
        break;
      }
    }
  }

  const parts = [`Dodano ${added}`];
  if (existed) parts.push(`już były ${existed}`);
  if (failed) parts.push(`błędy ${failed}`);
  setStatus(parts.join(', '));
  render();

  if (ids.length && (fromFolder || ids.length > 1 || images.length)) {
    const albums = new Set(ids.map(id => state.trackMap.get(id)?.album).filter(Boolean));
    const name = folderNameOf(files) || (albums.size === 1 ? [...albums][0] : '') || 'Nowa playlista';
    offerPlaylist({ ids, name, images, artTrack });
  }
}

function offerPlaylist({ ids, name, images, artTrack }) {
  const opts = images
    .slice()
    .sort((a, b) => (COVER_NAME.test(b.name) - COVER_NAME.test(a.name)) || compareNames(a.name, b.name))
    .map(f => ({ kind: 'img', file: f, url: URL.createObjectURL(f), label: f.name }));
  if (artTrack) opts.push({ kind: 'tag', track: artTrack, label: 'Z tagów' });
  opts.push({ kind: 'none', label: 'Bez okładki' });
  let sel = 0;

  const optHtml = (o, i) => {
    let pic;
    if (o.kind === 'img') pic = `<img src="${o.url}" alt="">`;
    else if (o.kind === 'tag') pic = artHtml('tr:' + o.track);
    else pic = `<div class="art none">${ICON.none}</div>`;
    return `<button type="button" class="cover-opt${i === sel ? ' sel' : ''}" data-i="${i}">${pic}<span class="lbl">${esc(o.label)}</span></button>`;
  };

  const total = ids.reduce((a, id) => a + (state.trackMap.get(id)?.size || 0), 0);
  sheetBody.innerHTML = `
    <h3>Zapisać jako playlistę?</h3>
    <p class="sheet-note">${ids.length} utw. · ${fmtSize(total)}${images.length ? ` · obrazy: ${images.length}` : ''}</p>
    <label class="field"><span>Nazwa</span><input id="plName" type="text" value="${esc(name)}" autocomplete="off" enterkeyhint="done"></label>
    <div class="field"><span>Okładka</span><div class="covers">${opts.map(optHtml).join('')}</div></div>
    <button class="sheet-btn primary" data-ok>Zapisz playlistę</button>
    <button class="sheet-btn cancel" data-cancel>Tylko do biblioteki</button>`;
  hydrateArt(sheetBody, sheetEl);

  onSheetClose = () => opts.forEach(o => o.url && URL.revokeObjectURL(o.url));
  sheetBody.onclick = async e => {
    const opt = e.target.closest('.cover-opt');
    if (opt) {
      sel = +opt.dataset.i;
      sheetBody.querySelectorAll('.cover-opt').forEach(b => b.classList.toggle('sel', +b.dataset.i === sel));
      return;
    }
    if (e.target.closest('[data-cancel]')) { sheetEl.close(); return; }
    const ok = e.target.closest('[data-ok]');
    if (!ok) return;
    ok.disabled = true;
    const plName = $('#plName').value.trim() || 'Nowa playlista';
    const o = opts[sel];
    let cover = null;
    if (o.kind === 'img') {
      cover = await resizeImage(o.file, 600).catch(() => null);
      if (!cover) alert('Nie udało się odczytać tego obrazu. Playlista zostanie zapisana bez okładki.');
    } else if (o.kind === 'tag') {
      cover = await idb.get('art', 'tr:' + o.track).catch(() => null);
    }
    const p = await createPlaylist(plName, ids, cover);
    sheetEl.close();
    state.openPlaylistId = p.id;
    state.view = 'playlist';
    state.editing = false;
    render();
    main.scrollTop = 0;
    setStatus('Zapisano playlistę');
  };
  sheetEl.showModal();
}

async function requestPersist(manual) {
  if (!navigator.storage || !navigator.storage.persist) {
    if (manual) alert('Ta przeglądarka nie obsługuje trwałej pamięci.');
    return false;
  }
  try {
    if (await navigator.storage.persisted()) return true;
    const ok = await navigator.storage.persist();
    if (manual) alert(ok ? 'Przyznano trwałą pamięć.' : 'iOS nie przyznał trwałej pamięci. Zwykle pomaga dodanie aplikacji do ekranu początkowego i regularne korzystanie z niej.');
    return ok;
  } catch {
    return false;
  }
}

/* =========================================================
   Odtwarzanie
   ========================================================= */
function clearPrefetch() {
  if (prefetched) { URL.revokeObjectURL(prefetched.url); prefetched = null; }
}

async function prefetchNext() {
  const ni = state.index + 1;
  if (ni >= state.queue.length) return;
  const id = state.queue[ni];
  const key = trackArtKey(id);
  if (key) artDataUrl(key);
  if (prefetched && prefetched.id === id) return;
  clearPrefetch();
  let blob = null;
  try { blob = await idb.get('blobs', id); } catch { return; }
  if (!blob || state.queue[state.index + 1] !== id || prefetched) return;
  prefetched = { id, url: URL.createObjectURL(blob) };
}

async function loadTrack(i, autoplay) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const id = state.queue[i];
  let url;

  if (prefetched && prefetched.id === id) {
    // Bez czekania na bazę – ważne przy przejściu do następnego utworu w tle.
    url = prefetched.url;
    prefetched = null;
  } else {
    clearPrefetch();
    let blob = null;
    try { blob = await idb.get('blobs', id); } catch (e) { log('błąd odczytu: ' + e.name); }
    if (state.queue[state.index] !== id) return;
    if (!blob) {
      log('brak pliku: ' + titleOf(id));
      setStatus('Brak pliku, pomijam');
      if (autoplay && i + 1 < state.queue.length) return loadTrack(i + 1, true);
      return;
    }
    url = URL.createObjectURL(blob);
  }

  if (currentUrl && currentUrl !== url) URL.revokeObjectURL(currentUrl);
  currentUrl = url;
  loadedId = id;
  pendingSeek = state.positions[id] || 0;
  audio.src = url;
  registerMediaActions();
  audio.defaultPlaybackRate = state.settings.rate;
  audio.playbackRate = state.settings.rate;

  log('utwór: ' + titleOf(id));
  updateMediaSession();
  updatePlayerUI();
  updatePlayerArt();
  markCurrent();
  saveLast();

  if (autoplay) {
    try {
      await audio.play();
    } catch (e) {
      log('play() odrzucone: ' + e.name);
      setStatus('Dotknij ▶, aby odtworzyć');
    }
  }
}

function sameSource(src) {
  const cur = state.source;
  return !!cur && cur.type === src.type && cur.id === src.id;
}

function playFrom(ids, i, source) {
  if (!ids.length || i < 0) return;
  if (ids[i] === loadedId && i === state.index && loaded() && sameSource(source)) {
    if (audio.paused) audio.play().catch(e => log('play() odrzucone: ' + e.name));
    openFull();
    return;
  }
  clearPrefetch();
  state.queue = ids.slice();
  state.source = source;
  loadTrack(i, true);
}

function playPause(forcePlay) {
  if (state.index < 0 || !state.queue.length) {
    if (state.tracks.length) playFolder(folders()[0]);
    return;
  }
  if (!loaded()) { loadTrack(state.index, true); return; }
  if (audio.paused || forcePlay) audio.play().catch(e => log('play() odrzucone: ' + e.name));
  else audio.pause();
}

function next() {
  if (state.index + 1 < state.queue.length) loadTrack(state.index + 1, true);
}

function prev() {
  if (loaded() && audio.currentTime > 5) { audio.currentTime = 0; return; }
  if (state.index > 0) loadTrack(state.index - 1, true);
  else if (loaded()) audio.currentTime = 0;
}

function savePosition() {
  const id = currentId();
  if (!id || !loaded() || !isFinite(audio.currentTime)) return;
  state.positions[id] = Math.floor(audio.currentTime);
  persistPositions();
  saveLast();
}

audio.addEventListener('loadedmetadata', () => {
  if (isSilent()) return;
  const meta = state.trackMap.get(loadedId);
  if (meta && isFinite(audio.duration) && Math.abs((meta.duration || 0) - audio.duration) > 1) {
    meta.duration = audio.duration;
    idb.put('tracks', meta).catch(() => {});
  }
  if (pendingSeek > 3 && (!isFinite(audio.duration) || pendingSeek < audio.duration - 3)) {
    audio.currentTime = pendingSeek;
  }
  pendingSeek = 0;
  audio.playbackRate = state.settings.rate;
  updatePlayerUI();
  updatePositionState();
});

audio.addEventListener('play', () => {
  if (isSilent()) return;
  setPlaybackState('playing');
  updatePlayerUI();
});

audio.addEventListener('playing', () => {
  if (isSilent()) return;
  log('gra: ' + titleOf(currentId()));
  registerMediaActions();
  prefetchNext();
  updatePositionState();
});

audio.addEventListener('pause', () => {
  if (isSilent()) return;
  setPlaybackState('paused');
  savePosition();
  updatePlayerUI();
  if (!audio.ended) log('pauza');
});

audio.addEventListener('ended', () => {
  if (isSilent()) return;
  const id = currentId();
  if (id) { state.positions[id] = 0; persistPositions(); }
  log('koniec: ' + titleOf(id));
  if (sleep && sleep.endOfTrack) {
    stopForSleep();
    updatePlayerUI();
    return;
  }
  if (state.index + 1 < state.queue.length) {
    loadTrack(state.index + 1, true);
  } else {
    log('koniec kolejki');
    updatePlayerUI();
  }
});

audio.addEventListener('timeupdate', () => {
  if (isSilent()) return;
  updatePlayerUI();
  const now = Date.now();
  if (now - lastSave > 5000) { lastSave = now; savePosition(); }
  if (now - lastPosState > 5000) { lastPosState = now; updatePositionState(); }
  checkSleep();
});

audio.addEventListener('seeked', () => {
  if (isSilent()) return;
  savePosition();
  updatePositionState();
});

audio.addEventListener('error', () => {
  if (isSilent() || !currentUrl) return;
  const code = audio.error && audio.error.code;
  log(`błąd odtwarzania (kod ${code}): ${titleOf(currentId())}`);
  setStatus(code === 4 ? 'Safari nie obsługuje tego formatu' : 'Błąd odtwarzania');
  if (code === 4 && state.index + 1 < state.queue.length) setTimeout(next, 800);
});

document.addEventListener('visibilitychange', () => {
  log(document.visibilityState === 'hidden' ? 'aplikacja przeszła w tło' : 'aplikacja wróciła na ekran');
  if (document.visibilityState === 'hidden') savePosition();
});
window.addEventListener('pagehide', savePosition);

/* =========================================================
   Ekran blokady (Media Session): poprzedni / play-pauza / następny
   iOS pokazuje przyciski ±10 s, gdy nie widzi obsługi poprzedniego /
   następnego utworu – np. po zmianie źródła <audio>. Dlatego obsługa
   jest rejestrowana ponownie przy każdym utworze i przy starcie odtwarzania.
   Poprzedni / następny nigdy nie są zerowane (nawet na końcu kolejki).
   ========================================================= */
const mediaActions = [
  ['play', () => playPause(true)],
  ['pause', () => audio.pause()],
  ['previoustrack', () => prev()],
  ['nexttrack', () => next()],
  ['seekto', d => { if (loaded() && d.seekTime != null) audio.currentTime = d.seekTime; }],
  ['seekbackward', null],
  ['seekforward', null],
];

function registerMediaActions() {
  if (!('mediaSession' in navigator)) return [];
  const ok = [];
  for (const [action, fn] of mediaActions) {
    try { navigator.mediaSession.setActionHandler(action, fn); if (fn) ok.push(action); } catch { /* nieobsługiwane */ }
  }
  return ok;
}

function setupMediaSession() {
  const ok = registerMediaActions();
  log('ekran blokady: ' + (ok.length ? ok.join(', ') : 'brak Media Session'));
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const id = currentId();
  if (!id) return;
  const t = state.trackMap.get(id);
  const base = { title: titleOf(id), artist: (t && t.artist) || sourceName(), album: (t && t.album) || sourceName() };
  const setMeta = artwork => {
    try { navigator.mediaSession.metadata = new MediaMetadata({ ...base, artwork }); } catch { /* ignoruj */ }
  };
  const key = nowArtKey();
  const cached = key && artDataUrls.get(key);
  if (cached) { setMeta([{ src: cached, sizes: '600x600', type: 'image/jpeg' }]); return; }
  setMeta([{ src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }]);
  if (key) {
    artDataUrl(key).then(d => {
      if (d && currentId() === id && nowArtKey() === key) setMeta([{ src: d, sizes: '600x600', type: 'image/jpeg' }]);
    });
  }
}

function setPlaybackState(s) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s; } catch { /* ignoruj */ }
}

function updatePositionState() {
  const ms = navigator.mediaSession;
  if (!ms || !ms.setPositionState || !loaded()) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try {
    ms.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) });
  } catch { /* ignoruj */ }
}

/* =========================================================
   Odtwarzacz: mini i pełny ekran
   ========================================================= */
function updatePlayerUI() {
  const id = currentId();
  const t = id && state.trackMap.get(id);
  dock.classList.toggle('no-track', !t);
  const title = t ? t.title : 'Nic nie gra';
  $('#miniTitle').textContent = title;
  $('#miniSub').textContent = t ? (t.artist || sourceName()) : '';
  $('#fullTitle').textContent = title;
  $('#fullSub').textContent = t ? ([t.artist, t.album].filter(Boolean).join(' — ') || sourceName()) : '';
  $('#fullSource').textContent = sourceName();
  $('#fullPos').textContent = t ? `${state.index + 1} z ${state.queue.length}` : '';
  $('#fullRate').textContent = fmtRate(state.settings.rate);

  const isLoaded = loaded();
  const dur = isLoaded && isFinite(audio.duration) ? audio.duration : (t && t.duration) || 0;
  const cur = isLoaded ? audio.currentTime : (id && state.positions[id]) || 0;
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  $('#miniBar').style.width = pct + '%';
  if (!seeking) {
    seek.max = String(Math.max(1, Math.floor(dur)));
    seek.value = String(Math.floor(cur));
    seek.style.setProperty('--p', pct + '%');
    $('#tCur').textContent = fmt(cur);
    $('#tLeft').textContent = '−' + fmt(Math.max(0, dur - cur));
  }

  const playing = isLoaded && !audio.paused;
  if (playing !== lastPlayingIcon) {
    lastPlayingIcon = playing;
    $('#btnPlay').innerHTML = playing ? ICON.pause : ICON.play;
    $('#miniPlay').innerHTML = playing ? ICON.pause : ICON.play;
    document.body.classList.toggle('is-playing', playing);
  }
  const atEnd = !t || state.index + 1 >= state.queue.length;
  $('#btnPrev').disabled = !t;
  $('#btnNext').disabled = atEnd;
  $('#miniNext').disabled = atEnd;
  $('#fullQueue').disabled = !t;
}

async function updatePlayerArt() {
  const id = currentId();
  const key = nowArtKey();
  const sig = key + '|' + id;
  if (sig === shownArtSig) return;
  shownArtSig = sig;
  const url = key ? await artUrl(key) : null;
  if (shownArtSig !== sig) return;
  for (const el of [$('#miniArt'), $('#fullArt')]) {
    el.style.backgroundImage = url ? `url("${url}")` : '';
    el.classList.toggle('loaded', !!url);
  }
  $('#fullBg').style.backgroundImage = url ? `url("${url}")` : '';
}

function openFull() {
  if (!currentId()) return;
  full.classList.add('open');
  full.setAttribute('aria-hidden', 'false');
  document.body.classList.add('full-open');
}
function closeFull() {
  toggleQueue(false);
  full.classList.remove('open');
  full.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('full-open');
}

seek.addEventListener('input', () => {
  seeking = true;
  const v = +seek.value, max = +seek.max || 1;
  seek.style.setProperty('--p', (v / max) * 100 + '%');
  $('#tCur').textContent = fmt(v);
  $('#tLeft').textContent = '−' + fmt(Math.max(0, max - v));
});
seek.addEventListener('change', () => {
  seeking = false;
  const id = currentId();
  if (loaded()) audio.currentTime = +seek.value;
  else if (id) { state.positions[id] = +seek.value; persistPositions(); }
  updatePlayerUI();
});

const RATES = [1, 1.25, 1.5, 2, 0.75];
$('#fullRate').addEventListener('click', () => {
  const i = RATES.indexOf(state.settings.rate);
  state.settings.rate = RATES[(i + 1) % RATES.length];
  audio.defaultPlaybackRate = state.settings.rate;
  audio.playbackRate = state.settings.rate;
  saveSettings();
  updatePlayerUI();
  updatePositionState();
});
$('#btnPlay').addEventListener('click', () => playPause());
$('#miniPlay').addEventListener('click', () => playPause());
$('#btnPrev').addEventListener('click', prev);
$('#btnNext').addEventListener('click', next);
$('#miniNext').addEventListener('click', next);
$('#miniOpen').addEventListener('click', openFull);
$('#fullClose').addEventListener('click', closeFull);
$('#fullQueue').addEventListener('click', () => toggleQueue());

/* Panel „Teraz odtwarzane” – bieżąca kolejka (folder lub playlista) */
let queueOpen = false;
let queueSig = null;
const queueList = $('#queueList');

function toggleQueue(force) {
  queueOpen = force === undefined ? !queueOpen : !!force;
  full.classList.toggle('queue-open', queueOpen);
  $('#fullQueue').classList.toggle('on', queueOpen);
  $('#fullQueue').setAttribute('aria-pressed', String(queueOpen));
  if (queueOpen) renderQueue(true);
}

function renderQueue(center) {
  if (!queueOpen) return;
  $('#queueSrc').textContent = sourceName();
  const sig = state.queue.join('\n');
  if (sig !== queueSig) {
    queueSig = sig;
    queueList.innerHTML = state.queue.map((id, i) => {
      const t = state.trackMap.get(id);
      const meta = t ? [t.artist, t.duration ? fmt(t.duration) : null].filter(Boolean).join(' · ') : '';
      return `<li class="item" data-qi="${i}">
        <button class="main" data-qi="${i}"><span class="num">${i + 1}</span>${eqHtml}${t ? trackArt(t, 'art-sm') : artHtml(null, 'art-sm')}
          <span class="txt"><span class="title">${esc(titleOf(id))}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</span>
        </button></li>`;
    }).join('');
    artObservers.get(queueList)?.disconnect();
    hydrateArt(queueList, queueList);
    center = true;
  }
  let cur = null;
  queueList.querySelectorAll('.item').forEach(el => {
    const on = +el.dataset.qi === state.index;
    el.classList.toggle('current', on);
    if (on) cur = el;
  });
  if (!cur) return;
  const top = cur.offsetTop, h = cur.offsetHeight, view = queueList.clientHeight;
  if (center) queueList.scrollTop = top - (view - h) / 2;
  else if (top < queueList.scrollTop || top + h > queueList.scrollTop + view) queueList.scrollTop = top - (view - h) / 2;
}

queueList.addEventListener('click', e => {
  const b = e.target.closest('button[data-qi]');
  if (!b) return;
  const i = +b.dataset.qi;
  if (i === state.index && loaded()) { if (audio.paused) playPause(true); return; }
  clearPrefetch();
  loadTrack(i, true);
});

// Przeciągnięcie w dół zamyka pełny odtwarzacz.
let touchY = null;
full.addEventListener('touchstart', e => {
  touchY = e.target.closest('input, button, .queue') ? null : e.touches[0].clientY;
}, { passive: true });
full.addEventListener('touchend', e => {
  if (touchY !== null && e.changedTouches[0].clientY - touchY > 90) closeFull();
  touchY = null;
});

/* =========================================================
   Wyłącznik czasowy (domyślnie wyłączony, nie jest zapamiętywany)
   PWA nie może zamknąć samej siebie – po czasie zatrzymuje odtwarzanie.
   Sprawdzany w „timeupdate”, więc działa też przy zablokowanym ekranie.
   ========================================================= */
let sleep = null; // { until: ms } | { endOfTrack: true } | null
let sleepTick = null;

function setSleep(v) {
  sleep = v;
  clearInterval(sleepTick);
  sleepTick = sleep && sleep.until ? setInterval(() => { checkSleep(); updateSleepUI(); }, 1000) : null;
  if (sleep) log(sleep.until ? 'wyłącznik czasowy: ' + fmt((sleep.until - Date.now()) / 1000) : 'wyłącznik czasowy: po bieżącym utworze');
  updateSleepUI();
}

function stopForSleep() {
  setSleep(null);
  if (!audio.paused) audio.pause();
  log('wyłącznik czasowy: pauza');
  setStatus('Zatrzymano – wyłącznik czasowy');
}

function checkSleep() {
  if (sleep && sleep.until && Date.now() >= sleep.until) stopForSleep();
}

function updateSleepUI() {
  const btn = $('#fullTimer');
  btn.classList.toggle('on', !!sleep);
  const el = $('#sleepLeft');
  if (!sleep) { el.textContent = ''; el.hidden = true; return; }
  el.hidden = false;
  el.textContent = sleep.until ? '⏾ ' + fmt(Math.max(0, (sleep.until - Date.now()) / 1000)) : '⏾ po tym utworze';
}

const WHEEL_ROW = 40;
function wheelHtml(id, n, unit, sel) {
  let rows = '';
  for (let i = 0; i < n; i++) rows += `<div class="wheel-row">${i}</div>`;
  return `<div class="wheel-col"><div class="wheel" id="${id}" data-sel="${sel}">${rows}</div><span class="wheel-unit">${unit}</span></div>`;
}
const wheelValue = el => Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollTop / WHEEL_ROW)));
function setWheel(el, v, smooth) {
  el.scrollTo({ top: v * WHEEL_ROW, behavior: smooth ? 'smooth' : 'auto' });
}

function sleepSheet() {
  const last = state.settings.sleepLast || 30;
  sheetBody.innerHTML = `
    <h3>Wyłącznik czasowy</h3>
    <p class="sheet-note">Po upływie czasu odtwarzanie zostanie zatrzymane.${sleep ? ` Teraz: <b>${esc($('#sleepLeft').textContent.replace('⏾ ', ''))}</b>.` : ''}</p>
    <div class="wheels">
      <div class="wheel-band"></div>
      ${wheelHtml('wh', 6, 'godz.', Math.floor(last / 60))}
      ${wheelHtml('wm', 60, 'min', last % 60)}
    </div>
    <div class="presets">
      ${[15, 30, 45, 60].map(m => `<button class="btn" data-min="${m}">${m} min</button>`).join('')}
      <button class="btn" data-eot>Po bieżącym utworze</button>
    </div>
    <button class="sheet-btn primary" data-start>Start</button>
    ${sleep ? '<button class="sheet-btn danger" data-off>Wyłącz wyłącznik</button>' : ''}
    <button class="sheet-btn cancel" data-cancel>Anuluj</button>`;
  const wh = $('#wh'), wm = $('#wm');
  const mark = () => [wh, wm].forEach(w => {
    const v = wheelValue(w);
    [...w.children].forEach((r, i) => r.classList.toggle('sel', i === v));
  });
  wh.addEventListener('scroll', mark, { passive: true });
  wm.addEventListener('scroll', mark, { passive: true });
  sheetBody.onclick = e => {
    const row = e.target.closest('.wheel-row');
    if (row) { setWheel(row.parentElement, [...row.parentElement.children].indexOf(row), true); return; }
    const pre = e.target.closest('[data-min]');
    if (pre) { const m = +pre.dataset.min; setWheel(wh, Math.floor(m / 60), true); setWheel(wm, m % 60, true); return; }
    if (e.target.closest('[data-cancel]')) { sheetEl.close(); return; }
    if (e.target.closest('[data-off]')) { setSleep(null); log('wyłącznik czasowy: wyłączony'); sheetEl.close(); return; }
    if (e.target.closest('[data-eot]')) { setSleep({ endOfTrack: true }); sheetEl.close(); return; }
    if (e.target.closest('[data-start]')) {
      const mins = wheelValue(wh) * 60 + wheelValue(wm);
      if (!mins) { alert('Wybierz czas większy od zera.'); return; }
      state.settings.sleepLast = mins;
      saveSettings();
      setSleep({ until: Date.now() + mins * 60000 });
      sheetEl.close();
    }
  };
  sheetEl.showModal();
  setWheel(wh, Math.floor(last / 60));
  setWheel(wm, last % 60);
  mark();
}
$('#fullTimer').addEventListener('click', sleepSheet);

/* =========================================================
   Arkusze akcji
   ========================================================= */
sheetEl.addEventListener('close', () => {
  resetViewport();
  const f = onSheetClose;
  onSheetClose = null;
  if (f) f();
});
sheetEl.addEventListener('click', e => { if (e.target === sheetEl) sheetEl.close(); });

function sheet(title, actions) {
  sheetBody.innerHTML = `<h3>${esc(title)}</h3>` +
    actions.map((a, i) => `<button class="sheet-btn${a.danger ? ' danger' : ''}${a.on ? ' on' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('') +
    '<button class="sheet-btn cancel" data-i="-1">Anuluj</button>';
  sheetBody.onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const i = +b.dataset.i;
    sheetEl.close();
    if (i >= 0) actions[i].fn();
  };
  sheetEl.showModal();
}

function libSortSheet() {
  sheet('Sortuj bibliotekę', Object.entries(SORT_LABELS).map(([k, label]) => ({
    label, on: state.settings.librarySort === k,
    fn: () => { state.settings.librarySort = k; saveSettings(); render(); },
  })));
}

function libMenu(t) {
  if (!t) return;
  sheet(t.title, [
    { label: 'Dodaj do playlisty…', fn: () => pickPlaylist(t) },
    {
      label: 'Odtwórz od początku',
      fn: () => {
        state.positions[t.id] = 0;
        persistPositions();
        if (loadedId === t.id && loaded()) { audio.currentTime = 0; audio.play().catch(() => {}); }
        else playFolder(folderOfTrack(t.id), t.id);
        render();
      },
    },
    { label: 'Usuń z aplikacji', danger: true, fn: () => { if (confirm(`Usunąć „${t.title}” z aplikacji? Oryginał w aplikacji Pliki zostanie.`)) deleteTrack(t.id); } },
  ]);
}

function pickPlaylist(t) {
  sheet('Dodaj do playlisty', [
    ...state.playlists.map(p => ({
      label: p.name,
      fn: async () => {
        p.trackIds.push(t.id);
        await savePl(p);
        syncQueueWithPlaylist(p);
        setStatus(`Dodano do „${p.name}”`);
      },
    })),
    {
      label: '+ Nowa playlista…',
      fn: () => newPlaylist(async p => {
        p.trackIds.push(t.id);
        await savePl(p);
        setStatus(`Dodano do „${p.name}”`);
        render();
      }),
    },
  ]);
}

function addTracksSheet(p) {
  if (!p) return;
  if (!state.tracks.length) { alert('Biblioteka jest pusta. Najpierw dodaj pliki.'); return; }
  const list = sortedTracks();
  sheetBody.innerHTML = `<h3>Dodaj do „${esc(p.name)}”</h3>
    <div class="checks">${list.map((t, i) => `<label class="check"><input type="checkbox" value="${i}"><span>${esc(t.title)}</span></label>`).join('')}</div>
    <button class="sheet-btn primary" data-ok>Dodaj zaznaczone</button>
    <button class="sheet-btn cancel" data-cancel>Anuluj</button>`;
  sheetBody.onclick = async e => {
    if (e.target.closest('[data-cancel]')) { sheetEl.close(); return; }
    if (!e.target.closest('[data-ok]')) return;
    const ids = [...sheetBody.querySelectorAll('input:checked')].map(c => list[+c.value].id);
    sheetEl.close();
    if (!ids.length) return;
    p.trackIds.push(...ids);
    await savePl(p);
    syncQueueWithPlaylist(p);
    setStatus(`Dodano ${ids.length}`);
    render();
  };
  sheetEl.showModal();
}

function plMenu(p) {
  if (!p) return;
  const withArt = p.trackIds.find(id => state.trackMap.get(id)?.hasArt);
  const actions = [
    { label: 'Dodaj utwory z biblioteki…', fn: () => addTracksSheet(p) },
    {
      label: 'Zmień nazwę…',
      fn: async () => {
        const name = prompt('Nowa nazwa:', p.name);
        resetViewport();
        if (!name || !name.trim()) return;
        p.name = name.trim();
        await savePl(p);
        sortPl();
        render();
        updatePlayerUI();
        updateMediaSession();
      },
    },
    { label: 'Ustaw okładkę z pliku…', fn: () => { coverTarget = p.id; $('#coverInput').click(); } },
  ];
  if (withArt) {
    actions.push({
      label: 'Użyj okładki z tagów utworu',
      fn: async () => setPlaylistCover(p, await idb.get('art', 'tr:' + withArt).catch(() => null)),
    });
  }
  if (p.hasCover) actions.push({ label: 'Usuń okładkę', fn: () => setPlaylistCover(p, null) });
  actions.push(
    { label: 'Sortuj: nazwa pliku A–Z', fn: () => sortPlaylist(p, 'name-asc') },
    { label: 'Sortuj: nazwa pliku Z–A', fn: () => sortPlaylist(p, 'name-desc') },
    { label: 'Sortuj: tytuł (tag) A–Z', fn: () => sortPlaylist(p, 'title-asc') },
    {
      label: 'Usuń playlistę',
      danger: true,
      fn: () => deletePlaylist(p),
    },
  );
  sheet(p.name, actions);
}

async function deletePlaylist(p) {
  if (!confirm(`Usunąć playlistę „${p.name}”? Utwory zostaną w bibliotece.`)) return;
  await idb.del('playlists', p.id);
  await idb.del('art', 'pl:' + p.id).catch(() => {});
  forgetArt('pl:' + p.id);
  state.playlists = state.playlists.filter(x => x.id !== p.id);
  if (state.source?.type === 'playlist' && state.source.id === p.id) state.source = { type: 'library' };
  state.view = 'playlists';
  render();
  updatePlayerUI();
  updatePlayerArt();
  setStatus('Usunięto playlistę');
}

function folderMenu(g) {
  if (!g) return;
  sheet(`${g.name} · ${g.tracks.length} utw.`, [
    { label: 'Odtwórz', fn: () => playFolder(g) },
    {
      label: 'Usuń folder z aplikacji',
      danger: true,
      fn: async () => {
        if (!confirm(`Usunąć folder „${g.name}” (${g.tracks.length} utw.) z aplikacji? Oryginały w aplikacji Pliki zostaną.`)) return;
        if (state.view === 'folder' && state.openFolder === g.key) state.view = 'library';
        await deleteTracks(g.tracks.map(t => t.id));
        setStatus(`Usunięto folder „${g.name}”`);
      },
    },
  ]);
}

/* =========================================================
   Playlisty
   ========================================================= */
const savePl = p => idb.put('playlists', p);

async function createPlaylist(name, ids, cover) {
  const p = { id: newId(), name, trackIds: ids.slice(), created: Date.now(), hasCover: !!cover };
  if (cover) await idb.put('art', cover, 'pl:' + p.id);
  await savePl(p);
  state.playlists.push(p);
  sortPl();
  return p;
}

function newPlaylist(then) {
  const name = prompt('Nazwa playlisty:');
  resetViewport();
  if (!name || !name.trim()) return;
  createPlaylist(name.trim(), [], null).then(p => (then ? then(p) : render()));
}

async function setPlaylistCover(p, blob) {
  if (blob) await idb.put('art', blob, 'pl:' + p.id);
  else await idb.del('art', 'pl:' + p.id).catch(() => {});
  p.hasCover = !!blob;
  await savePl(p);
  forgetArt('pl:' + p.id);
  render();
  updatePlayerArt();
  updateMediaSession();
  setStatus(blob ? 'Ustawiono okładkę' : 'Usunięto okładkę');
}

async function sortPlaylist(p, how) {
  const known = p.trackIds.filter(id => state.trackMap.has(id)).map(id => state.trackMap.get(id));
  const missing = p.trackIds.filter(id => !state.trackMap.has(id));
  known.sort(SORTS[how]);
  p.trackIds = [...known.map(t => t.id), ...missing];
  await savePl(p);
  syncQueueWithPlaylist(p);
  render();
  setStatus('Posortowano');
}

function syncQueueWithPlaylist(p) {
  if (state.source?.type !== 'playlist' || state.source.id !== p.id) return;
  const cur = currentId();
  const q = existing(p);
  const ni = q.indexOf(cur);
  if (ni < 0) return;
  clearPrefetch();
  state.queue = q;
  state.index = ni;
  saveLast();
  updatePlayerUI();
  renderQueue();
  if (!audio.paused) prefetchNext();
}

const deleteTrack = id => deleteTracks([id]);

async function deleteTracks(ids) {
  const del = new Set(ids);
  if (!del.size) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'blobs', 'playlists', 'art'], 'readwrite');
    for (const id of del) {
      t.objectStore('tracks').delete(id);
      t.objectStore('blobs').delete(id);
      t.objectStore('art').delete('tr:' + id);
    }
    for (const p of state.playlists) {
      if (p.trackIds.some(x => del.has(x))) {
        p.trackIds = p.trackIds.filter(x => !del.has(x));
        t.objectStore('playlists').put(p);
      }
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  state.tracks = state.tracks.filter(t => !del.has(t.id));
  for (const id of del) {
    state.trackMap.delete(id);
    forgetArt('tr:' + id);
    delete state.positions[id];
  }
  persistPositions();
  if (prefetched && del.has(prefetched.id)) clearPrefetch();

  if (state.source?.type === 'folder' && !getFolder(state.source.id)) state.source = { type: 'library' };
  if (state.queue.some(x => del.has(x))) {
    const cur = currentId();
    const curGone = del.has(cur);
    if (curGone) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = null;
      loadedId = null;
    }
    // Nowy indeks: pierwszy pozostały utwór za bieżącym (albo ostatni).
    const before = state.queue.slice(0, state.index).filter(x => !del.has(x)).length;
    const q = state.queue.filter(x => !del.has(x));
    const ni = curGone ? Math.min(before, q.length - 1) : q.indexOf(cur);
    state.queue = q;
    state.index = q.length ? Math.max(0, ni) : -1;
    saveLast();
  }
  setStatus('Usunięto');
  updatePlayerUI();
  updatePlayerArt();
  render();
}

/* =========================================================
   Kopia zapasowa (playlisty i pozycje, bez plików audio i okładek)
   ========================================================= */
async function exportJson() {
  const data = {
    app: 'nplayer',
    version: 2,
    exported: new Date().toISOString(),
    playlists: state.playlists.map(p => ({ name: p.name, tracks: p.trackIds })),
    positions: state.positions,
    settings: state.settings,
  };
  const name = `nplayer-kopia-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importJson(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { alert('To nie jest poprawny plik kopii.'); return; }
  if (!data || !['nplayer', 'odtwarzacz'].includes(data.app) || !Array.isArray(data.playlists)) { alert('Nieznany format pliku.'); return; }
  let count = 0;
  for (const ip of data.playlists) {
    if (!ip || typeof ip.name !== 'string' || !Array.isArray(ip.tracks)) continue;
    const ids = ip.tracks.filter(x => typeof x === 'string');
    let p = state.playlists.find(x => x.name === ip.name);
    if (p) { p.trackIds = ids; await savePl(p); }
    else await createPlaylist(ip.name, ids, null);
    count++;
  }
  if (data.positions && typeof data.positions === 'object') {
    for (const [k, v] of Object.entries(data.positions)) if (typeof v === 'number') state.positions[k] = v;
    persistPositions();
  }
  sortPl();
  render();
  alert(`Zaimportowano playlisty: ${count}. Utwory, których nie ma w bibliotece, pojawią się po ponownym dodaniu tych samych plików.`);
}

async function wipeAll() {
  if (!confirm('Usunąć wszystkie utwory, playlisty, okładki i ustawienia z tej aplikacji? Oryginały w aplikacji Pliki zostaną.')) return;
  audio.pause();
  try { (await openDB()).close(); } catch { /* ignoruj */ }
  dbPromise = null;
  await new Promise(r => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = q.onerror = q.onblocked = () => r();
  });
  try { localStorage.clear(); } catch { /* ignoruj */ }
  location.reload();
}

/* =========================================================
   Widoki
   ========================================================= */
const FOLDER_OK = 'webkitdirectory' in document.createElement('input');
const eqHtml = '<span class="eq"><i></i><i></i><i></i></span>';

function render() {
  const tab = state.view === 'playlist' ? 'playlists' : state.view === 'folder' ? 'library' : state.view;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === tab));
  $('#back').hidden = state.view !== 'playlist' && state.view !== 'folder';
  artObservers.get(main)?.disconnect();
  main.dataset.scope = '';
  if (state.view === 'library') renderLibrary();
  else if (state.view === 'folder') renderFolder();
  else if (state.view === 'playlists') renderPlaylists();
  else if (state.view === 'playlist') renderPlaylist();
  else { renderSettings(); return; }
  markCurrent();
  hydrateArt(main);
}

const scopeOf = src => (src?.type === 'playlist' ? 'p:' + src.id : src?.type === 'folder' ? 'f:' + src.id : '');

function markCurrent() {
  const id = currentId();
  const src = state.source;
  const inScope = (state.view === 'playlist' && src?.type === 'playlist' && src.id === state.openPlaylistId)
    || (!!main.dataset.scope && main.dataset.scope === scopeOf(src));
  main.querySelectorAll('.item[data-id]').forEach(el => el.classList.toggle('current', inScope && el.dataset.id === id));
  main.querySelectorAll('.item[data-folder]').forEach(el => el.classList.toggle('current', !!id && src?.type === 'folder' && src.id === el.dataset.folder));
  renderQueue();
}

function trackInfo(t) {
  const pos = state.positions[t.id] || 0;
  const parts = [t.artist, t.duration ? fmt(t.duration) : null, pos > 3 ? 'wznów od ' + fmt(pos) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : fmtSize(t.size);
}

const sortBtn = () => `<button class="btn ghost" data-act="lib-sort">${ICON.sort}${esc(SORT_LABELS[state.settings.librarySort] || '')}</button>`;

const trackListHtml = tracks => '<ul class="list">' + tracks.map(t => `
    <li class="item" data-id="${esc(t.id)}">
      <button class="main" data-act="play-track">${trackArt(t)}
        <span class="txt"><span class="title">${esc(t.title)}</span><span class="meta">${esc(trackInfo(t))}</span></span>
      </button>${eqHtml}
      <button class="ibtn more" data-act="menu-lib" aria-label="Więcej">${ICON.more}</button>
    </li>`).join('') + '</ul>';

function renderLibrary() {
  $('#viewTitle').textContent = 'Biblioteka';
  const total = state.tracks.reduce((a, t) => a + t.size, 0);
  const groups = folders();
  const folderBtn = FOLDER_OK ? `<label class="btn" for="folderInput">${ICON.folder}Folder</label>` : '';
  let html = `<div class="toolbar">
      <label class="btn primary" for="fileInput">${ICON.plus}Pliki</label>${folderBtn}
      <span class="spacer"></span>
      ${state.tracks.length ? sortBtn() : ''}
    </div>`;
  if (!state.tracks.length) {
    html += `<div class="empty">
        <div class="glyph">${ICON.lib}</div>
        <b>Biblioteka jest pusta</b>
        <p>Wczytaj pliki albo cały folder z aplikacji Pliki. Zostaną skopiowane do pamięci aplikacji i będą działać offline.</p>
      </div>`;
    main.innerHTML = html;
    return;
  }
  html += `<p class="count">${groups.length > 1 ? `Foldery: ${groups.length} · ` : ''}${state.tracks.length} utw. · ${fmtSize(total)}</p>`;
  if (groups.length === 1) {
    // Jeden folder – od razu lista utworów.
    main.dataset.scope = 'f:' + groups[0].key;
    html += trackListHtml(groups[0].tracks);
  } else {
    html += '<ul class="list">' + groups.map(g => {
      const withArt = g.tracks.find(t => t.hasArt);
      const dur = g.tracks.reduce((a, t) => a + (t.duration || 0), 0);
      return `
    <li class="item" data-folder="${esc(g.key)}">
      <button class="main" data-act="open-folder">${artHtml(withArt ? 'tr:' + withArt.id : null, 'art-md', 'folder')}
        <span class="txt"><span class="title">${esc(g.name)}</span><span class="meta">${g.tracks.length} utw.${dur ? ' · ' + fmtLong(dur) : ''}</span></span>
      </button>${eqHtml}
      <button class="ibtn more" data-act="menu-folder" aria-label="Więcej">${ICON.more}</button>
    </li>`;
    }).join('') + '</ul>';
  }
  main.innerHTML = html;
}

function renderFolder() {
  const g = getFolder(state.openFolder);
  if (!g) { state.view = 'library'; render(); return; }
  $('#viewTitle').textContent = g.name;
  main.dataset.scope = 'f:' + g.key;
  const size = g.tracks.reduce((a, t) => a + t.size, 0);
  main.innerHTML = `<div class="toolbar">
      <button class="btn primary" data-act="play-folder">${ICON.play}Odtwórz</button>
      <span class="spacer"></span>${sortBtn()}
      <button class="btn icon" data-act="menu-folder" aria-label="Więcej">${ICON.more}</button>
    </div>
    <p class="count">${g.tracks.length} utw. · ${fmtSize(size)}</p>` + trackListHtml(g.tracks);
}

function renderPlaylists() {
  $('#viewTitle').textContent = 'Playlisty';
  let html = `<div class="grid">
      <button class="tile tile-new" data-act="new-pl"><div class="art">${ICON.plus}</div><b>Nowa playlista</b><small>&nbsp;</small></button>`;
  html += state.playlists.map(p => `
      <div class="tile-wrap">
        <button class="tile" data-act="open-pl" data-pid="${esc(p.id)}">
          ${artHtml(playlistArtKey(p), '', 'lists')}
          <b>${esc(p.name)}</b><small>${p.trackIds.length} utw.</small>
        </button>
        <button class="tile-more" data-act="tile-menu" data-pid="${esc(p.id)}" aria-label="Więcej">${ICON.more}</button>
      </div>`).join('');
  html += '</div>';
  if (!state.playlists.length) {
    html += `<p class="note">Wskazówka: wczytaj cały folder w Bibliotece, a NPlayer zaproponuje zapisanie go jako playlisty z okładką.</p>`;
  }
  main.innerHTML = html;
}

function renderPlaylist() {
  const p = openPl();
  if (!p) { state.view = 'playlists'; render(); return; }
  $('#viewTitle').textContent = 'Playlista';
  const known = existing(p);
  const dur = known.reduce((a, id) => a + (state.trackMap.get(id).duration || 0), 0);
  const n = p.trackIds.length;
  let html = `<div class="hero">
      ${artHtml(playlistArtKey(p), '', 'lists')}
      <h2>${esc(p.name)}</h2>
      <p class="meta">${n} utw.${dur ? ' · ' + fmtLong(dur) : ''}</p>
      <div class="row">
        <button class="btn primary" data-act="play-pl" ${known.length ? '' : 'disabled'}>${ICON.play}Odtwórz</button>
        <button class="btn" data-act="edit-pl">${state.editing ? 'Gotowe' : 'Edytuj'}</button>
        <button class="btn icon" data-act="pl-menu" aria-label="Więcej">${ICON.more}</button>
      </div>
    </div>`;
  if (!n) html += '<p class="note" style="text-align:center">Playlista jest pusta. Dodaj utwory z menu ⋯.</p>';
  html += '<ul class="list plist">' + p.trackIds.map((id, i) => {
    const t = state.trackMap.get(id);
    const tools = state.editing ? `
      <button class="ibtn sm" data-act="pl-up" ${i === 0 ? 'disabled' : ''} aria-label="W górę">${ICON.up}</button>
      <button class="ibtn sm" data-act="pl-down" ${i === n - 1 ? 'disabled' : ''} aria-label="W dół">${ICON.dn}</button>
      <button class="ibtn sm" data-act="pl-remove" aria-label="Usuń z playlisty">${ICON.x}</button>` : '';
    if (!t) {
      return `<li class="item missing" data-i="${i}"><div class="main"><span class="num">${i + 1}</span>
        ${artHtml(null, 'art-sm')}<span class="txt"><span class="title">${esc(stripExt(id.split('|')[0]))}</span>
        <span class="meta">brak pliku w bibliotece – dodaj go ponownie</span></span></div>${tools}</li>`;
    }
    return `<li class="item" data-id="${esc(id)}" data-i="${i}">
      <button class="main" data-act="play-pl-item"><span class="num">${i + 1}</span>${eqHtml}${trackArt(t, 'art-sm')}
        <span class="txt"><span class="title">${esc(t.title)}</span><span class="meta">${esc(trackInfo(t))}</span></span>
      </button>${tools}</li>`;
  }).join('') + '</ul>';
  main.innerHTML = html;
}

async function renderSettings() {
  $('#viewTitle').textContent = 'Ustawienia';
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  if (state.view !== 'settings') return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const nm = state.settings.numberMode;
  main.innerHTML = `
    <section class="card">
      <h2>Sortowanie liczb</h2>
      <div class="seg">
        <button data-act="num-version" class="${nm === 'version' ? 'on' : ''}">Wersja<small>1.9 → 1.10</small></button>
        <button data-act="num-decimal" class="${nm === 'decimal' ? 'on' : ''}">Dziesiętne<small>1.10 → 1.9</small></button>
      </div>
      <p class="hint">Dotyczy liczby na końcu nazwy pliku lub tytułu z tagu, np. „Rozdział 1.9” i „Rozdział 1.10”.</p>
    </section>

    <section class="card">
      <h2>Pamięć</h2>
      <p>Zajęte: <b>${est ? fmtSize(est.usage || 0) : '?'}</b> z ${est ? fmtSize(est.quota || 0) : '?'}</p>
      <p>Trwała pamięć: <b>${persisted ? 'tak' : 'nie'}</b></p>
      ${persisted ? '' : '<div class="row"><button class="btn" data-act="persist">Poproś o trwałą pamięć</button></div>'}
      <p class="hint">Bez trwałej pamięci iOS może usunąć pliki przy braku miejsca. Oryginały zostają w aplikacji Pliki.</p>
    </section>

    <section class="card">
      <h2>Kopia zapasowa</h2>
      <p class="hint">Zapisuje playlisty i pozycje odtwarzania (bez plików audio i okładek).</p>
      <div class="row">
        <button class="btn" data-act="export">Eksportuj JSON</button>
        <label class="btn" for="jsonInput">Importuj JSON</label>
      </div>
    </section>

    <section class="card">
      <h2>Diagnostyka</h2>
      <p>Tryb: <b>${standalone ? 'aplikacja z ekranu początkowego' : 'karta przeglądarki'}</b></p>
      <p class="hint">Wpisy „[tło] koniec” i zaraz po nich „[tło] gra” oznaczają, że następny utwór włączył się przy zablokowanym ekranie.</p>
      <pre id="log" class="log"></pre>
      <div class="row"><button class="btn" data-act="clear-log">Wyczyść dziennik</button></div>
    </section>

    <section class="card">
      <h2>Dane</h2>
      <div class="row"><button class="btn danger" data-act="wipe">Usuń wszystkie dane</button></div>
    </section>
    <p class="version">NPlayer ${VERSION}</p>`;
  renderLog();
}

/* Obsługa kliknięć w treści */
main.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const item = b.closest('.item');
  const id = item?.dataset.id;
  const i = item ? Number(item.dataset.i) : -1;
  switch (act) {
    case 'play-track': {
      const scope = main.dataset.scope || '';
      if (scope.startsWith('f:')) playFolder(getFolder(scope.slice(2)), id);
      break;
    }
    case 'menu-folder':
      folderMenu(getFolder(item ? item.dataset.folder : state.openFolder));
      break;
    case 'tile-menu':
      plMenu(getPl(b.dataset.pid));
      break;
    case 'open-folder':
      state.openFolder = item.dataset.folder;
      state.view = 'folder';
      render();
      main.scrollTop = 0;
      break;
    case 'play-folder':
      playFolder(getFolder(state.openFolder));
      break;
    case 'menu-lib':
      libMenu(state.trackMap.get(id));
      break;
    case 'lib-sort':
      libSortSheet();
      break;
    case 'new-pl':
      newPlaylist();
      break;
    case 'open-pl':
      state.openPlaylistId = b.dataset.pid;
      state.view = 'playlist';
      state.editing = false;
      render();
      main.scrollTop = 0;
      break;
    case 'play-pl': {
      const p = openPl();
      playFrom(existing(p), 0, { type: 'playlist', id: p.id });
      break;
    }
    case 'play-pl-item': {
      const p = openPl();
      const before = p.trackIds.slice(0, i).filter(x => state.trackMap.has(x)).length;
      playFrom(existing(p), before, { type: 'playlist', id: p.id });
      break;
    }
    case 'edit-pl':
      state.editing = !state.editing;
      render();
      break;
    case 'pl-menu':
      plMenu(openPl());
      break;
    case 'pl-up':
    case 'pl-down': {
      const p = openPl();
      const j = i + (act === 'pl-up' ? -1 : 1);
      if (j < 0 || j >= p.trackIds.length) break;
      [p.trackIds[i], p.trackIds[j]] = [p.trackIds[j], p.trackIds[i]];
      savePl(p);
      syncQueueWithPlaylist(p);
      render();
      break;
    }
    case 'pl-remove': {
      const p = openPl();
      p.trackIds.splice(i, 1);
      savePl(p);
      syncQueueWithPlaylist(p);
      render();
      break;
    }
    case 'num-version':
    case 'num-decimal':
      state.settings.numberMode = act === 'num-decimal' ? 'decimal' : 'version';
      saveSettings();
      sortPl();
      render();
      break;
    case 'persist':
      requestPersist(true).then(render);
      break;
    case 'export':
      exportJson();
      break;
    case 'clear-log':
      logLines = [];
      try { localStorage.removeItem('log'); } catch { /* ignoruj */ }
      renderLog();
      break;
    case 'wipe':
      wipeAll();
      break;
  }
});

document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  closeFull();
  state.view = b.dataset.view;
  state.editing = false;
  render();
  main.scrollTop = 0;
});
$('#back').addEventListener('click', () => {
  state.view = state.view === 'folder' ? 'library' : 'playlists';
  state.editing = false;
  render();
  main.scrollTop = 0;
});

$('#fileInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  await importSelection(files, false);
});
$('#folderInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  await importSelection(files, true);
});
$('#coverInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  const p = getPl(coverTarget);
  if (!f || !p) return;
  const blob = await resizeImage(f, 600).catch(() => null);
  if (!blob) { alert('Nie udało się odczytać tego obrazu.'); return; }
  await setPlaylistCover(p, blob);
});
$('#jsonInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await importJson(f);
});

/* Blokada powiększania gestami (iOS ignoruje user-scalable=no). */
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

/* iOS po zamknięciu klawiatury potrafi zostawić przesunięty widok – przywracamy go. */
function resetViewport() {
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
  }
}
document.addEventListener('focusout', () => setTimeout(resetViewport, 60));
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetViewport, 60));

const setDockH = () => document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
if ('ResizeObserver' in window) new ResizeObserver(setDockH).observe(dock);
window.addEventListener('resize', setDockH);

/* =========================================================
   Start
   ========================================================= */
async function init() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICON[el.dataset.icon] || ''; });
  setupUnlock();
  setDockH();
  try {
    const [tracks, playlists, positions, last, settings] = await Promise.all([
      idb.getAll('tracks'),
      idb.getAll('playlists'),
      idb.get('kv', 'positions'),
      idb.get('kv', 'last'),
      idb.get('kv', 'settings'),
    ]);
    if (settings) {
      state.settings = Object.assign(state.settings, settings);
      delete state.settings.lockMode;
    }
    state.tracks = tracks || [];
    state.tracks.forEach(t => state.trackMap.set(t.id, t));
    state.playlists = playlists || [];
    sortPl();
    state.positions = positions || {};

    if (last && Array.isArray(last.queue)) {
      const wanted = last.queue[last.index];
      state.queue = last.queue.filter(id => state.trackMap.has(id));
      const ni = state.queue.indexOf(wanted);
      state.index = state.queue.length ? (ni >= 0 ? ni : 0) : -1;
      const src = last.source;
      const valid = src && (src.type === 'playlist' ? !!getPl(src.id) : src.type === 'folder' ? !!getFolder(src.id) : true);
      state.source = valid ? src : { type: 'library' };
    }
  } catch (e) {
    log('błąd bazy danych: ' + (e && e.name));
    setStatus('Nie udało się otworzyć bazy danych', true);
  }

  setupMediaSession();
  updateMediaSession();
  updatePlayerUI();
  updatePlayerArt();
  render();
  log('start aplikacji');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => log('service worker: ' + e.message));
  }
}

init();
