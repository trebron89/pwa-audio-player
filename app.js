'use strict';

const VERSION = '1.0.0';

/* =========================================================
   IndexedDB: metadane utworów, pliki audio, playlisty, stan
   ========================================================= */
const DB_NAME = 'odtwarzacz';
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
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

async function saveTrack(meta, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'blobs'], 'readwrite');
    t.objectStore('blobs').put(blob, meta.id);
    t.objectStore('tracks').put(meta);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transakcja przerwana'));
  });
}

/* =========================================================
   Stan aplikacji
   ========================================================= */
const state = {
  tracks: [],
  trackMap: new Map(),
  playlists: [],
  positions: {},          // id utworu -> sekundy
  queue: [],              // id utworów w bieżącej kolejce
  index: -1,
  source: null,           // { type: 'library' } | { type: 'playlist', id }
  view: 'library',        // library | playlists | playlist | settings
  openPlaylistId: null,
  settings: { rate: 1, lockMode: 'tracks' },
};

const $ = s => document.querySelector(s);
const main = $('#main');
const audio = $('#audio');
const seek = $('#seek');

let currentUrl = null;    // blob URL aktualnie załadowanego utworu
let loadedId = null;
let pendingSeek = 0;
let prefetched = null;    // { id, url } następnego utworu
let seeking = false;
let lastSave = 0;
let lastPosState = 0;

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
const fmtSize = b => (b >= 1e9 ? (b / 1e9).toFixed(2).replace('.', ',') + ' GB' : (b / 1e6).toFixed(1).replace('.', ',') + ' MB');
const stripExt = n => n.replace(/\.[^.]+$/, '');
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4|aac|wav|aif|aiff|caf|flac|alac|opus|ogg|oga)$/i;
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({
    mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', alac: 'audio/mp4',
    aac: 'audio/aac', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf',
    flac: 'audio/flac', opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg',
  })[ext] || 'application/octet-stream';
}

const currentId = () => (state.index >= 0 ? state.queue[state.index] : undefined);
const titleOf = id => (id && state.trackMap.get(id)?.title) || (id ? id.split('|')[0] : '?');
const loaded = () => !!currentUrl && loadedId === currentId() && audio.src === currentUrl;
const getPl = id => state.playlists.find(p => p.id === id);
const openPl = () => getPl(state.openPlaylistId);
const existing = p => p.trackIds.filter(id => state.trackMap.has(id));

function sortTracks() {
  state.tracks.sort((a, b) => a.title.localeCompare(b.title, 'pl', { numeric: true, sensitivity: 'base' }));
}
function sortPl() {
  state.playlists.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' }));
}
function sourceName() {
  if (state.source?.type === 'playlist') return getPl(state.source.id)?.name || 'Playlista';
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
   Dziennik diagnostyczny (test odtwarzania przy zablokowanym ekranie)
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
   Odblokowanie audio na iOS
   Pierwsze dotknięcie odtwarza ułamek sekundy ciszy, żeby
   późniejsze play() (np. po odczycie z bazy) nie było blokowane.
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
   Import plików
   ========================================================= */
async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  await requestPersist(false);
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setStatus(`Kopiowanie ${i + 1}/${files.length}…`, true);
    if (!(f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))) { skipped++; continue; }
    const id = `${f.name}|${f.size}`;
    if (state.trackMap.has(id)) { skipped++; continue; }
    try {
      const buf = await f.arrayBuffer();
      const type = f.type || guessType(f.name);
      const blob = new Blob([buf], { type });
      const meta = { id, name: f.name, title: stripExt(f.name), size: f.size, type, duration: 0, added: Date.now() };
      await saveTrack(meta, blob);
      state.tracks.push(meta);
      state.trackMap.set(id, meta);
      added++;
    } catch (e) {
      failed++;
      log(`błąd importu ${f.name}: ${e && e.name}`);
      if (e && e.name === 'QuotaExceededError') {
        alert('Brak miejsca w pamięci aplikacji. Usuń część utworów lub zwolnij miejsce na iPhonie.');
        break;
      }
    }
  }
  sortTracks();
  const parts = [`Dodano ${added}`];
  if (skipped) parts.push(`pominięto ${skipped}`);
  if (failed) parts.push(`błędy ${failed}`);
  setStatus(parts.join(', '));
  render();
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
    // Ścieżka synchroniczna: ważna przy przejściu do następnego utworu w tle.
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
  audio.defaultPlaybackRate = state.settings.rate;
  audio.playbackRate = state.settings.rate;

  log('utwór: ' + titleOf(id));
  updateMediaSession();
  updatePlayerUI();
  saveLast();
  if (state.view !== 'settings') render();

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
  if (ids[i] === loadedId && loaded() && sameSource(source)) { playPause(); return; }
  clearPrefetch();
  state.queue = ids.slice();
  state.source = source;
  loadTrack(i, true);
}

