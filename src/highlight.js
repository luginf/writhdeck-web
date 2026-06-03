'use strict';
// Syntax highlighting engine — textarea overlay technique

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlight(text, s, searchTerm, paraStart, paraEnd) {
  // Build regexes from current settings
  const hm = escRx(s.headingMarker);
  const cm = escRx(s.commentMarker);
  const bm = escRx(s.boldMarker);
  const im = escRx(s.italicMarker);
  const um = escRx(s.underlineMarker);
  const sm = escRx(s.strikeMarker);

  const hasPara = paraStart !== undefined && paraEnd !== undefined;
  const lines = text.split('\n');
  const out = lines.map((line, idx) => {
    const dim = hasPara && (idx < paraStart || idx > paraEnd);
    const esc = escapeHtml(line);

    // Heading line
    if (hm && line.startsWith(s.headingMarker)) {
      return `<span class="hl-heading${dim ? ' hl-dim' : ''}">${esc}</span>`;
    }
    // Markdown headings
    if (s.markdownHeadings && /^#{1,6}\s/.test(line)) {
      return `<span class="hl-heading${dim ? ' hl-dim' : ''}">${esc}</span>`;
    }
    // Comment line
    if (cm && line.startsWith(s.commentMarker)) {
      return `<span class="hl-comment${dim ? ' hl-dim' : ''}">${esc}</span>`;
    }
    // Lines outside paragraph in typewriter mode: plain dim, no inline markup
    if (dim) return `<span class="hl-dim">${esc}</span>`;
    // Inline markup (apply in order, non-greedy)
    let result = esc;
    if (bm) result = result.replace(new RegExp(escRx(escapeHtml(s.boldMarker)) + '(.+?)' + escRx(escapeHtml(s.boldMarker)), 'g'),
      (_, inner) => `<span class="hl-markup">${escapeHtml(s.boldMarker)}${inner}${escapeHtml(s.boldMarker)}</span>`);
    if (im) result = result.replace(new RegExp(escRx(escapeHtml(s.italicMarker)) + '(.+?)' + escRx(escapeHtml(s.italicMarker)), 'g'),
      (_, inner) => `<span class="hl-markup">${escapeHtml(s.italicMarker)}${inner}${escapeHtml(s.italicMarker)}</span>`);
    if (um) result = result.replace(new RegExp(escRx(escapeHtml(s.underlineMarker)) + '(.+?)' + escRx(escapeHtml(s.underlineMarker)), 'g'),
      (_, inner) => `<span class="hl-markup">${escapeHtml(s.underlineMarker)}${inner}${escapeHtml(s.underlineMarker)}</span>`);
    if (sm) result = result.replace(new RegExp(escRx(escapeHtml(s.strikeMarker)) + '(.+?)' + escRx(escapeHtml(s.strikeMarker)), 'g'),
      (_, inner) => `<span class="hl-markup">${escapeHtml(s.strikeMarker)}${inner}${escapeHtml(s.strikeMarker)}</span>`);
    return result;
  });

  // Trailing newline required for correct height in the overlay
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
