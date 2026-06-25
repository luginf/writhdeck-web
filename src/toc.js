'use strict';
// Table of Contents — side panel (right)
const TOC = (() => {
  let _visible = false;
  let _pinned  = false;
  let _focused = -1;
  let _wired   = false;

  function _show(visible) {
    const panel = document.getElementById('toc-panel');
    if (!panel) return;
    // Use style.display instead of hidden attribute — avoids Firefox UA cascade issues
    panel.style.display = visible ? 'flex' : 'none';
    const btn = document.getElementById('ed-toc-btn');
    if (btn) btn.classList.toggle('active', visible);
  }

  function _setPinned(val) {
    _pinned = val;
    const pinBtn = document.getElementById('toc-pin-btn');
    if (pinBtn) {
      pinBtn.classList.toggle('active', _pinned);
      pinBtn.title = _pinned
        ? t('toc_unpin_title', 'Unpin TOC (closes when selecting a chapter)')
        : t('toc_pin_title', 'Pin TOC (stays open when selecting a chapter)');
    }
  }

  function _wire() {
    if (_wired) return;
    _wired = true;
    const pinBtn = document.getElementById('toc-pin-btn');
    if (!pinBtn) return;
    pinBtn.addEventListener('click', () => togglePin());
  }

  // Keyboard equivalent of clicking the pin button (Shift+Ctrl+F11, mirrors
  // Tcl's cfg_key_toc_pinned). Also opens the panel when pinning it while closed —
  // pinning a hidden panel would otherwise have no visible effect.
  function togglePin() {
    _wire();
    _setPinned(!_pinned);
    if (_pinned && !_visible) {
      _visible = true;
      _show(true);
      render();
      focusPanel();
    }
  }

  function parse(text, s) {
    const entries = [];
    text.split('\n').forEach((line, idx) => {
      let level = 0, title = '';
      if (s.markdownHeadings) {
        const m = line.match(/^(#{1,3})\s+(.+)/);
        if (m) { level = m[1].length; title = m[2]; }
      }
      if (!level && s.headingMarker) {
        const hm  = s.headingMarker;
        const hmR = hm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (line.startsWith(hm)) {
          const mm = line.match(new RegExp(`^(${hmR}+)`));
          level = mm ? Math.min(Math.round(mm[1].length / hm.length), 3) : 1;
          title = line.slice(hm.length).replace(new RegExp(`^${hmR}*\\s*`), '')
                      .replace(new RegExp(`\\s*${hmR}*$`), '').trim()
                  || line.trim();
        }
      }
      if (level && title) entries.push({ line: idx, level, title });
    });
    return entries;
  }

  function lineToOffset(text, lineIdx) {
    return text.split('\n').slice(0, lineIdx).reduce((s, l) => s + l.length + 1, 0);
  }

  // The `.hl-line` spans in #ed-highlight share the textarea's exact font/padding/
  // line-height (CSS-enforced) and are kept in sync with its content, so a line's
  // already-computed offsetTop gives its scroll position directly — no extra layout.
  function linePixelTop(lineIdx) {
    const pre = document.getElementById('ed-highlight');
    const padTop = parseFloat(getComputedStyle(pre).paddingTop) || 0;
    return pre.children[lineIdx].offsetTop + padTop;
  }

  function _items() {
    return Array.from(document.querySelectorAll('#toc-list .toc-item[data-line]'));
  }

  function _focusItem(idx) {
    const items = _items();
    items.forEach(it => it.classList.remove('toc-focused'));
    if (!items.length) { _focused = -1; return; }
    _focused = ((idx % items.length) + items.length) % items.length;
    items[_focused].classList.add('toc-focused');
    items[_focused].scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!_items().length) return;
    _focusItem(_focused < 0 ? (delta > 0 ? 0 : _items().length - 1) : _focused + delta);
  }

  function selectFocused() {
    const items = _items();
    if (_focused >= 0 && _focused < items.length) items[_focused].click();
  }

  function _select(ta, lineIdx) {
    const offset = lineToOffset(ta.value, lineIdx);
    ta.focus();
    ta.setSelectionRange(offset, offset);
    ta.scrollTop = Math.max(0, linePixelTop(lineIdx) - ta.clientHeight / 3);
    if (!_pinned) {
      _visible = false;
      _show(false);
      _focused = -1;
    }
  }

  function render() {
    const ta      = document.getElementById('ed-input');
    const list    = document.getElementById('toc-list');
    if (!ta || !list) return;
    const entries = parse(ta.value, State.settings);
    list.innerHTML = '';
    _focused = -1;
    if (!entries.length) {
      const div = document.createElement('div');
      div.className = 'toc-item';
      div.style.color = 'var(--fg-bar)';
      div.textContent = t('toc_no_headings', 'No headings found.');
      list.appendChild(div);
      return;
    }
    entries.forEach(e => {
      const div = document.createElement('div');
      div.className = `toc-item level-${e.level}`;
      div.dataset.line = e.line;
      div.textContent = e.title;
      div.addEventListener('click', () => _select(ta, e.line));
      list.appendChild(div);
    });
  }

  function focusPanel() {
    const list = document.getElementById('toc-list');
    if (list) list.focus({ preventScroll: true });
    _focusItem(0);
  }

  function toggle() {
    _wire();
    _visible = !_visible;
    _show(_visible);
    if (_visible) {
      render();
      focusPanel();
    } else {
      _focused = -1;
    }
  }

  function hide() {
    _visible = false;
    _show(false);
    _focused = -1;
  }

  function refresh() { if (_visible) render(); }

  return {
    toggle, hide, refresh, move, selectFocused, focusPanel, togglePin,
    isVisible: () => _visible,
    isPinned: () => _pinned,
    isFocused: () => {
      const panel = document.getElementById('toc-panel');
      return !!(panel && panel.contains(document.activeElement));
    }
  };
})();
