'use strict';
// Document browser module
const Browser = (() => {

  // FSA detection — use typeof rather than 'in' (more robust in Brave)
  const hasFSA = (() => { try { return typeof window.showOpenFilePicker === 'function'; } catch(_) { return false; } })();

  function render() {
    const list = document.getElementById('br-list');
    list.innerHTML = '';

    const docs   = State.docs;
    const favIds = new Set(State.favorites);
    const recIds = new Set(State.recents);

    const favDocs   = State.favorites.map(id => docs.find(d => d.id === id)).filter(Boolean);
    const diskDocs  = docs.filter(d => d.fromDisk).sort((a, b) => b.modified - a.modified);
    const localDocs = docs.filter(d => !d.fromDisk).sort((a, b) => b.modified - a.modified);

    if (favDocs.length) {
      section('Favorites', favDocs, list, {});
    }

    // writhdeck.ini — always visible
    iniRow(list);

    // Watched folder section
    if (hasFSA && State.dirHandle) {
      folderSection(list);
    }

    // Individual disk files (opened with 📂, not from watched folder)
    if (hasFSA && diskDocs.filter(d => !d.dirFile).length) {
      const indiv = diskDocs.filter(d => !d.dirFile);
      const recentDisk = indiv.filter(d => recIds.has(d.id));
      const olderDisk  = indiv.filter(d => !recIds.has(d.id));
      if (recentDisk.length) section('Recent files', recentDisk, list, { disk: true });
      if (olderDisk.length)  section('Files from disk', olderDisk, list, { disk: true });
    }

    section('Documents', localDocs, list, { showRecent: id => recIds.has(id) });

    buildShortcutBar();
  }

  function section(title, docs, container, opts) {
    const hdr = document.createElement('div');
    hdr.className = 'br-section-header';
    hdr.textContent = title;
    container.appendChild(hdr);
    if (!docs.length) {
      const empty = document.createElement('div');
      empty.className = 'br-item';
      empty.style.color = 'var(--fg-bar)';
      empty.style.fontSize = '0.85em';
      empty.textContent = 'No documents yet. Press n to create one.';
      container.appendChild(empty);
      return;
    }
    docs.forEach(doc => container.appendChild(docRow(doc, opts || {})));
  }

  function docRow(doc, opts) {
    const row = document.createElement('div');
    row.className = 'br-item';
    if (State.doc && State.doc.id === doc.id) row.classList.add('selected');

    // No pin for folder files (they are ephemeral, not in IDB)
    const pin = document.createElement('span');
    if (!opts.dirFile) {
      pin.className = 'br-item-pin' + (isFavorite(doc.id) ? ' active' : '');
      pin.textContent = '★';
      pin.title = isFavorite(doc.id) ? 'Unpin' : 'Pin to favorites';
      pin.addEventListener('click', e => {
        e.stopPropagation();
        toggleFavorite(doc.id);
        render();
      });
    } else {
      pin.style.cssText = 'width:1em;'; // spacer
    }

    const name = document.createElement('span');
    name.className = 'br-item-name';
    name.textContent = doc.name;

    const meta = document.createElement('span');
    meta.className = 'br-item-meta';
    meta.textContent = fmtDate(doc.modified);

    row.appendChild(pin);
    row.appendChild(name);
    row.appendChild(meta);

    // Disk file indicator
    if (opts.disk || doc.fromDisk) {
      const ico = document.createElement('span');
      ico.textContent = '💾';
      ico.title = 'Linked to a file on disk';
      ico.style.cssText = 'font-size:0.75em;flex-shrink:0;opacity:0.7;';
      row.appendChild(ico);
    }
    // Subtle dot for recently opened storage docs
    if (opts.showRecent && opts.showRecent(doc.id)) {
      const dot = document.createElement('span');
      dot.title = 'Recently opened';
      dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:var(--heading);flex-shrink:0;';
      row.appendChild(dot);
    }

    row.addEventListener('click', () => Editor.open(doc));
    row.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(doc, e); });
    return row;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    return d.toLocaleDateString([], {month:'short', day:'numeric'});
  }

  // ── Context menu ─────────────────────────────────────────────────────────

  let _ctxMenu = null;

  function showContextMenu(doc, e) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;
      background:var(--bg-bar);border:1px solid var(--fg-bar);z-index:200;min-width:140px;`;
    const items = [
      ['Open',          () => Editor.open(doc)],
      ['Rename',        () => renameDoc(doc)],
      ['Export as .txt',() => exportDocFrom(doc, 'txt')],
      ['Export as .md', () => exportDocFrom(doc, 'md')],
      ['Stats',         () => { Stats.show(); }],
      ['Delete',        () => deleteDoc(doc)]
    ];
    items.forEach(([label, fn]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 14px;border:none;background:none;';
      btn.style.color = 'var(--fg)';
      btn.addEventListener('click', () => { hideContextMenu(); fn(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    _ctxMenu = menu;
  }

  function hideContextMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  // ── Document actions ─────────────────────────────────────────────────────

  async function newDoc() {
    const name = prompt('Document name:', 'Untitled');
    if (!name || !name.trim()) return;
    const doc = { name: name.trim(), content: '', created: Date.now(), modified: Date.now() };
    await DB.saveDoc(doc);
    State.docs.push(doc);
    render();
    await Editor.open(doc);
  }

  async function renameDoc(doc) {
    const name = prompt('Rename to:', doc.name);
    if (!name || !name.trim() || name.trim() === doc.name) return;
    doc.name = name.trim();
    await DB.saveDoc(doc);
    if (State.doc && State.doc.id === doc.id) {
      document.getElementById('ed-filename').textContent = doc.name;
    }
    render();
  }

  async function deleteDoc(doc) {
    const msg = doc.fromDisk
      ? `Remove "${doc.name}" from Writhdeck?\n\nThe original file on your disk will NOT be deleted — only the copy stored in the browser is removed.`
      : `Delete "${doc.name}" from browser storage?\n\nThis cannot be undone. The document is stored only in this browser — it is NOT on your disk.`;
    if (!confirm(msg)) return;
    await DB.deleteDoc(doc.id);
    State.docs      = State.docs.filter(d => d.id !== doc.id);
    State.favorites = State.favorites.filter(id => id !== doc.id);
    State.recents   = State.recents.filter(id => id !== doc.id);
    saveFavorites(); saveRecents();
    if (State.doc && State.doc.id === doc.id) await Editor.close();
    render();
  }

  function exportDocFrom(doc, fmt) {
    const ext  = fmt === 'md' ? '.md' : '.txt';
    const name = doc.name.replace(/\.[^.]+$/, '') + ext;
    const blob = new Blob([doc.content || ''], {type:'text/plain'});
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ── Shortcut bar ──────────────────────────────────────────────────────────

  function buildShortcutBar() {
    const bar = document.getElementById('br-bar');
    bar.innerHTML = '';
    const shortcuts = [
      ['n', 'new', newDoc],
      ...(hasFSA ? [
        ['w', 'watch folder', openFolder],
        ['o', 'open file',   openFromDisk]
      ] : []),
      ['Ctrl+O', 'import copy', () => document.getElementById('file-import-input').click()],
      ['s', 'stats', () => Stats.show()],
      ['c', 'config', () => Settings.show()]
    ];
    shortcuts.forEach(([key, label, fn]) => {
      const sp = document.createElement('span');
      sp.className = 'br-shortcut';
      sp.innerHTML = `<span class="br-shortcut-key">${key}</span>:${label}`;
      sp.addEventListener('click', fn);
      bar.appendChild(sp);
    });
  }

  function iniRow(container) {
    const row = document.createElement('div');
    row.className = 'br-item';
    if (State.doc && State.doc.isIni) row.classList.add('selected');

    const ico = document.createElement('span');
    ico.style.cssText = 'font-size:0.8em;color:var(--fg-bar);flex-shrink:0;width:1em;';
    ico.textContent = '⚙';

    const name = document.createElement('span');
    name.className = 'br-item-name';
    name.textContent = 'writhdeck.ini';
    name.style.color = 'var(--fg-bar)';

    row.appendChild(ico);
    row.appendChild(name);
    row.addEventListener('click', () => {
      Editor.open({
        id: '__ini__',
        name: 'writhdeck.ini',
        content: State.iniText || '',
        isIni: true,
        virtual: true
      });
    });
    container.appendChild(row);
  }

  async function openFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      alert('Directory access requires Chrome, Edge or Brave.\nIf using Brave, check Shields settings.');
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return;
    }
    State.dirHandle = handle;
    await saveDirHandle();
    await scanDir();
    render();
  }

  async function clearFolder() {
    if (!confirm(`Remove folder "${State.dirHandle.name}" from Writhdeck?\n\nFiles on disk are not affected.`)) return;
    await clearDirHandle();
    render();
  }

  async function requestFolderPermission() {
    if (!State.dirHandle) return;
    try {
      const perm = await State.dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await scanDir();
        render();
      }
    } catch (_) {}
  }

  function folderSection(container) {
    const dirFiles = State.dirFiles;
    const dirName  = State.dirHandle.name;

    // Header row with folder name + clear button
    const hdr = document.createElement('div');
    hdr.className = 'br-section-header';
    hdr.style.display = 'flex';
    hdr.style.alignItems = 'center';
    hdr.style.justifyContent = 'space-between';

    const label = document.createElement('span');
    label.textContent = `📁 ${dirName}`;
    hdr.appendChild(label);

    const clearBtn = document.createElement('span');
    clearBtn.textContent = '✕';
    clearBtn.title = 'Remove folder';
    clearBtn.style.cssText = 'cursor:pointer;color:var(--fg-bar);font-size:0.8em;padding:0 4px;';
    clearBtn.addEventListener('click', e => { e.stopPropagation(); clearFolder(); });
    hdr.appendChild(clearBtn);
    container.appendChild(hdr);

    if (!dirFiles.length) {
      // Check permission state
      State.dirHandle.queryPermission({ mode: 'readwrite' }).then(perm => {
        if (perm !== 'granted') {
          const row = document.createElement('div');
          row.className = 'br-item';
          const btn = document.createElement('button');
          btn.textContent = 'Re-authorize folder access';
          btn.style.cssText = 'font-size:0.85em;margin:4px 0;';
          btn.addEventListener('click', requestFolderPermission);
          row.appendChild(btn);
          container.appendChild(row);
        } else {
          const row = document.createElement('div');
          row.className = 'br-item';
          row.style.color = 'var(--fg-bar)';
          row.style.fontSize = '0.85em';
          row.textContent = 'No .txt / .md / .tcl files in this folder.';
          container.appendChild(row);
        }
      });
      return;
    }

    dirFiles.forEach(doc => {
      const row = docRow(doc, { dirFile: true });
      container.appendChild(row);
    });
  }

  async function openFromDisk() {
    if (typeof window.showOpenFilePicker !== 'function') {
      alert('Direct file access is not available in this browser.\n\nUse the ↑ Import button to load a copy of a file, or switch to Chrome/Edge/Brave.\n\nIf you are using Brave, check that Shields fingerprinting protection is not set to "Strict".');
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Text files', accept: { 'text/plain': ['.txt', '.md', '.tcl', '.text'] } }]
      });
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return;
    }
    for (const fileHandle of handles) {
      const file    = await fileHandle.getFile();
      const content = await file.text();
      // Check if already tracked (same name + fromDisk)
      const existing = State.docs.find(d => d.fromDisk && d.name === file.name);
      if (existing) {
        // Update handle and content
        existing.fileHandle = fileHandle;
        existing.content    = content;
        existing.modified   = Date.now();
        await DB.saveDoc(existing);
        await Editor.open(existing);
      } else {
        const doc = { name: file.name, content, fromDisk: true, fileHandle, created: Date.now(), modified: Date.now() };
        await DB.saveDoc(doc);
        State.docs.push(doc);
        await Editor.open(doc);
      }
    }
    render();
  }

  return { render, newDoc, renameDoc, deleteDoc, openFromDisk, openFolder, hideContextMenu, hasFSA };
})();
