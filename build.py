#!/usr/bin/env python3
"""Assembles src/ modules into a single writhdeck.html file."""
import sys, os, json
from datetime import date

BASE    = os.path.join(os.path.dirname(__file__), 'src')
ROOT    = os.path.dirname(__file__)

JS_ORDER = [
    'schemes.js',
    'db.js',
    'backend.js',
    'state.js',
    'ini.js',
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

template = read('template.html')
style    = read('style.css')
script   = '\n\n'.join(read(js) for js in JS_ORDER)
readme   = json.dumps(read_root('README.md'))

# `--script` / `--style` emit just the assembled JS bundle or the stylesheet,
# so an embedder (e.g. the LionWiki-t2t writhdeck template) can reuse the exact
# same build output without the standalone HTML shell. `{{README}}` is still
# substituted in the script bundle since it lives in app.js.
if '--script' in sys.argv:
    sys.stdout.write(script.replace('{{README}}', readme))
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
        .replace('{{README}}',      readme)
        .replace('{{BUILD_DATE}}',  date.today().isoformat()))
    sys.stdout.write(result)
