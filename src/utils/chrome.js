// Wrapper utilities around the Chrome extension APIs that return Promises instead of relying
// on callback-style APIs. Centralising them here improves testability and keeps other modules
// focused on business logic rather than on plumbing.

export function sendMsg(msg) {
       return new Promise((resolve) => {
              chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
       });
}


export function storageSessionSet(obj) {
       return new Promise((resolve) => {
              (chrome.storage.session || chrome.storage.local).set(obj, () => resolve());
       });
}

// -------------------------
// Generic storage helpers
// -------------------------
const storageArea = chrome.storage?.session || chrome.storage.local;

export function storageGet(keys) {
       return new Promise((resolve) => storageArea.get(keys, (res) => resolve(res)));
}

export function storageSet(obj) {
       return new Promise((resolve) => storageArea.set(obj, () => resolve()));
}

// -------------------------
// Permissions helpers
// -------------------------
// Centralized sanitizer for origin patterns to avoid invalid entries like "*:///*"
function sanitizeOriginsInput(opts) {
       const input = opts && Array.isArray(opts.origins) ? opts.origins : [];
       const out = [];
       for (const item of input) {
               if (!item || typeof item !== 'string') continue;
               const origin = item.trim();
               if (origin === '<all_urls>') { out.push(origin); continue; }

               // Expect pattern: scheme://host/path
               const m = origin.match(/^([a-zA-Z*]+):\/\/([^\/]+)(?:\/.*)?$/);
               if (!m) continue;

               const scheme = m[1].toLowerCase();
               // Only allow http/https or * (http+https)
               if (!(scheme === 'http' || scheme === 'https' || scheme === '*')) continue;

               const host = m[2];
               if (!host) continue;
               // Host can be *, *.example.com, or example.com
               if (!/^(\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)$/.test(host)) continue;

               // Map the broad pattern to <all_urls> for better cross-browser behavior
               if (scheme === '*' && host === '*') {
                       out.push('<all_urls>');
                       continue;
               }

               // Normalize to always end with /* (required by Permissions API patterns)
               const normalized = `${scheme}://${host}/*`;
               out.push(normalized);
       }
       // Dedupe while preserving order
       const deduped = Array.from(new Set(out));
       return { origins: deduped };
}

export function permissionsGetAll() {
       return new Promise((resolve) => chrome.permissions.getAll((p) => resolve(p)));
}

export function permissionsContains(opts) {
       const sanitized = sanitizeOriginsInput(opts);
       if (!sanitized.origins.length) return Promise.resolve(false);
       return new Promise((resolve) => chrome.permissions.contains({ origins: sanitized.origins }, (granted) => {
              if (!granted) {
                     const err = chrome.runtime?.lastError?.message;
                     if (err) console.warn('[permissions.contains] lastError:', err, 'origins:', sanitized.origins);
              }
              resolve(granted);
       }));
}

export function permissionsRequest(opts) {
       const sanitized = sanitizeOriginsInput(opts);
       if (!sanitized.origins.length) return Promise.resolve(false);
       return new Promise((resolve) => chrome.permissions.request({ origins: sanitized.origins }, (granted) => {
              if (!granted) {
                     const err = chrome.runtime?.lastError?.message;
                     if (err) console.warn('[permissions.request] lastError:', err, 'origins:', sanitized.origins);
                     else console.warn('[permissions.request] User denied or not granted. origins:', sanitized.origins);
              }
              resolve(granted);
       }));
}

export function permissionsRemove(opts) {
       const sanitized = sanitizeOriginsInput(opts);
       if (!sanitized.origins.length) return Promise.resolve(false);
       return new Promise((resolve) => chrome.permissions.remove({ origins: sanitized.origins }, (removed) => {
              if (!removed) {
                     const err = chrome.runtime?.lastError?.message;
                     if (err) console.warn('[permissions.remove] lastError:', err, 'origins:', sanitized.origins);
              }
              resolve(removed);
       }));
}

// -------------------------
// Cookie helpers
// -------------------------
export function cookiesGetAll(filter = {}) {
       return new Promise((resolve) => chrome.cookies.getAll(filter, (cookies) => resolve(cookies)));
}

export function cookiesRemove(details) {
       return new Promise((resolve) => chrome.cookies.remove(details, (res) => resolve(res)));
}

export function cookiesSet(details) {
       return new Promise((resolve, reject) => {
              chrome.cookies.set(details, (res) => {
                     if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                     resolve(res);
              });
       });
}
