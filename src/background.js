/**
 * src/background.js
 * Service worker for CookieControl (Manifest V3)
 *
 * Responsibilities:
 * - Handle RPC messages from popup/options
 * - Manage cookie operations (list, delete, import, export)
 * - Manage permission-on-demand flows
 * - Keep a small session op log in chrome.storage.session
 *
 * Note: We import cookieUtils via importScripts so this file doesn't require bundling.
 */

import {
       cookieToUrl,
       domainToOriginPattern,
       validateSetCookieOptions,
       hasAllUrlsPermission,
       requestAllUrlsPermission,
       removeAllUrlsPermission,
       getBaseDomain
} from './utils/cookieUtils.js';

const OP_LOG_KEY = 'cookiecontrol:oplog';
const SETTINGS_KEY = 'cookiecontrol:settings';

/* -------------------------
   Helper promise wrappers
   ------------------------- */

function storageGet(keys) {
       return new Promise((resolve) => (chrome.storage.session || chrome.storage.local).get(keys, (res) => resolve(res)));
}

function storageSet(obj) {
       return new Promise((resolve) => (chrome.storage.session || chrome.storage.local).set(obj, () => resolve()));
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
       // Use Chrome's domain filter to avoid requiring <all_urls> for per-site fetches
       const list = await cookiesGetAll({ domain: normalized });
        return list;
}

/**
 * Get cookies only for a specific host and the base domain, excluding other sibling subdomains.
 * Example on host "mail.google.com" with base "google.com":
 * - include: domain === "mail.google.com" or ".mail.google.com" or "google.com" or ".google.com"
 * - exclude: domain === "accounts.google.com", etc.
 */
