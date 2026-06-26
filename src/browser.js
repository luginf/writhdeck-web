'use strict';
// Document browser module
const Browser = (() => {

  // FSA detection — use typeof rather than 'in' (more robust in Brave)
  const hasFSA = (() => { try { return typeof window.showOpenFilePicker === 'function'; } catch(_) { return false; } })();

  function render() {
    const list = document.getElementById('br-list');
    list.innerHTML = '';

    const docs   = State.docs.filter(d => d.id !== 'scratch');
    const favIds = new Set(State.favorites);
    const recIds = new Set(State.recents);

    const favDocs   = State.favorites.map(id => docs.find(d => d.id === id)).filter(Boolean);
    const diskDocs  = docs.filter(d => d.fromDisk).sort((a, b) => b.modified - a.modified);
    const localDocs = docs.filter(d => !d.fromDisk).sort((a, b) => b.modified - a.modified);

    if (favDocs.length) {
      section(t('browser_section_favorites', 'Favorites'), favDocs, list, {});
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
      if (recentDisk.length) section(t('browser_section_recent_files', 'Recent files'), recentDisk, list, { disk: true });
      if (olderDisk.length)  section(t('browser_section_files_from_disk', 'Files from disk'), olderDisk, list, { disk: true });
    }

    section(t('browser_section_documents', 'Documents'), localDocs, list, { showRecent: id => recIds.has(id) });

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
      empty.textContent = t('browser_no_docs_yet', 'No documents yet. Press n to create one.');
      container.appendChild(empty);
      return;
    }
    docs.forEach(doc => container.appendChild(docRow(doc, opts || {})));
  }

  function docRow(doc, opts) {
    const row = document.createElement('div');
    row.className = 'br-item br-nav-item';
    row.tabIndex = -1;
    row.dataset.id = String(doc.id);
    if (State.doc && State.doc.id === doc.id) row.classList.add('selected');

    // No pin for folder files (they are ephemeral, not in IDB)
    const pin = document.createElement('span');
    if (!opts.dirFile) {
      pin.className = 'br-item-pin' + (isFavorite(doc.id) ? ' active' : '');
      pin.textContent = '★';
      pin.title = isFavorite(doc.id) ? t('browser_unpin', 'Unpin') : t('browser_pin_to_favorites', 'Pin to favorites');
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
      ico.title = t('browser_linked_to_file_on_disk', 'Linked to a file on disk');
      ico.style.cssText = 'font-size:0.75em;flex-shrink:0;opacity:0.7;';
      row.appendChild(ico);
    }
    // Subtle dot for recently opened storage docs
    if (opts.showRecent && opts.showRecent(doc.id)) {
      const dot = document.createElement('span');
      dot.title = t('browser_recently_opened', 'Recently opened');
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

  function showIniContextMenu(e, openIni) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;
      background:var(--bg-bar);border:1px solid var(--fg-bar);z-index:200;min-width:160px;`;
    const resetLabel = t('browser_reset_to_defaults', 'Reset to defaults');
    const items = [
      [t('browser_open', 'Open'), openIni],
      [t('browser_export_ini', 'Export writhdeck.ini'), () => Settings.exportIni()],
      [resetLabel, async () => {
        if (!confirm(t('browser_reset_settings_confirm', 'Reset all settings to defaults?'))) return;
        await DB.setMeta('iniText', null);
        location.reload();
      }]
    ];
    items.forEach(([label, fn]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 14px;border:none;background:none;';
      btn.style.color = label === resetLabel ? 'var(--heading)' : 'var(--fg)';
      btn.addEventListener('click', () => { hideContextMenu(); fn(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    _ctxMenu = menu;
  }

  function showContextMenu(doc, e) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;
      background:var(--bg-bar);border:1px solid var(--fg-bar);z-index:200;min-width:140px;`;
    const items = [
      [t('browser_open', 'Open'),          () => Editor.open(doc)],
      [t('browser_info', 'Info'),          () => document.dispatchEvent(new CustomEvent('writhdeck-show-info',    { detail: doc }))],
      [t('browser_analyse', 'Analyse'),       () => document.dispatchEvent(new CustomEvent('writhdeck-show-analyse', { detail: doc }))],
      [t('browser_rename', 'Rename'),        () => renameDoc(doc)],
      [t('browser_export_as_txt', 'Export as .txt'),() => exportDocFrom(doc, 'txt')],
      [t('browser_export_as_md', 'Export as .md'), () => exportDocFrom(doc, 'md')],
      [t('browser_stats', 'Stats'),         () => { Stats.show(); }],
      [t('browser_delete', 'Delete'),        () => deleteDoc(doc)]
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

  function nameExists(name, excludeId) {
    return State.docs.some(d => d.name === name && d.id !== excludeId);
  }

  function uniqueName(base) {
    if (!nameExists(base)) return base;
    let n = 2;
    while (nameExists(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  }

  async function openScratch() {
    const doc = { id: 'scratch', name: t('browser_scratch_name', 'Scratch'), content: '' };
    await Editor.open(doc);
  }

  async function newDoc() {
    const inFolder = hasFSA && !!State.dirHandle;
    const name = prompt(t('browser_document_name_prompt', 'Document name:'), uniqueName('Untitled'));
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const safeName = trimmed.lastIndexOf('.') > 0 ? trimmed : `${trimmed}.txt`;

    if (inFolder) {
      if (State.dirFiles.some(f => f.name === safeName)) {
        alert(t('browser_file_already_exists_in_folder', 'A file named "${safeName}" already exists in this folder.', { safeName }));
        return;
      }
      let fileHandle;
      try {
        fileHandle = await currentDir().getFileHandle(safeName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.close();
      } catch (e) {
        alert(t('browser_could_not_create_file', 'Could not create "${safeName}": ${message}', { safeName, message: e.message }));
        return;
      }
      const doc = {
        id: `dir:${dirRelPath()}${safeName}`, name: safeName, content: '',
        fileHandle, fromDisk: true, dirFile: true, modified: Date.now()
      };
      State.dirFiles.push(doc);
      State.dirFiles.sort((a, b) => a.name.localeCompare(b.name));
      render();
      await Editor.open(doc);
    } else {
      if (nameExists(safeName)) {
        alert(t('browser_document_already_exists', 'A document named "${safeName}" already exists.', { safeName }));
        return;
      }
      const doc = { name: safeName, content: '', created: Date.now(), modified: Date.now() };
      await DB.saveDoc(doc);
      State.docs.push(doc);
      render();
      await Editor.open(doc);
    }
  }

  async function renameDoc(doc) {
    const name = prompt(t('browser_rename_to_prompt', 'Rename to:'), doc.name);
    if (!name || !name.trim() || name.trim() === doc.name) return;
    const trimmed = name.trim();
    if (nameExists(trimmed, doc.id)) {
      alert(t('browser_document_already_exists', 'A document named "${safeName}" already exists.', { safeName: trimmed }));
      return;
    }
    doc.name = trimmed;
    await DB.saveDoc(doc);
    if (State.doc && State.doc.id === doc.id) {
      document.getElementById('ed-filename').textContent = doc.name;
    }
    render();
  }

  async function deleteDoc(doc) {
    const msg = doc.fromDisk
      ? t('browser_remove_from_writhdeck_confirm', 'Remove "${name}" from Writhdeck?\n\nThe original file on your disk will NOT be deleted — only the copy stored in the browser is removed.', { name: doc.name })
      : t('browser_delete_from_storage_confirm', 'Delete "${name}" from browser storage?\n\nThis cannot be undone. The document is stored only in this browser — it is NOT on your disk.', { name: doc.name });
    if (!confirm(msg)) return;
    await DB.deleteDoc(doc.id);
    State.docs      = State.docs.filter(d => d.id !== doc.id);
    State.favorites = State.favorites.filter(id => id !== doc.id);
    State.recents   = State.recents.filter(id => id !== doc.id);
    saveFavorites(); saveRecents();
    if (State.doc && State.doc.id === doc.id) await Editor.close();
    render();
  }

  // Returns the document corresponding to the currently keyboard-focused
  // browser row (`.br-focused`), or null if none / the row isn't a regular
  // stored document (e.g. writhdeck.ini, watched-folder files).
  function getFocusedDoc() {
    const row = document.querySelector('#br-list .br-nav-item.br-focused');
    if (!row || !row.dataset.id || row.dataset.id === '__ini__') return null;
    return State.docs.find(d => String(d.id) === row.dataset.id) || null;
  }

  // Saves a timestamped copy of `doc` as a new document (mirrors Tcl's
  // do-backup, which copies the file into DOCS_DIR/backups/ with a
  // "%Y-%m-%dT%Hh%Mm%S" timestamp).
  async function backupDoc(doc) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}`;
    const name = uniqueName(`${doc.name} (backup ${stamp})`);
    const copy = { name, content: doc.content || '', created: Date.now(), modified: Date.now() };
    await DB.saveDoc(copy);
    State.docs.push(copy);
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

  // Wraps an action so it only fires when a browser row is keyboard-focused
  // (used for shortcuts that act on the focused document: r/d/b/f/i).
  function withFocused(fn) {
    return () => {
      const doc = getFocusedDoc();
      if (doc) fn(doc);
    };
  }

  function buildShortcutBar() {
    const bar = document.getElementById('br-bar');
    bar.innerHTML = '';
    const shortcuts = [
      ['n', t('browser_shortcut_new', 'new'), newDoc],
      ['t', t('browser_shortcut_scratch', 'scratch'), openScratch],
      ...(hasFSA ? [
        ['w', t('browser_shortcut_watch_folder', 'watch folder'), openFolder],
        ['o', t('browser_shortcut_open_file', 'open file'),   openFromDisk]
      ] : []),
      ['Ctrl+O', t('browser_shortcut_import_copy', 'import copy'), () => document.getElementById('file-import-input').click()],
      ['s', t('browser_shortcut_stats', 'stats'), () => Stats.show()],
      ['c', t('browser_shortcut_config', 'config'), () => Settings.show()],
      ['r', t('browser_shortcut_rename', 'rename'),   withFocused(renameDoc)],
      ['d', t('browser_shortcut_delete', 'delete'),   withFocused(deleteDoc)],
      ['b', t('browser_shortcut_backup', 'backup'),   withFocused(backupDoc)],
      ['f', t('browser_shortcut_favorite', 'favorite'), withFocused(doc => { toggleFavorite(doc.id); render(); })],
      ['i', t('browser_shortcut_info', 'info'),     withFocused(doc => document.dispatchEvent(new CustomEvent('writhdeck-show-info', { detail: doc })))],
      ['h', t('browser_shortcut_help', 'help'), () => {
        const d = document.getElementById('br-help-details');
        d.open = !d.open;
      }],
      ['z', t('browser_shortcut_reload', 'reload'), () => location.reload()]
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
    row.className = 'br-item br-nav-item';
    row.tabIndex = -1;
    row.dataset.id = '__ini__';
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
    const openIni = () => Editor.open({
      id: '__ini__', name: 'writhdeck.ini',
      content: State.iniText || '', isIni: true, virtual: true
    });
    row.addEventListener('click', openIni);
    row.addEventListener('contextmenu', e => { e.preventDefault(); showIniContextMenu(e, openIni); });
    container.appendChild(row);
  }

  async function openFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      alert(t('browser_directory_access_requires_chrome', 'Directory access requires Chrome, Edge or Brave.\nIf using Brave, check Shields settings.'));
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
    State.dirStack  = [];   // reset subfolder navigation to the new root
    await saveDirHandle();
    await scanDir();
    await Fonts.loadFromFolder(State.dirHandle);
    render();
  }

  async function clearFolder() {
    if (!confirm(t('browser_remove_folder_confirm', 'Remove folder "${name}" from Writhdeck?\n\nFiles on disk are not affected.', { name: State.dirHandle.name }))) return;
    await clearDirHandle();
    render();
  }

  async function requestFolderPermission() {
    if (!State.dirHandle) return;
    try {
      const perm = await State.dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await scanDir();
        await Fonts.loadFromFolder(State.dirHandle);
        render();
      }
    } catch (_) {}
  }

  // A navigable folder row (subdirectory or "..") inside the watched folder.
  function dirNavRow(label, title, onActivate) {
    const row = document.createElement('div');
    row.className = 'br-item br-nav-item';
    row.tabIndex = -1;
    row.dataset.id = '__dir__';

    const ico = document.createElement('span');
    ico.style.cssText = 'flex-shrink:0;width:1em;';
    ico.textContent = '📁';

    const name = document.createElement('span');
    name.className = 'br-item-name';
    name.textContent = label;
    if (title) name.title = title;

    row.appendChild(ico);
    row.appendChild(name);
    row.addEventListener('click', onActivate);
    return row;
  }

  function folderSection(container) {
    const dirFiles = State.dirFiles;
    const subdirs  = State.settings.browserSubdirs ? State.dirSubdirs : [];
    // Breadcrumb: root name + any navigated subfolders.
    const crumb = State.dirStack.length
      ? State.dirStack.map(s => s.name).join(' / ')
      : State.dirHandle.name;

    // Header row with folder name + clear button
    const hdr = document.createElement('div');
    hdr.className = 'br-section-header';
    hdr.style.display = 'flex';
    hdr.style.alignItems = 'center';
    hdr.style.justifyContent = 'space-between';

    const label = document.createElement('span');
    label.textContent = `📁 ${crumb}`;
    hdr.appendChild(label);

    const clearBtn = document.createElement('span');
    clearBtn.textContent = '✕';
    clearBtn.title = t('browser_remove_folder', 'Remove folder');
    clearBtn.style.cssText = 'cursor:pointer;color:var(--fg-bar);font-size:0.8em;padding:0 4px;';
    clearBtn.addEventListener('click', e => { e.stopPropagation(); clearFolder(); });
    hdr.appendChild(clearBtn);
    container.appendChild(hdr);

    // ".." row (only when navigated into a subfolder)
    if (State.settings.browserSubdirs && State.dirStack.length > 1) {
      container.appendChild(dirNavRow('..', t('browser_go_up_one_folder', 'Go up one folder'),
        async () => { await dirUp(); render(); }));
    }
    // Subfolder rows
    subdirs.forEach(sub => {
      container.appendChild(dirNavRow(`${sub.name}/`, null,
        async () => { await dirEnter(sub.name); render(); }));
    });

    if (!dirFiles.length) {
      // Check permission state
      State.dirHandle.queryPermission({ mode: 'readwrite' }).then(perm => {
        if (perm !== 'granted') {
          const row = document.createElement('div');
          row.className = 'br-item';
          const btn = document.createElement('button');
          btn.textContent = t('browser_reauthorize_folder_access', 'Re-authorize folder access');
          btn.style.cssText = 'font-size:0.85em;margin:4px 0;';
          btn.addEventListener('click', requestFolderPermission);
          row.appendChild(btn);
          container.appendChild(row);
        } else {
          const row = document.createElement('div');
          row.className = 'br-item';
          row.style.color = 'var(--fg-bar)';
          row.style.fontSize = '0.85em';
          row.textContent = t('browser_no_files_in_folder', 'No .txt / .md / .tcl files in this folder.');
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
      alert(t('browser_direct_file_access_unavailable', 'Direct file access is not available in this browser.\n\nUse the ↑ Import button to load a copy of a file, or switch to Chrome/Edge/Brave.\n\nIf you are using Brave, check that Shields fingerprinting protection is not set to "Strict".'));
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: t('browser_text_files', 'Text files'), accept: { 'text/plain': ['.txt', '.md', '.tcl', '.text'] } }]
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

  return { render, newDoc, openScratch, renameDoc, deleteDoc, openFromDisk, openFolder, hideContextMenu, hasFSA, nameExists, uniqueName, getFocusedDoc, backupDoc };
})();
