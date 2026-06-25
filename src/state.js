'use strict';
// In-memory application state
const State = {
  doc:   null,  // { id, name, content, created, modified }
  dirty: false,

  docs: [],   // IDB-backed document list

  // Watched folder (File System Access API)
  dirHandle:    null,
  dirFiles:     [],   // in-memory only, rebuilt by scanDir()
  dirSubdirs:   [],   // [{name, handle}] subdirectories of the current folder
  dirStack:     [],   // [{name, handle}] root..current dir for subfolder navigation
  dirIniHandle: null, // FileSystemFileHandle for writhdeck.ini in folder

  // Cached INI text — the canonical settings format in IDB
  iniText: '',

  // Per-profile overrides (12-key aligned set — see ini.js PROFILE_JS_KEYS)
  profiles: {},        // {name: {jsKey: value, ...}}
  activeProfile: 'default',
  profileNames: [],

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
    interceptContextMenu: true,
    browserFilter: '*.txt *.t2t *.md *.ini',
    browserShowAll: false,
    browserSubdirs: true,
    // 'auto' = follow navigator.language; otherwise forces the UI to a specific
    // language regardless of the browser's locale ('en', 'fr', 'es', ...).
    language: 'auto'
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
    const { settings, schemes, profiles, activeProfile } = INI.parseIni(iniText);
    Object.assign(State.settings, settings);
    // Only load non-built-in schemes: built-in colors come from code, not IDB
    for (const [n, sc] of Object.entries(schemes)) {
      if (!SCHEMES[n]) customSchemes[n] = sc;
    }
    State.customSchemes = { ...customSchemes };
    State.iniText = iniText;
    applyParsedProfiles(profiles, activeProfile);
  } else if (oldSettings) {
    // One-time migration from legacy JSON format
    Object.assign(State.settings, oldSettings);
    if (oldCs) Object.assign(customSchemes, oldCs);
    State.customSchemes = { ...customSchemes };
    seedProfilesIfMissing();
    await saveSettings();             // re-persist as INI
    await DB.setMeta('settings', null);
    await DB.setMeta('customSchemes', null);
  }
  // else: first run — defaults are in place, INI saved after init by app.js

  seedProfilesIfMissing();

  if (favorites) State.favorites = favorites;
  if (recents)   State.recents   = recents;
  if (cursors)   State.cursors   = cursors;
  if (daily)     State.daily     = daily;
  if (dh)        State.dirHandle = dh;

  State.docs = await DB.getAllDocs();
}

// ── Profiles ──────────────────────────────────────────────────────────────

// Adopts profiles parsed from an INI file (no-op if the file had none),
// merging the active profile's overrides onto State.settings.
function applyParsedProfiles(profiles, activeProfile) {
  if (Object.keys(profiles).length === 0) return;
  State.profiles = profiles;
  State.activeProfile = profiles[activeProfile] ? activeProfile : Object.keys(profiles)[0];
  State.profileNames = Object.keys(profiles);
  Object.assign(State.settings, State.profiles[State.activeProfile] || {});
}

// First-run / older-INI fallback: seed `default` (snapshot of current
// settings, lossless) plus a `novel` profile, mirroring the Android/Tcl
// "two starter profiles" set.
function seedProfilesIfMissing() {
  if (Object.keys(State.profiles).length > 0) {
    State.profileNames = Object.keys(State.profiles);
    return;
  }
  const extract = () => Object.fromEntries(INI.PROFILE_JS_KEYS.map(k => [k, State.settings[k]]));
  const novel = extract();
  novel.scheme           = 'everforest';
  novel.marginX          = State.settings.marginX * 2;
  novel.marginY          = Math.round(State.settings.marginY * 1.5);
  novel.wordGoal         = 1000;
  novel.fontSize         = State.settings.fontSize + 2;
  novel.fontFamily       = 'serif';
  novel.lineSpacing      = Math.round(State.settings.lineSpacing * 1.2 * 10) / 10;
  novel.markdownHeadings = false;

  State.profiles = { default: extract(), novel };
  State.activeProfile = 'default';
  State.profileNames = Object.keys(State.profiles);
}

