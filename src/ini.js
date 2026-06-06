'use strict';
// writhdeck.ini parser/writer — compatible with the Tcl/Tk desktop version

// ── Key mappings ─────────────────────────────────────────────────────────
// INI key  →  State.settings key  (+ type coercion)

const INI_TO_SETTINGS = {
  scheme:               ['scheme',          'str'],
  dark_mode:            ['darkMode',         'bool'],
  font_size:            ['fontSize',         'int'],
  font_family:          ['fontFamily',       'str'],
  bar_font_family:      ['fontFamily',       'str'],   // fallback
  margin_width:         ['marginX',          'int'],
  margin_height:        ['marginY',          'int'],
  line_spacing:         ['lineSpacing',      'float'],
  word_goal:            ['wordGoal',         'int'],
  heading_marker:       ['headingMarker',    'str'],
  comment_marker:       ['commentMarker',    'str'],
  dim_marker:           ['commentMarker',    'str'],   // legacy alias
  bold_marker:          ['boldMarker',       'str'],
  italic_marker:        ['italicMarker',     'str'],
  underline_marker:     ['underlineMarker',  'str'],
  strikethrough_marker: ['strikeMarker',     'str'],
  markdown_headings:    ['markdownHeadings', 'bool'],
  hemingway_mode:       ['hemingwayMode',    'bool'],
  timer_type:           ['timerType',        'str'],
  timer_duration:       ['timerDuration',    'int'],
  timer_sound:          ['timerSound',       'bool'],
  timer_alert:          ['timerAlert',       'bool'],
  chrono_show:          ['timerShow',        'bool'],
  status_left:          ['statusLeft',       'str'],
  status_center:        ['statusCenter',     'str'],
  status_right:         ['statusRight',      'str'],
  cursor_restore:             ['cursorRestore',             'bool'],
  line_numbers:               ['lineNumbers',               'bool'],
  block_cursor:               ['blockCursor',               'bool'],
  blink_cursor:               ['blinkCursor',               'bool'],
  intercept_browser_shortcuts:['interceptBrowserShortcuts', 'bool'],
  intercept_context_menu:     ['interceptContextMenu',      'bool'],
  open_last_doc:              ['openLastDoc',               'bool'],
};

const SETTINGS_TO_INI = Object.fromEntries(
  Object.entries(INI_TO_SETTINGS).map(([k, [v]]) => [v, k])
);
// Fix aliases — keep the canonical INI key for write
SETTINGS_TO_INI['commentMarker']  = 'comment_marker';
SETTINGS_TO_INI['fontFamily']     = 'font_family';

// Scheme color key mapping (INI ↔ JS)
const SCHEME_INI_TO_JS = {
  color_bg:          'bg',         color_fg:          'fg',
  color_bg_bar:      'bgBar',      color_fg_bar:      'fgBar',
  color_bg_sel:      'bgSel',      color_heading:     'heading',
  color_comment:     'comment',    color_markup:      'markup',
  color_bg2:         'bg2',
  color_bg_alt:      'bgAlt',      color_fg_alt:      'fgAlt',
  color_bg_bar_alt:  'bgBarAlt',   color_fg_bar_alt:  'fgBarAlt',
  color_bg_sel_alt:  'bgSelAlt',   color_heading_alt: 'headingAlt',
  color_comment_alt: 'commentAlt', color_markup_alt:  'markupAlt',
  color_bg2_alt:     'bg2Alt',
  // legacy alias
  color_dim:         'comment',    color_dim_alt:     'commentAlt',
};
const SCHEME_JS_TO_INI = {
  bg:'color_bg', fg:'color_fg', bgBar:'color_bg_bar', fgBar:'color_fg_bar',
  bgSel:'color_bg_sel', heading:'color_heading', comment:'color_comment',
  markup:'color_markup', bg2:'color_bg2',
  bgAlt:'color_bg_alt', fgAlt:'color_fg_alt', bgBarAlt:'color_bg_bar_alt',
  fgBarAlt:'color_fg_bar_alt', bgSelAlt:'color_bg_sel_alt',
  headingAlt:'color_heading_alt', commentAlt:'color_comment_alt',
  markupAlt:'color_markup_alt', bg2Alt:'color_bg2_alt',
};

// ── Boolean coercion ──────────────────────────────────────────────────────
function parseBool(v) {
  return /^(yes|1|true|on)$/i.test(String(v).trim());
}

