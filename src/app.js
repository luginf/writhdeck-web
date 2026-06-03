'use strict';
// Main entry point

// ── File info dialog ──────────────────────────────────────────────────────

async function showFileInfo() {
  const doc = State.doc;
  if (!doc) return;
  const body = document.getElementById('info-body');
  body.innerHTML = '';

  const wc = (doc.content || '').match(/\S+/g)?.length || 0;
  const cc = (doc.content || '').length;

  // Build storage label with best available path info
  let storageLabel;
  if (doc.fromDisk) {
    let pathDisplay = doc.name;
    if (doc.dirFile && State.dirHandle && doc.fileHandle) {
      // resolve() gives the path relative to the watched folder
      try {
        const parts = await State.dirHandle.resolve(doc.fileHandle);
        if (parts) pathDisplay = [State.dirHandle.name, ...parts].join('/');
      } catch (_) {}
    } else if (doc.fileHandle) {
      pathDisplay = `${doc.fileHandle.name} <span style="color:var(--fg-bar);font-size:0.85em">(folder not set — full path unavailable)</span>`;
    }
    storageLabel = `<span class="info-storage-disk">Disk file — ${pathDisplay}</span>`;
  } else {
    storageLabel = `<span class="info-storage-browser">Browser storage (IndexedDB) — not on your disk</span>`;
  }

  const rows = [
    ['Name',     doc.name],
    ['Storage',  storageLabel],
    ['Words',    wc.toLocaleString()],
    ['Chars',    cc.toLocaleString()],
    ['Created',  doc.created  ? new Date(doc.created).toLocaleString()  : '—'],
    ['Modified', doc.modified ? new Date(doc.modified).toLocaleString() : '—']
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'info-row';
    row.innerHTML = `<span class="info-label">${label}</span><span class="info-value">${value}</span>`;
    body.appendChild(row);
  });

  document.getElementById('info-dlg').showModal();
}

// ── Fullscreen ────────────────────────────────────────────────────────────

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme() {
  const s  = State.settings;
  const sc = getScheme(s.scheme);
  const dark = s.darkMode;
  const r = document.documentElement.style;

  r.setProperty('--bg',      dark ? sc.bg      : sc.bgAlt);
  r.setProperty('--fg',      dark ? sc.fg      : sc.fgAlt);
  r.setProperty('--bg-bar',  dark ? sc.bgBar   : sc.bgBarAlt);
  r.setProperty('--fg-bar',  dark ? sc.fgBar   : sc.fgBarAlt);
  r.setProperty('--bg-sel',  dark ? sc.bgSel   : sc.bgSelAlt);
  r.setProperty('--heading', dark ? sc.heading : sc.headingAlt);
  r.setProperty('--comment', dark ? sc.comment : sc.commentAlt);
  r.setProperty('--markup',  dark ? sc.markup  : sc.markupAlt);
  r.setProperty('--bg2',     dark ? (sc.bg2 || sc.bg) : (sc.bg2Alt || sc.bgAlt));

  r.setProperty('--font-family',  s.fontFamily || 'monospace');
  r.setProperty('--font-size',    (s.fontSize  || 14) + 'px');
  r.setProperty('--line-spacing', (s.lineSpacing || 1.5));
  r.setProperty('--margin-x',     (s.marginX   || 80) + 'px');
  r.setProperty('--margin-y',     (s.marginY   || 40) + 'px');
}

// ── File import ────────────────────────────────────────────────────────────

function triggerImport() {
  document.getElementById('file-import-input').click();
}

