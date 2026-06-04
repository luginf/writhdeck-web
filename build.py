#!/usr/bin/env python3
"""Assembles src/ modules into a single writhdeck.html file."""
import sys, os, json

BASE    = os.path.join(os.path.dirname(__file__), 'src')
ROOT    = os.path.dirname(__file__)

JS_ORDER = [
    'schemes.js',
    'db.js',
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

result = (template
    .replace('{{STYLE}}',  style)
    .replace('{{SCRIPT}}', script)
    .replace('{{README}}', readme))
sys.stdout.write(result)
