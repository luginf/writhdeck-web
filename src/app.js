'use strict';
// Main entry point

const README_CONTENT = {{README}};

let _edMenu          = null;
let _openMenuFn      = null;
let _menuNavLock     = false;
let _edCtxMenu       = null;
let _helpDetails     = null;
let _menuActionTime  = 0;

function hideEditorCtxMenu() {
  if (_edCtxMenu) { _edCtxMenu.remove(); _edCtxMenu = null; }
}

function showMainMenu() {
  if (!_edMenu || !_openMenuFn) return;
  _openMenuFn();
  _edMenu.hidden = true;
  setTimeout(() => { _edMenu.hidden = false; }, 0);
}

// ── File info dialog ──────────────────────────────────────────────────────

async function showFileInfo(docArg) {
  const doc = docArg || State.doc;
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

// ── Word occurrences dialog ───────────────────────────────────────────────

async function showWordOcc(docArg) {
  const doc = docArg || State.doc;
  if (!doc) return;

  let content = doc.content;
  if (content == null) {
    if (doc.fileHandle) {
      try { const f = await doc.fileHandle.getFile(); content = await f.text(); }
      catch(_) { content = ''; }
    } else if (doc.id && typeof doc.id === 'number') {
      const full = await DB.getDoc(doc.id);
      content = full ? full.content : '';
    } else { content = ''; }
  }

  const counts = {};
  const words = content.toLowerCase().match(/[\wÀ-ɏ]+/g) || [];
  words.forEach(w => { if (w.length >= 3) counts[w] = (counts[w] || 0) + 1; });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const body = document.getElementById('words-body');
  body.innerHTML = '';

  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--fg-bar);padding:12px 0';
    empty.textContent = 'No words found.';
    body.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'words-table';
    table.innerHTML = '<tr><th>Word</th><th>#</th></tr>';
    sorted.forEach(([word, count]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${word}</td><td>${count}</td>`;
      table.appendChild(tr);
    });
    body.appendChild(table);
  }

  document.getElementById('words-title').textContent = `Word occurrences — ${doc.name}`;
  document.getElementById('words-dlg').showModal();
}

// ── Structure analyse dialog ──────────────────────────────────────────────

async function showAnalyse(docArg) {
  const doc = docArg || State.doc;
  if (!doc) return;

  let content = doc.content;
  if (content == null) {
    if (doc.fileHandle) {
      try {
        const file = await doc.fileHandle.getFile();
        content = await file.text();
      } catch(_) { content = ''; }
    } else if (doc.id && typeof doc.id === 'number') {
      const full = await DB.getDoc(doc.id);
      content = full ? full.content : '';
    } else {
      content = '';
    }
  }

  const s = State.settings;

  function parseHeading(line) {
    if (s.headingMarker && line.startsWith(s.headingMarker)) {
      let n = 1;
      while (n < 3 && line.startsWith(s.headingMarker.repeat(n + 1))) n++;
      const mEsc = escRx(s.headingMarker);
      const title = line
        .replace(new RegExp('^' + mEsc + '+\\s*'), '')
        .replace(new RegExp('\\s*' + mEsc + '+\\s*$'), '')
        .trim();
      return { level: n, title: title || line.trim() };
    }
    if (s.markdownHeadings) {
      const m = line.match(/^(#{1,6})\s+(.*)/);
      if (m) return { level: m[1].length, title: m[2].trim() };
    }
    return null;
  }

  const sections = [];
  let curTitle = null, curLevel = 0, curWords = 0;

  content.split('\n').forEach(line => {
    const h = parseHeading(line);
    if (h) {
      sections.push({ title: curTitle, level: curLevel, words: curWords });
      curTitle = h.title; curLevel = h.level; curWords = 0;
    } else {
      curWords += (line.match(/\S+/g) || []).length;
    }
  });
  sections.push({ title: curTitle, level: curLevel, words: curWords });

  const total = sections.reduce((acc, sec) => acc + sec.words, 0);

  document.getElementById('analyse-title').textContent = `Structure — ${doc.name}`;
  const body = document.getElementById('analyse-body');
  body.innerHTML = '';

  if (total === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px 0;color:var(--fg-bar)';
    empty.textContent = 'No content to analyse.';
    body.appendChild(empty);
    document.getElementById('analyse-dlg').showModal();
    return;
  }

  const maxBar = 240; // px — max bar width at 100%
  sections.forEach(sec => {
    if (sec.words === 0 && sec.title === null) return;
    const pct = total > 0 ? Math.round(sec.words / total * 100) : 0;
    const barW = Math.max(2, Math.round(pct / 100 * maxBar));
    const indent = sec.level > 1 ? (sec.level - 1) * 14 : 0;
    const label = sec.title || '(début)';

    const row = document.createElement('div');
    row.className = 'analyse-row';
    row.style.paddingLeft = indent + 'px';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'analyse-title';
    if (sec.level > 0) {
      const lvl = document.createElement('span');
      lvl.className = 'analyse-level';
      lvl.textContent = 'H' + sec.level;
      titleDiv.appendChild(lvl);
    }
    const txt = document.createElement('span');
    txt.className = 'analyse-title-text';
    txt.textContent = label;
    titleDiv.appendChild(txt);
    row.appendChild(titleDiv);

    const barWrap = document.createElement('div');
    barWrap.className = 'analyse-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'analyse-bar';
    bar.style.width = barW + 'px';
    const stats = document.createElement('span');
    stats.className = 'analyse-stats';
    stats.textContent = sec.words.toLocaleString() + 'w · ' + pct + '%';
    barWrap.appendChild(bar);
    barWrap.appendChild(stats);
    row.appendChild(barWrap);

    body.appendChild(row);
  });

  const sectionCount = sections.filter(sec => sec.title !== null).length;
  const footer = document.createElement('div');
  footer.className = 'analyse-footer';
  footer.textContent = `Total : ${total.toLocaleString()} mots · ${sectionCount} section${sectionCount !== 1 ? 's' : ''}`;
  body.appendChild(footer);

  document.getElementById('analyse-words-btn').onclick = () => {
    document.getElementById('analyse-dlg').close();
    showWordOcc(doc);
  };
  document.getElementById('analyse-dlg').showModal();
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

  document.getElementById('editor').classList.toggle('block-cursor', !!s.blockCursor);
  document.getElementById('editor').classList.toggle('no-blink', s.blinkCursor === false);
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
  if (_helpDetails && _helpDetails.open && lkey === 'escape') { _helpDetails.open = false; return; }

  // Menu keyboard handling — intercept at capture level regardless of focus.
  if (_edMenu && !_edMenu.hidden) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!_menuNavLock) {
        _menuNavLock = true;
        requestAnimationFrame(() => { _menuNavLock = false; });
        const items = Array.from(_edMenu.querySelectorAll('button:not(:disabled)'));
        const idx   = items.indexOf(document.activeElement);
        const next  = key === 'ArrowDown'
          ? items[(idx + 1) % items.length]
          : items[(idx - 1 + items.length) % items.length];
        if (next) next.focus();
      }
      return;
    }
    // Enter — activate focused button
    if (key === 'Enter') {
      const focused = document.activeElement;
      if (focused && _edMenu.contains(focused)) {
        e.preventDefault(); e.stopPropagation();
        focused.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return;
      }
    }
    // Letter shortcut — activate button whose hint matches
    if (!ctrl && !e.altKey && lkey.length === 1) {
      const match = Array.from(_edMenu.querySelectorAll('button:not(:disabled)')).find(b => {
        const hint = b.querySelector('.hint');
        return hint && hint.textContent.trim() === lkey;
      });
      if (match) {
        e.preventDefault(); e.stopPropagation();
        match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return;
      }
    }
  }

  // Global shortcuts (work anywhere, no active input focused)
  const focused = document.activeElement;
  const inInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT');

  // Dark/light toggle — global (works even in editor textarea)
  if (ctrl && lkey === 'd') {
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

  // TOC keyboard navigation — active while focus is on the panel (moved there on open)
  if (inEditor && TOC.isVisible() && TOC.isFocused()) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      TOC.move(key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      TOC.selectFocused();
      return;
    }
    if (lkey === 'escape') {
      e.preventDefault(); e.stopPropagation();
      TOC.hide();
      const ta = document.getElementById('ed-input');
      if (ta) ta.focus();
      return;
    }
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
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        Editor.cmdNavMove(key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (key === 'Enter') {
        const cmd = Editor.getCmdNavKey();
        if (cmd) {
          document.dispatchEvent(new CustomEvent('writhdeck-cmd', { detail: cmd }));
          return;
        }
      }
      Editor.exitCmdMode();
      switch (lkey) {
        case 'f': Editor.searchOpen(false);  break;
        case 'r': Editor.searchOpen(true);   break;
        case 'g': Editor.gotoLine();         break;
        case 'n': Editor.toggleLineNumbers(); break;
        case 'd':
          State.settings.darkMode = !State.settings.darkMode;
          saveSettings(); applyTheme();
          if (State.doc) Editor.rehighlight();
          break;
        case 'o': TOC.toggle();              break;
        case 'c': Settings.show();           break;
        case 'e': Editor.exportDoc('txt'); break;
        case 's': Stats.show();              break;
        case 'a': showAnalyse();             break;
        case 'i': showFileInfo();            break;
        case 't': Timer.toggle();  Editor.updateStatusBar(); break;
        case 'p': Timer.isActive() ? Timer.pause() : Timer.toggle();
                  Editor.updateStatusBar(); break;
        case 'w': Editor.toggleTypewriter(); break;
        case 'm': showMainMenu(); break;
        case 'q': Editor.close();            break;
        // any other key: just exit cmd mode (already done above)
      }
      return;
    }

    if (ctrl && lkey === 's')     { e.preventDefault(); e.stopPropagation(); Editor.save();              return; }
    if (ctrl && lkey === 'q')     { e.preventDefault(); e.stopPropagation(); Editor.close();             return; }
    if (ctrl && lkey === 'f')     { e.preventDefault(); e.stopPropagation(); Editor.searchOpen(false);   return; }
    if (ctrl && lkey === 'h')     { e.preventDefault(); e.stopPropagation(); Editor.searchOpen(true);    return; }
    if (ctrl && lkey === 'g')     { e.preventDefault(); e.stopPropagation(); Editor.gotoLine();          return; }
    if (ctrl && lkey === 'l')     { e.preventDefault(); e.stopPropagation(); Editor.toggleLineNumbers();  return; }
    if (e.altKey && lkey === 't') { e.preventDefault(); e.stopPropagation(); Timer.toggle(); Editor.updateStatusBar(); return; }
    if (e.altKey && lkey === 'c') { e.preventDefault(); e.stopPropagation(); Editor.enterCmdMode(); return; }
    if (e.altKey && lkey === 'm') { e.preventDefault(); e.stopPropagation(); showMainMenu(); return; }

    if (lkey === 'escape') {
      e.preventDefault(); e.stopPropagation();
      if (_edCtxMenu) { hideEditorCtxMenu(); return; }
      if (_edMenu && !_edMenu.hidden) { _edMenu.hidden = true; return; }
      const openDlg = document.querySelector('dialog[open]');
      if (openDlg) { openDlg.close(); return; }
      if (!document.getElementById('search-bar').hidden) { Editor.searchClose(); return; }
      if (!document.getElementById('goto-bar').hidden)   { Editor.gotoLineClose(); return; }
      // ESC enters command mode
      Editor.enterCmdMode();
      return;
    }
    // Hemingway mode
    if (State.settings.hemingwayMode && (lkey === 'backspace' || lkey === 'delete')) {
      e.preventDefault(); return;
    }
  }

  // Ctrl+N → new document (overrides browser "new window", requires option)
  if (State.settings.interceptBrowserShortcuts && ctrl && lkey === 'n' && !inInput) {
    e.preventDefault(); e.stopPropagation(); Browser.newDoc(); return;
  }

  // Browser shortcuts (no input focused)
  if (inBrowser && !inInput) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(document.querySelectorAll('#br-list .br-nav-item'));
      if (!items.length) return;
      const cur = document.querySelector('#br-list .br-nav-item.br-focused');
      const idx = cur ? items.indexOf(cur) : -1;
      const next = idx === -1
        ? (key === 'ArrowDown' ? 0 : items.length - 1)
        : key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      if (cur) cur.classList.remove('br-focused');
      items[next].classList.add('br-focused');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (key === 'Enter') {
      const cur = document.querySelector('#br-list .br-nav-item.br-focused');
      if (cur) { e.preventDefault(); cur.click(); return; }
    }
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
            applyTheme(); // re-appliquer après maj des settings depuis le dossier
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
  // Update line/col on cursor move (click or keyboard navigation); also keep
  // the incremental-repaint line cache in sync so a click to a different line
  // followed by typing patches the right DOM node (see syncCursorLineCache).
  ta.addEventListener('click',   () => { Editor.syncCursorLineCache(); Editor.updateStatusBar(); if (State.settings.blockCursor) Editor.rehighlight(); });
  ta.addEventListener('keyup',   () => { Editor.syncCursorLineCache(); Editor.updateStatusBar(); if (State.settings.blockCursor) Editor.rehighlight(); });

  // Header buttons
  document.getElementById('br-new-btn').addEventListener('click',    () => Browser.newDoc());
  document.getElementById('br-import-btn').addEventListener('click', triggerImport);
  document.getElementById('br-folder-btn').addEventListener('click',  () => Browser.openFolder());
  document.getElementById('br-opendisk-btn').addEventListener('click', () => Browser.openFromDisk());
  document.getElementById('ed-close-btn').addEventListener('click', () => Editor.close());

  // Help menu (? button) — native <details> toggle, no JS click handler needed
  const helpDetails = document.getElementById('br-help-details');
  _helpDetails = helpDetails;

  document.getElementById('br-help-readme').addEventListener('click', async () => {
    helpDetails.open = false;
    let doc = State.docs.find(d => d.name === 'README.md');
    if (!doc) {
      doc = { name: 'README.md', content: README_CONTENT, created: Date.now(), modified: Date.now() };
      await DB.saveDoc(doc);
      State.docs.push(doc);
      Browser.render();
    }
    await Editor.open(doc);
  });

  document.getElementById('br-help-settings').addEventListener('click', () => {
    helpDetails.open = false;
    Settings.show();
  });

  // File import input
  const fileInput = document.getElementById('file-import-input');
  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length) {
      await importFiles(Array.from(fileInput.files));
      fileInput.value = '';
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

  // Main editor menu (≡ button)
  const menuBtn  = document.getElementById('ed-menu-btn');
  const edMenu   = document.getElementById('ed-menu');
  _edMenu = edMenu;

  function execCmd(cmd) {
    edMenu.hidden = true;
    switch (cmd) {
      case 'toc':        TOC.toggle();              break;
      case 'dark':
        State.settings.darkMode = !State.settings.darkMode;
        saveSettings(); applyTheme();
        if (State.doc) Editor.rehighlight();
        break;
      case 'linenos':    Editor.toggleLineNumbers(); break;
      case 'typewriter': Editor.toggleTypewriter();  break;
      case 'find':       Editor.searchOpen(false);   break;
      case 'replace':    Editor.searchOpen(true);    break;
      case 'goto':       Editor.gotoLine();          break;
      case 'export-txt': Editor.exportDoc('txt');    break;
      case 'export-md':  Editor.exportDoc('md');     break;
      case 'stats':      Stats.show();               break;
      case 'analyse':    showAnalyse();              break;
      case 'word-occ':   showWordOcc();              break;
      case 'info':       showFileInfo();             break;
      case 'timer':      Timer.toggle(); Editor.updateStatusBar(); break;
      case 'block-cursor':
        State.settings.blockCursor = !State.settings.blockCursor;
        saveSettings();
        applyTheme();
        if (State.doc) Editor.rehighlight();
        break;
      case 'ctx-menu':
        State.settings.interceptContextMenu = !State.settings.interceptContextMenu;
        saveSettings();
        Editor.setMsg(State.settings.interceptContextMenu ? 'Right-click menu on' : 'Right-click menu off');
        break;
      case 'config':     Settings.show();            break;
    }
  }

  function openMenu() {
    const s  = State.settings;
    const hm = s.headingMarker || '';
    [1, 2, 3].forEach(lvl => {
      const btn = edMenu.querySelector(`[data-markup="h${lvl}"]`);
      const p   = hm.repeat(lvl);
      btn.innerHTML = hm ? `<span>${p} H${lvl} ${p}</span>` : `<span>H${lvl}</span>`;
      btn.disabled  = !hm;
    });
    [['comment', s.commentMarker, 'Comment (line)'],
     ['bold',    s.boldMarker,    'Bold'],
     ['italic',  s.italicMarker,  'Italic'],
     ['underline', s.underlineMarker, 'Underline'],
     ['strike',  s.strikeMarker,  'Strike'],
    ].forEach(([type, marker, label]) => {
      const btn = edMenu.querySelector(`[data-markup="${type}"]`);
      btn.innerHTML = marker ? `<span>${marker} ${label}</span>` : `<span>${label}</span>`;
      btn.disabled  = !marker;
    });
    // Update toggle labels
    const ctxBtn = edMenu.querySelector('[data-cmd="ctx-menu"]');
    if (ctxBtn) ctxBtn.innerHTML = `Right-click menu <span class="hint">${s.interceptContextMenu ? 'on' : 'off'}</span>`;
    const bcBtn = edMenu.querySelector('[data-cmd="block-cursor"]');
    if (bcBtn) bcBtn.innerHTML = `Block cursor <span class="hint">${s.blockCursor ? 'on' : 'off'}</span>`;
    edMenu.hidden = false;
  }
  _openMenuFn = openMenu;

  function menuItems() {
    return Array.from(edMenu.querySelectorAll('button:not(:disabled)'));
  }

  // Prevent menu button from stealing textarea focus (preserves selection).
  menuBtn.addEventListener('mousedown', e => e.preventDefault());
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!edMenu.hidden) { edMenu.hidden = true; return; }
    openMenu();
    edMenu.hidden = true;
    setTimeout(() => { edMenu.hidden = false; }, 0);
  });

  function menuGuard() {
    const now = Date.now();
    if (now - _menuActionTime < 150) return false;
    _menuActionTime = now;
    return true;
  }

  document.getElementById('ed-more-cmd').addEventListener('mousedown', e => {
    if (!menuGuard()) return;
    e.preventDefault();
    edMenu.hidden = true;
    Editor.enterCmdMode();
  });

  edMenu.querySelectorAll('[data-markup]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      if (!menuGuard()) return;
      e.preventDefault();
      edMenu.hidden = true;
      const s = State.settings;
      switch (btn.dataset.markup) {
        case 'h1':        Editor.applyHeading(1);                      break;
        case 'h2':        Editor.applyHeading(2);                      break;
        case 'h3':        Editor.applyHeading(3);                      break;
        case 'comment':   Editor.applyLineMarker(s.commentMarker);     break;
        case 'bold':      Editor.applyInlineMarker(s.boldMarker);      break;
        case 'italic':    Editor.applyInlineMarker(s.italicMarker);    break;
        case 'underline': Editor.applyInlineMarker(s.underlineMarker); break;
        case 'strike':    Editor.applyInlineMarker(s.strikeMarker);    break;
      }
    });
  });

  edMenu.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      if (!menuGuard()) return;
      e.preventDefault();
      execCmd(btn.dataset.cmd);
    });
  });

  document.addEventListener('click', e => { edMenu.hidden = true; if (!helpDetails.contains(e.target)) helpDetails.open = false; hideEditorCtxMenu(); });

  // ── Editor right-click context menu ──────────────────────────────────────

  function buildCtxMenu(e) {
    if (!State.settings.interceptContextMenu) return;
    e.preventDefault();
    hideEditorCtxMenu();

    const s   = State.settings;
    const ta  = document.getElementById('ed-input');
    const sel = ta.selectionStart !== ta.selectionEnd;

    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;
      background:var(--bg-bar);border:1px solid var(--fg-bar);z-index:200;min-width:180px;`;

    function sep() {
      const d = document.createElement('div');
      d.style.cssText = 'height:1px;background:var(--fg-bar);opacity:0.3;margin:3px 0;';
      menu.appendChild(d);
    }

    function item(label, fn, disabled) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.disabled = !!disabled;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 14px;' +
        'border:none;background:none;font-family:var(--font-family);font-size:var(--font-size);color:var(--fg);';
      btn.addEventListener('mousedown', ev => ev.preventDefault());
      btn.addEventListener('click', () => { hideEditorCtxMenu(); fn(); });
      menu.appendChild(btn);
    }

    // Format
    const hm = s.headingMarker;
    if (hm) {
      item(`${hm} H1 ${hm}`, () => Editor.applyHeading(1));
      item(`${hm.repeat(2)} H2 ${hm.repeat(2)}`, () => Editor.applyHeading(2));
      item(`${hm.repeat(3)} H3 ${hm.repeat(3)}`, () => Editor.applyHeading(3));
    }
    if (s.commentMarker)   item(`${s.commentMarker} Comment`, () => Editor.applyLineMarker(s.commentMarker));
    if (s.boldMarker)      item(`${s.boldMarker} Bold`,       () => Editor.applyInlineMarker(s.boldMarker),      !sel);
    if (s.italicMarker)    item(`${s.italicMarker} Italic`,   () => Editor.applyInlineMarker(s.italicMarker),    !sel);
    if (s.underlineMarker) item(`${s.underlineMarker} Underline`, () => Editor.applyInlineMarker(s.underlineMarker), !sel);
    if (s.strikeMarker)    item(`${s.strikeMarker} Strike`,   () => Editor.applyInlineMarker(s.strikeMarker),    !sel);

    sep();

    // Edit
    item('Cut',   () => document.execCommand('cut'),  !sel);
    item('Copy',  () => document.execCommand('copy'), !sel);
    item('Paste', async () => {
      try {
        const text = await navigator.clipboard.readText();
        ta.focus();
        document.execCommand('insertText', false, text);
        Editor.onInput();
      } catch (_) {}
    });

    sep();

    // Spell check toggle
    item(`Spell check: ${ta.spellcheck ? 'on' : 'off'}`, () => { ta.spellcheck = !ta.spellcheck; });

    document.body.appendChild(menu);
    _edCtxMenu = menu;

    // Clamp to viewport after paint
    requestAnimationFrame(() => {
      if (!_edCtxMenu) return;
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = Math.max(0, e.clientX - r.width)  + 'px';
      if (r.bottom > window.innerHeight) menu.style.top  = Math.max(0, e.clientY - r.height) + 'px';
    });
  }

  document.getElementById('ed-input').addEventListener('contextmenu', buildCtxMenu);

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

  // Goto bar
  document.getElementById('goto-go').addEventListener('click',    () => Editor.gotoLineGo());
  document.getElementById('goto-close').addEventListener('click', () => Editor.gotoLineClose());
  document.getElementById('goto-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  Editor.gotoLineGo();
    else if (e.key === 'Escape') Editor.gotoLineClose();
  });

  // Dialog close buttons
  document.getElementById('info-close').addEventListener('click',     () => document.getElementById('info-dlg').close());
  document.getElementById('analyse-close').addEventListener('click',  () => document.getElementById('analyse-dlg').close());
  document.getElementById('words-close').addEventListener('click',    () => document.getElementById('words-dlg').close());
  document.getElementById('stats-close').addEventListener('click',    () => document.getElementById('stats-dlg').close());
  document.getElementById('timer-alert-ok').addEventListener('click',  () => document.getElementById('timer-alert-dlg').close());
  document.getElementById('about-close').addEventListener('click',    () => document.getElementById('about-dlg').close());
  document.getElementById('about-ok').addEventListener('click',       () => document.getElementById('about-dlg').close());

  // About button and logo in help menu
  const openAbout = () => { helpDetails.open = false; document.getElementById('about-dlg').showModal(); };
  document.getElementById('br-help-about').addEventListener('click', openAbout);
  document.getElementById('br-help-logo').addEventListener('click', openAbout);

  // Misc tab import button (shares triggerImport)
  document.getElementById('misc-import-btn').addEventListener('click', triggerImport);

  // Settings
  Settings.initEvents();

  // File info / analyse from browser context menu
  document.addEventListener('writhdeck-show-info',    e => showFileInfo(e.detail));
  document.addEventListener('writhdeck-show-analyse', e => showAnalyse(e.detail));

  // Command mode clicks from status bar buttons
  document.addEventListener('writhdeck-cmd', e => {
    if (!Editor.isCmdMode()) return;
    Editor.exitCmdMode();
    switch (e.detail) {
      case 'f': Editor.searchOpen(false);  break;
      case 'r': Editor.searchOpen(true);   break;
      case 'g': Editor.gotoLine();         break;
      case 'n': Editor.toggleLineNumbers(); break;
      case 'd':
        State.settings.darkMode = !State.settings.darkMode;
        saveSettings(); applyTheme();
        if (State.doc) Editor.rehighlight();
        break;
      case 'o': TOC.toggle();              break;
      case 'c': Settings.show();           break;
      case 'e': Editor.exportDoc('txt');   break;
      case 's': Stats.show();              break;
      case 'a': showAnalyse();             break;
      case 'i': showFileInfo();            break;
      case 't': Timer.toggle();  Editor.updateStatusBar(); break;
      case 'p': Timer.isActive() ? Timer.pause() : Timer.toggle();
                Editor.updateStatusBar(); break;
      case 'w': Editor.toggleTypewriter(); break;
      case 'm': showMainMenu();            break;
      case 'q': Editor.close();            break;
    }
  });

  // Keyboard — capture phase so we intercept before browser default handlers
  document.addEventListener('keydown', onKeydown, true);

  // Save cursor + dirty guard on unload
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && State.doc) Editor.saveCursorPos();
  });
  window.addEventListener('resize', () => {
    if (State.doc) { Editor.syncGutter(); Editor.syncScroll(); Editor.typewriterScroll(); }
  });
  document.addEventListener('fullscreenchange', () => {
    if (State.doc) { Editor.syncGutter(); Editor.syncScroll(); }
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

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('Writhdeck init error:', err);
    document.body.innerHTML +=
      `<div style="position:fixed;bottom:0;left:0;right:0;padding:12px;background:#700;color:#fff;font-family:monospace;font-size:12px">
        Init error: ${err.message || err}. Open DevTools console for details.
      </div>`;
  });
});