function playPause(forcePlay) {
  if (state.index < 0 || !state.queue.length) {
    if (state.tracks.length) playFrom(state.tracks.map(t => t.id), 0, { type: 'library' });
    return;
  }
  if (!loaded()) { loadTrack(state.index, true); return; }
  if (audio.paused || forcePlay) {
    audio.play().catch(e => log('play() odrzucone: ' + e.name));
  } else {
    audio.pause();
  }
}

function next() {
  if (state.index + 1 < state.queue.length) loadTrack(state.index + 1, true);
}

function prev() {
  if (loaded() && audio.currentTime > 5) { audio.currentTime = 0; return; }
  if (state.index > 0) loadTrack(state.index - 1, true);
  else if (loaded()) audio.currentTime = 0;
}

function seekBy(d) {
  if (!loaded()) return;
  const dur = isFinite(audio.duration) ? audio.duration : Infinity;
  audio.currentTime = Math.max(0, Math.min(dur - 0.5, audio.currentTime + d));
}

function savePosition() {
  const id = currentId();
  if (!id || !loaded() || !isFinite(audio.currentTime)) return;
  state.positions[id] = Math.floor(audio.currentTime);
  persistPositions();
  saveLast();
}

/* Zdarzenia elementu audio */
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
   Ekran blokady (Media Session)
   ========================================================= */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const h = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* nieobsługiwane */ } };
  h('play', () => playPause(true));
  h('pause', () => audio.pause());
  h('seekto', d => { if (loaded() && d.seekTime != null) audio.currentTime = d.seekTime; });
  if (state.settings.lockMode === 'seek') {
    h('previoustrack', null);
    h('nexttrack', null);
    h('seekbackward', d => seekBy(-(d.seekOffset || 15)));
    h('seekforward', d => seekBy(d.seekOffset || 30));
  } else {
    h('seekbackward', null);
    h('seekforward', null);
    h('previoustrack', prev);
    h('nexttrack', next);
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const id = currentId();
  if (!id) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleOf(id),
      artist: sourceName(),
      album: 'Odtwarzacz',
      artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  } catch { /* ignoruj */ }
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
   Pasek odtwarzacza
   ========================================================= */
function updatePlayerUI() {
  const id = currentId();
  const meta = id && state.trackMap.get(id);
  $('#nowTitle').textContent = meta ? meta.title : 'Nic nie gra';
  $('#nowSub').textContent = meta
    ? `${sourceName()} · ${state.index + 1}/${state.queue.length}`
    : 'Wybierz utwór z biblioteki';
  const isLoaded = loaded();
  const dur = isLoaded && isFinite(audio.duration) ? audio.duration : (meta && meta.duration) || 0;
  const cur = isLoaded ? audio.currentTime : (id && state.positions[id]) || 0;
  if (!seeking) {
    seek.max = String(Math.max(1, Math.floor(dur)));
    seek.value = String(Math.floor(cur));
    $('#tCur').textContent = fmt(cur);
  }
  $('#tDur').textContent = fmt(dur);
  const playing = isLoaded && !audio.paused;
  $('#btnPlay').innerHTML = playing ? '❚❚' : '▶&#xFE0E;';
  $('#btnRate').textContent = String(state.settings.rate).replace('.', ',') + '×';
}

