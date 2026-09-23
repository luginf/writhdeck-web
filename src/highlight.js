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
  let headingLevel = 0;
  if (hm && line.startsWith(s.headingMarker)) {
    const ml = s.headingMarker.length;
    while (line.startsWith(s.headingMarker.repeat(headingLevel + 1))) headingLevel++;
  } else if (s.markdownSupport) {
    const m = line.match(/^(#{1,6})\s/);
    if (m) headingLevel = m[1].length;
  }
  if (headingLevel > 0) {
    const lvCls = headingLevel <= 4 ? ` hl-h${headingLevel}` : '';
    return `<span class="hl-heading${lvCls}${dim ? ' hl-dim' : ''}">${esc}</span>`;
  }
  if (cm && line.startsWith(s.commentMarker)) {
    return `<span class="hl-comment${dim ? ' hl-dim' : ''}">${esc}</span>`;
  }
  // List item: "- " always, "* " only with Markdown support. Whole line in
  // the markup colour, like bold/italic spans.
  const isList = /^\s*-\s/.test(line) || (s.markdownSupport && /^\s*\*\s/.test(line));
  // Sentence-length mode (analysis tool): mark each sentence with its class.
  if (!dim && Sentences.active) {
    const marked = _renderSentences(line, markupRules, isList);
    if (marked !== null) return marked;
  }
  if (isList) {
    return `<span class="hl-markup${dim ? ' hl-dim' : ''}">${esc}</span>`;
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

// Renders a prose line with one <span class="sl-short|medium|long"> per
// sentence (Sentences.split - see sentences.js). Every character of the line is
// kept, in order, so the text-node concatenation still equals the raw text
// (selection highlight / block cursor rely on that). Inline markup is applied
// per sentence, so a bold span crossing a sentence boundary is not coloured.
// Returns null when the line holds no sentence (caller renders it normally).
function _renderSentences(line, markupRules, isList) {
  const sents = Sentences.split(line);
  if (!sents.length) return null;
  let html = '', pos = 0;
  for (const { start, end, words } of sents) {
    if (start > pos) html += escapeHtml(line.slice(pos, start));
    let seg = escapeHtml(line.slice(start, end));
    if (!isList) {
      for (const rule of markupRules) {
        rule.rx.lastIndex = 0;
        seg = seg.replace(rule.rx, rule.replacer);
      }
    }
    html += `<span class="sl-${Sentences.classOf(words, Sentences.shortMax, Sentences.longMin)}">${seg}</span>`;
    pos = end;
  }
  if (pos < line.length) html += escapeHtml(line.slice(pos));
  return isList ? `<span class="hl-markup">${html}</span>` : html;
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

// Word count skipping every line that starts with the comment marker
// (State.settings.commentMarker).
function wordCountNoComments(text, marker) {
  if (!marker) return wordCount(text);
  return text.split('\n')
    .filter(line => !line.startsWith(marker))
    .reduce((n, line) => n + wordCount(line), 0);
}
