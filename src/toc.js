'use strict';
// Table of Contents — side panel (right)
const TOC = (() => {
  let _visible = false;

  function _show(visible) {
    const panel = document.getElementById('toc-panel');
    if (!panel) return;
    // Use style.display instead of hidden attribute — avoids Firefox UA cascade issues
    panel.style.display = visible ? 'flex' : 'none';
    const btn = document.getElementById('ed-toc-btn');
    if (btn) btn.classList.toggle('active', visible);
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

  function linePixelTop(ta, lineIdx) {
    const cs = getComputedStyle(ta);
    const m  = document.createElement('div');
    m.style.cssText = `position:fixed;top:-9999px;left:-9999px;visibility:hidden;`
      + `white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;`
      + `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};`
      + `padding:${cs.paddingTop} ${cs.paddingRight} 0 ${cs.paddingLeft};`
      + `width:${ta.clientWidth}px;box-sizing:border-box`;
    m.textContent = ta.value.split('\n').slice(0, lineIdx).join('\n') + (lineIdx > 0 ? '\n' : '');
    document.body.appendChild(m);
    const top = m.offsetHeight;
    document.body.removeChild(m);
    return top;
  }

  function render() {
    const ta      = document.getElementById('ed-input');
    const list    = document.getElementById('toc-list');
    if (!ta || !list) return;
    const entries = parse(ta.value, State.settings);
    list.innerHTML = '';
    if (!entries.length) {
      const div = document.createElement('div');
      div.className = 'toc-item';
      div.style.color = 'var(--fg-bar)';
      div.textContent = 'No headings found.';
      list.appendChild(div);
      return;
    }
    entries.forEach(e => {
      const div = document.createElement('div');
      div.className = `toc-item level-${e.level}`;
      div.textContent = e.title;
      div.addEventListener('click', () => {
        const offset = lineToOffset(ta.value, e.line);
        ta.focus();
        ta.setSelectionRange(offset, offset);
        ta.scrollTop = Math.max(0, linePixelTop(ta, e.line) - ta.clientHeight / 3);
      });
      list.appendChild(div);
    });
  }

  function toggle() {
    _visible = !_visible;
    _show(_visible);
    if (_visible) render();
  }

  function hide() {
    _visible = false;
    _show(false);
  }

  function refresh() { if (_visible) render(); }

  return { toggle, hide, refresh, isVisible: () => _visible };
})();
