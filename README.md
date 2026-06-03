# Writhdeck

A distraction-free writing app that runs as a single self-contained HTML file — no server, no install, no internet required. Open `writhdeck.html` directly in any modern browser.

## Features

- **Single-file**: the entire app is one `writhdeck.html` (~60 KB). Copy it anywhere, it just works.
- **Document browser**: create, rename, delete, and favourite documents stored in IndexedDB.
- **Disk file support** (Chrome/Edge): open individual files or watch a folder — edits go straight back to disk via the File System Access API.
- **Syntax highlighting overlay**: headings, comments, and inline markers (bold, italic, underline, strikethrough) are coloured in real time without leaving the textarea.
- **Configurable markers**: choose your own syntax for headings, comments, and each inline style. Enable Markdown-style `#` headings if you prefer.
- **8 built-in colour schemes** (default, solarized, gruvbox, everforest, nord, + 3 more), dark and light variants, and full custom-scheme support.
- **Writing timer**: countdown or stopwatch, with optional sound and alert at the end.
- **Table of contents**: auto-generated from heading lines, shown in a side panel.
- **Daily word-count stats** with optional daily goal.
- **Hemingway mode**: disables backspace/delete to keep you writing forward.
- **Typewriter mode**: keeps the cursor vertically centred; dims text outside the current paragraph so only the active paragraph appears at full colour.
- **Find & replace** with live match highlighting, goto line, line numbers.
- **Export** as `.txt` or `.md`.
- **INI config**: load a `writhdeck.ini` file to share settings across installs.
- **Status bar**: fully customisable left/centre/right slots with tokens (`words`, `chars`, `filename`, `goal`, `clock`, `timer`, …).
- **`≡` menu**: all commands accessible from a single dropdown — format selection (H1–H3, bold, italic…), search, export, settings, and more.
- **Command mode** (`Esc` or `Alt+C`): modal keyboard interface for all editor commands without Ctrl shortcuts.

## Build

```sh
make        # produces writhdeck.html
make clean  # removes writhdeck.html
```

`build.py` reads `src/template.html`, inlines `src/style.css` and all JS modules (in the order defined in `JS_ORDER`), and writes the result to stdout. Python 3, no dependencies.

## Keyboard shortcuts

### Global

| Shortcut | Action |
|---|---|
| `Ctrl+D` | Toggle dark / light mode |
| `Ctrl+O` | Import file copy |
| `F11` | Toggle table of contents |
| `Alt+Enter` | Toggle fullscreen |
| `Ctrl+N` *(opt)* | New document (overrides browser "new window") |

### Editor

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save |
| `Ctrl+Q` | Close document |
| `Ctrl+F` | Find (live match highlighting) |
| `Ctrl+H` | Find & replace |
| `Ctrl+G` | Go to line |
| `Ctrl+L` | Toggle line numbers |
| `Alt+T` | Toggle timer |
| `Alt+C` / `Esc` | Enter command mode |

### Command mode (`Alt+C` or `Esc`)

Press the trigger key, then one letter. Works in fullscreen (`Alt+C`).

| Key | Action | Key | Action |
|---|---|---|---|
| `f` | Find | `d` | Dark / light |
| `r` | Find & replace | `o` | Table of contents |
| `g` | Go to line | `c` | Settings |
| `n` | Line numbers | `e` | Export as .txt |
| `w` | Typewriter mode | `s` | Statistics |
| `t` | Timer | `i` | File info |
| `p` | Timer pause | `q` | Close document |

### Browser (document list)

| Key | Action |
|---|---|
| `n` | New document |
| `o` | Open file from disk |
| `w` | Watch a folder |
| `s` | Stats |
| `c` | Settings |

## Project structure

```
src/
  template.html   HTML skeleton with {{STYLE}} / {{SCRIPT}} placeholders
  style.css       All CSS (uses CSS custom properties only, no hardcoded colours)
  schemes.js      Built-in colour schemes + custom-scheme support
  db.js           IndexedDB wrapper (promise-based)
  state.js        App state, load/save helpers
  ini.js          INI config parser/applier
  highlight.js    Syntax highlighter + word count
  timer.js        Writing timer
  toc.js          Table of contents
  stats.js        Daily word-count stats
  editor.js       Editor panel, textarea/overlay sync, find/replace
  browser.js      Document browser panel, FSA integration
  settings.js     Settings dialog
  app.js          Entry point, theme application, keyboard router
build.py          Build script
Makefile          Convenience wrapper around build.py
```

## Storage

Documents are stored in IndexedDB (`writhdeck` database, version 1):

- **`documents`** store — each document: `id`, `name`, `content`, `created`, `modified`.
- **`meta`** store — keyed entries: `settings`, `favorites`, `recents`, `cursors`, `daily`, `customSchemes`.

Nothing is sent to any server.

## Adding a colour scheme

Add an entry to the `SCHEMES` object in `src/schemes.js`. Each scheme needs 9 dark-mode keys and 9 light-mode (`*Alt`) keys: `bg`, `fg`, `bgBar`, `fgBar`, `bgSel`, `heading`, `comment`, `markup`, `bg2` (+ `Alt` variants). Then run `make`.

## License

MIT
