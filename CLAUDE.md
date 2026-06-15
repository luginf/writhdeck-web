# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

```sh
make              # → writhdeck.html (single autonomous file, ~146 KB)
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

**Per-profile settings** (`[profiles]` section): `State.profiles` (`{name: {...}}`), `State.activeProfile`, `State.profileNames`. The 12 keys in `INI.PROFILE_JS_KEYS` (`scheme`, `headingMarker`, `markdownHeadings`, `marginX`, `marginY`, `wordGoal`, `fontSize`, `fontFamily`, `lineSpacing`, `lineNumbers`, `darkMode`, `blockCursor` — aligned with the Tcl/Android profile key set) live per-profile, not in `State.settings`'s global `[editor]`/`[behaviour]` output. `applyParsedProfiles(profiles, activeProfile)` (in `state.js`) adopts parsed profiles and merges the active profile's overrides onto `State.settings`; call it after any `parseIni()`. `seedProfilesIfMissing()` creates `default`+`novel` on first run / when loading an INI without `[profiles]`. The Profile tab's `#profile-select` + new/delete buttons (`settings.js`: `switchProfile`/`newProfile`/`deleteProfile`) call `apply()` first to commit pending edits to the active profile before switching.

**Reset to defaults**: the Settings dialog footer has a "Reset to defaults" button that clears `meta['iniText']` from IndexedDB and reloads — equivalent to deleting `writhdeck.ini`.

**INI parser note** (`ini.js`): `stripComment()` strips leading whitespace only (not trailing), so marker values with intentional trailing spaces (e.g. `comment_marker = % `) round-trip correctly. Default `commentMarker` is `'% '` (percent + space).

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

### Document name uniqueness

`browser.js` enforces unique names: `nameExists(name, excludeId)` checks `State.docs`. On new doc creation, `uniqueName('Untitled')` auto-suggests `"Untitled (2)"` etc. if the base name is taken. Creating or renaming to an existing name shows an alert and cancels.

### Keyboard shortcuts

Handled centrally in `onKeydown()` (`app.js`). Editor: `Ctrl+S` save, `Ctrl+Q` close, `Ctrl+F` find, `Ctrl+H` replace, `Ctrl+G` goto line, `Ctrl+L` line numbers, `Ctrl+D` dark/light, `Alt+T` timer, `Alt+C`/`Esc` command mode, `F11` TOC, `Alt+Enter` fullscreen. Browser: `n` new, `s` stats, `c` settings. Global override (when `interceptBrowserShortcuts`): `Ctrl+N` new doc.

**Command mode** (`Alt+C` / `Esc`): enters a modal state (`_cmdMode = true`). The status bar replaces its three zones with a single row of clickable `<button class="cmd-btn">` elements (one per command), rendered by `updateStatusBar()` via `_CMD_LIST` in `editor.js`. Navigation:
- **Letter key** — executes the command directly and exits cmd mode
- **← / →** — moves selection via `Editor.cmdNavMove(±1)`, which updates `_cmdNavIdx` and re-renders the bar; the active button gets class `.cmd-btn.active` (highlighted in `--heading` color + underline)
- **Enter** — dispatches `writhdeck-cmd` CustomEvent with `Editor.getCmdNavKey()`; the listener in `app.js` calls `exitCmdMode()` then executes the command
- **Mouse click** — button `mousedown` (with `preventDefault()`) dispatches `writhdeck-cmd`; the same listener handles it

`_cmdNavIdx` is stored in `editor.js` (JS state, not DOM focus) so it survives `updateStatusBar()` re-renders from the clock interval. `exitCmdMode()` resets `_cmdNavIdx = -1`.

**`≡` menu** (button `#ed-menu-btn`): single dropdown covering all editor actions. Opens with `openMenu()` in `app.js`. Sections: View, Search, Format (H1–H3 via `Editor.applyHeading(n)`, inline markers via `Editor.applyInlineMarker()`), Document, App. Format labels are dynamically generated from `State.settings.*Marker` values.

The `≡` button uses `mousedown + preventDefault()` to prevent stealing focus from the textarea — selected text remains highlighted when the menu opens.

**Menu keyboard navigation**: ArrowUp/ArrowDown navigate between enabled items (handled in `onKeydown` capture phase, works regardless of focus). Enter activates the focused item. Escape closes the menu.

The menu open/show is deferred via `setTimeout(0)` to let any Firefox focus-activation click fire first (harmlessly, while the menu is still hidden).

Module-level refs `_edMenu` / `_openMenuFn` allow `onKeydown` (outside `init()`) to open the menu via `showMainMenu()`.

### Right-click context menu (editor)

