'use strict';
const Settings = (() => {

  const COLOR_KEYS = [
    ['bg',         'Background (dark)'],
    ['fg',         'Text (dark)'],
    ['bgBar',      'Bar BG (dark)'],
    ['fgBar',      'Bar text (dark)'],
    ['bgSel',      'Selection (dark)'],
    ['heading',    'Heading (dark)'],
    ['comment',    'Comment (dark)'],
    ['markup',     'Markup (dark)'],
    ['bgAlt',      'Background (light)'],
    ['fgAlt',      'Text (light)'],
    ['bgBarAlt',   'Bar BG (light)'],
    ['fgBarAlt',   'Bar text (light)'],
    ['bgSelAlt',   'Selection (light)'],
    ['headingAlt', 'Heading (light)'],
    ['commentAlt', 'Comment (light)'],
    ['markupAlt',  'Markup (light)']
  ];

  // ── Public ────────────────────────────────────────────────────────────────

  function show(tab) {
    populate();
    if (tab) switchTab(tab);
    document.getElementById('settings-dlg').showModal();
  }

  // ── Populate ──────────────────────────────────────────────────────────────

  function populate() {
    const s = State.settings;

    // Fill all data-key inputs (Profile, Timer, Misc, Display tabs)
    document.querySelectorAll('#settings-dlg [data-key]').forEach(el => {
      const key = el.dataset.key;
      if (!(key in s)) return;
      if (el.type === 'checkbox') el.checked = !!s[key];
      else el.value = s[key];
    });

    // Scheme selectors (profile + schemes tab)
    ['scheme-select-profile', 'scheme-select'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '';
      getAllSchemeNames().forEach(name => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = name;
        if (name === s.scheme) opt.selected = true;
        sel.appendChild(opt);
      });
    });

    buildColorGrid(s.scheme);
    populateFontList(s.fontFamily);
    updateFontPreview(s.fontFamily, s.fontSize);
  }

  function populateFontList(current) {
    const list = document.getElementById('font-list');
    list.innerHTML = '';
    // Detect available fonts via canvas
    const available = detectFonts([
      'monospace', 'serif', 'sans-serif',
      'Courier New', 'Consolas', 'Fira Code', 'JetBrains Mono', 'Source Code Pro',
      'Liberation Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', 'Inconsolata',
      'Noto Mono', 'Hack', 'Cascadia Code', 'Menlo', 'Monaco',
      'Georgia', 'Palatino', 'Times New Roman', 'Arial', 'Helvetica', 'Verdana',
      'Noto Serif', 'Noto Sans', 'Tahoma', 'Trebuchet MS'
    ]);
    available.forEach(font => {
      const div = document.createElement('div');
      div.className = 'font-item' + (font === current ? ' selected' : '');
      div.textContent = font;
      div.style.fontFamily = font;
      div.addEventListener('click', () => {
        document.querySelectorAll('.font-item').forEach(d => d.classList.remove('selected'));
        div.classList.add('selected');
        document.getElementById('font-family-input').value = font;
        updateFontPreview(font);
      });
      list.appendChild(div);
    });
  }

  function detectFonts(candidates) {
    const cvs = document.createElement('canvas');
    cvs.width = 200; cvs.height = 50;
    const ctx = cvs.getContext('2d');
    const base = 'monospace';
    const text = 'abcdefghijklm0123456789';
    ctx.font = `14px ${base}`;
    const refW = ctx.measureText(text).width;
    return candidates.filter(f => {
      ctx.font = `14px "${f}", ${base}`;
      return f === 'monospace' || f === 'serif' || f === 'sans-serif'
        || ctx.measureText(text).width !== refW;
    });
  }

  function updateFontPreview(family, size) {
    const preview = document.getElementById('font-preview');
    if (!preview) return;
    const f = family || document.getElementById('font-family-input').value || 'monospace';
    const sz = size || Number(document.querySelector('[data-key="fontSize"]').value) || 14;
    preview.style.fontFamily = f;
    preview.style.fontSize = sz + 'px';
  }

  function buildColorGrid(schemeName) {
    const scheme = getScheme(schemeName);
    const grid = document.getElementById('scheme-colors');
    grid.innerHTML = '';
    COLOR_KEYS.forEach(([key, label]) => {
      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.fontSize = '0.85em';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.dataset.colorKey = key;
      inp.value = (scheme[key] || '#888888').slice(0, 7); // color input needs 6-digit hex
      grid.appendChild(lbl);
      grid.appendChild(inp);
    });
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  function apply() {
    const s = State.settings;

    // Read all data-key inputs
    document.querySelectorAll('#settings-dlg [data-key]').forEach(el => {
      const key = el.dataset.key;
      if (el.type === 'checkbox')    s[key] = el.checked;
      else if (el.type === 'number') s[key] = Number(el.value);
      else                           s[key] = el.value;
    });

    // If the active scheme tab selector differs from profile tab selector, prefer schemes tab
    const schemesSel = document.getElementById('scheme-select');
    if (schemesSel) s.scheme = schemesSel.value;

    // Persist color edits for custom schemes
    const schemeName = s.scheme;
    if (!SCHEMES[schemeName]) {
      const scheme = { ...getScheme(schemeName) };
      document.querySelectorAll('#scheme-colors input[data-color-key]').forEach(inp => {
        scheme[inp.dataset.colorKey] = inp.value;
      });
      customSchemes[schemeName] = scheme;
      saveCustomSchemes();
    }

    saveSettings();
    applyTheme();
    if (State.doc) {
      Editor.rehighlight();
      Editor.applyLineNumbers();
      Editor.updateStatusBar();
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  function switchTab(name) {
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.stab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.stab[data-tab="${name}"]`);
    const pane = document.querySelector(`.stab-content[data-tab="${name}"]`);
    if (btn) btn.classList.add('active');
    if (pane) pane.classList.add('active');
  }

  // ── Scheme actions ────────────────────────────────────────────────────────

  function newScheme() {
    const name = prompt('New scheme name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (getAllSchemeNames().includes(trimmed)) { alert('Name already exists.'); return; }
    customSchemes[trimmed] = { ...getScheme(State.settings.scheme) };
    saveCustomSchemes();
    State.settings.scheme = trimmed;
    saveSettings();
    populate();
    applyTheme();
  }

  function deleteScheme() {
    const name = document.getElementById('scheme-select').value;
    if (SCHEMES[name]) { alert('Cannot delete a built-in scheme.'); return; }
    if (!confirm(`Delete scheme "${name}"?`)) return;
    delete customSchemes[name];
    saveCustomSchemes();
    State.settings.scheme = 'default';
    saveSettings();
    populate();
    applyTheme();
  }

  // ── INI import / export ───────────────────────────────────────────────────

  async function importIni(text) {
    const { settings, schemes } = INI.parseIni(text);
    Object.assign(State.settings, settings);
    for (const [n, sc] of Object.entries(schemes)) {
      customSchemes[n] = SCHEMES[n] ? { ...SCHEMES[n], ...sc } : sc;
    }
    await saveSettings();   // re-generates INI text + stores in IDB
    applyTheme();
    populate();
    if (State.doc) { Editor.rehighlight(); Editor.updateStatusBar(); }
    alert(`Settings imported.\nSchemes found: ${Object.keys(schemes).join(', ') || 'none'}`);
  }

  function exportIni() {
    // State.iniText is always kept in sync with IDB — no need to regenerate
    const text = State.iniText || INI.writeIni(State.settings, { ...SCHEMES, ...customSchemes });
    const blob = new Blob([text], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'writhdeck.ini'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ── Export all ────────────────────────────────────────────────────────────

  function exportAll() {
    State.docs.forEach(doc => {
      if (!doc.content) return;
      const blob = new Blob([doc.content], { type: 'text/plain' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: doc.name.replace(/\.[^.]+$/, '') + '.txt'
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
  }

  function exportZip() {
    const files = State.docs
      .filter(d => d.content)
      .map(d => ({ name: d.name.replace(/\.[^.]+$/, '') + '.txt', content: d.content }));
    if (!files.length) { alert('No documents to export.'); return; }
    const blob = new Blob([buildZip(files)], { type: 'application/zip' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'writhdeck-export.zip'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // Minimal uncompressed ZIP builder (no external dependency)
  function buildZip(files) {
    const enc = new TextEncoder();

    function u16(n) { return [(n) & 0xff, (n >> 8) & 0xff]; }
    function u32(n) { return [(n) & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

    function crc32(data) {
      if (!crc32._t) {
        crc32._t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
          crc32._t[i] = c;
        }
      }
      let crc = 0xffffffff;
      for (const b of data) crc = (crc32._t[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
      return (crc ^ 0xffffffff) >>> 0;
    }

    function concat(...arrays) {
      const len = arrays.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(len);
      let off = 0;
      for (const a of arrays) { out.set(a, off); off += a.length; }
      return out;
    }

    const DOS_TIME = new Uint8Array([0, 0, 0, 0]); // midnight Jan 1 1980

    const locals = [];    // local file records
    const centralDir = [];
    let offset = 0;

    for (const file of files) {
      const name = enc.encode(file.name);
      const data = enc.encode(file.content);
      const crc  = crc32(data);
      const sz   = data.length;

      const local = concat(
        new Uint8Array([0x50,0x4b,0x03,0x04, 20,0, 0,0, 0,0]),
        DOS_TIME,
        new Uint8Array(u32(crc)),
        new Uint8Array(u32(sz)),
        new Uint8Array(u32(sz)),
        new Uint8Array(u16(name.length)),
        new Uint8Array([0,0]),
        name,
        data
      );

      const cd = concat(
        new Uint8Array([0x50,0x4b,0x01,0x02, 20,0, 20,0, 0,0, 0,0]),
        DOS_TIME,
        new Uint8Array(u32(crc)),
        new Uint8Array(u32(sz)),
        new Uint8Array(u32(sz)),
        new Uint8Array(u16(name.length)),
        new Uint8Array([0,0, 0,0, 0,0, 0,0, 0,0,0,0]),
        new Uint8Array(u32(offset)),
        name
      );

      locals.push(local);
      centralDir.push(cd);
      offset += local.length;
    }

    const cdSize = centralDir.reduce((s, c) => s + c.length, 0);
    const eocd = concat(
      new Uint8Array([0x50,0x4b,0x05,0x06, 0,0, 0,0]),
      new Uint8Array(u16(files.length)),
      new Uint8Array(u16(files.length)),
      new Uint8Array(u32(cdSize)),
      new Uint8Array(u32(offset)),
      new Uint8Array([0,0])
    );

    return concat(...locals, ...centralDir, eocd);
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function initEvents() {
    // Tab buttons
    document.querySelectorAll('.stab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Scheme selector in Schemes tab → rebuild color grid
    document.getElementById('scheme-select').addEventListener('change', e => {
      buildColorGrid(e.target.value);
    });

    // Scheme selector in Profile tab → sync to Schemes tab selector
    document.getElementById('scheme-select-profile').addEventListener('change', e => {
      document.getElementById('scheme-select').value = e.target.value;
      buildColorGrid(e.target.value);
    });

    // Font size change → update preview
    document.querySelector('[data-key="fontSize"]').addEventListener('input', () => {
      updateFontPreview();
    });
    document.getElementById('font-family-input').addEventListener('input', () => {
      updateFontPreview();
    });

    document.getElementById('settings-apply').addEventListener('click', apply);
    document.getElementById('settings-close').addEventListener('click', () => {
      document.getElementById('settings-dlg').close();
    });
    document.getElementById('settings-reset').addEventListener('click', async () => {
      if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
      await DB.setMeta('iniText', null);
      location.reload();
    });
    document.getElementById('scheme-new-btn').addEventListener('click', newScheme);
    document.getElementById('scheme-delete-btn').addEventListener('click', deleteScheme);
    document.getElementById('misc-export-all-btn').addEventListener('click', exportAll);
    document.getElementById('misc-export-zip-btn').addEventListener('click', exportZip);
    document.getElementById('misc-ini-export-btn').addEventListener('click', exportIni);
    document.getElementById('misc-ini-import-btn').addEventListener('click', () => {
      document.getElementById('ini-import-input').click();
    });
    document.getElementById('ini-import-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      await importIni(await file.text());
      e.target.value = '';
    });
    // misc-import-btn wired in app.js (shares logic with br-import-btn)
  }

  return { show, initEvents, switchTab, exportIni };
})();