// Strips inline comments (# preceded by whitespace). % is line-start-only.
// Leading whitespace trimmed; trailing preserved so '% ' marker round-trips correctly.
function stripComment(v) {
  return v.replace(/\s+#.*$/, '').replace(/^\s+/, '');
}

// ── Parser ────────────────────────────────────────────────────────────────
function parseIni(text) {
  const settings = {};
  const schemes  = {};   // {name: {jsKey: value}}

  let section    = '';
  let curScheme  = '';
  let curProfile = '';
  const TOPLEVEL = new Set(['editor', 'behaviour', 'keys', 'timer', 'misc', 'tui_colors', 'display', 'web']);

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('%')) continue;

    // Section header [name]
    const secMatch = line.match(/^\[(\w[\w\s]*)\]$/);
    if (secMatch) {
      const hdr = secMatch[1].trim();
      if (hdr === 'schemes') {
        section = 'schemes'; curScheme = ''; curProfile = '';
      } else if (hdr === 'profiles') {
        section = 'profiles'; curProfile = ''; curScheme = '';
      } else if (section === 'schemes' && !TOPLEVEL.has(hdr)) {
        curScheme = hdr;
      } else if (section === 'profiles' && !TOPLEVEL.has(hdr)) {
        curProfile = hdr;
      } else {
        section = hdr; curScheme = ''; curProfile = '';
      }
      continue;
    }

    // key = value
    const kvMatch = line.match(/^(\w+)\s*=(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim();
    const val = stripComment(kvMatch[2]);

    if (curScheme) {
      // Scheme color key
      const jsKey = SCHEME_INI_TO_JS[key];
      if (jsKey) {
        if (!schemes[curScheme]) schemes[curScheme] = {};
        schemes[curScheme][jsKey] = val;
      }
    } else if (!curProfile) {
      // Global setting
      const mapping = INI_TO_SETTINGS[key];
      if (mapping) {
        const [jsKey, type] = mapping;
        if (type === 'bool')        settings[jsKey] = parseBool(val);
        else if (type === 'int')    settings[jsKey] = parseInt(val, 10)  || undefined;
        else if (type === 'float')  settings[jsKey] = parseFloat(val)    || undefined;
        else                        settings[jsKey] = val;
      }
    }
  }

  // Remove undefined values
  Object.keys(settings).forEach(k => settings[k] === undefined && delete settings[k]);

  return { settings, schemes };
}

// ── Writer ────────────────────────────────────────────────────────────────
function writeIni(s, allSchemes) {
  const b = (v) => v ? 'yes' : 'no';
  const nl = '\n';

  let out = '= WrithDeck configuration =' + nl;
  out += '% https://github.com/luginf/writhdeck' + nl + nl;

  out += '= editor =' + nl + '[editor]' + nl;
  out += `scheme         = ${s.scheme || 'default'}` + nl;
  if (s.fontFamily)    out += `font_family    = ${s.fontFamily}` + nl;
  if (s.fontSize)      out += `font_size      = ${s.fontSize}` + nl;
  out += `margin_width   = ${s.marginX   || 60}` + nl;
  out += `margin_height  = ${s.marginY   || 40}` + nl;
  out += `line_spacing   = ${s.lineSpacing || 100}` + nl;
  out += `word_goal      = ${s.wordGoal  || 0}` + nl;
  out += `heading_marker       = ${s.headingMarker   || '='}` + nl;
  out += `comment_marker       = ${s.commentMarker   || '% '}` + nl;
  out += `bold_marker          = ${s.boldMarker      || '**'}` + nl;
  out += `italic_marker        = ${s.italicMarker    || '//'}` + nl;
  out += `underline_marker     = ${s.underlineMarker || '__'}` + nl;
  out += `strikethrough_marker = ${s.strikeMarker    || '--'}` + nl;
  out += `markdown_headings    = ${b(s.markdownHeadings !== false)}` + nl;
  out += nl;

  out += '= behaviour =' + nl + '[behaviour]' + nl;
  out += `hemingway_mode  = ${b(s.hemingwayMode)}` + nl;
  out += `cursor_restore               = ${b(s.cursorRestore !== false)}` + nl;
  out += `line_numbers                 = ${b(s.lineNumbers)}` + nl;
  out += `block_cursor                 = ${b(s.blockCursor)}` + nl;
  out += `blink_cursor                 = ${b(s.blinkCursor)}` + nl;
  out += `dark_mode       = ${b(s.darkMode)}` + nl;
  out += nl;

  out += '= web =' + nl + '[web]' + nl;
  out += `% Options specific to the web version — ignored by the desktop version` + nl;
  out += `open_last_doc                = ${b(s.openLastDoc)}` + nl;
  out += `intercept_browser_shortcuts  = ${b(s.interceptBrowserShortcuts)}` + nl;
  out += `intercept_context_menu       = ${b(s.interceptContextMenu !== false)}` + nl;
  out += nl;

  out += '= timer =' + nl;
  out += `timer_type     = ${s.timerType     || 'countdown'}` + nl;
  out += `timer_duration = ${s.timerDuration || 25}` + nl;
  out += `timer_sound    = ${b(s.timerSound)}` + nl;
  out += `timer_alert    = ${b(s.timerAlert)}` + nl;
  out += `chrono_show    = ${b(s.timerShow)}` + nl;
  out += nl;

  out += '= display =' + nl + '[display]' + nl;
  out += `status_left    = ${s.statusLeft   || ''}` + nl;
  out += `status_center  = ${s.statusCenter || ''}` + nl;
  out += `status_right   = ${s.statusRight  || ''}` + nl;
  out += nl;

  out += '= schemes =' + nl + '[schemes]' + nl;
  out += '% colors in #rrggbb format' + nl + nl;

  const schemeOrder = ['default', ...Object.keys(allSchemes).filter(n => n !== 'default')];
  for (const name of schemeOrder) {
    const sc = allSchemes[name];
    if (!sc) continue;
    out += `= ${name} =` + nl + `[${name}]` + nl;
    out += '% dark mode' + nl;
    for (const jsKey of ['bg','fg','bgBar','fgBar','bgSel','heading','comment','markup','bg2']) {
      if (sc[jsKey]) out += `${SCHEME_JS_TO_INI[jsKey]} = ${sc[jsKey]}` + nl;
    }
    out += '% light mode' + nl;
    for (const jsKey of ['bgAlt','fgAlt','bgBarAlt','fgBarAlt','bgSelAlt','headingAlt','commentAlt','markupAlt','bg2Alt']) {
      if (sc[jsKey]) out += `${SCHEME_JS_TO_INI[jsKey]} = ${sc[jsKey]}` + nl;
    }
    out += nl;
  }

  return out;
}

const INI = { parseIni, writeIni };
