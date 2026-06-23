'use strict';
// User-supplied editor fonts — the web counterpart of writhdeck-android's
// <configDir>/fonts/ folder. The user uploads .ttf/.otf (also .woff/.woff2)
// files; each is registered at runtime via the CSS Font Loading API
// (`FontFace`) and the binary is persisted in IndexedDB (`meta['userFonts']`)
// so it survives reloads. The chosen font name lives in the INI's `font_family`
// value exactly like a system font — no special INI handling needed.
const Fonts = (() => {
  const META_KEY = 'userFonts';
  const FONT_RE  = /\.(ttf|otf|woff2?)$/i;
  let _fonts = [];        // uploaded, persisted in IndexedDB: [{ name, data: ArrayBuffer }]
  let _folderFonts = [];  // names found in <watchedFolder>/fonts/ (on disk, not persisted)

  // Registers a FontFace from a binary buffer and adds it to document.fonts.
  async function register(name, data) {
    try {
      const face = new FontFace(name, data);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch (e) {
      console.warn('Font load failed:', name, e);
      return false;
    }
  }

  // Called once at startup (app.js init): re-registers every stored font so
  // custom fonts render immediately, before applyTheme().
  async function load() {
    try { _fonts = (await DB.getMeta(META_KEY)) || []; }
    catch (_) { _fonts = []; }
    for (const f of _fonts) await register(f.name, f.data);
  }

  // Adds one uploaded File: registers it and persists the binary. Returns the
  // derived font name (filename without extension) on success, or null.
  async function add(file) {
    const buf  = await file.arrayBuffer();
    const name = file.name.replace(FONT_RE, '').trim() || file.name;
    if (!await register(name, buf)) return null;
    _fonts = _fonts.filter(f => f.name !== name);   // replace same-named font
    _fonts.push({ name, data: buf });
    await DB.setMeta(META_KEY, _fonts);
    return name;
  }

  // Forgets a stored font. The already-registered FontFace can't be reliably
  // un-added cross-browser, but it's gone after the next reload.
  async function remove(name) {
    _fonts = _fonts.filter(f => f.name !== name);
    await DB.setMeta(META_KEY, _fonts);
  }

  // Scans a `fonts/` subfolder of the watched folder (File System Access API,
  // Chromium only) and registers every .ttf/.otf/.woff(2) it holds — the web
  // counterpart of writhdeck-android's docsDir/fonts. These live on disk, so
  // they're re-scanned each time access is granted rather than persisted, and
  // are not removable from the UI. Call after scanDir() at the watched root.
  async function loadFromFolder(rootHandle) {
    _folderFonts = [];
    if (!rootHandle) return _folderFonts;
    let dir;
    try { dir = await rootHandle.getDirectoryHandle('fonts'); }
    catch (_) { return _folderFonts; }   // no fonts/ subfolder
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file' || !FONT_RE.test(name)) continue;
        try {
          const buf = await (await handle.getFile()).arrayBuffer();
          const fontName = name.replace(FONT_RE, '');
          if (await register(fontName, buf)) _folderFonts.push(fontName);
        } catch (_) {}
      }
    } catch (_) {}
    return _folderFonts;
  }

  function names() { return _fonts.map(f => f.name); }
  function folderNames() { return _folderFonts.slice(); }

  return { load, add, remove, names, loadFromFolder, folderNames };
})();
