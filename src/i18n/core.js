'use strict';
// i18n engine — no language data lives here. Each language is a separate
// src/i18n/<code>.js file (`I18N.<code> = {...}`), so adding a language later
// means adding one new file + one JS_ORDER entry in build.py, without touching
// this file or any other language's dictionary.
const I18N = {};

function currentLang() {
  const setting = State.settings.language || 'auto';
  if (setting !== 'auto') return I18N[setting] ? setting : 'en';
  const nav = (navigator.language || navigator.userLanguage || 'en').split('-')[0].toLowerCase();
  return I18N[nav] ? nav : 'en';
}

// t(key, fallbackEnglish, vars?) — looks up the active language's dictionary
// for `key`; falls back to the English text given inline at the call site, so
// there is no separate 'en' dictionary to keep in sync with the rest of the
// code. `vars` substitutes `${name}` tokens in the result.
function t(key, fallbackEnglish, vars) {
  const lang = currentLang();
  let text = (I18N[lang] && I18N[lang][key]) || fallbackEnglish;
  if (vars) {
    for (const k in vars) text = text.split('${' + k + '}').join(vars[k]);
  }
  return text;
}

// applyTranslations() — walks every translatable DOM node and sets its text/
// title to the active language, caching the original English on first run so
// switching back to English restores it exactly (no need for an 'en' dict).
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nDefault === undefined) el.dataset.i18nDefault = el.textContent;
    el.textContent = t(el.dataset.i18n, el.dataset.i18nDefault);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    if (el.dataset.i18nTitleDefault === undefined) el.dataset.i18nTitleDefault = el.title;
    el.title = t(el.dataset.i18nTitle, el.dataset.i18nTitleDefault);
  });
}
