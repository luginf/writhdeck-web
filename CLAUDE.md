# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

```sh
make              # → writhdeck.html (single autonomous file, ~60 KB)
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
- `meta` — keyPath `key`. Used for: `settings`, `favorites`, `recents`, `cursors`, `daily`, `customSchemes`.

`DB` API is fully promise-based. All reads/writes go through `DB.getMeta/setMeta` and `DB.saveDoc/getDoc/getAllDocs/deleteDoc`.

### Theming

`applyTheme()` in `app.js` reads `State.settings.{scheme, darkMode}`, gets the scheme object via `getScheme()`, and applies the 8 dark or 8 light colors as CSS custom properties on `:root` (`--bg`, `--fg`, `--bg-bar`, `--fg-bar`, `--bg-sel`, `--heading`, `--comment`, `--markup`, `--bg2`). Font/margin settings are also set as properties.

All CSS uses `var(--*)` — never hardcoded colors. Call `applyTheme()` after any settings change.

### Editor: textarea + overlay technique

`#ed-input` (textarea, transparent bg, z-index 1) receives all input. `#ed-highlight` (pre, `pointer-events:none`, absolute overlay) shows colorized HTML from `highlight()`. Both must share identical font/padding/line-height — enforced in CSS. `Editor.syncScroll()` keeps their scroll positions in sync.

`highlight(text, settings)` processes text line-by-line: heading lines → `.hl-heading`, comment lines → `.hl-comment`, inline markers → `.hl-markup`. Returns HTML string with trailing `\n`.

### Color schemes

Defined in `schemes.js` as plain objects with 18 keys (`bg`, `fg`, `bgBar`, `fgBar`, `bgSel`, `heading`, `comment`, `markup`, `bg2` + `*Alt` variants for light mode). Custom schemes are stored in `customSchemes` (merged into IndexedDB `meta['customSchemes']`).

To add a built-in scheme: add an entry to `SCHEMES` in `schemes.js`.

### Key patterns

- `State.doc` — currently open document object (null in browser view)
- `State.dirty` — unsaved changes flag; set in `Editor.onInput()`, cleared in `Editor.save()`
- `State.settings` — live settings object; mutated by `Settings.apply()`, persisted via `saveSettings()`
- Daily stats use high-water mark: `updateDaily(id, wc)` only increases, never decreases
- Cursor position saved as character offset in `State.cursors[id]`, persisted to `meta['cursors']`

### Keyboard shortcuts

Handled centrally in `onKeydown()` (`app.js`). Shortcuts active in editor: `Ctrl+S` save, `Ctrl+Q` close, `Ctrl+F` find, `Ctrl+H` find+replace, `Ctrl+Shift+T` TOC, `Alt+T` timer toggle, `Ctrl+D` dark/light, `Escape` close dialogs. Browser: `n` new, `s` stats, `c` config.

### Adding a feature

1. Add logic to the relevant module (or create a new `src/foo.js`)
2. If new file: add it to `JS_ORDER` in `build.py` and `JS_SRCS` in `Makefile`
3. Wire events in `app.js` `init()`
4. Run `make`
