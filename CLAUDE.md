# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

```sh
make              # → writhdeck.html (single autonomous file, ~120 KB)
make clean        # Remove writhdeck.html
```

`build.py` inlines `src/style.css` and all `src/*.js` (in the order defined in `JS_ORDER`) into `src/template.html` via `{{STYLE}}` / `{{SCRIPT}}` placeholders. No bundler, no npm.

Open `writhdeck.html` directly in any modern browser — no server required.

## Architecture

Single-file output built from modular sources in `src/`. All JS shares a single scope (no ES modules), organized as named objects assigned to global constants.

### Module load order (`src/JS_ORDER` in `build.py`)

| File | Exports | Depends on |
|---|---|---|
| `schemes.js` | `SCHEMES`, `customSchemes`, `getScheme()`, `getAllSchemeNames()` | — |
| `db.js` | `DB` (IndexedDB wrapper) | — |
| `state.js` | `State`, `loadState()`, `save*()`, helpers | `DB`, `customSchemes` |
| `ini.js` | `INI` (parser/writer) | — |
| `highlight.js` | `highlight()`, `wordCount()` | — |
| `timer.js` | `Timer` | `State`, `Editor` |
| `toc.js` | `TOC` | `State` |
| `stats.js` | `Stats` | `State` |
| `editor.js` | `Editor` | `State`, `DB`, `highlight`, `wordCount`, `Timer` |
| `browser.js` | `Browser` | `State`, `DB`, `Editor`, `Stats`, `Settings` |
| `settings.js` | `Settings` | `State`, `SCHEMES`, `customSchemes`, `getScheme`, `getAllSchemeNames`, `Editor`, `applyTheme` |
| `app.js` | `applyTheme()`, `init()` | everything |

`app.js` calls `document.addEventListener('DOMContentLoaded', init)` — entry point.

### Storage (IndexedDB, database `writhdeck`, version 1)

Two object stores:
- `documents` — keyPath `id` (autoIncrement). Fields: `id, name, content, created, modified`.
- `meta` — keyPath `key`. Used for: `iniText` (canonical settings as INI string), `favorites`, `recents`, `cursors`, `daily`.

`DB` API is fully promise-based. All reads/writes go through `DB.getMeta/setMeta` and `DB.saveDoc/getDoc/getAllDocs/deleteDoc`.

Settings are persisted as an INI text string (`meta['iniText']`) via `saveSettings()`. `loadState()` reads and parses this on startup. The INI format is compatible with the Tcl/Tk desktop version.

### Theming

`applyTheme()` in `app.js` reads `State.settings.{scheme, darkMode}`, gets the scheme object via `getScheme()`, and applies the 8 dark or 8 light colors as CSS custom properties on `:root` (`--bg`, `--fg`, `--bg-bar`, `--fg-bar`, `--bg-sel`, `--heading`, `--comment`, `--markup`, `--bg2`). Font/margin settings are also set as properties.

All CSS uses `var(--*)` — never hardcoded colors. Call `applyTheme()` after any settings change.

`getScheme(name)` returns `customSchemes[name] || SCHEMES[name] || SCHEMES.default`. Built-in scheme colors always come from code (`SCHEMES`) — `loadState()` only puts non-built-in schemes into `customSchemes`.

### Editor: textarea + overlay technique

`#ed-input` (textarea, `color: transparent`, z-index 1) receives all input — it is purely an input element, its text is invisible.

`#ed-highlight` (pre, `color: var(--fg)`, `pointer-events:none`, absolute overlay) renders all visible text via `innerHTML = highlight(...)`. Colored spans (`.hl-heading`, `.hl-comment`, `.hl-markup`) override the default `var(--fg)` color for their lines.

Both elements share identical font/padding/line-height — enforced in CSS. `Editor.syncScroll()` keeps their scroll positions in sync. `Editor.syncGutter()` compensates for the textarea's scrollbar width by adjusting the pre's `paddingRight` dynamically, so both elements wrap text at the same width (called on every `rehighlight()`, on open, and on resize/fullscreenchange).

#### `highlight(text, settings, searchTerm?, paraStart?, paraEnd?)`

Processes text line-by-line:
- Heading lines → `<span class="hl-heading">` (or `hl-heading hl-dim` if outside paragraph range)
- Comment lines → `<span class="hl-comment">` (or `hl-comment hl-dim`)
- Regular lines outside paragraph range → `<span class="hl-dim">`
- Regular lines inside range → inline markup applied (`hl-markup` spans)

When `searchTerm` is provided, matches are injected as `<span class="hl-search">` into text nodes only (skipping HTML tags) to avoid breaking existing spans.

