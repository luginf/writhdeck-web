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
  browser_filter:             ['browserFilter',             'str'],
  browser_show_all:           ['browserShowAll',            'bool'],
  browser_subdirs:            ['browserSubdirs',            'bool'],
};

const SETTINGS_TO_INI = Object.fromEntries(
  Object.entries(INI_TO_SETTINGS).map(([k, [v]]) => [v, k])
);
// Fix aliases — keep the canonical INI key for write
SETTINGS_TO_INI['commentMarker']  = 'comment_marker';
SETTINGS_TO_INI['fontFamily']     = 'font_family';

// Per-profile settings — aligned with the Tcl/Android "profile" key set.
const PROFILE_KEYS = [
  'scheme', 'heading_marker', 'markdown_headings',
  'margin_width', 'margin_height', 'word_goal',
  'font_size', 'font_family', 'line_spacing',
  'line_numbers', 'dark_mode', 'block_cursor'
];
const PROFILE_JS_KEYS = PROFILE_KEYS.map(k => INI_TO_SETTINGS[k][0]);

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

function coerceValue(type, val) {
  if (type === 'bool')   return parseBool(val);
  if (type === 'int')    return parseInt(val, 10);
  if (type === 'float')  return parseFloat(val);
  return val;
}

// `line_spacing` uses incompatible units across versions: the Tcl desktop stores a
// percentage (100 = normal line height; extra_px = lineHeight*(v-100)/100), while web
// and Android store a CSS line-height / setLineSpacing multiplier (default 1.5). The two
// conventions differ by a factor of 100. INI values >= 10 are assumed to use the
// percentage convention (Tcl, or an already-migrated web/Android file) and are divided
// by 100; smaller values are pre-conversion web/Android files and used as-is.
// writeIni() always emits the percentage convention going forward, so a stale value
// self-heals on the next save.
function lineSpacingFromIni(raw) {
  return raw >= 10 ? raw / 100 : raw;
}
function lineSpacingToIni(value) {
  return Math.round(value * 100);
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
  const profiles = {};   // {name: {jsKey: value}} — per-profile overrides
  let activeProfile = 'default';

  let section    = '';
  let curScheme  = '';
  let curProfile = '';
  const TOPLEVEL = new Set(['editor', 'behaviour', 'keys', 'timer', 'misc', 'tui_colors', 'display', 'web']);

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('%')) continue;

    // Section header [name]
    const secMatch = line.match(/^\[([^[\]]+)\]$/);
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
        if (!profiles[curProfile]) profiles[curProfile] = {};
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
    } else if (curProfile) {
      // Per-profile override (12-key aligned set)
      if (PROFILE_KEYS.includes(key)) {
        const [jsKey, type] = INI_TO_SETTINGS[key];
        let v = coerceValue(type, val);
        if (key === 'line_spacing') v = lineSpacingFromIni(v);
        profiles[curProfile][jsKey] = v;
      }
    } else {
      // Global setting
      if (key === 'profile') { activeProfile = val.trim(); continue; }
      const mapping = INI_TO_SETTINGS[key];
      if (mapping) {
        const [jsKey, type] = mapping;
        if (type === 'bool')        settings[jsKey] = parseBool(val);
        else if (type === 'int')    settings[jsKey] = parseInt(val, 10)  || undefined;
        else if (type === 'float')  settings[jsKey] = parseFloat(val)    || undefined;
        else                        settings[jsKey] = val;
        if (key === 'line_spacing' && settings[jsKey] !== undefined) {
          settings[jsKey] = lineSpacingFromIni(settings[jsKey]);
        }
      }
    }
  }

  // Remove undefined values
  Object.keys(settings).forEach(k => settings[k] === undefined && delete settings[k]);

  return { settings, schemes, profiles, activeProfile };
}

// ── Writer ────────────────────────────────────────────────────────────────
function writeIni(s, allSchemes, profiles, activeProfile) {
  const b = (v) => v ? 'yes' : 'no';
  const nl = '\n';

  let out = '= WrithDeck configuration =' + nl;
  out += '% https://github.com/luginf/writhdeck' + nl + nl;

  out += '= editor =' + nl + '[editor]' + nl;
  out += `profile              = ${activeProfile || 'default'}` + nl;
  out += `comment_marker       = ${s.commentMarker   || '% '}` + nl;
  out += `bold_marker          = ${s.boldMarker      || '**'}` + nl;
  out += `italic_marker        = ${s.italicMarker    || '//'}` + nl;
  out += `underline_marker     = ${s.underlineMarker || '__'}` + nl;
  out += `strikethrough_marker = ${s.strikeMarker    || '--'}` + nl;
  out += nl;

  out += '= behaviour =' + nl + '[behaviour]' + nl;
  out += `hemingway_mode  = ${b(s.hemingwayMode)}` + nl;
  out += `cursor_restore               = ${b(s.cursorRestore !== false)}` + nl;
  out += `blink_cursor                 = ${b(s.blinkCursor)}` + nl;
  out += `% browser_filter: space-separated glob patterns (* ? [...]) for the browser file list` + nl;
  out += `browser_filter  = ${s.browserFilter ?? '*.txt *.t2t *.md *.ini'}` + nl;
  out += `% browser_show_all: bypass browser_filter and show all files` + nl;
  out += `browser_show_all = ${b(s.browserShowAll)}` + nl;
  out += `% browser_subdirs: scan and browse subfolders inside the watched folder` + nl;
  out += `browser_subdirs  = ${b(s.browserSubdirs)}` + nl;
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

  out += '= profiles =' + nl + '[profiles]' + nl;
  for (const [name, p] of Object.entries(profiles || {})) {
    const pv = (jsKey, dflt) => p[jsKey] !== undefined ? p[jsKey] : (s[jsKey] !== undefined ? s[jsKey] : dflt);
    out += `[${name}]` + nl;
    out += `scheme            = ${pv('scheme', 'default')}` + nl;
    out += `dark_mode         = ${b(pv('darkMode', true))}` + nl;
    out += `margin_width      = ${pv('marginX', 60)}` + nl;
    out += `margin_height     = ${pv('marginY', 40)}` + nl;
    out += `font_size         = ${pv('fontSize', 18)}` + nl;
    out += `font_family       = ${pv('fontFamily', 'monospace')}` + nl;
    out += `line_spacing      = ${lineSpacingToIni(pv('lineSpacing', 1.5))}` + nl;
    out += `word_goal         = ${pv('wordGoal', 0)}` + nl;
    out += `line_numbers      = ${b(pv('lineNumbers', false))}` + nl;
    out += `block_cursor      = ${b(pv('blockCursor', false))}` + nl;
    out += `heading_marker    = ${pv('headingMarker', '=')}` + nl;
    out += `markdown_headings = ${b(pv('markdownHeadings', true))}` + nl;
    out += nl;
  }

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

const INI = { parseIni, writeIni, PROFILE_JS_KEYS };