async function importFiles(files) {
  for (const file of files) {
    const text = await file.text();
    const name = file.name;
    const doc  = { name, content: text, created: Date.now(), modified: Date.now() };
    await DB.saveDoc(doc);
    State.docs.push(doc);
  }
  Browser.render();
  // If a single file, open it directly
  if (files.length === 1) {
    const last = State.docs[State.docs.length - 1];
    await Editor.open(last);
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function onKeydown(e) {
  const ctrl  = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key   = e.key;
  const lkey  = key.toLowerCase();
  const inEditor  = !document.getElementById('editor').hidden;
  const inBrowser = !document.getElementById('browser').hidden;

  Browser.hideContextMenu();

  // Global shortcuts (work anywhere, no active input focused)
  const focused = document.activeElement;
  const inInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT');

  // Dark/light toggle — global
  if (ctrl && lkey === 'd' && !inInput) {
    e.preventDefault();
    State.settings.darkMode = !State.settings.darkMode;
    saveSettings();
    applyTheme();
    if (State.doc) Editor.rehighlight();
    return;
  }

  // File import — global
  if (ctrl && lkey === 'o') {
    e.preventDefault();
    triggerImport();
    return;
  }

  // F11 — always intercept: TOC toggle in editor, ignored elsewhere
  if (key === 'F11') {
    e.preventDefault(); e.stopPropagation();
    if (inEditor) TOC.toggle();
    return;
  }

  // Alt+Enter — fullscreen toggle
  if (e.altKey && key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    toggleFullscreen();
    return;
  }

  // Editor shortcuts
  if (inEditor) {
    // Command mode — intercept ALL keys while active
    if (Editor.isCmdMode()) {
      e.preventDefault(); e.stopPropagation();
      Editor.exitCmdMode();
      switch (lkey) {
        case 's': Stats.show();    break;
        case 'i': showFileInfo();  break;
        case 't': Timer.toggle();  Editor.updateStatusBar(); break;
        case 'p': Timer.isActive() ? Timer.pause() : Timer.toggle();
                  Editor.updateStatusBar(); break;
        case 'q': Editor.close();  break;
        // any other key: just exit cmd mode (already done above)
      }
      return;
    }

    if (ctrl && lkey === 's')     { e.preventDefault(); e.stopPropagation(); Editor.save();            return; }
    if (ctrl && lkey === 'q')     { e.preventDefault(); e.stopPropagation(); Editor.close();           return; }
    if (ctrl && lkey === 'f')     { e.preventDefault(); e.stopPropagation(); Editor.searchOpen(false); return; }
    if (ctrl && lkey === 'h')     { e.preventDefault(); e.stopPropagation(); Editor.searchOpen(true);  return; }
    if (e.altKey && lkey === 't') { e.preventDefault(); e.stopPropagation(); Timer.toggle(); Editor.updateStatusBar(); return; }
    if (lkey === 'escape') {
      e.preventDefault(); e.stopPropagation();
      const openDlg = document.querySelector('dialog[open]');
      if (openDlg) { openDlg.close(); return; }
      if (!document.getElementById('search-bar').hidden) { Editor.searchClose(); return; }
      // ESC enters command mode
      Editor.enterCmdMode();
      return;
    }
    // Hemingway mode
    if (State.settings.hemingwayMode && (lkey === 'backspace' || lkey === 'delete')) {
      e.preventDefault(); return;
    }
  }

  // Browser shortcuts (no input focused)
  if (inBrowser && !inInput) {
    if (lkey === 'n') { e.preventDefault(); Browser.newDoc();        return; }
    if (lkey === 'o' && Browser.hasFSA) { e.preventDefault(); Browser.openFromDisk(); return; }
    if (lkey === 'w' && Browser.hasFSA) { e.preventDefault(); Browser.openFolder();   return; }
    if (lkey === 's') { e.preventDefault(); Stats.show();            return; }
    if (lkey === 'c') { e.preventDefault(); Settings.show();         return; }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  await DB.open();
  await loadState();
  applyTheme();

  // Restore watched folder if permission still granted (silent — no user gesture needed for query)
  if (State.dirHandle) {
    try {
      const perm = await State.dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await scanDir();
        // Auto-load writhdeck.ini from the watched folder (silent, no prompt)
        if (State.dirIniHandle) {
          try {
            const f = await State.dirIniHandle.getFile();
            const { settings, schemes } = INI.parseIni(await f.text());
            Object.assign(State.settings, settings);
            for (const [n, sc] of Object.entries(schemes)) {
              if (!SCHEMES[n]) customSchemes[n] = sc;
            }
            await saveSettings();
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  Browser.render();

  // First run — no INI yet → save defaults to IDB
  if (!State.iniText) await saveSettings();

  // Wire editor textarea events
  const ta = document.getElementById('ed-input');
  ta.addEventListener('input',  () => Editor.onInput());
  ta.addEventListener('scroll', () => Editor.syncScroll());

  // Header buttons
  document.getElementById('br-new-btn').addEventListener('click',    () => Browser.newDoc());
  document.getElementById('br-import-btn').addEventListener('click', triggerImport);
  document.getElementById('br-folder-btn').addEventListener('click',  () => Browser.openFolder());
  document.getElementById('br-opendisk-btn').addEventListener('click', () => Browser.openFromDisk());
  document.getElementById('ed-close-btn').addEventListener('click',  () => Editor.close());
  document.getElementById('ed-settings-btn').addEventListener('click', () => Settings.show());
  document.getElementById('ed-toc-btn').addEventListener('click',    () => TOC.toggle());

  // File import input
  const fileInput = document.getElementById('file-import-input');
  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length) {
      await importFiles(Array.from(fileInput.files));
      fileInput.value = ''; // reset so same file can be re-imported
    }
  });
  // Drag and drop on browser panel
  const browserEl = document.getElementById('browser');
  browserEl.addEventListener('dragover', e => { e.preventDefault(); browserEl.style.outline = '2px dashed var(--heading)'; });
  browserEl.addEventListener('dragleave', () => { browserEl.style.outline = ''; });
  browserEl.addEventListener('drop', async e => {
    e.preventDefault();
    browserEl.style.outline = '';
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(txt|md|tcl|text)$/i.test(f.name));
    if (files.length) await importFiles(files);
  });

  // Export menu
  const exportBtn  = document.getElementById('ed-export-btn');
  const exportMenu = document.getElementById('export-menu');
  exportBtn.addEventListener('click', e => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
  exportMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { exportMenu.hidden = true; Editor.exportDoc(btn.dataset.fmt); });
  });
  document.addEventListener('click', () => { exportMenu.hidden = true; });

  // Search bar
  document.getElementById('search-input').addEventListener('input',  () => Editor.searchUpdate());
  document.getElementById('search-next').addEventListener('click',   () => Editor.searchNext());
  document.getElementById('search-prev').addEventListener('click',   () => Editor.searchPrev());
  document.getElementById('replace-one').addEventListener('click',   () => Editor.replaceOne());
  document.getElementById('replace-all').addEventListener('click',   () => Editor.replaceAll());
  document.getElementById('search-close').addEventListener('click',  () => Editor.searchClose());
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.shiftKey) Editor.searchPrev();
    else if (e.key === 'Enter')          Editor.searchNext();
    else if (e.key === 'Escape')         Editor.searchClose();
  });

  // Dialog close buttons
  document.getElementById('info-close').addEventListener('click',      () => document.getElementById('info-dlg').close());
  document.getElementById('stats-close').addEventListener('click',     () => document.getElementById('stats-dlg').close());
  document.getElementById('timer-alert-ok').addEventListener('click',  () => document.getElementById('timer-alert-dlg').close());

  // Misc tab import button (shares triggerImport)
  document.getElementById('misc-import-btn').addEventListener('click', triggerImport);

  // Settings
  Settings.initEvents();

  // Keyboard — capture phase so we intercept before browser default handlers
  document.addEventListener('keydown', onKeydown, true);

  // Save cursor + dirty guard on unload
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && State.doc) Editor.saveCursorPos();
  });
  window.addEventListener('beforeunload', e => {
    if (State.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Open last doc if configured
  if (State.settings.openLastDoc && State.recents.length) {
    const lastId = State.recents[0];
    const doc = State.docs.find(d => d.id === lastId);
    if (doc) await Editor.open(doc);
  }
}

document.addEventListener('DOMContentLoaded', init);