async function getCookiesForHostAndBase(hostname, base) {
       const allowedDomainSet = new Set([
              hostname,
              `.${hostname}`,
              base,
              base ? `.${base}` : null
       ].filter(Boolean));

       const hostList = await cookiesGetAll({ domain: hostname });
       const baseList = base && base !== hostname ? await cookiesGetAll({ domain: base }) : [];

       const merged = hostList.concat(baseList).filter((c) => allowedDomainSet.has(c.domain));

       // Deduplicate by name|domain|path|storeId
       const keyOf = (c) => `${c.name}|${c.domain}|${c.path || '/'}|${c.storeId || ''}`;
       const uniq = new Map();
       for (const c of merged) {
              if (!uniq.has(keyOf(c))) uniq.set(keyOf(c), c);
       }
       return Array.from(uniq.values());
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
                                   // Accept either base-domain OR exact-host permissions
                                   const base = getBaseDomain(hostname);
                                   const isBaseDomain = hostname === base || hostname === `www.${base}`;

                                   let hasPermissions = false;
                                   if (isBaseDomain) {
                                       // Accept either base-only permission or wildcard for full access on base domain
                                       const baseOnly = `*://${base}/*`;
                                       const wildcard = `*://*.${base}/*`;
                                       const [hasBase, hasWildcard] = await Promise.all([
                                           permissionsContains({ origins: [baseOnly] }),
                                           permissionsContains({ origins: [wildcard] })
                                       ]);
                                       hasPermissions = hasBase || hasWildcard;
                                   } else {
                                       // On a subdomain, we need permission for the specific host AND the base domain.
                                       const patternsToCheck = [`*://${hostname}/*`, `*://${base}/*`];
                                       const wildcard = `*://*.${base}/*`;
                                       const [hasPair, hasWildcard] = await Promise.all([
                                           permissionsContains({ origins: patternsToCheck }),
                                           permissionsContains({ origins: [wildcard] })
                                       ]);
                                       hasPermissions = hasPair || hasWildcard;
                                   }

                                   if (!hasPermissions) {
                                       return sendResponse({ limited: true, msg: 'no_site_permission' });
                                   }

                                   // Permission present -> return cookies for the active host and base only
                                   const cookies = await getCookiesForHostAndBase(hostname, base);
                                   return sendResponse({ cookies });
                            }

                            case 'GET_ALL_COOKIES': {
                                   // Ensure we have global host permission before returning all cookies
                                   const allPattern = '<all_urls>';
                                   const hasAll = await permissionsContains({ origins: [allPattern] });
                                   if (hasAll) {
                                          const allCookies = await cookiesGetAll({});
                                          return sendResponse({ cookies: allCookies, limited: false });
                                   }

                                   // Fallback: aggregate cookies only for specifically granted origins
                                   const perms = await permissionsGetAll();
                                   const origins = (perms.origins || []).filter((o) => o && o !== allPattern);

                                   if (!origins.length) {
                                          return sendResponse({ cookies: [], limited: true });
                                   }

                                   // Derive domains to query from origin patterns
                                   const domainsToQuery = new Set();
                                   for (const origin of origins) {
                                          try {
                                                 // Skip non-http(s) schemes
                                                 if (!origin.includes('://')) continue;
                                                 const scheme = origin.split('://')[0];
                                                 if (scheme !== 'http' && scheme !== 'https' && scheme !== '*') continue;

                                                 const afterScheme = origin.slice(origin.indexOf('://') + 3);
                                                 const hostPart = afterScheme.split('/')[0] || '';
                                                 if (!hostPart) continue;

                                                 // Remove wildcard prefix if present
                                                 const hadWildcard = hostPart.startsWith('*.');
                                                 const hostname = hadWildcard ? hostPart.slice(2) : hostPart;

                                                 // Only accept plausible hostnames
                                                 if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) continue;

                                                 // If wildcard permission was granted, query base domain to include subdomains
                                                 if (hadWildcard) {
                                                        domainsToQuery.add(hostname);
                                                 } else {
                                                        domainsToQuery.add(hostname);
                                                 }
                                          } catch (_) {
                                                 // ignore malformed patterns
                                          }
                                   }

                                   if (domainsToQuery.size === 0) {
                                          return sendResponse({ cookies: [], limited: true });
                                   }

                                   // Query cookies for each allowed domain and merge
                                   const results = [];
                                   for (const domain of domainsToQuery) {
                                          try {
                                                 const list = await cookiesGetAll({ domain });
                                                 if (Array.isArray(list) && list.length) results.push(...list);
                                          } catch (e) {
                                                 // ignore errors for specific domains
                                          }
                                   }

                                   // Deduplicate by name|domain|path|storeId
                                   const keyOf = (c) => `${c.name}|${c.domain}|${c.path || '/'}|${c.storeId || ''}`;
                                   const uniq = new Map();
                                   for (const c of results) {
                                          if (!uniq.has(keyOf(c))) uniq.set(keyOf(c), c);
                                   }

                                   return sendResponse({ cookies: Array.from(uniq.values()), limited: true });
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

                            case 'CHECK_PERMISSION': {
                                   if (!message.origins || !message.origins.length) {
                                       return sendResponse(false);
                                   }
                                   // Return true only if we have ALL of the requested origins
                                   const hasAll = await permissionsContains({ origins: message.origins });
                                   return sendResponse(hasAll);
                            }

                           case 'REQUEST_PERMISSION': {
                                  const { origins } = message;
                                  if (!origins) return sendResponse(false);
                                  const granted = await permissionsRequest({ origins });
                                  await pushLog({ type: 'permission_request', origins, granted });
                                  return sendResponse(granted);
                           }

                           case 'REVOKE_PERMISSION': {
                                  const { origins } = message;
                                  if (!origins) return sendResponse(false);
                                  const removed = await permissionsRemove({ origins });
                                  await pushLog({ type: 'permission_revoke', origins, removed });
                                  return sendResponse(removed);
                           }

                           case 'DELETE_COOKIE': {
                                  const { cookie } = message;
                                  if (!cookie) return sendResponse({ ok: false, error: 'no_cookie' });
                                  const success = await removeCookie(cookie);
                                  return sendResponse({ ok: success });
                           }


                           case 'DELETE_COOKIES_BULK': {
                                  const { cookies } = message;
                                  if (!Array.isArray(cookies) || cookies.length === 0) {
                                         return sendResponse({ ok: false, error: 'no_cookies_provided' });
                                  }
                                  let deletedCount = 0;
                                  for (const cookie of cookies) {
                                         const success = await removeCookie(cookie);
                                         if (success) deletedCount++;
                                  }
                                  return sendResponse({ ok: true, deletedCount });
                           }

                           case 'SET_COOKIE': {
                                  const { details } = message;
                                  try {
                                         if (!details || typeof details !== 'object') {
                                                return sendResponse({ ok: false, error: 'invalid_details' });
                                         }
                                         // Minimal validation: require name and url
                                         validateSetCookieOptions({ name: details.name, url: details.url });

                                         // Ensure path default
                                         if (!details.path) details.path = '/';

                                         const result = await cookiesSet(details);
                                         await pushLog({ type: 'set', cookie: { name: details.name, domain: result.domain, path: result.path } });
                                         return sendResponse({ ok: true, result });
                                  } catch (e) {
                                         console.error('[CookieControl] SET_COOKIE failed', e);
                                         return sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
                                  }
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
// Centralize cookie operations
async function getCookies(filter) {
       return cookiesGetAll(filter);
}

async function deleteCookie(details) {
       return cookiesRemove(details);
}

async function setCookie(details) {
       return cookiesSet(details);
}

// Example: Wrap cookie operations
async function wrappedGetCookies(details) {
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
