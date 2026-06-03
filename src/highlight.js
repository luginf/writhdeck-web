'use strict';
// Syntax highlighting engine — textarea overlay technique

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlight(text, s) {
  // Build regexes from current settings
  const hm = escRx(s.headingMarker);
  const cm = escRx(s.commentMarker);
  const bm = escRx(s.boldMarker);
  const im = escRx(s.italicMarker);
  const um = escRx(s.underlineMarker);
  const sm = escRx(s.strikeMarker);

  const lines = text.split('\n');
  const out = lines.map(line => {
    const esc = escapeHtml(line);

    // Heading line
    if (hm && line.startsWith(s.headingMarker)) {
      return `<span class="hl-heading">${esc}</span>`;
    }
    // Markdown headings
    if (s.markdownHeadings && /^#{1,6}\s/.test(line)) {
      return `<span class="hl-heading">${esc}</span>`;
    }
    // Comment line
    if (cm && line.startsWith(s.commentMarker)) {
      return `<span class="hl-comment">${esc}</span>`;
    }
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
  return out.join('\n') + '\n';
}

function escRx(s) {
  return s ? s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}
