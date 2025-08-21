/*
 * src/utils/cookiePartition.js
 * Helper utilities for working with partitioned cookies (Chrome 119+).
 *
 * The cookies API operates on unpartitioned cookies by default. For browsers that support
 * partitioned cookies you must pass a `partitionKey` when calling chrome.cookies.get / getAll / set.
 *
 * Ref: https://developer.chrome.com/docs/extensions/reference/cookies/#type-CookiePartitionKey
 */

import { getBaseDomain } from './cookieUtils.js';
import { tabsQuery, cookiesGetAll } from './chrome.js';

/**
 * Attempt to obtain a CookiePartitionKey for a specific frame.
 *
 * Preferred approach (Chrome 121+):
 *   chrome.cookies.getPartitionKey({ tabId, frameId })
 *
 * Fallback (older Chrome):
 *   Derive the top-level site from the tab's URL and construct the key manually.
 *
 * @param {object} params
 * @param {number} params.tabId   – the tab ID
 * @param {number} [params.frameId=0] – the frame ID; defaults to the main frame (0)
 * @returns {Promise<chrome.cookies.CookiePartitionKey|null>} null if unavailable
 */
export async function getPartitionKey({ tabId, frameId = 0 } = {}) {
       if (typeof chrome === 'undefined' || !chrome.cookies) return null;

       //     // 1. Use the dedicated API if it exists.
       //     if (typeof chrome.cookies.getPartitionKey === 'function' && Number.isInteger(tabId)) {
       //         return new Promise((resolve) => {
       //             try {
       //                 const opts = {};
       //                 if (Number.isInteger(tabId)) {
       //                     opts.tabId = tabId;
       //                     // Only include frameId if we have a valid tabId – the API requires the pair.
       //                     if (Number.isInteger(frameId)) opts.frameId = frameId;
       //                 }
       //                 chrome.cookies.getPartitionKey(opts, (key) => {
       //                     // In some cases the callback may fire with `undefined` when the feature is disabled.
       //                     resolve(key || null);
       //                 });
       //             } catch (_) {
       //                 resolve(null);
       //             }
       //         });
       //     }

       // 2. Graceful fallback: derive from the tab's top-level site if we have a tabId.
       if (typeof chrome.tabs?.get === 'function' && Number.isInteger(tabId)) {
              try {
                     const tab = await new Promise((resolve) => chrome.tabs.get(tabId, resolve));
                     if (tab?.url) {
                            const topLevelSite = buildTopLevelSite(tab.url);
                            if (topLevelSite) {
                                   return { topLevelSite };
                            }
                     }
              } catch (_) {
                     /* ignored – will fall through to returning null */
              }
       }

       // 3. Unable to determine – return null so callers can decide how to proceed.
       return null;
}

/**
 * Derive a top-level site string (scheme://eTLD+1) from an arbitrary URL.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function buildTopLevelSite(url) {
       try {
              const u = new URL(url);
              const baseDomain = getBaseDomain(u.hostname);
              return `${u.protocol}//${baseDomain}`;
       } catch (_) {
              return null;
       }
}

/**
 * Convenience helper that mirrors chrome.cookies.getAll but automatically injects a
 * partitionKey (when available) for browsers that support partitioned cookies.
 *
 * @param {object} filter      – original chrome.cookies.getAll filter argument
 * @param {object} frameInfo   – { tabId, frameId }
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function cookiesGetAllWithPartitionKey(filter = {}, frameInfo) {
       // Clone the filter to avoid mutating the caller's object.
       const f = { ...filter };

       const results = [];

       // 1. Always fetch regular (unpartitioned) cookies.
       results.push(cookiesGetAll(filter));

       // 2. If browser supports partitioned cookies, fetch those too.
       if (!('partitionKey' in filter)) {
              const key = await getPartitionKey(frameInfo);
              if (key) {
                     results.push(cookiesGetAll({ ...f, partitionKey: key }));
              }
       }

       const lists = await Promise.all(results);
       const merged = [].concat(...lists);

       // Deduplicate by name|domain|path|storeId|partitionKey
       const keyOf = (c) => `${c.name}|${c.domain}|${c.path || '/'}|${c.storeId || ''}|${c.partitionKey ? JSON.stringify(c.partitionKey) : ''}`;
       const uniq = new Map();
       for (const c of merged) {
              if (!uniq.has(keyOf(c))) uniq.set(keyOf(c), c);
       }
       return Array.from(uniq.values());
}
