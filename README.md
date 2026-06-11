# Writhdeck

A distraction-free writing app that runs as a single self-contained HTML file — no server, no install, no internet required. Open `writhdeck.html` directly in any modern browser.

## Features

- **Single-file**: the entire app is one `writhdeck.html` (~180 KB). Copy it anywhere, it just works.
- **Document browser**: create, rename, delete, and favourite documents stored in IndexedDB. Document names are unique — duplicates are auto-suggested as `"Untitled (2)"` etc.
- **Disk file support** (Chrome/Edge/Brave): open individual files or watch a folder — edits go straight back to disk via the File System Access API.
- **Syntax highlighting overlay**: headings, comments, and inline markers (bold, italic, underline, strikethrough) are coloured in real time without leaving the textarea.
- **Configurable markers**: choose your own syntax for headings, comments, and each inline style. Enable Markdown-style `#` headings if you prefer.
- **8 built-in colour schemes** (default, solarized, gruvbox, everforest, nord, + 3 more), dark and light variants, and full custom-scheme support.
- **Writing timer**: countdown or stopwatch, with optional sound and alert at the end.
- **Table of contents**: auto-generated from heading lines, shown in a side panel.
- **Daily writing stats**: tracks words *added* today (not total document size) with a high-water mark across sessions. Optional daily goal.
- **Hemingway mode**: disables backspace/delete to keep you writing forward.
- **Typewriter mode**: keeps the cursor vertically centred; dims text outside the current paragraph so only the active paragraph appears at full colour.
- **Find & replace** with live match highlighting, goto line, line numbers.
- **Structure analysis**: section-by-section word-count breakdown with progress bars. Accessible from the `≡` menu (`a`).
- **Word occurrences**: frequency table of all words, sorted by count. Accessible from the Analyse dialog or the `≡` menu.
- **Block cursor**: optional solid rectangle cursor, rendered in the highlight overlay. Supports blink on/off.
- **Export** as `.txt` or `.md`.
- **INI config**: `writhdeck.ini` is always visible in the browser. Right-click it to open, export, or reset to defaults. The format is compatible with the Tcl/Tk desktop version; web-specific options are in a dedicated `[web]` section.
- **Status bar**: fully customisable left/centre/right slots with tokens — see [Status bar tokens](#status-bar-tokens).
- **`≡` menu**: all commands accessible from a single dropdown — keyboard-navigable (↑↓ + Enter, or press the hint letter directly), with format options (H1–H3, bold, italic…), search, export, settings, and more. Opening the menu preserves any active text selection.
- **Right-click context menu**: format, cut/copy/paste, and spell-check toggle (editor); Open / Info / Rename / Export / Delete (browser document list); Open / Export / Reset (writhdeck.ini).
- **Command mode** (`Esc` or `Alt+C`): interactive status bar showing all commands as clickable buttons. Navigate with `←`/`→`, confirm with `Enter`, or click with the mouse.
- **About dialog**: accessible from the `?` menu in the browser — shows the app description and build date.
- **Undo support**: bold, italic, heading, and comment formatting operations integrate with the browser's native undo stack (via `execCommand('insertText')`).

## Build

```sh
make        # produces writhdeck.html (~180 KB)
make clean  # removes writhdeck.html
```

`build.py` reads `src/template.html`, inlines `src/style.css` and all JS modules (in the order defined in `JS_ORDER`), and writes the result to stdout. The build date is embedded as `{{BUILD_DATE}}` (ISO format). Python 3, no dependencies.

## Keyboard shortcuts

### Global

| Shortcut | Action |
|---|---|
| `Ctrl+D` | Toggle dark / light mode |
| `Ctrl+O` | Import file copy |
| `F11` | Toggle table of contents |
| `Alt+Enter` | Toggle fullscreen |
| `Ctrl+N` *(opt)* | New document (overrides browser "new window", requires setting) |

### Editor

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save |
| `Ctrl+Q` | Close document (`Ctrl+Shift+Q` on Firefox, see [Browser notes](#browser-notes)) |
| `Ctrl+F` | Find (live match highlighting) |
| `Ctrl+H` | Find & replace |
| `Ctrl+G` | Go to line |
| `Ctrl+L` | Toggle line numbers |
| `Alt+T` | Toggle timer |
| `Alt+C` / `Esc` | Enter command mode |
| `Alt+M` | Open `≡` menu |

### Command mode (`Alt+C` or `Esc`)

The status bar becomes an interactive row of command buttons. Works in fullscreen (`Alt+C`).

| Input | Action |
|---|---|
| `←` / `→` | Move selection between commands |
| `Enter` | Execute selected command |
| *letter* | Execute command directly (e.g. `f` = Find) |
| Mouse click | Execute command directly |

| Key | Action | Key | Action |
|---|---|---|---|
| `f` | Find | `d` | Dark / light |
| `r` | Find & replace | `o` | Table of contents |
| `g` | Go to line | `c` | Settings |
| `n` | Line numbers | `e` | Export as .txt |
| `w` | Typewriter mode | `s` | Statistics |
| `t` | Timer | `a` | Analyse structure |
| `p` | Timer pause | `i` | File info |
| `q` | Close document | `m` | Main menu (≡) |

### Browser (document list)

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate document list |
| `Enter` | Open selected document |
| `n` | New document |
| `o` | Open file from disk |
| `w` | Watch a folder |
| `s` | Stats |
| `c` | Settings |

## Browser notes

- **Disk file support** (open/watch files, edits saved straight back to disk) requires the File System Access API — available in Chrome, Edge, Brave, and other Chromium-based browsers. Firefox falls back to IndexedDB-only storage.
- **Large documents** (tens of thousands of words): Firefox is noticeably slower than Chromium-based browsers, especially when a full re-render is triggered (search highlighting, Typewriter mode, multi-line edits like paste/undo). Chromium-based browsers are recommended for very large documents.
- **`Ctrl+Q`**: Firefox intercepts the plain shortcut as its own "Quit" command before the page sees it — use `Ctrl+Shift+Q` to close the document (works in both Firefox and Chrome).

## Status bar tokens

The three status bar zones (left / centre / right) are configured as space-separated token strings in Settings → Profile.

| Token | Example | Description |
|---|---|---|
| `filename` | `my-novel.txt` | Current document name |
| `dirty` | `[+]` | Unsaved changes indicator |
| `words` | `1 842w` | Word count |
| `chars` | `10 240c` | Character count |
| `lines` | `312L` | Total line count |
| `line` | `L42` | Current cursor line |
| `col` | `C7` | Current cursor column |
| `para` | `18§` | Paragraph count (blank-line separated) |
| `pages` | `7p` | Estimated pages at 250 w/page |
| `percent` | `68%` | Progress toward word goal |
| `today` | `342↑` | Words *added* today (high-water mark across sessions) |
| `goal` | `342/500` | Today's words / goal (hidden if no goal) |
| `reading` | `9min` | Estimated reading time at 200 w/min |
| `clock` | `14:32` | Current time |
| `timer` | `24:07` | Writing timer display |
| `space` | ` ` | Single space (explicit separator) |
| *(anything else)* | literal | Fixed text, separators, etc. |

Default: Left `filename dirty words` · Center *(empty)* · Right `goal clock timer`

## INI config

`writhdeck.ini` uses the same format as the Tcl/Tk desktop version. Web-specific options live in a dedicated section so they are silently ignored by the desktop version:

```ini
[web]
% Options specific to the web version — ignored by the desktop version
open_last_doc               = no
intercept_browser_shortcuts = yes
intercept_context_menu      = yes
```

Options shared with the desktop version (`block_cursor`, `blink_cursor`, `line_numbers`, `dark_mode`, etc.) stay in `[behaviour]`.

Right-click `writhdeck.ini` in the browser to export it or reset all settings to defaults (the file is recreated from defaults on next load).

## Project structure

```
src/
  template.html   HTML skeleton with {{STYLE}} / {{SCRIPT}} / {{BUILD_DATE}} placeholders
  style.css       All CSS (uses CSS custom properties only, no hardcoded colours)
  schemes.js      Built-in colour schemes + custom-scheme support
  db.js           IndexedDB wrapper (promise-based)
  state.js        App state, load/save helpers
  ini.js          INI config parser/writer (compatible with desktop version)
  highlight.js    Syntax highlighter + word count + block cursor injection
  timer.js        Writing timer
  toc.js          Table of contents
  stats.js        Daily word-count stats dialog
  editor.js       Editor panel, textarea/overlay sync, find/replace, formatting
  browser.js      Document browser panel, FSA integration
  settings.js     Settings dialog
  app.js          Entry point, theme, keyboard router, menus, dialogs
build.py          Build script (inlines CSS/JS, stamps build date)
Makefile          Convenience wrapper around build.py
```

## Storage

Documents are stored in IndexedDB (`writhdeck` database, version 1):

- **`documents`** store — each document: `id`, `name`, `content`, `created`, `modified`.
- **`meta`** store — keyed entries: `iniText`, `favorites`, `recents`, `cursors`, `daily`.

Nothing is sent to any server.

## Adding a colour scheme

Add an entry to the `SCHEMES` object in `src/schemes.js`. Each scheme needs 9 dark-mode keys and 9 light-mode (`*Alt`) keys: `bg`, `fg`, `bgBar`, `fgBar`, `bgSel`, `heading`, `comment`, `markup`, `bg2` (+ `Alt` variants). Then run `make`.

## License

Copyright (C) 2026 by Luginfo — Zero-Clause BSD License

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted. The software is provided "as is" without warranty of any kind.
