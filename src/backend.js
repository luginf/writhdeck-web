'use strict';
// Storage backend selector.
//
// `IndexedDbBackend` (db.js) is the default — used by the standalone
// writhdeck.html. A host page (e.g. the LionWiki-t2t template) can provide an
// alternative implementation by defining `window.WRITHDECK_BACKEND` *before*
// this script runs. The chosen object must expose the same interface as
// `IndexedDbBackend`: open, saveDoc, getDoc, getAllDocs, deleteDoc,
// getMeta, setMeta.
//
// `IndexedDbBackend` stays globally reachable so an adapter can delegate
// client-side concerns (settings/theme via getMeta/setMeta) to it while
// overriding document storage.
const DB = (typeof window !== 'undefined' && window.WRITHDECK_BACKEND)
  ? window.WRITHDECK_BACKEND
  : IndexedDbBackend;
