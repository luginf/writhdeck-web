JS_SRCS := src/schemes.js src/db.js src/backend.js src/fonts.js src/state.js src/ini.js \
           src/i18n/core.js src/i18n/fr.js src/i18n/es.js src/highlight.js \
           src/timer.js src/toc.js src/stats.js src/editor.js \
           src/browser.js src/settings.js src/app.js

.PHONY: all clean

all: writhdeck.html

writhdeck.html: src/template.html src/style.css $(JS_SRCS) build.py
	python3 build.py > writhdeck.html
	@echo "Built writhdeck.html ($$(wc -c < writhdeck.html) bytes)"

clean:
	rm -f writhdeck.html
