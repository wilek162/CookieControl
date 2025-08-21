// Wrapper utilities around the Chrome extension APIs that return Promises instead of relying
// on callback-style APIs. Centralising them here improves testability and keeps other modules
// focused on business logic rather than on plumbing.

export function sendMsg(msg) {
       return new Promise((resolve) => {
              chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
       });
}

export function tabsQuery(queryInfo) {
       return new Promise((resolve) => {
              chrome.tabs.query(queryInfo, (tabs) => resolve(tabs));
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
export const storageArea = chrome.storage?.session || chrome.storage.local;

export function storageGet(keys) {
       return new Promise((resolve) => storageArea.get(keys, (res) => resolve(res)));
}

export function storageSet(obj) {
       return new Promise((resolve) => storageArea.set(obj, () => resolve()));
}

// -------------------------
// Permissions helpers
// -------------------------
export function permissionsGetAll() {
       return new Promise((resolve) => chrome.permissions.getAll((p) => resolve(p)));
}

export function permissionsContains(opts) {
       return new Promise((resolve) => chrome.permissions.contains(opts, (granted) => resolve(granted)));
}

export function permissionsRequest(opts) {
       return new Promise((resolve) => chrome.permissions.request(opts, (granted) => resolve(granted)));
}

export function permissionsRemove(opts) {
       return new Promise((resolve) => chrome.permissions.remove(opts, (removed) => resolve(removed)));
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
