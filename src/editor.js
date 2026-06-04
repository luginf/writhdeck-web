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
    syncGutter();
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
    const searchVisible = !document.getElementById('search-bar').hidden;
    let paraStart, paraEnd;
    if (_typewriter) {
      const input = ta();
      const text  = input.value;
      const idx   = text.substring(0, input.selectionStart).split('\n').length - 1;
      const ls    = text.split('\n');
      const s     = State.settings;
      const isBoundary = i => {
        const l = ls[i] || '';
        return !l.trim()
          || (s.headingMarker && l.startsWith(s.headingMarker))
          || (s.markdownHeadings && /^#{1,6}\s/.test(l))
          || (s.commentMarker && l.startsWith(s.commentMarker));
      };
      paraStart = idx; paraEnd = idx;
      if (!isBoundary(idx)) {
        while (paraStart > 0 && !isBoundary(paraStart - 1)) paraStart--;
        while (paraEnd < ls.length - 1 && !isBoundary(paraEnd + 1)) paraEnd++;
      }
    }
    pre().innerHTML = highlight(ta().value, State.settings, searchVisible ? _searchTerm : '', paraStart, paraEnd);
    syncGutter();
  }

  function syncGutter() {
    const input = ta();
    const hl    = pre();
    // Measure actual scrollbar width: offsetWidth includes it, clientWidth doesn't
    const gutter   = input.offsetWidth - input.clientWidth;
    const baseRight = parseFloat(getComputedStyle(input).paddingRight) || 0;
    hl.style.paddingRight = (baseRight + gutter) + 'px';
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
    const input   = ta();
    const lineIdx = input.value.substring(0, input.selectionStart).split('\n').length - 1;
    const lh      = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.scrollTop = Math.max(0, linePixelTop(input, lineIdx) - input.clientHeight / 2 + lh / 2);
  }

  // ── Line numbers ──────────────────────────────────────────────────────────

  function updateLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el || el.style.display === 'none') return;
    const count = (ta().value.match(/\n/g) || []).length + 1;
    el.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    el.scrollTop = ta().scrollTop;
  }

  function applyLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el) return;
    const show = !!State.settings.lineNumbers;
    el.style.display = show ? 'block' : 'none';
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
    const bar = document.getElementById('goto-bar');
    bar.hidden = false;
    const gi = document.getElementById('goto-input');
    gi.value = '';
    gi.focus();
    gi.select();
  }

  function gotoLineGo() {
    const n = parseInt(document.getElementById('goto-input').value, 10);
    gotoLineClose();
    if (isNaN(n) || n < 1) return;
    const input   = ta();
    const lines   = input.value.split('\n');
    const lineIdx = Math.min(n - 1, lines.length - 1);
    let offset = 0;
    for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
    input.focus();
    input.setSelectionRange(offset, offset);
    input.scrollTop = Math.max(0, linePixelTop(input, lineIdx) - input.clientHeight / 3);
  }

  function gotoLineClose() {
    document.getElementById('goto-bar').hidden = true;
    ta().focus();
  }

  function linePixelTop(input, lineIdx) {
    const cs = getComputedStyle(input);
    const m  = document.createElement('div');
    m.style.cssText = `position:fixed;top:-9999px;left:-9999px;visibility:hidden;`
      + `white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;`
      + `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};`
      + `padding:${cs.paddingTop} ${cs.paddingRight} 0 ${cs.paddingLeft};`
      + `width:${input.clientWidth}px;box-sizing:border-box`;
    m.textContent = input.value.split('\n').slice(0, lineIdx).join('\n') + (lineIdx > 0 ? '\n' : '');
    document.body.appendChild(m);
    const top = m.offsetHeight;
    document.body.removeChild(m);
    return top;
  }

  // ── Markup helpers ────────────────────────────────────────────────────────

  function applyLineMarker(marker) {
    if (!marker) return;
    const input = ta();
    const s = input.selectionStart, e = input.selectionEnd;
    const text = input.value;
    const blockStart = text.lastIndexOf('\n', s - 1) + 1;
    const raw = text.indexOf('\n', e);
    const blockEnd = raw === -1 ? text.length : raw;
    const lines = text.slice(blockStart, blockEnd).split('\n');
    const allMarked = lines.every(l => l.startsWith(marker));
    const newLines = allMarked ? lines.map(l => l.slice(marker.length)) : lines.map(l => marker + l);
    const newBlock = newLines.join('\n');
    input.value = text.slice(0, blockStart) + newBlock + text.slice(blockEnd);
    input.setSelectionRange(blockStart, blockStart + newBlock.length);
    onInput();
  }

  function applyInlineMarker(marker) {
    if (!marker) return;
    const input = ta();
    const s = input.selectionStart, e = input.selectionEnd;
    const text = input.value;
    if (s === e) {
      input.value = text.slice(0, s) + marker + marker + text.slice(s);
      input.setSelectionRange(s + marker.length, s + marker.length);
    } else {
      const sel = text.slice(s, e);
      const isWrapped = sel.startsWith(marker) && sel.endsWith(marker) && sel.length > marker.length * 2;
      if (isWrapped) {
        const inner = sel.slice(marker.length, -marker.length);
        input.value = text.slice(0, s) + inner + text.slice(e);
        input.setSelectionRange(s, s + inner.length);
      } else {
        const wrapped = marker + sel + marker;
        input.value = text.slice(0, s) + wrapped + text.slice(e);
        input.setSelectionRange(s, s + wrapped.length);
      }
    }
    onInput();
  }

  function applyHeading(level) {
    const marker = State.settings.headingMarker;
    if (!marker) return;
    const input = ta();
    const s = input.selectionStart, e = input.selectionEnd;
    const text = input.value;
    const blockStart = text.lastIndexOf('\n', s - 1) + 1;
    const raw = text.indexOf('\n', e);
    const blockEnd = raw === -1 ? text.length : raw;
    const prefix = marker.repeat(level);
    const mEsc   = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function headingLevel(line) {
      if (!line.startsWith(marker)) return 0;
      let n = 1;
      while (n < 3 && line.startsWith(marker.repeat(n + 1))) n++;
      return n;
    }
    function stripHeading(line) {
      return line
        .replace(new RegExp(`^${mEsc}+\\s*`), '')
        .replace(new RegExp(`\\s*${mEsc}+\\s*$`), '')
        .trim();
    }

    const lines = text.slice(blockStart, blockEnd).split('\n');
    const allAtLevel = lines.every(l => headingLevel(l) === level);
    const newLines = lines.map(l => {
      if (allAtLevel) return stripHeading(l);
      const content = headingLevel(l) > 0 ? stripHeading(l) : l.trim();
      return content ? `${prefix} ${content} ${prefix}` : `${prefix}  ${prefix}`;
    });
    const newBlock = newLines.join('\n');
    input.value = text.slice(0, blockStart) + newBlock + text.slice(blockEnd);
    input.setSelectionRange(blockStart, blockStart + newBlock.length);
    onInput();
  }

  // ── Command mode (ESC) ───────────────────────────────────────────────────

  function enterCmdMode() {
    _cmdMode = true;
    document.getElementById('ed-menu-btn').classList.add('active');
    updateStatusBar();
  }

  function exitCmdMode() {
    _cmdMode = false;
    document.getElementById('ed-menu-btn').classList.remove('active');
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
      document.getElementById('ed-bar-left').textContent   = 'f:find  r:replace  g:goto  n:linenos  o:toc';
      document.getElementById('ed-bar-center').textContent = 'd:dark  c:config  e:export  s:stats  i:info';
      document.getElementById('ed-bar-right').textContent  = 't:timer  p:pause  w:typewriter  m:menu  q:close  ·ESC/Alt+C:exit·';
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
          case 'words':    return doc ? `${wc}w` : '';
          case 'chars':    return doc ? `${(ta().value || '').length}c` : '';
          case 'goal':     return s.wordGoal > 0 ? `${today}/${s.wordGoal}` : '';
          case 'clock':    return clk;
          case 'timer':    return s.timerShow ? Timer.format() : '';
          case 'today':    return doc && today > 0 ? `${today}↑` : '';
          case 'percent':  return (doc && s.wordGoal > 0) ? `${Math.min(100, Math.round(wc / s.wordGoal * 100))}%` : '';
          case 'lines':    return doc ? `${(ta().value.match(/\n/g) || []).length + 1}L` : '';
          case 'line': {
            if (!doc) return '';
            const pos    = ta().selectionStart || 0;
            const before = ta().value.slice(0, pos);
            return `L${(before.match(/\n/g) || []).length + 1}`;
          }
          case 'col': {
            if (!doc) return '';
            const pos    = ta().selectionStart || 0;
            const before = ta().value.slice(0, pos);
            return `C${pos - before.lastIndexOf('\n')}`;
          }
          case 'para': {
            if (!doc) return '';
            const count = ta().value.split(/\n{2,}/).filter(p => p.trim()).length;
            return count ? `${count}§` : '';
          }
          case 'pages':   return (doc && wc > 0) ? `${Math.ceil(wc / 250)}p` : '';
          case 'reading': {
            if (!doc || !wc) return '';
            const mins = Math.ceil(wc / 200);
            return mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h${mins % 60 ? (mins % 60) + 'm' : ''}`;
          }
          case 'space':    return ' ';
          case 'help_bar': return '';
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
    rehighlight(); // retire les surlignages (barre cachée → searchTerm ignoré)
  }

  function searchUpdate() {
    _searchTerm = document.getElementById('search-input').value;
    _matches = [];
    _matchIdx = -1;
    if (!_searchTerm) {
      document.getElementById('search-count').textContent = '';
      rehighlight();
      return;
    }
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
    rehighlight(); // applique les surlignages
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
    const input   = ta();
    const lineIdx = input.value.slice(0, pos).split('\n').length - 1;
    // Ne pas appeler input.focus() : cela volerait le focus depuis le champ de recherche
    input.setSelectionRange(pos, pos + _searchTerm.length);
    input.scrollTop = Math.max(0, linePixelTop(input, lineIdx) - input.clientHeight / 3);
    syncScroll();
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
    open, close, save, onInput, syncScroll, syncGutter, rehighlight, updateStatusBar, setMsg,
    saveCursorPos, applyLineNumbers,
    toggleTypewriter, typewriterScroll, toggleLineNumbers, gotoLine, gotoLineGo, gotoLineClose,
    applyLineMarker, applyInlineMarker, applyHeading,
    enterCmdMode, exitCmdMode, isCmdMode,
    searchOpen, searchClose, searchUpdate, searchNext, searchPrev, replaceOne, replaceAll,
    exportDoc
  };
})();