Controlled by `State.settings.interceptContextMenu` (default `true`). When active, intercepts `contextmenu` on `#ed-input` and shows a custom menu with:
- **Format** — H1/H2/H3, Comment (always), inline styles (Bold/Italic/Underline/Strike, grayed out without selection) — only configured markers shown
- **Edit** — Cut/Copy (grayed without selection), Paste (via `navigator.clipboard.readText()`)
- **Spell check on/off** — toggles `spellcheck` attribute on the textarea

All context menu buttons use `mousedown + preventDefault()` so the textarea keeps focus and selection during style actions. Menu is closed by Escape (priority in `onKeydown`) or any click outside.

Toggle in `≡` menu → App section → "Right-click menu".

### Right-click context menu (browser)

Right-clicking a document row in `browser.js` shows a menu via `showContextMenu(doc, e)`: Open, **Info**, Rename, Export as .txt, Export as .md, Stats, Delete. "Info" dispatches `writhdeck-show-info` CustomEvent with the doc object; the listener in `app.js` calls `showFileInfo(doc)`. `showFileInfo` accepts an optional `docArg` so it can show info for a document that isn't currently open.

### Browser keyboard navigation

`↑` / `↓` in the browser panel (no input focused) navigates the document list. The selected row receives class `.br-nav-item.br-focused` (accent-coloured left border via `box-shadow: inset 3px 0 0 var(--heading)`). Navigation state is tracked purely via the CSS class — no DOM focus involved. `Enter` calls `.click()` on the focused row to open the document. The `.br-focused` class is cleared when `render()` rebuilds the list.

### Status bar tokens

`buildZone(spec)` in `Editor.updateStatusBar()` splits the spec string on whitespace and maps tokens:

| Token | Output | Notes |
|---|---|---|
| `filename` | document name | empty in browser view |
| `dirty` | `[+]` | only when unsaved |
| `words` | `142w` | |
| `chars` | `840c` | |
| `lines` | `42L` | total line count |
| `line` | `L12` | current cursor line |
| `col` | `C5` | current cursor column |
| `para` | `7§` | paragraphs (blank-line separated) |
| `pages` | `3p` | estimated at 250 w/page |
| `percent` | `68%` | word goal percentage |
| `today` | `142↑` | daily high-water mark |
| `goal` | `142/500` | today/goal, hidden if no goal set |
| `reading` | `4min` | estimated reading time at 200 w/min |
| `clock` | `14:32` | current time |
| `timer` | timer display | respects `timerShow` setting |
| `space` | ` ` | single space (explicit separator) |
| `help_bar` | *(empty)* | reserved token, outputs nothing |
| anything else | literal text | |

`line`/`col` update on textarea click and keyup (in addition to input events).

### Markup helpers (`Editor`)

- `applyLineMarker(marker)` — toggles a line-level marker (e.g., comment `%`) at the start of each selected line
- `applyInlineMarker(marker)` — wraps/unwraps selection with an inline marker (bold, italic…); if no selection, inserts `marker+marker` and places cursor between them
- `applyHeading(level)` — applies heading at the given level (1–3) using repeated `headingMarker`; detects and replaces existing heading level; format: `{marker×n} content {marker×n}`

### Search

`Editor.searchOpen(withReplace)` shows `#search-bar`. `searchUpdate()` finds all matches and calls `rehighlight()` to show `hl-search` spans in the overlay. `selectMatch()` sets the textarea's selection and scrolls (without stealing focus from the search input — `input.focus()` deliberately omitted). Closing the search bar calls `rehighlight()` to remove the highlights.

**Toggle**: calling `searchOpen(false)` while the bar is already open in find mode (replace row hidden) closes it — so `Ctrl+F` acts as a toggle. On reopen, the previous search term is restored in the input and pre-selected (`input.select()`), so typing immediately replaces it.

### Go to line

`Editor.gotoLine()` shows `#goto-bar` (styled identically to `#search-bar`). On confirm, `gotoLineGo()` computes the character offset and scrolls using `linePixelTop()`.

### Adding a feature

1. Add logic to the relevant module (or create a new `src/foo.js`)
2. If new file: add it to `JS_ORDER` in `build.py` and `JS_SRCS` in `Makefile`
3. Wire events in `app.js` `init()`
4. Run `make`

### Firefox / extension notes

- The `≡` menu uses `setTimeout(0)` on open to defer visibility past Firefox's focus-activation click. This fixes menu-doesn't-appear with multiple tabs.
- `edMenu.focus()` was intentionally removed — calling `.focus()` on the menu div triggered silent event interception by extensions like NoScript.
- Arrow key navigation uses the `onKeydown` document capture handler (not an `edMenu` keydown listener) so it works regardless of which element has focus.
- If the menu opens but items don't activate: check for extensions (NoScript etc.) that may silently intercept DOM events. Works in Firefox private/incognito where extensions are typically disabled.
