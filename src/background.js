/**
 * src/background.js
 * Service worker for CookieControl (Manifest V3)
 *
 * Responsibilities:
 * - Handle RPC messages from popup/options
 * - Manage cookie operations (list, delete, import, export)
 * - Manage permission-on-demand flows
 * - Keep a small local op log in chrome.storage.local
 *
 * Note: We import cookieUtils via importScripts so this file doesn't require bundling.
 */

importScripts('utils/cookieUtils.js');

const OP_LOG_KEY = 'cookiecontrol:oplog';
const SETTINGS_KEY = 'cookiecontrol:settings';

/* -------------------------
   Helper promise wrappers
   ------------------------- */

function storageGet(keys) {
       return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res)));
}

function storageSet(obj) {
       return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
}

function permissionsGetAll() {
       return new Promise((resolve) => chrome.permissions.getAll((p) => resolve(p)));
}

function permissionsContains(opts) {
       return new Promise((resolve) => chrome.permissions.contains(opts, (granted) => resolve(granted)));
}

function permissionsRequest(opts) {
       return new Promise((resolve) => chrome.permissions.request(opts, (granted) => resolve(granted)));
}

function permissionsRemove(opts) {
       return new Promise((resolve) => chrome.permissions.remove(opts, (removed) => resolve(removed)));
}
function hasAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
       );
}

function requestAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
       );
}
function removeAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.remove({ origins: ['<all_urls>'] }, resolve)
       );
}

function cookiesGetAll(filter) {
       return new Promise((resolve) => chrome.cookies.getAll(filter || {}, (cookies) => resolve(cookies)));
}

function cookiesRemove(details) {
       return new Promise((resolve) => chrome.cookies.remove(details, (res) => resolve(res)));
}

function cookiesSet(details) {
       return new Promise((resolve, reject) =>
              chrome.cookies.set(details, (res) => {
                     if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                     resolve(res);
              })
       );
}

/* -------------------------
   Operation log helpers
   ------------------------- */

async function pushLog(entry) {
       try {
              const stored = await storageGet(OP_LOG_KEY);
              const old = stored[OP_LOG_KEY] || [];
              old.unshift({ ts: Date.now(), ...entry });
              // keep only last 500 entries for lightweight storage
              await storageSet({ [OP_LOG_KEY]: old.slice(0, 500) });
       } catch (e) {
              console.error('[CookieControl] pushLog error', e);
       }
}

/* -------------------------
   Cookie helpers
   ------------------------- */

/**
 * Get all cookies whose domain equals or is a subdomain of the provided domain.
 * domain: 'example.com' or '.example.com'
 * returns array of cookie objects
 */
async function getAllCookiesForSite(domain) {
       const normalized = domain.startsWith('.') ? domain.slice(1) : domain;
       const all = await cookiesGetAll({});
       return all.filter((c) => {
              const cd = c.domain ? (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) : '';
              return cd === normalized || cd.endsWith('.' + normalized);
       });
}

/**
 * Remove a cookie via chrome.cookies.remove.
 * Accepts a cookie object returned by chrome.cookies.getAll.
 */
async function removeCookie(cookie) {
       try {
              const url = cookieToUrl(cookie);
              const details = { url, name: cookie.name };
              if (cookie.storeId) details.storeId = cookie.storeId;
              await cookiesRemove(details);
              await pushLog({ type: 'remove', cookie });
              return true;
       } catch (e) {
              console.error('[CookieControl] removeCookie error', e);
              return false;
       }
}

/**
 * Delete all cookies for a top-level site (domain + subdomains).
 * Returns { removed, total }.
 */
async function deleteAllForSite(domain) {
       const list = await getAllCookiesForSite(domain);
       const promises = list.map((c) => removeCookie(c));
       const results = await Promise.all(promises);
       return { removed: results.filter(Boolean).length, total: list.length };
}

/* -------------------------
   Import / Export
   ------------------------- */

/**
 * Export all cookies in the browser as an array (full cookie objects).
 * This is local-only; consumer decides how to persist/download.
 */
async function exportAllCookies() {
       const all = await cookiesGetAll({});
       return all;
}

/**
 * Import cookies from an array (JSON). Will attempt to call chrome.cookies.set.
 * Returns { imported: n }
 */
async function importCookies(cookieArray) {
       if (!Array.isArray(cookieArray)) throw new Error('Import expects an array');
       let count = 0;
       for (const c of cookieArray) {
              try {
                     // Build a safe url for cookies.set: prefer cookie.secure -> https
                     const host = c.domain ? (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) : undefined;
                     if (!host) continue;
                     const scheme = c.secure ? 'https' : 'http';
                     const path = c.path || '/';
                     const url = `${scheme}://${host}${path}`;

                     // validate minimum required
                     try {
                            validateSetCookieOptions({ name: c.name, url });
                     } catch (e) {
                            console.warn('[CookieControl] validateSetCookieOptions failed for cookie', c, e);
                            continue;
                     }

                     const setObj = {
                            url,
                            name: c.name,
                            value: c.value || '',
                            path: c.path,
                            secure: !!c.secure,
                            httpOnly: !!c.httpOnly
                     };

                     if (c.expirationDate) setObj.expirationDate = c.expirationDate;
                     if (c.sameSite) setObj.sameSite = c.sameSite;

                     await cookiesSet(setObj);
                     count++;
              } catch (e) {
                     // Keep importing others even if one fails
                     console.error('[CookieControl] import cookie failed', c, e);
              }
       }
       await pushLog({ type: 'import', count });
       return { imported: count };
}

/* -------------------------
   Permissions helpers
   ------------------------- */

