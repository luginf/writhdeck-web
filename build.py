#!/usr/bin/env python3
"""Assembles src/ modules into a single writhdeck.html file."""
import sys, os, json, subprocess
from datetime import date

BASE    = os.path.join(os.path.dirname(__file__), 'src')
ROOT    = os.path.dirname(__file__)

JS_ORDER = [
    'schemes.js',
    'db.js',
    'backend.js',
    'fonts.js',
    'state.js',
    'ini.js',
    'i18n/core.js',
    'i18n/fr.js',
    'i18n/es.js',
    'i18n/de.js',
    'i18n/pt.js',
    'highlight.js',
    'timer.js',
    'toc.js',
    'stats.js',
    'editor.js',
    'browser.js',
    'settings.js',
    'app.js',
]

def read(name):
    with open(os.path.join(BASE, name), encoding='utf-8') as f:
        return f.read()

def read_root(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()

def minify_js(code):
    """Runs the assembled bundle through terser (compress+mangle, no --toplevel
    so the global names the LionWiki-t2t embedder relies on — Editor, State,
    SCHEMES, etc. — stay intact)."""
    try:
        result = subprocess.run(
            ['terser', '--compress', '--mangle', '--comments', 'false'],
            input=code, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("build.py: 'terser' not found on PATH — install it "
                  "(e.g. `npm install -g terser`) or build with `make debug` "
                  "for an unminified writhdeck.html.")
    if result.returncode != 0:
        sys.exit(f"build.py: terser minification failed:\n{result.stderr}")
    return result.stdout

template = read('template.html')
style    = read('style.css')
script   = '\n\n'.join(read(js) for js in JS_ORDER)
readme   = json.dumps(read_root('README.md'))
script   = script.replace('{{README}}', readme)

if '--debug' not in sys.argv:
    script = minify_js(script)

# `--script` / `--style` emit just the assembled JS bundle or the stylesheet,
# so an embedder (e.g. the LionWiki-t2t writhdeck template) can reuse the exact
# same build output without the standalone HTML shell.
if '--script' in sys.argv:
    sys.stdout.write(script)
elif '--style' in sys.argv:
    sys.stdout.write(style)
elif '--body' in sys.argv:
    # Emit just the <body> inner markup (browser + editor + dialogs), so an
    # embedder can drop the writhdeck DOM into its own page. Excludes <head>,
    # the inlined <script>, and the {{STYLE}}/{{SCRIPT}} placeholders.
    body = template.split('<body>', 1)[1].rsplit('<script>', 1)[0]
    sys.stdout.write(body.replace('{{BUILD_DATE}}', date.today().isoformat()))
else:
    result = (template
        .replace('{{STYLE}}',       style)
        .replace('{{SCRIPT}}',      script)
        .replace('{{BUILD_DATE}}',  date.today().isoformat()))
    sys.stdout.write(result)
