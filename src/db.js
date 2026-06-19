'use strict';
// IndexedDB wrapper — promise-based.
// This is the default storage backend. `backend.js` selects the active `DB`
// implementation (this one, or a host-provided `window.WRITHDECK_BACKEND`).
const IndexedDbBackend = (() => {
  const DB_NAME = 'writhdeck';
  const DB_VER  = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      if (req && typeof req.onsuccess === 'undefined') {
        // fn returned a value, not a request
        resolve(req);
        return;
      }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror    = e => reject(e.target.error);
      if (req) {
        req.onerror  = e => reject(e.target.error);
      }
    }));
  }

  // Documents
  function saveDoc(doc) {
    return tx('documents', 'readwrite', s => {
      doc.modified = Date.now();
      if (!doc.created) doc.created = doc.modified;
      return s.put(doc);
    }).then(id => { if (!doc.id) doc.id = id; return doc; });
  }

  function getDoc(id) {
    return tx('documents', 'readonly', s => s.get(Number(id)));
  }

  function getAllDocs() {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('documents', 'readonly');
      const s = t.objectStore('documents');
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  function deleteDoc(id) {
    return tx('documents', 'readwrite', s => s.delete(Number(id)));
  }

  // Meta (settings, favorites, etc.)
  function getMeta(key) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('meta', 'readonly');
      const req = t.objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  function setMeta(key, value) {
    return tx('meta', 'readwrite', s => s.put({ key, value }));
  }

  return { open, saveDoc, getDoc, getAllDocs, deleteDoc, getMeta, setMeta };
})();