async function requestOriginPattern(domain) {
       // domain may be example.com or .example.com
       const pattern = domainToOriginPattern(domain);
       try {
              const granted = await permissionsRequest({ origins: [pattern] });
              return granted ? pattern : null;
       } catch (e) {
              console.error('[CookieControl] requestOriginPattern', e);
              return null;
       }
}

/* -------------------------
   Message handler (RPC)
   ------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
       (async () => {
              try {
                     switch (message.type) {
                            // Add this case to the switch inside chrome.runtime.onMessage handler:
                            case 'GET_ACTIVE_TAB_COOKIES': {
                                   // Get active tab hostname
                                   const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
                                   const tab = tabs && tabs[0];
                                   if (!tab || !tab.url) return sendResponse({ error: 'no_active_tab' });

                                   let hostname;
                                   try { hostname = new URL(tab.url).hostname; } catch (e) { return sendResponse({ error: 'invalid_tab_url' }); }

                                   // Build per-site origin pattern to check permission (e.g. "*://*.example.com/*")
                                   const sitePattern = `*://*.${hostname}/*`;

                                   // Check if we have host permission for that pattern
                                   const hasSitePerm = await permissionsContains({ origins: [sitePattern] });

                                   if (!hasSitePerm) {
                                          // Do not request permissions from the background (must be user gesture from popup).
                                          // Respond to caller indicating limited access. The popup will use scripting.executeScript
                                          // to get non-httpOnly cookies from document.cookie if the user has not granted site permission.
                                          return sendResponse({ limited: true, msg: 'no_site_permission' });
                                   }

                                   // We have host permission -> return full cookies for the site.
                                   const cookies = await getAllCookiesForSite(hostname);
                                   return sendResponse({ cookies });
                            }

                            case 'GET_ALL_COOKIES': {
                                   // Ensure we have global host permission before returning all cookies
                                   const allPattern = '<all_urls>';
                                   const hasAll = await permissionsContains({ origins: [allPattern] });
                                   if (!hasAll) {
                                          return sendResponse({ error: 'permission_denied' });
                                   }
                                   const allCookies = await cookiesGetAll({});
                                   return sendResponse({ cookies: allCookies });
                            }

                            case 'DELETE_ALL_FOR_SITE': {
                                   const domain = message.domain;
                                   if (!domain) return sendResponse({ error: 'missing_domain' });

                                   // Ensure host permission exists (popup should have requested it)
                                   const allPattern = '<all_urls>';
                                   const hasAll = await permissionsContains({ origins: [allPattern] });
                                   if (!hasAll) {
                                          return sendResponse({ error: 'permission_denied' });
                                   }

                                   const result = await deleteAllForSite(domain);
                                   return sendResponse({ result });
                            }

                            case 'EXPORT_COOKIES': {
                                   const data = await exportAllCookies();
                                   return sendResponse({ data });
                            }

                            case 'IMPORT_COOKIES': {
                                   const arr = message.cookies;
                                   if (!arr) return sendResponse({ error: 'missing_cookies' });
                                   const res = await importCookies(arr);
                                   return sendResponse({ res });
                            }

                            case 'GET_GRANTED_ORIGINS': {
                                   const perms = await permissionsGetAll();
                                   return sendResponse({ origins: perms.origins || [] });
                            }

                            case 'REQUEST_ORIGINS': {
                                   const origins = message.origins || [];
                                   const granted = await permissionsRequest({ origins });
                                   return sendResponse({ granted });
                            }

                            case 'REMOVE_ORIGINS': {
                                   const origins = message.origins || [];
                                   const removed = await permissionsRemove({ origins });
                                   return sendResponse({ removed });
                            }

                            case 'GET_OP_LOG': {
                                   const stored = await storageGet(OP_LOG_KEY);
                                   const log = stored[OP_LOG_KEY] || [];
                                   return sendResponse({ log });
                            }

                            default:
                                   return sendResponse({ error: 'unknown_message' });
                     }
              } catch (err) {
                     console.error('[CookieControl] message handler error', err);
                     return sendResponse({ error: err.message || String(err) });
              }
       })();

       // Allowed because we will respond asynchronously
       return true;
});

/* -------------------------
   Cookie change listener to track external changes
   ------------------------- */

chrome.cookies.onChanged.addListener(async (changeInfo) => {
       try {
              await pushLog({ type: 'cookie_changed', changeInfo });
       } catch (e) {
              console.error('[CookieControl] cookie change pushLog error', e);
       }
});

/* -------------------------
   Install event: seed defaults
   ------------------------- */

self.addEventListener('install', (event) => {
       event.waitUntil((async () => {
              const defaults = { permissionMode: 'on_demand' };
              await storageSet({ [SETTINGS_KEY]: defaults });
       })());
});

// Use shared permission functions
async function ensurePermissionForCookies() {
       const hasPermission = await hasAllUrlsPermission();
       if (!hasPermission) {
              throw new Error('Permission not granted for cookie operations.');
       }
}

// Centralize cookie operations
async function getCookies(filter) {
       await ensurePermissionForCookies();
       return cookiesGetAll(filter);
}

async function deleteCookie(details) {
       await ensurePermissionForCookies();
       return cookiesRemove(details);
}

async function setCookie(details) {
       await ensurePermissionForCookies();
       return cookiesSet(details);
}

// Example: Wrap cookie operations
async function wrappedGetCookies(details) {
       await ensurePermissionForCookies();
       return new Promise((resolve, reject) => {
              chrome.cookies.getAll(details, (cookies) => {
                     if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                     } else {
                            resolve(cookies);
                     }
              });
       });
}
