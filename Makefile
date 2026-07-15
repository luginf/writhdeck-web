JS_SRCS := src/schemes.js src/db.js src/backend.js src/fonts.js src/state.js src/ini.js \
           src/i18n/core.js src/i18n/fr.js src/i18n/es.js src/highlight.js \
           src/timer.js src/toc.js src/stats.js src/editor.js \
           src/browser.js src/settings.js src/app.js

.PHONY: all debug clean

# Minified by default (production export). Always rebuilds — writhdeck.html
# is not used as a make prerequisite so `make` reliably overwrites whatever
# `make debug` last left in place, regardless of file mtimes.
all:
	python3 build.py > writhdeck.html
	@echo "Built writhdeck.html (minified, $$(wc -c < writhdeck.html) bytes)"

# Unminified, same output filename — for debugging in the browser devtools.
# Run `make` again once done to restore the minified version before shipping.
debug:
	python3 build.py --debug > writhdeck.html
	@echo "Built writhdeck.html (debug/unminified, $$(wc -c < writhdeck.html) bytes)"

clean:
	rm -f writhdeck.html
