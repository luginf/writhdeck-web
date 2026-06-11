'use strict';
// Editor module
const Editor = (() => {
  const ta  = () => document.getElementById('ed-input');
  const pre = () => document.getElementById('ed-highlight');

  let _autosaveId     = null;
  let _clockId        = null;
  let _tocRefresh     = null;
  let _cmdMode        = false;
  let _cmdNavIdx      = -1;
  const _CMD_LIST = [
    ['f','find'], ['r','replace'], ['g','goto'], ['n','linenos'], ['o','toc'],
    ['d','dark'],  ['c','config'], ['e','export'], ['s','stats'], ['a','analyse'],
    ['i','info'],  ['t','timer'], ['p','pause'], ['w','typewriter'], ['m','menu'], ['q','close'],
    ['1','h1'], ['2','h2'], ['3','h3'], ['b','bold'], ['u','underline'], ['x','strike'], ['/','comment'],
  ];
  let _typewriter       = false;
  let _wc               = 0;
  let _sessionBaseline  = -1;  // total words in doc minus today's prior additions (set on open)
  let _sessionMaxToday  = 0;   // high-water mark of words added today this session

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

    // Session baseline: words that existed before today's contribution
    if (!doc.isIni) {
      const priorToday = doc.id ? todayWords(doc.id) : 0;
      _sessionBaseline = _wc - priorToday;
      _sessionMaxToday = priorToday;
    }

    startAutosave();
    startClock();
    if (!doc.virtual) pushRecent(doc.id);
    Browser.render();
  }

  // Yes/No/Cancel confirmation matching the Tcl/Tk and Android semantics:
  // Yes = save then close, No = discard changes and close, Cancel = stay open.
  // A native confirm() only offers two buttons, which forced "Cancel" to mean
  // "close without saving" — there was no way to abort closing altogether.
  let _closeConfirmWired   = false;
  let _closeConfirmResolve = null;
  function confirmSaveBeforeClose(name) {
    if (!_closeConfirmWired) {
      _closeConfirmWired = true;
      const dlg = document.getElementById('close-confirm-dlg');
      const respond = val => {
        const resolve = _closeConfirmResolve;
        _closeConfirmResolve = null;
        dlg.close();
        if (resolve) resolve(val);
      };
      document.getElementById('close-confirm-yes').addEventListener('click', () => respond('yes'));
      document.getElementById('close-confirm-no').addEventListener('click', () => respond('no'));
      document.getElementById('close-confirm-cancel').addEventListener('click', () => respond('cancel'));
      dlg.addEventListener('cancel', e => { e.preventDefault(); respond('cancel'); }); // Esc → Cancel
    }
    return new Promise(resolve => {
      _closeConfirmResolve = resolve;
      document.getElementById('close-confirm-msg').textContent = `Save "${name}" before closing?`;
      document.getElementById('close-confirm-dlg').showModal();
    });
  }

  async function close() {
    if (State.dirty && !State.doc.isIni) {
      const choice = await confirmSaveBeforeClose(State.doc.name);
      if (choice === 'cancel') return;
      if (choice === 'yes') await save();
      // 'no' — discard changes and proceed to close
    }
    saveCursorPos();
    stopAutosave();
    stopClock();
    TOC.hide();
    _cmdMode          = false;
    _sessionBaseline  = -1;
    _sessionMaxToday  = 0;
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

    // Update daily stats (track words added today, not total)
    _wc = wordCount(State.doc.content);
    if (_sessionBaseline >= 0) {
      const added = Math.max(0, _wc - _sessionBaseline);
      if (added > _sessionMaxToday) _sessionMaxToday = added;
      updateDaily(State.doc.id, _sessionMaxToday);
    }

    updateStatusBar();
  }

  // Save As (Ctrl+Shift+S) — mirrors the Tcl GUI's Save-As. With the File System
  // Access API, lets the user pick a new file/location and re-points this document
  // at it. Without FSA (e.g. Firefox), falls back to saving a copy under a new name
  // in browser storage and switches the editor to that copy.
  async function saveAs() {
    if (!State.doc || State.doc.isIni) return;
    if (typeof window.showSaveFilePicker === 'function') {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: State.doc.name,
          types: [{ description: 'Text', accept: { 'text/plain': ['.txt', '.md', '.t2t'] } }]
        });
      } catch (e) {
        if (e.name !== 'AbortError') { setMsg('Save As failed'); console.error(e); }
        return;
      }
      try {
        const writable = await handle.createWritable();
        await writable.write(ta().value);
        await writable.close();
      } catch (e) {
        setMsg('Save As failed'); console.error(e);
        return;
      }
      State.doc.fileHandle = handle;
      State.doc.name       = handle.name;
      State.doc.fromDisk    = true;
      State.doc.content     = ta().value;
      State.doc.modified    = Date.now();
      await DB.saveDoc(State.doc);
      const idx = State.docs.findIndex(d => d.id === State.doc.id);
      if (idx >= 0) State.docs[idx] = State.doc;
      State.dirty = false;
      document.title = `${State.doc.name} — Writhdeck`;
      setMsg('Saved as ' + State.doc.name);
      updateStatusBar();
      Browser.render();
      return;
    }

    // Fallback: save a copy under a new name in browser storage
    const name = prompt('Save as (new name):', Browser.uniqueName(State.doc.name));
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (Browser.nameExists(trimmed)) {
      alert(`A document named "${trimmed}" already exists.`);
      return;
    }
    const copy = { name: trimmed, content: ta().value, created: Date.now(), modified: Date.now() };
    await DB.saveDoc(copy);
    State.docs.push(copy);
    State.doc   = copy;
    State.dirty = false;
    document.title = `${copy.name} — Writhdeck`;
    setMsg('Saved as ' + copy.name);
    updateStatusBar();
    Browser.render();
  }

  // ── Input handling ────────────────────────────────────────────────────────

  function onInput() {
    if (!_tryIncrementalRepaint()) rehighlight();
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

  // Cache describing the line the cursor sat on after the last render — lets
  // onInput() locate the changed line via lastIndexOf/indexOf around the
  // cursor (cost ~ line length) instead of text.split('\n') + full-array diff
  // (cost ~ document size, plus ~9600 string allocations on a 90K-word doc).
  let _prevText = null;
  let _prevLineIdx = -1;
  let _prevLineStart = -1;
  let _prevLineEnd = -1;

  // Tracks which <span class="hl-line"> currently renders the <span class="hl-cursor">
  // (block cursor mode only) and that line's offsets in the source text — lets
  // syncBlockCursor()/_tryIncrementalRepaint() move the cursor span by patching
  // just the old/new line(s) instead of a full rehighlight(). -1 when block
  // cursor is off or no cursor has been placed yet.
  let _prevCursorLineIdx = -1;
  let _prevCursorLineStart = -1;
  let _prevCursorLineEnd = -1;

  // Locate the line containing offset `pos` in `text` without scanning the
  // whole document for its boundaries (lastIndexOf/indexOf walk backward and
  // forward from `pos` only). Still counts newlines before the line to get
  // its index — O(document size), so only call this from full-render paths.
  // Keeps _prevLineIdx/_prevLineStart/_prevLineEnd correct when the cursor
  // moves WITHOUT an edit (click, arrow keys) — without this, a click to a
  // different line followed by typing could make _tryIncrementalRepaint patch
  // the wrong <span class="hl-line">. Cheap in the common case (cursor stays
  // within the cached line's range — just a numeric comparison); only pays
  // the O(document size) newline count when the cursor actually changes line.
  function syncCursorLineCache() {
    if (_prevText === null) return;
    const text = ta().value;
    if (text !== _prevText) return;   // an edit is pending a render — leave it to rehighlight/_tryIncrementalRepaint
    const pos = ta().selectionStart;
    if (pos >= _prevLineStart && pos <= _prevLineEnd) return;
    const info = _lineInfoAt(text, pos);
    _prevLineIdx = info.idx;
    _prevLineStart = info.lineStart;
    _prevLineEnd = info.lineEnd;
  }

  function _lineInfoAt(text, pos) {
    // lastIndexOf(needle, -1) clamps to checking index 0 rather than meaning
    // "nothing before position 0" — special-case pos === 0 to avoid that trap.
    const lineStart = pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;
    let idx = 0;
    for (let i = text.indexOf('\n'); i !== -1 && i < lineStart; i = text.indexOf('\n', i + 1)) idx++;
    return { idx, lineStart, lineEnd };
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
    const cursorPos = State.settings.blockCursor ? ta().selectionStart : undefined;
    const text = ta().value;
    pre().innerHTML = highlight(text, State.settings, searchVisible ? _searchTerm : '', paraStart, paraEnd, cursorPos);
    const info = _lineInfoAt(text, ta().selectionStart);
    _prevText = text;
    _prevLineIdx = info.idx;
    _prevLineStart = info.lineStart;
    _prevLineEnd = info.lineEnd;
    if (State.settings.blockCursor) {
      _prevCursorLineIdx = info.idx;
      _prevCursorLineStart = info.lineStart;
      _prevCursorLineEnd = info.lineEnd;
    } else {
      _prevCursorLineIdx = -1;
    }
    scheduleSyncGutter();
  }

  // Patches the DOM node for a single changed line instead of replacing the
  // whole overlay's innerHTML — on a 90K-word/9600-line document, rebuilding
  // the full ~700KB HTML string and ~10K-span DOM subtree on EVERY keystroke
  // is what causes typed characters to lag seconds behind: each keystroke
  // queues another full-document re-render, and they pile up faster than the
  // browser can paint them. Returns true if it handled the repaint, false if
  // the caller should fall back to the full rehighlight().
  //
  // Only safe when the result is guaranteed identical to a full highlight()
  // pass: that means no search overlay, no typewriter dimming (depends on
  // paragraph boundaries — cross-line state) and no block-cursor span (only
  // injected on the cursor's line, computed from the whole document).
  // Finds the changed line via lastIndexOf/indexOf around the cursor (cost ~
  // line length, NOT document size — see _prevText/_prevLineIdx above). A
  // single atomic edit (the only kind a native 'input' event represents) can
  // only insert/remove a '\n' if it changes this line's start offset or
  // shifts what follows it; if both the start offset AND the trailing length
  // (text.length - lineEnd) are unchanged from the last render, no newline
  // was added or removed anywhere — this is a pure same-line content edit and
  // _prevLineIdx still names the right <span class="hl-line"> to patch.
  function _tryIncrementalRepaint() {
    if (_prevText === null || _prevLineIdx < 0) return false;
    if (!document.getElementById('search-bar').hidden) return false;
    if (_typewriter) return false;

    const text = ta().value;
    const pos  = ta().selectionStart;
    const lineStart = pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;

    if (lineStart !== _prevLineStart) return false;
    if (text.length - lineEnd !== _prevText.length - _prevLineEnd) return false;

    const lineEl = pre().children[_prevLineIdx];
    if (!lineEl) return false;

    const s = State.settings;
    let lineHtml = _renderLine(text.slice(lineStart, lineEnd), s, escRx(s.headingMarker), escRx(s.commentMarker), _buildMarkupRules(s), false);
    // Typing always edits at the cursor, which (per the invariant maintained by
    // rehighlight()/syncBlockCursor()) is already on this same line — so the
    // cursor span only ever needs to move WITHIN this line, never to another.
    if (s.blockCursor) {
      lineHtml = injectCursorAt(lineHtml, pos - lineStart);
      _prevCursorLineIdx = _prevLineIdx;
      _prevCursorLineStart = lineStart;
      _prevCursorLineEnd = lineEnd;
    }
    lineEl.innerHTML = lineHtml;
    _prevText = text;
    _prevLineStart = lineStart;
    _prevLineEnd = lineEnd;
    // _prevLineIdx unchanged — same line, no newlines shifted before it
    scheduleSyncGutter();
    return true;
  }

  // Moves the <span class="hl-cursor"> to the line under the cursor by
  // re-rendering only the old and new cursor lines — avoids a full
  // rehighlight() (rebuilding all <span class="hl-line"> via innerHTML, very
  // costly on large documents in Firefox) on every click/arrow-key when block
  // cursor is enabled. Reads line text from `text` (the source), not from the
  // DOM, since a line previously holding an end-of-line cursor has a synthetic
  // trailing space appended to its rendered HTML (see injectCursorAt).
  function syncBlockCursor() {
    if (!State.settings.blockCursor || !State.doc) return;
    const text = ta().value;
    const pos  = ta().selectionStart;
    const info = _lineInfoAt(text, pos);
    const col  = pos - info.lineStart;

    if (info.idx !== _prevCursorLineIdx && _prevCursorLineIdx >= 0) {
      _patchCursorLine(_prevCursorLineIdx, text.slice(_prevCursorLineStart, _prevCursorLineEnd), undefined);
    }
    _patchCursorLine(info.idx, text.slice(info.lineStart, info.lineEnd), col);
    _prevCursorLineIdx = info.idx;
    _prevCursorLineStart = info.lineStart;
    _prevCursorLineEnd = info.lineEnd;
  }

  function _patchCursorLine(idx, lineText, cursorCol) {
    const lineEl = pre().children[idx];
    if (!lineEl) return;
    const s = State.settings;
    let html = _renderLine(lineText, s, escRx(s.headingMarker), escRx(s.commentMarker), _buildMarkupRules(s), false);
    if (cursorCol !== undefined) html = injectCursorAt(html, cursorCol);
    lineEl.innerHTML = html;
  }

  function syncGutter() {
    const input = ta();
    const hl    = pre();
    // Measure actual scrollbar width: offsetWidth includes it, clientWidth doesn't
    const gutter   = input.offsetWidth - input.clientWidth;
    const baseRight = parseFloat(getComputedStyle(input).paddingRight) || 0;
    hl.style.paddingRight = (baseRight + gutter) + 'px';
  }

  // Reading offsetWidth/clientWidth/getComputedStyle right after mutating the (huge)
  // overlay's innerHTML forces a synchronous layout of the whole document — on a
  // 90K-word file that cost ~250ms PER KEYSTROKE. Deferring to rAF lets the browser
  // fold the measurement into the layout it has to do for the next paint anyway,
  // and collapses bursts of rehighlight() calls into a single measurement.
  let _gutterRaf = null;
  function scheduleSyncGutter() {
    if (_gutterRaf !== null) return;
    _gutterRaf = requestAnimationFrame(() => {
      _gutterRaf = null;
      syncGutter();
    });
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

  function isTypewriter() { return _typewriter; }

  function typewriterScroll() {
    if (!_typewriter) return;
    const input   = ta();
    const lineIdx = input.value.substring(0, input.selectionStart).split('\n').length - 1;
    const lh      = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.scrollTop = Math.max(0, linePixelTop(lineIdx) - input.clientHeight / 2 + lh / 2);
  }

  // ── Line numbers ──────────────────────────────────────────────────────────

  // Most keystrokes don't change the line count — skip the (expensive, full-text)
  // rebuild when it's unchanged. Reading scrollTop right after rewriting `textContent`
  // forces a synchronous reflow of the gutter (same layout-thrashing pattern as
  // syncGutter — ~100-180ms on a 90K-word doc), so defer it to rAF; `syncScroll()`
  // (wired to the textarea's `scroll` event) keeps it in sync the rest of the time.
  let _lastLineCount = -1;
  function updateLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el || el.style.display === 'none') return;
    const count = (ta().value.match(/\n/g) || []).length + 1;
    if (count === _lastLineCount) return;
    _lastLineCount = count;
    el.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    el.style.width = `calc(${String(count).length + 1}ch + 12px)`;
    requestAnimationFrame(() => { el.scrollTop = ta().scrollTop; });
  }

  function applyLineNumbers() {
    const el = document.getElementById('ed-linenos');
    if (!el) return;
    const show = !!State.settings.lineNumbers;
    el.style.display = show ? 'block' : 'none';
    if (show) { _lastLineCount = -1; updateLineNumbers(); }
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
    input.scrollTop = Math.max(0, linePixelTop(lineIdx) - input.clientHeight / 3);
  }

  function gotoLineClose() {
    document.getElementById('goto-bar').hidden = true;
    ta().focus();
  }

  // The `.hl-line` spans in #ed-highlight share the textarea's exact font/padding/
  // line-height (CSS-enforced) and are kept in sync with its content, so a line's
  // already-computed offsetTop gives its scroll position directly — no extra layout.
  function linePixelTop(lineIdx) {
    const pre = document.getElementById('ed-highlight');
    const padTop = parseFloat(getComputedStyle(pre).paddingTop) || 0;
    return pre.children[lineIdx].offsetTop + padTop;
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
    input.focus();
    input.setSelectionRange(blockStart, blockEnd);
    document.execCommand('insertText', false, newBlock);
    input.setSelectionRange(blockStart, blockStart + newBlock.length);
    onInput();
  }

  function applyInlineMarker(marker) {
    if (!marker) return;
    const input = ta();
    const s = input.selectionStart, e = input.selectionEnd;
    const text = input.value;
    input.focus();
    if (s === e) {
      input.setSelectionRange(s, s);
      document.execCommand('insertText', false, marker + marker);
      input.setSelectionRange(s + marker.length, s + marker.length);
    } else {
      const sel = text.slice(s, e);
      const isWrapped = sel.startsWith(marker) && sel.endsWith(marker) && sel.length > marker.length * 2;
      if (isWrapped) {
        const inner = sel.slice(marker.length, -marker.length);
        input.setSelectionRange(s, e);
        document.execCommand('insertText', false, inner);
        input.setSelectionRange(s, s + inner.length);
      } else {
        const wrapped = marker + sel + marker;
        input.setSelectionRange(s, e);
        document.execCommand('insertText', false, wrapped);
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
    input.focus();
    input.setSelectionRange(blockStart, blockEnd);
    document.execCommand('insertText', false, newBlock);
    input.setSelectionRange(blockStart, blockStart + newBlock.length);
    onInput();
  }

  // ── Command mode (ESC) ───────────────────────────────────────────────────

  function enterCmdMode() {
    _cmdMode   = true;
    _cmdNavIdx = -1;
    document.getElementById('ed-bar').classList.add('cmd-mode');
    document.getElementById('ed-menu-btn').classList.add('active');
    updateStatusBar();
  }

  function exitCmdMode() {
    _cmdMode   = false;
    _cmdNavIdx = -1;
    document.getElementById('ed-bar').classList.remove('cmd-mode');
    document.getElementById('ed-menu-btn').classList.remove('active');
    updateStatusBar();
  }

  function isCmdMode() { return _cmdMode; }

  function cmdNavMove(delta) {
    if (!_cmdMode) return;
    const n = _CMD_LIST.length;
    _cmdNavIdx = _cmdNavIdx === -1
      ? (delta > 0 ? 0 : n - 1)
      : (_cmdNavIdx + delta + n) % n;
    updateStatusBar();
  }

  function getCmdNavKey() {
    if (_cmdNavIdx < 0 || _cmdNavIdx >= _CMD_LIST.length) return null;
    return _CMD_LIST[_cmdNavIdx][0];
  }

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
      const bar = document.getElementById('ed-bar-left');
      bar.innerHTML = '';
      _CMD_LIST.forEach(([key, label], i) => {
        const btn = document.createElement('button');
        btn.className = 'cmd-btn' + (i === _cmdNavIdx ? ' active' : '');
        btn.dataset.cmd = key;
        btn.innerHTML = `<b>${key}</b>:${label}`;
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('writhdeck-cmd', { detail: key }));
        });
        bar.appendChild(btn);
      });
      const exit = document.createElement('span');
      exit.className = 'cmd-exit';
      exit.textContent = '·ESC/Alt+C·';
      bar.appendChild(exit);
      document.getElementById('ed-bar-center').textContent = '';
      document.getElementById('ed-bar-right').textContent  = '';
      return;
    }
    const s = State.settings;
    const doc = State.doc;

    // Lazily compute expensive full-text values — only when a configured status-bar
    // token actually needs them. wordCount() alone scans the whole document, and on
    // a 90K-word file this ran on every keystroke even when "words" wasn't displayed.
    let _wc = null;
    const wc = () => {
      if (_wc === null) _wc = doc ? wordCount(ta().value) : 0;
      return _wc;
    };
    let _today = null;
    const today = () => {
      if (_today === null) {
        if (doc && _sessionBaseline >= 0) {
          const cur = Math.max(0, wc() - _sessionBaseline);
          if (cur > _sessionMaxToday) _sessionMaxToday = cur;
          _today = _sessionMaxToday;
        } else {
          _today = doc ? todayWords(doc.id) : 0;
        }
      }
      return _today;
    };
    const clk = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    function buildZone(spec) {
      return spec.split(/\s+/).map(tok => {
        switch (tok) {
          case 'filename': return doc ? doc.name : '';
          case 'dirty':    return State.dirty ? '[+]' : '';
          case 'words':    return doc ? `${wc()}w` : '';
          case 'chars':    return doc ? `${(ta().value || '').length}c` : '';
          case 'goal':     return s.wordGoal > 0 ? `${today()}/${s.wordGoal}` : '';
          case 'clock':    return clk;
          case 'timer':    return s.timerShow ? Timer.format() : '';
          case 'today':    return doc && today() > 0 ? `${today()}↑` : '';
          case 'percent':  return (doc && s.wordGoal > 0) ? `${Math.min(100, Math.round(wc() / s.wordGoal * 100))}%` : '';
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
          case 'pages':   return (doc && wc() > 0) ? `${Math.ceil(wc() / 250)}p` : '';
          case 'reading': {
            if (!doc || !wc()) return '';
            const mins = Math.ceil(wc() / 200);
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
    const bar   = document.getElementById('search-bar');
    const input = document.getElementById('search-input');
    // Ctrl+F while find bar is open → close
    if (!bar.hidden && !withReplace && document.getElementById('replace-row').hidden) {
      searchClose();
      return;
    }
    bar.hidden = false;
    document.getElementById('replace-row').hidden   = !withReplace;
    document.getElementById('replace-one').hidden   = !withReplace;
    document.getElementById('replace-all').hidden   = !withReplace;
    if (_searchTerm) { input.value = _searchTerm; }
    input.focus();
    input.select();
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
    input.scrollTop = Math.max(0, linePixelTop(lineIdx) - input.clientHeight / 3);
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
    open, close, save, saveAs, onInput, syncScroll, syncGutter, rehighlight, updateStatusBar, setMsg,
    syncCursorLineCache, syncBlockCursor,
    saveCursorPos, applyLineNumbers,
    toggleTypewriter, isTypewriter, typewriterScroll, toggleLineNumbers, gotoLine, gotoLineGo, gotoLineClose,
    applyLineMarker, applyInlineMarker, applyHeading,
    enterCmdMode, exitCmdMode, isCmdMode, cmdNavMove, getCmdNavKey,
    searchOpen, searchClose, searchUpdate, searchNext, searchPrev, replaceOne, replaceAll,
    exportDoc
  };
})();