// ── Settings — INI is canonical ───────────────────────────────────────────

async function saveSettings() {
  const allSchemes = { ...SCHEMES, ...customSchemes };
  const text = INI.writeIni(State.settings, allSchemes, State.profiles, State.activeProfile);
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
  State.dirSubdirs   = [];
  State.dirStack     = [];
  State.dirIniHandle = null;
  await DB.setMeta('dirHandle', null);
}

// ── Browser file filter ───────────────────────────────────────────────────
// Mirrors the Tcl desktop's `list-docs` filtering: an empty filter or
// browserShowAll=true shows everything; otherwise glob-match (case-insensitive,
// `*`/`?`/`[...]`) against each space-separated pattern.

function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) re += '\\[';
      else { re += '[' + pattern.slice(i + 1, close) + ']'; i = close; }
    }
    else if ('.+^${}()|\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$', 'i');
}

function matchesBrowserFilter(name) {
  if (State.settings.browserShowAll) return true;
  const patterns = (State.settings.browserFilter || '').trim().split(/\s+/).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some(pat => globToRegex(pat).test(name));
}

// ── Watched folder ────────────────────────────────────────────────────────

// Handle of the folder currently being browsed (root, or a subfolder when
// the user has navigated into one via subfolder navigation).
function currentDir() {
  if (State.dirStack.length) return State.dirStack[State.dirStack.length - 1].handle;
  return State.dirHandle;
}

// Relative path (with trailing '/') from the watched root to the current
// folder, e.g. "chapters/act1/" — "" when at the root. Used to build unique
// ids and to display the breadcrumb.
function dirRelPath() {
  if (State.dirStack.length <= 1) return '';
  return State.dirStack.slice(1).map(s => s.name).join('/') + '/';
}

async function scanDir() {
  if (!State.dirHandle) return false;
  // Initialise / repair the navigation stack to the root.
  if (!State.dirStack.length) State.dirStack = [{ name: State.dirHandle.name, handle: State.dirHandle }];
  // When subfolder navigation is off, never browse below the root.
  if (!State.settings.browserSubdirs && State.dirStack.length > 1) {
    State.dirStack = [State.dirStack[0]];
  }
  const cur = currentDir();
  const rel = dirRelPath();
  const files = [];
  const subdirs = [];
  try {
    for await (const [name, handle] of cur.entries()) {
      if (handle.kind === 'directory') {
        if (State.settings.browserSubdirs && name !== 'backups') subdirs.push({ name, handle });
        continue;
      }
      if (handle.kind !== 'file') continue;
      if (!matchesBrowserFilter(name)) continue;
      const file = await handle.getFile();
      files.push({
        id: `dir:${rel}${name}`, name, content: null,
        fileHandle: handle, fromDisk: true, dirFile: true,
        modified: file.lastModified
      });
    }
  } catch (e) {
    if (e.name !== 'NotAllowedError') console.error(e);
    return false;
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  subdirs.sort((a, b) => a.name.localeCompare(b.name));
  State.dirFiles = files;
  State.dirSubdirs = subdirs;
  try {
    State.dirIniHandle = await currentDir().getFileHandle('writhdeck.ini');
  } catch (_) {
    State.dirIniHandle = null;
  }
  return true;
}

// Enter a subfolder (by name, from State.dirSubdirs) and rescan.
async function dirEnter(name) {
  const sub = State.dirSubdirs.find(s => s.name === name);
  if (!sub) return;
  State.dirStack.push(sub);
  await scanDir();
}

// Go up one folder (no-op at the root) and rescan.
async function dirUp() {
  if (State.dirStack.length <= 1) return;
  State.dirStack.pop();
  await scanDir();
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
