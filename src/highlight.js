'use strict';
// Syntax highlighting engine — textarea overlay technique

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Inject a block-cursor span at original-text column `col` inside HTML `html`.
// HTML tags are skipped; HTML entities count as one original character each.
function injectCursorAt(html, col) {
  let rem = col;
  let done = false;
  const result = html.replace(/(<[^>]+>)|(&[^;]+;)|([\s\S])/g, (m, tag, ent, ch) => {
    if (done || tag) return m;
    if (rem-- > 0) return m;
    done = true;
    return `<span class="hl-cursor">${m}</span>`;
  });
  return done ? result : result + '<span class="hl-cursor"> </span>';
}

// Build inline-markup rules once per highlight() call (regex compilation is
// loop-invariant — doing it inside the per-line loop cost ~70ms on a 90K-word
// document). Exposed so the incremental single-line repaint in editor.js (see
// `rehighlight()`'s fast path) can reuse the exact same rules.
function _buildMarkupRules(s) {
  const rules = [];
  if (s.boldMarker)      rules.push(_markupRule(s.boldMarker));
  if (s.italicMarker)    rules.push(_markupRule(s.italicMarker));
  if (s.underlineMarker) rules.push(_markupRule(s.underlineMarker));
  if (s.strikeMarker)    rules.push(_markupRule(s.strikeMarker));
  return rules;
}

function _markupRule(marker) {
  const escMarker = escapeHtml(marker);
  const rx = new RegExp(escRx(escMarker) + '(.+?)' + escRx(escMarker), 'g');
  return { rx, replacer: (_, inner) => `<span class="hl-markup">${escMarker}${inner}${escMarker}</span>` };
}

// Render a single line's inner HTML (heading/comment/dim/inline-markup), with
// no cursor or search overlay — the part that's identical between the full
// highlight() pass and the incremental single-line repaint fast path.
function _renderLine(line, s, hm, cm, markupRules, dim) {
  const esc = escapeHtml(line);
  if (hm && line.startsWith(s.headingMarker)) {
    return `<span class="hl-heading${dim ? ' hl-dim' : ''}">${esc}</span>`;
  }
  if (s.markdownHeadings && /^#{1,6}\s/.test(line)) {
    return `<span class="hl-heading${dim ? ' hl-dim' : ''}">${esc}</span>`;
  }
  if (cm && line.startsWith(s.commentMarker)) {
    return `<span class="hl-comment${dim ? ' hl-dim' : ''}">${esc}</span>`;
  }
  if (dim) {
    return `<span class="hl-dim">${esc}</span>`;
  }
  let result = esc;
  for (const rule of markupRules) {
    rule.rx.lastIndex = 0;
    result = result.replace(rule.rx, rule.replacer);
  }
  return result;
}

function highlight(text, s, searchTerm, paraStart, paraEnd, cursorPos) {
  const hm = escRx(s.headingMarker);
  const cm = escRx(s.commentMarker);
  const hasPara = paraStart !== undefined && paraEnd !== undefined;
  const lines = text.split('\n');
  const markupRules = _buildMarkupRules(s);

  // Compute cursor line/col from absolute offset
  let cursorLine = -1, cursorCol = -1;
  if (cursorPos !== undefined) {
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cursorPos <= off + lines[i].length) { cursorLine = i; cursorCol = cursorPos - off; break; }
      off += lines[i].length + 1;
    }
    if (cursorLine === -1) { cursorLine = lines.length - 1; cursorCol = lines[lines.length - 1].length; }
  }

  const out = lines.map((line, idx) => {
    const dim = hasPara && (idx < paraStart || idx > paraEnd);
    let lineHtml = _renderLine(line, s, hm, cm, markupRules, dim);
    if (idx === cursorLine) lineHtml = injectCursorAt(lineHtml, cursorCol);
    return `<span class="hl-line">${lineHtml}</span>`;
  });

  // \n between spans = line break in the pre's pre-wrap IFC.
  // Trailing \n ensures overlay height matches the textarea (cursor line at end).
  if (!searchTerm) return out.join('\n') + '\n';

  // Inject search highlights into text nodes only (skip HTML tags)
  const termRx = escRx(escapeHtml(searchTerm));
  return out.map(line => line.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) =>
    tag ? tag : text.replace(new RegExp(termRx, 'gi'),
      m => `<span class="hl-search">${m}</span>`)
  )).join('\n') + '\n';
}

function escRx(s) {
  return s ? s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}
