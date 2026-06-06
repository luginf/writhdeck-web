'use strict';
// In-memory application state
const State = {
  doc:   null,  // { id, name, content, created, modified }
  dirty: false,

  docs: [],   // IDB-backed document list

  // Watched folder (File System Access API)
  dirHandle:    null,
  dirFiles:     [],   // in-memory only, rebuilt by scanDir()
  dirIniHandle: null, // FileSystemFileHandle for writhdeck.ini in folder

  // Cached INI text — the canonical settings format in IDB
  iniText: '',

  // Settings defaults (overwritten from IDB on load)
  settings: {
    scheme: 'default',
    darkMode: true,
    fontSize: 18,
    fontFamily: 'monospace',
    marginX: 80,
    marginY: 40,
    lineSpacing: 1.5,
    headingMarker: '=',
    commentMarker: '% ',
    boldMarker: '**',
    italicMarker: '//',
    underlineMarker: '__',
    strikeMarker: '--',
    markdownHeadings: true,
    wordGoal: 0,
    hemingwayMode: false,
    cursorRestore: true,
    openLastDoc: false,
    timerType: 'countdown',
    timerDuration: 25,
    timerSound: true,
    timerAlert: true,
    timerShow: true,
    statusLeft: 'filename dirty words',
    statusCenter: '',
    statusRight: 'goal clock timer',
    lineNumbers: false,
    blockCursor: false,
    blinkCursor: false,
    interceptBrowserShortcuts: true,
    interceptContextMenu: true
  },

  favorites: [],  // [id, ...]
  recents: [],    // [id, ...] max 4
  cursors: {},    // {id: charOffset}
  daily: {},      // {id: {"YYYY-MM-DD": N, ...}}
  customSchemes: {}
};

// ── Load ──────────────────────────────────────────────────────────────────

async function loadState() {
  const [iniText, oldSettings, favorites, recents, cursors, daily, oldCs, dh] = await Promise.all([
    DB.getMeta('iniText'),       // canonical INI storage (current)
    DB.getMeta('settings'),      // legacy JSON (migration only)
    DB.getMeta('favorites'),
    DB.getMeta('recents'),
    DB.getMeta('cursors'),
    DB.getMeta('daily'),
    DB.getMeta('customSchemes'), // legacy separate custom schemes
    DB.getMeta('dirHandle')
  ]);

  if (iniText) {
    // Normal path — INI is the source of truth
    const { settings, schemes } = INI.parseIni(iniText);
    Object.assign(State.settings, settings);
    // Only load non-built-in schemes: built-in colors come from code, not IDB
    for (const [n, sc] of Object.entries(schemes)) {
      if (!SCHEMES[n]) customSchemes[n] = sc;
    }
    State.customSchemes = { ...customSchemes };
    State.iniText = iniText;
  } else if (oldSettings) {
    // One-time migration from legacy JSON format
    Object.assign(State.settings, oldSettings);
    if (oldCs) Object.assign(customSchemes, oldCs);
    State.customSchemes = { ...customSchemes };
    await saveSettings();             // re-persist as INI
    await DB.setMeta('settings', null);
    await DB.setMeta('customSchemes', null);
  }
  // else: first run — defaults are in place, INI saved after init by app.js

  if (favorites) State.favorites = favorites;
  if (recents)   State.recents   = recents;
  if (cursors)   State.cursors   = cursors;
  if (daily)     State.daily     = daily;
  if (dh)        State.dirHandle = dh;

  State.docs = await DB.getAllDocs();
}

// ── Settings — INI is canonical ───────────────────────────────────────────

async function saveSettings() {
  const allSchemes = { ...SCHEMES, ...customSchemes };
  const text = INI.writeIni(State.settings, allSchemes);
  State.iniText = text;
  await DB.setMeta('iniText', text);
}

// Custom schemes are embedded in the INI — just re-save settings
async function saveCustomSchemes() {
  State.customSchemes = { ...customSchemes };
  await saveSettings();
}

// ── Persistence helpers ───────────────────────────────────────────────────

async function saveFavorites() { await DB.setMeta('favorites', State.favorites); }
async function saveRecents()   { await DB.setMeta('recents',   State.recents);   }
async function saveCursors()   { await DB.setMeta('cursors',   State.cursors);   }
async function saveDaily()     { await DB.setMeta('daily',     State.daily);     }
async function saveDirHandle() { await DB.setMeta('dirHandle', State.dirHandle); }

async function clearDirHandle() {
  State.dirHandle    = null;
  State.dirFiles     = [];
  State.dirIniHandle = null;
  await DB.setMeta('dirHandle', null);
}

// ── Watched folder ────────────────────────────────────────────────────────

async function scanDir() {
  if (!State.dirHandle) return false;
  const files = [];
  try {
    for await (const [name, handle] of State.dirHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!/\.(txt|md|tcl|text)$/i.test(name)) continue;
      const file = await handle.getFile();
      files.push({
        id: `dir:${name}`, name, content: null,
        fileHandle: handle, fromDisk: true, dirFile: true,
        modified: file.lastModified
      });
    }
  } catch (e) {
    if (e.name !== 'NotAllowedError') console.error(e);
    return false;
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  State.dirFiles = files;
  try {
    State.dirIniHandle = await State.dirHandle.getFileHandle('writhdeck.ini');
  } catch (_) {
    State.dirIniHandle = null;
  }
  return true;
}

// ── Recents / favorites ───────────────────────────────────────────────────

function pushRecent(id) {
  State.recents = [id, ...State.recents.filter(r => r !== id)].slice(0, 4);
  saveRecents();
}

function removeRecent(id) {
  State.recents = State.recents.filter(r => r !== id);
  saveRecents();
}

function toggleFavorite(id) {
  const idx = State.favorites.indexOf(id);
  if (idx >= 0) State.favorites.splice(idx, 1);
  else State.favorites.unshift(id);
  saveFavorites();
}

function isFavorite(id) { return State.favorites.includes(id); }

// ── Daily stats — high-water mark ─────────────────────────────────────────

function updateDaily(id, added) {
  const today = new Date().toISOString().slice(0, 10);
  if (!State.daily[id]) State.daily[id] = {};
  const prev = State.daily[id][today] || 0;
  if (added > prev) { State.daily[id][today] = added; saveDaily(); }
}

function todayWords(id) {
  const today = new Date().toISOString().slice(0, 10);
  return (State.daily[id] && State.daily[id][today]) || 0;
}
