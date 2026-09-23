'use strict';
// Sentence-length analysis (short / medium / long) - same splitting rules as
// the Tcl desktop version (`sentence-split-line` in src/analysis.tcl).
//
// A line is a paragraph: a sentence never spans a line break, which is what
// lets highlight.js render sentence marks one line at a time (full repaint and
// incremental single-line repaint alike). Heading and comment lines are not
// prose and are never marked nor counted.
//
// `active` / `shortMax` / `longMin` are the live highlight state read by
// highlight.js's _renderLine(); the analysis dialog (app.js) and
// Editor.setSentenceMode() drive them. Temporary by design: Editor.close()
// switches it off.

const Sentences = (() => {
  // Lowercase abbreviations whose trailing "." does not end a sentence.
  const ABBREVS = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'mlles', 'dr', 'pr', 'me', 'mgr',
    'st', 'ste', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'vs', 'cf']);
  // Closing quotes / brackets that stay with the sentence they follow.
  const CLOSERS = '"\'»”’)]*_';
  const SP = /\s/;
  const LOWER = /\p{Ll}/u;
  const ALNUM = /[\p{L}\p{N}]/u;

  // Words of `seg`: whitespace-separated tokens holding at least one letter or
  // digit (a lone dialogue dash or punctuation mark is not a word).
  function countWords(seg) {
    let n = 0;
    for (const w of seg.split(/\s+/)) if (w && ALNUM.test(w)) n++;
    return n;
  }

  // Splits one line into sentences: [{start, end, words}] (char offsets, end
  // exclusive; sentences without any word are dropped). A sentence ends at a
  // run of . ! ? … followed by end of line or whitespace, unless it is an
  // abbreviation / initial ("M.", "Mme.", "J."), or the text goes on with a
  // lowercase letter (dialogue tag "- Vraiment ? dit-il.", ellipsis
  // continuation).
  function split(line) {
    const len = line.length;
    const res = [];
    const rx = /[.!?…]+/g;
    let start = 0, pos = 0;
    while (pos < len) {
      rx.lastIndex = pos;
      const m = rx.exec(line);
      if (!m) break;
      const a = m.index, b = a + m[0].length;
      let k = b;
      pos = k;
      while (k < len && CLOSERS.includes(line[k])) k++;
      if (k < len && !SP.test(line[k])) continue;
      if (b - a === 1 && line[a] === '.' && a > 0) {
        const tm = /(\p{L}+)$/u.exec(line.slice(0, a));
        if (tm) {
          const tok = tm[1];
          if (ABBREVS.has(tok.toLowerCase())
              || (tok.length === 1 && tok !== tok.toLowerCase())) continue;
        }
      }
      let nx = k;
      while (nx < len && SP.test(line[nx])) nx++;
      if (nx < len && LOWER.test(line[nx])) continue;
      // a closing guillemet / curly quote after a space still belongs here
      if (nx < len && nx > k && (line[nx] === '»' || line[nx] === '”')) {
        const after = nx + 1;
        if (after >= len || SP.test(line[after])) {
          k = after;
          nx = after;
          while (nx < len && SP.test(line[nx])) nx++;
        }
      }
      let s0 = start;
      while (s0 < k && SP.test(line[s0])) s0++;
      const n = countWords(line.slice(s0, k));
      if (n > 0) res.push({ start: s0, end: k, words: n });
      start = nx;
      pos = nx;
    }
    if (start < len) {
      let s0 = start;
      while (s0 < len && SP.test(line[s0])) s0++;
      const n = countWords(line.slice(s0));
      if (n > 0) res.push({ start: s0, end: len, words: n });
    }
    return res;
  }

  // 'short' / 'medium' / 'long' for a sentence of `words` words.
  function classOf(words, shortMax, longMin) {
    if (words <= shortMax) return 'short';
    if (words >= longMin) return 'long';
    return 'medium';
  }

  return {
    active: false,
    shortMax: 7,
    longMin: 16,
    countWords, split, classOf,
  };
})();
