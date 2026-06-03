'use strict';
// Editor module
const Editor = (() => {
  const ta  = () => document.getElementById('ed-input');
  const pre = () => document.getElementById('ed-highlight');

  let _autosaveId     = null;
  let _clockId        = null;
  let _tocRefresh     = null;
  let _cmdMode        = false;
  let _typewriter     = false;
  let _wc = 0;

  // ── Open / close ──────────────────────────────────────────────────────────

  async function open(doc) {
    // For disk files, try to read fresh content from disk
    if (doc.fileHandle) {
      try {
        const perm = await doc.fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          const file = await doc.fileHandle.getFile();
          doc.content = await file.text();
        } else {
          const req = await doc.fileHandle.requestPermission({ mode: 'readwrite' });
          if (req === 'granted') {
            const file = await doc.fileHandle.getFile();
            doc.content = await file.text();
          }
          // If denied: fall through and use cached content
        }
      } catch (_) { /* use cached content */ }
    }

    State.doc   = doc;
    State.dirty = false;

    document.getElementById('browser').hidden = true;
    document.getElementById('editor').hidden  = false;
    document.title = `${doc.name} — Writhdeck`;

    const input = ta();
    input.value = doc.content || '';

    // Restore cursor
    const offset = State.cursors[doc.id] || 0;
    input.setSelectionRange(offset, offset);

    _typewriter = false;
    document.getElementById('editor').classList.remove('typewriter');
    rehighlight();
    syncScroll();
    applyLineNumbers();
    updateStatusBar();
    input.focus();
    _wc = wordCount(input.value);

    startAutosave();
    startClock();
    if (!doc.virtual) pushRecent(doc.id);
    Browser.render();
  }

  async function close() {
    if (State.dirty && !State.doc.isIni) {
      const ok = confirm(`Save "${State.doc.name}" before closing?`);
      if (ok) await save();
    }
    saveCursorPos();
    stopAutosave();
    stopClock();
    TOC.hide();
    _cmdMode    = false;
    State.doc   = null;
    State.dirty = false;
    document.title = 'Writhdeck';
    document.getElementById('editor').hidden  = true;
    document.getElementById('browser').hidden = false;
    Browser.render();
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    if (!State.doc) return;
    State.doc.content = ta().value;

    // Virtual INI doc — parse and apply, don't write to docs store
    if (State.doc.isIni) {
      try {
        const { settings, schemes } = INI.parseIni(State.doc.content);
        Object.assign(State.settings, settings);
        for (const [n, sc] of Object.entries(schemes)) {
          customSchemes[n] = SCHEMES[n] ? { ...SCHEMES[n], ...sc } : sc;
        }
        await saveSettings();   // re-generates canonical INI text → IDB
        State.doc.content = State.iniText; // reflect normalised output
        ta().value = State.iniText;
        rehighlight();
        applyTheme();
        State.dirty = false;
        setMsg('Settings applied');
        Browser.render();
      } catch (e) {
        setMsg('Parse error');
        console.error(e);
      }
      return;
    }

    State.doc.modified = Date.now();

    if (State.doc.fileHandle) {
      // Save to disk (File System Access API)
      try {
        const perm = await State.doc.fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          const req = await State.doc.fileHandle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') { setMsg('Permission denied'); return; }
        }
        const writable = await State.doc.fileHandle.createWritable();
        await writable.write(State.doc.content);
        await writable.close();
        setMsg('Saved to disk');
      } catch (e) {
        setMsg('Disk save failed');
        console.error(e);
        return;
      }
    }

    // Always update IDB (caches content, persists handle)
    await DB.saveDoc(State.doc);
    State.dirty = false;
    if (!State.doc.fileHandle) setMsg('Saved');

    // Update docs list
    const idx = State.docs.findIndex(d => d.id === State.doc.id);
    if (idx >= 0) State.docs[idx] = State.doc;

    // Update daily stats
    _wc = wordCount(State.doc.content);
    updateDaily(State.doc.id, _wc);

    updateStatusBar();
  }

  // ── Input handling ────────────────────────────────────────────────────────

  function onInput() {
    rehighlight();
    if (!State.dirty) State.dirty = true;
    typewriterScroll();
    updateLineNumbers();
    if (_tocRefresh) clearTimeout(_tocRefresh);
    _tocRefresh = setTimeout(() => TOC.refresh(), 600);
    // Hemingway mode: prevent delete
    if (State.settings && State.settings.hemingwayMode) {
      // Handled via keydown
    }
    updateStatusBar();
  }

  function rehighlight() {
    pre().innerHTML = highlight(ta().value, State.settings);
  }

  function syncScroll() {
    pre().scrollTop  = ta().scrollTop;
    pre().scrollLeft = ta().scrollLeft;
    const ln = document.getElementById('ed-linenos');
    if (ln && !ln.hidden) ln.scrollTop = ta().scrollTop;
  }

  function saveCursorPos() {
    if (!State.doc) return;
    State.cursors[State.doc.id] = ta().selectionStart;
    saveCursors();
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  // ── Typewriter mode ───────────────────────────────────────────────────────

  function toggleTypewriter() {
    _typewriter = !_typewriter;
    document.getElementById('editor').classList.toggle('typewriter', _typewriter);
    setMsg(_typewriter ? 'Typewriter mode on' : 'Typewriter mode off');
    if (_typewriter) typewriterScroll();
  }

  function typewriterScroll() {
    if (!_typewriter) return;
    const input = ta();
    const text  = input.value.substring(0, input.selectionStart);
    const line  = text.split('\n').length - 1;
    const lh    = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.scrollTop = Math.max(0, line * lh - input.clientHeight / 2 + lh / 2);
  }

  // ── Line numbers ──────────────────────────────────────────────────────────

  function updateLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el || el.hidden) return;
    const count = (ta().value.match(/\n/g) || []).length + 1;
    el.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    el.scrollTop = ta().scrollTop;
  }

  function applyLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el) return;
    const show = State.settings.lineNumbers;
    el.hidden = !show;
    if (show) updateLineNumbers();
  }

  function toggleLineNumbers() {
    State.settings.lineNumbers = !State.settings.lineNumbers;
    applyLineNumbers();
    saveSettings();
    setMsg(State.settings.lineNumbers ? 'Line numbers on' : 'Line numbers off');
  }

  // ── Go to line ────────────────────────────────────────────────────────────

  function gotoLine() {
    const raw = prompt('Go to line:');
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return;
    const input  = ta();
    const lines  = input.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(n - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    input.focus();
    input.setSelectionRange(offset, offset);
    const lh = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.scrollTop = (n - 1) * lh - input.clientHeight / 3;
  }

  // ── Command mode (ESC) ───────────────────────────────────────────────────

  function enterCmdMode() {
    _cmdMode = true;
    updateStatusBar();
  }

  function exitCmdMode() {
    _cmdMode = false;
    updateStatusBar();
  }

  function isCmdMode() { return _cmdMode; }

  // ── Messages ──────────────────────────────────────────────────────────────

  let _msgTimeout = null;
  let _msg = '';

  function setMsg(text) {
    _msg = text;
    updateStatusBar();
    if (_msgTimeout) clearTimeout(_msgTimeout);
    _msgTimeout = setTimeout(() => { _msg = ''; updateStatusBar(); }, 2000);
  }

  function updateStatusBar() {
    if (_cmdMode) {
      document.getElementById('ed-bar-left').textContent =
        'ESC: exit  s:stats  i:info  t:timer  p:pause  q:close';
      document.getElementById('ed-bar-center').textContent = '';
      document.getElementById('ed-bar-right').textContent  = '';
      return;
    }
    const s = State.settings;
    const doc = State.doc;
    const wc = doc ? wordCount(ta().value) : 0;
    const today = doc ? todayWords(doc.id) : 0;
    const clk = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    function buildZone(spec) {
      return spec.split(/\s+/).map(tok => {
        switch (tok) {
          case 'filename': return doc ? doc.name : '';
          case 'dirty':    return State.dirty ? '[+]' : '';
          case 'words':    return `${wc}w`;
          case 'chars':    return `${(ta().value || '').length}c`;
          case 'goal':     return s.wordGoal > 0 ? `${today}/${s.wordGoal}` : '';
          case 'clock':    return clk;
          case 'timer':    return s.timerShow ? Timer.format() : '';
          default:         return tok;
        }
      }).filter(Boolean).join('  ');
    }

    const l = _msg || buildZone(s.statusLeft   || '');
    const c =        buildZone(s.statusCenter  || '');
    const r =        buildZone(s.statusRight   || '');
    document.getElementById('ed-bar-left').textContent   = l;
    document.getElementById('ed-bar-center').textContent = c;
    document.getElementById('ed-bar-right').textContent  = r;
  }

  function startClock() {
    stopClock();
    _clockId = setInterval(updateStatusBar, 10000);
  }
  function stopClock() {
    if (_clockId) { clearInterval(_clockId); _clockId = null; }
  }

  // ── Autosave ──────────────────────────────────────────────────────────────

  function startAutosave() {
    stopAutosave();
    _autosaveId = setInterval(() => { if (State.dirty) save(); }, 60000);
  }
  function stopAutosave() {
    if (_autosaveId) { clearInterval(_autosaveId); _autosaveId = null; }
  }

  // ── Find / Replace ────────────────────────────────────────────────────────

  let _searchTerm = '';
  let _matches    = [];
  let _matchIdx   = -1;

  function searchOpen(withReplace = false) {
    const bar = document.getElementById('search-bar');
    bar.hidden = false;
    document.getElementById('replace-row').hidden   = !withReplace;
    document.getElementById('replace-one').hidden   = !withReplace;
    document.getElementById('replace-all').hidden   = !withReplace;
    document.getElementById('search-input').focus();
    if (_searchTerm) document.getElementById('search-input').value = _searchTerm;
    searchUpdate();
  }

  function searchClose() {
    document.getElementById('search-bar').hidden = true;
    ta().focus();
    _matches = []; _matchIdx = -1;
    document.getElementById('search-count').textContent = '';
  }

  function searchUpdate() {
    _searchTerm = document.getElementById('search-input').value;
    _matches = [];
    _matchIdx = -1;
    if (!_searchTerm) { document.getElementById('search-count').textContent = ''; return; }
    const text = ta().value;
    const lower = text.toLowerCase();
    const term  = _searchTerm.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(term, pos)) !== -1) {
      _matches.push(pos);
      pos += term.length;
    }
    document.getElementById('search-count').textContent = `${_matches.length} match${_matches.length !== 1 ? 'es' : ''}`;
    if (_matches.length) searchNext();
  }

  function searchNext() {
    if (!_matches.length) return;
    _matchIdx = (_matchIdx + 1) % _matches.length;
    selectMatch(_matches[_matchIdx]);
  }

  function searchPrev() {
    if (!_matches.length) return;
    _matchIdx = (_matchIdx - 1 + _matches.length) % _matches.length;
    selectMatch(_matches[_matchIdx]);
  }

  function selectMatch(pos) {
    ta().focus();
    ta().setSelectionRange(pos, pos + _searchTerm.length);
    // Scroll into view
    const lh = parseFloat(getComputedStyle(ta()).lineHeight) || 20;
    const lineIdx = ta().value.slice(0, pos).split('\n').length - 1;
    ta().scrollTop = lineIdx * lh - ta().clientHeight / 3;
  }

  function replaceOne() {
    if (!_matches.length || _matchIdx < 0) return;
    const repl  = document.getElementById('replace-input').value;
    const start = _matches[_matchIdx];
    const text  = ta().value;
    ta().value  = text.slice(0, start) + repl + text.slice(start + _searchTerm.length);
    onInput();
    searchUpdate();
  }

  function replaceAll() {
    const repl = document.getElementById('replace-input').value;
    const re   = new RegExp(_searchTerm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    ta().value = ta().value.replace(re, repl);
    onInput();
    searchUpdate();
    setMsg(`Replaced`);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function exportDoc(fmt) {
    if (!State.doc) return;
    const ext  = fmt === 'md' ? '.md' : '.txt';
    const name = State.doc.name.replace(/\.[^.]+$/, '') + ext;
    const blob = new Blob([State.doc.content || ta().value], {type: 'text/plain'});
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  return {
    open, close, save, onInput, syncScroll, rehighlight, updateStatusBar, setMsg,
    saveCursorPos, applyLineNumbers,
    toggleTypewriter, toggleLineNumbers, gotoLine,
    enterCmdMode, exitCmdMode, isCmdMode,
    searchOpen, searchClose, searchUpdate, searchNext, searchPrev, replaceOne, replaceAll,
    exportDoc
  };
})();