When `paraStart`/`paraEnd` are provided (typewriter focus mode), lines outside the range are dimmed:
- `.hl-dim { color: var(--comment); }` — plain text dims to comment color
- `.hl-heading.hl-dim { color: var(--heading); opacity: 0.35; }` — headings stay in heading color but faded

Returns HTML string with trailing `\n`.

#### Pixel-accurate scroll positioning

`linePixelTop(input, lineIdx)` creates a hidden mirror div with identical font/padding/width to the textarea, fills it with text up to `lineIdx`, and reads `offsetHeight`. This gives the exact pixel position of the target line accounting for word-wrap. Used by:
- `Editor.gotoLine()` — go-to-line bar
- `Editor.selectMatch()` — find/replace
- `TOC` click handlers
- `Editor.typewriterScroll()` — centers current line vertically

### Typewriter mode

`Editor.toggleTypewriter()` adds/removes `.typewriter` class on `#editor`. When active:
- `rehighlight()` computes paragraph boundaries (blank lines, heading lines, comment lines) from the cursor position and passes `paraStart`/`paraEnd` to `highlight()`
- Lines outside the current paragraph are dimmed (`.hl-dim`)
- `typewriterScroll()` centers the current line vertically using `linePixelTop()`

### Color schemes

Defined in `schemes.js` as plain objects with 18 keys (`bg`, `fg`, `bgBar`, `fgBar`, `bgSel`, `heading`, `comment`, `markup`, `bg2` + `*Alt` variants for light mode). Custom schemes are stored in `customSchemes` and persisted in the INI.

To add a built-in scheme: add an entry to `SCHEMES` in `schemes.js`.

### Key patterns

- `State.doc` — currently open document object (null in browser view)
- `State.dirty` — unsaved changes flag; set in `Editor.onInput()`, cleared in `Editor.save()`
- `State.settings` — live settings object; mutated by `Settings.apply()`, persisted via `saveSettings()`
- `State.iniText` — the canonical INI text as last written to IDB
- Daily stats use high-water mark: `updateDaily(id, wc)` only increases, never decreases
- Cursor position saved as character offset in `State.cursors[id]`, persisted to `meta['cursors']`

### Keyboard shortcuts

Handled centrally in `onKeydown()` (`app.js`). Editor: `Ctrl+S` save, `Ctrl+Q` close, `Ctrl+F` find, `Ctrl+H` replace, `Ctrl+G` goto line, `Ctrl+L` line numbers, `Ctrl+D` dark/light, `Alt+T` timer, `Alt+C`/`Esc` command mode, `F11` TOC, `Alt+Enter` fullscreen. Browser: `n` new, `s` stats, `c` settings. Global override (when `interceptBrowserShortcuts`): `Ctrl+N` new doc.

**Command mode** (`Alt+C` / `Esc`): enters a modal state (`_cmdMode = true`) where the next keystroke triggers a command — `f` find, `r` replace, `g` goto, `n` linenos, `d` dark, `o` toc, `c` config, `e` export .txt, `s` stats, `i` info, `t` timer, `p` pause, `w` typewriter, `q` close. Works in fullscreen (unlike `Esc` which the browser intercepts). Status bar shows all commands when in mode.

**`≡` menu** (button `#ed-menu-btn`): single dropdown covering all editor actions. Opens with `openMenu()` in `app.js`. Sections: View, Search, Format (H1–H3 via `Editor.applyHeading(n)`, inline markers via `Editor.applyInlineMarker()`), Document, App. Format labels are dynamically generated from `State.settings.*Marker` values.

### Markup helpers (`Editor`)

- `applyLineMarker(marker)` — toggles a line-level marker (e.g., comment `%`) at the start of each selected line
- `applyInlineMarker(marker)` — wraps/unwraps selection with an inline marker (bold, italic…); if no selection, inserts `marker+marker` and places cursor between them
- `applyHeading(level)` — applies heading at the given level (1–3) using repeated `headingMarker`; detects and replaces existing heading level; format: `{marker×n} content {marker×n}`

### Search

`Editor.searchOpen(withReplace)` shows `#search-bar`. `searchUpdate()` finds all matches and calls `rehighlight()` to show `hl-search` spans in the overlay. `selectMatch()` sets the textarea's selection and scrolls (without stealing focus from the search input — `input.focus()` deliberately omitted). Closing the search bar calls `rehighlight()` to remove the highlights.

### Go to line

`Editor.gotoLine()` shows `#goto-bar` (styled identically to `#search-bar`). On confirm, `gotoLineGo()` computes the character offset and scrolls using `linePixelTop()`.

### Adding a feature

1. Add logic to the relevant module (or create a new `src/foo.js`)
2. If new file: add it to `JS_ORDER` in `build.py` and `JS_SRCS` in `Makefile`
3. Wire events in `app.js` `init()`
4. Run `make`