seek.addEventListener('input', () => { seeking = true; $('#tCur').textContent = fmt(+seek.value); });
seek.addEventListener('change', () => {
  seeking = false;
  const id = currentId();
  if (loaded()) audio.currentTime = +seek.value;
  else if (id) { state.positions[id] = +seek.value; persistPositions(); }
  updatePlayerUI();
});

const RATES = [1, 1.25, 1.5, 2, 0.75];
$('#btnRate').addEventListener('click', () => {
  const i = RATES.indexOf(state.settings.rate);
  state.settings.rate = RATES[(i + 1) % RATES.length];
  audio.defaultPlaybackRate = state.settings.rate;
  audio.playbackRate = state.settings.rate;
  saveSettings();
  updatePlayerUI();
  updatePositionState();
});
$('#btnPlay').addEventListener('click', () => playPause());
$('#btnPrev').addEventListener('click', prev);
$('#btnNext').addEventListener('click', next);
$('#btnBack').addEventListener('click', () => seekBy(-15));
$('#btnFwd').addEventListener('click', () => seekBy(30));

/* =========================================================
   Arkusze akcji
   ========================================================= */
const sheetEl = $('#sheet');
const sheetBody = $('#sheetBody');

function sheet(title, actions) {
  sheetBody.innerHTML = `<h3>${esc(title)}</h3>` +
    actions.map((a, i) => `<button class="sheet-btn${a.danger ? ' danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('') +
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
        else { const ids = state.tracks.map(x => x.id); playFrom(ids, ids.indexOf(t.id), { type: 'library' }); }
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
  sheetBody.innerHTML = `<h3>Dodaj do „${esc(p.name)}”</h3>
    <div class="checks">${state.tracks.map((t, i) => `<label class="check"><input type="checkbox" value="${i}"><span>${esc(t.title)}</span></label>`).join('')}</div>
    <button class="sheet-btn primary" data-ok>Dodaj zaznaczone</button>
    <button class="sheet-btn cancel" data-cancel>Anuluj</button>`;
  sheetBody.onclick = async e => {
    if (e.target.closest('[data-cancel]')) { sheetEl.close(); return; }
    if (!e.target.closest('[data-ok]')) return;
    const ids = [...sheetBody.querySelectorAll('input:checked')].map(c => state.tracks[+c.value].id);
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
  sheet(p.name, [
    {
      label: 'Zmień nazwę…',
      fn: async () => {
        const name = prompt('Nowa nazwa:', p.name);
        if (!name || !name.trim()) return;
        p.name = name.trim();
        await savePl(p);
        sortPl();
        render();
        updatePlayerUI();
      },
    },
    {
      label: 'Usuń playlistę',
      danger: true,
      fn: async () => {
        if (!confirm(`Usunąć playlistę „${p.name}”? Utwory zostaną w bibliotece.`)) return;
        await idb.del('playlists', p.id);
        state.playlists = state.playlists.filter(x => x.id !== p.id);
        if (state.source?.type === 'playlist' && state.source.id === p.id) state.source = { type: 'library' };
        state.view = 'playlists';
        render();
        updatePlayerUI();
      },
    },
  ]);
}

/* =========================================================
   Playlisty i usuwanie
   ========================================================= */
const savePl = p => idb.put('playlists', p);

function newPlaylist(then) {
  const name = prompt('Nazwa playlisty:');
  if (!name || !name.trim()) return;
  const p = { id: newId(), name: name.trim(), trackIds: [], created: Date.now() };
  state.playlists.push(p);
  sortPl();
  savePl(p).then(() => (then ? then(p) : render()));
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
  if (!audio.paused) prefetchNext();
}

async function deleteTrack(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'blobs', 'playlists'], 'readwrite');
    t.objectStore('tracks').delete(id);
    t.objectStore('blobs').delete(id);
    for (const p of state.playlists) {
      if (p.trackIds.includes(id)) {
        p.trackIds = p.trackIds.filter(x => x !== id);
        t.objectStore('playlists').put(p);
      }
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  state.tracks = state.tracks.filter(t => t.id !== id);
  state.trackMap.delete(id);
  delete state.positions[id];
  persistPositions();
  if (prefetched && prefetched.id === id) clearPrefetch();

  if (state.queue.includes(id)) {
    const cur = currentId();
    if (cur === id) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = null;
      loadedId = null;
    }
    const q = state.queue.filter(x => x !== id);
    const ni = cur === id ? Math.min(state.index, q.length - 1) : q.indexOf(cur);
    state.queue = q;
    state.index = q.length ? Math.max(0, ni) : -1;
    saveLast();
  }
  setStatus('Usunięto');
  updatePlayerUI();
  render();
}

/* =========================================================
   Kopia zapasowa (playlisty i pozycje, bez plików audio)
   ========================================================= */
async function exportJson() {
  const data = {
    app: 'odtwarzacz',
    version: 1,
    exported: new Date().toISOString(),
    playlists: state.playlists.map(p => ({ name: p.name, tracks: p.trackIds })),
    positions: state.positions,
    settings: state.settings,
  };
  const name = `odtwarzacz-kopia-${new Date().toISOString().slice(0, 10)}.json`;
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
  if (!data || data.app !== 'odtwarzacz' || !Array.isArray(data.playlists)) { alert('Nieznany format pliku.'); return; }
  let count = 0;
  for (const ip of data.playlists) {
    if (!ip || typeof ip.name !== 'string' || !Array.isArray(ip.tracks)) continue;
    const ids = ip.tracks.filter(x => typeof x === 'string');
    let p = state.playlists.find(x => x.name === ip.name);
    if (p) p.trackIds = ids;
    else { p = { id: newId(), name: ip.name, trackIds: ids, created: Date.now() }; state.playlists.push(p); }
    await savePl(p);
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
  if (!confirm('Usunąć wszystkie utwory, playlisty i ustawienia z tej aplikacji? Oryginały w aplikacji Pliki zostaną.')) return;
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
function setTitle(t) { $('#viewTitle').textContent = t; }

function render() {
  const tab = state.view === 'playlist' ? 'playlists' : state.view;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === tab));
  $('#back').hidden = state.view !== 'playlist';
  if (state.view === 'library') renderLibrary();
  else if (state.view === 'playlists') renderPlaylists();
  else if (state.view === 'playlist') renderPlaylist();
  else renderSettings();
}

function trackInfo(t) {
  const pos = state.positions[t.id] || 0;
  return [t.duration ? fmt(t.duration) : null, fmtSize(t.size), pos > 3 ? 'wznów od ' + fmt(pos) : null]
    .filter(Boolean).join(' · ');
}

function renderLibrary() {
  setTitle('Biblioteka');
  const total = state.tracks.reduce((a, t) => a + t.size, 0);
  const cur = state.source?.type === 'library' ? currentId() : null;
  let html = `<div class="toolbar">
      <label class="btn primary" for="fileInput">+ Dodaj pliki</label>
      <span class="muted">${state.tracks.length} utw. · ${fmtSize(total)}</span>
    </div>`;
  if (!state.tracks.length) {
    html += `<p class="empty">Biblioteka jest pusta. Dotknij „Dodaj pliki” i wybierz utwory z aplikacji Pliki.
      Zostaną skopiowane do pamięci aplikacji i będą dostępne offline.</p>`;
  }
  html += '<ul class="list">' + state.tracks.map((t, i) => `
    <li class="item${t.id === cur ? ' current' : ''}">
      <button class="main" data-act="play-lib" data-i="${i}">
        <span class="title">${esc(t.title)}</span><span class="meta">${trackInfo(t)}</span>
      </button>
      <button class="icon-btn" data-act="menu-lib" data-i="${i}" aria-label="Więcej">⋯</button>
    </li>`).join('') + '</ul>';
  main.innerHTML = html;
}

function renderPlaylists() {
  setTitle('Playlisty');
  let html = '<div class="toolbar"><button class="btn primary" data-act="new-pl">+ Nowa playlista</button></div>';
  if (!state.playlists.length) html += '<p class="empty">Nie masz jeszcze playlist.</p>';
  html += '<ul class="list">' + state.playlists.map(p => `
    <li class="item">
      <button class="main" data-act="open-pl" data-id="${esc(p.id)}">
        <span class="title">${esc(p.name)}</span><span class="meta">${p.trackIds.length} utw.</span>
      </button>
      <span class="chev">›</span>
    </li>`).join('') + '</ul>';
  main.innerHTML = html;
}

function renderPlaylist() {
  const p = openPl();
  if (!p) { state.view = 'playlists'; render(); return; }
  setTitle(p.name);
  const cur = state.source?.type === 'playlist' && state.source.id === p.id ? currentId() : null;
  const n = p.trackIds.length;
  let html = `<div class="toolbar">
      <button class="btn primary" data-act="play-pl" ${existing(p).length ? '' : 'disabled'}>▶&#xFE0E; Odtwórz</button>
      <button class="btn" data-act="add-to-pl">+ Dodaj utwory</button>
      <button class="btn" data-act="pl-menu" aria-label="Więcej">⋯</button>
    </div>`;
  if (!n) html += '<p class="empty">Playlista jest pusta. Dotknij „Dodaj utwory”.</p>';
  html += '<ul class="list">' + p.trackIds.map((id, i) => {
    const t = state.trackMap.get(id);
    const tools = `
      <button class="icon-btn" data-act="pl-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="W górę">↑</button>
      <button class="icon-btn" data-act="pl-down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="W dół">↓</button>
      <button class="icon-btn" data-act="pl-remove" data-i="${i}" aria-label="Usuń z playlisty">✕</button>`;
    if (!t) {
      return `<li class="item missing"><div class="main"><span class="title">${esc(id.split('|')[0])}</span>
        <span class="meta">brak pliku w bibliotece, dodaj go ponownie</span></div>${tools}</li>`;
    }
    return `<li class="item${id === cur ? ' current' : ''}">
      <button class="main" data-act="play-pl-item" data-i="${i}">
        <span class="title">${esc(t.title)}</span><span class="meta">${trackInfo(t)}</span>
      </button>${tools}</li>`;
  }).join('') + '</ul>';
  main.innerHTML = html;
}

async function renderSettings() {
  setTitle('Ustawienia');
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  if (state.view !== 'settings') return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const lm = state.settings.lockMode;
  main.innerHTML = `
    <section class="card">
      <h2>Pamięć</h2>
      <p>Zajęte: <b>${est ? fmtSize(est.usage || 0) : '?'}</b> z ${est ? fmtSize(est.quota || 0) : '?'}</p>
      <p>Trwała pamięć: <b>${persisted ? 'tak' : 'nie'}</b></p>
      ${persisted ? '' : '<div class="row"><button class="btn" data-act="persist">Poproś o trwałą pamięć</button></div>'}
      <p class="muted">Bez trwałej pamięci iOS może usunąć pliki przy braku miejsca. Oryginały zostają w aplikacji Pliki.</p>
    </section>

    <section class="card">
      <h2>Przyciski na ekranie blokady</h2>
      <div class="seg">
        <button data-act="lock-tracks" class="${lm === 'tracks' ? 'on' : ''}">Poprzedni / następny</button>
        <button data-act="lock-seek" class="${lm === 'seek' ? 'on' : ''}">−15 s / +30 s</button>
      </div>
      <p class="muted">iOS pokazuje albo przełączanie utworów, albo przewijanie. Przewijanie przydaje się przy audiobookach.</p>
    </section>

    <section class="card">
      <h2>Kopia zapasowa</h2>
      <p class="muted">Zapisuje playlisty i pozycje odtwarzania (bez plików audio).</p>
      <div class="row">
        <button class="btn" data-act="export">Eksportuj JSON</button>
        <label class="btn" for="jsonInput">Importuj JSON</label>
      </div>
    </section>

    <section class="card">
      <h2>Diagnostyka</h2>
      <p>Tryb: <b>${standalone ? 'aplikacja z ekranu początkowego' : 'karta przeglądarki'}</b></p>
      <p class="muted">Wpisy „[tło] koniec” i zaraz po nich „[tło] gra” oznaczają, że następny utwór
        włączył się przy zablokowanym ekranie.</p>
      <pre id="log" class="log"></pre>
      <div class="row"><button class="btn" data-act="clear-log">Wyczyść dziennik</button></div>
    </section>

    <section class="card">
      <h2>Dane</h2>
      <div class="row"><button class="btn danger" data-act="wipe">Usuń wszystkie dane</button></div>
    </section>
    <p class="muted center">Odtwarzacz ${VERSION}</p>`;
  renderLog();
}

/* Obsługa kliknięć w treści */
main.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const i = Number(b.dataset.i);
  switch (act) {
    case 'play-lib':
      playFrom(state.tracks.map(t => t.id), i, { type: 'library' });
      break;
    case 'menu-lib':
      libMenu(state.tracks[i]);
      break;
    case 'new-pl':
      newPlaylist();
      break;
    case 'open-pl':
      state.openPlaylistId = b.dataset.id;
      state.view = 'playlist';
      render();
      window.scrollTo(0, 0);
      break;
    case 'play-pl': {
      const p = openPl();
      playFrom(existing(p), 0, { type: 'playlist', id: p.id });
      break;
    }
    case 'play-pl-item': {
      const p = openPl();
      const before = p.trackIds.slice(0, i).filter(id => state.trackMap.has(id)).length;
      playFrom(existing(p), before, { type: 'playlist', id: p.id });
      break;
    }
    case 'add-to-pl':
      addTracksSheet(openPl());
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
    case 'persist':
      requestPersist(true).then(render);
      break;
    case 'lock-tracks':
    case 'lock-seek':
      state.settings.lockMode = act === 'lock-seek' ? 'seek' : 'tracks';
      saveSettings();
      setupMediaSession();
      render();
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
  state.view = b.dataset.view;
  render();
  window.scrollTo(0, 0);
});
$('#back').addEventListener('click', () => { state.view = 'playlists'; render(); });

$('#fileInput').addEventListener('change', async e => {
  await importFiles(e.target.files);
  e.target.value = '';
});
$('#jsonInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (f) await importJson(f);
  e.target.value = '';
});

/* Odstęp treści od paska odtwarzacza */
const dock = $('#dock');
const setDockH = () => document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
if ('ResizeObserver' in window) new ResizeObserver(setDockH).observe(dock);
window.addEventListener('resize', setDockH);

/* =========================================================
   Start
   ========================================================= */
async function init() {
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
    state.tracks = tracks || [];
    state.tracks.forEach(t => state.trackMap.set(t.id, t));
    sortTracks();
    state.playlists = playlists || [];
    sortPl();
    state.positions = positions || {};
    if (settings) state.settings = Object.assign(state.settings, settings);

    if (last && Array.isArray(last.queue)) {
      const wanted = last.queue[last.index];
      state.queue = last.queue.filter(id => state.trackMap.has(id));
      const ni = state.queue.indexOf(wanted);
      state.index = state.queue.length ? (ni >= 0 ? ni : 0) : -1;
      state.source = last.source && (last.source.type !== 'playlist' || getPl(last.source.id)) ? last.source : { type: 'library' };
    }
  } catch (e) {
    log('błąd bazy danych: ' + (e && e.name));
    setStatus('Nie udało się otworzyć bazy danych', true);
  }

  setupMediaSession();
  updateMediaSession();
  updatePlayerUI();
  render();
  log('start aplikacji');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => log('service worker: ' + e.message));
  }
}

init();
