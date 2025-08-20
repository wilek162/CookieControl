/**
 * src/utils/cookieUtils.js
 * Utility helpers that are safe to import into the service worker via importScripts.
 *
 * Keep these functions pure and defensive. These are designed to run in the worker context.
 */

/**
 * Build a URL for chrome.cookies.remove/set usage from a cookie object.
 * cookie.domain may start with '.' so we strip it when building the host.
 * @param {object} cookie chrome cookie object
 * @returns {string} url (scheme + host + path)
 */
export function cookieToUrl(cookie) {
       const domain = cookie.domain ? (cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain) : '';
       const scheme = cookie.secure ? 'https' : 'http';
       const path = cookie.path || '/';
       // Ensure domain is present
       return `${scheme}://${domain}${path}`;
}

/**
 * Convert domain (example.com or .example.com) to an origin pattern suitable for permissions.request
 * e.g. example.com -> '*://*.example.com/*'
 * @param {string} domain
 * @returns {string}
 */
export function domainToOriginPattern(domain) {
       if (!domain) throw new Error('domain required');
       const d = domain.startsWith('.') ? domain.slice(1) : domain;
       return `*://*.${d}/*`;
}

/**
 * Minimal validation for setting cookies via chrome.cookies.set
 * Throws on invalid input.
 * @param {object} opts
 */
export function validateSetCookieOptions(opts) {
       if (!opts || typeof opts !== 'object') throw new Error('Invalid cookie options');
       if (!opts.name) throw new Error('Cookie must have a name');
       if (!opts.url && !opts.domain) throw new Error('Either url or domain must be provided (prefer url)');
}

/**
 * Ensure modular utility functions
 */
export async function ensurePermissionForCookies() {
       const hasPermission = await new Promise(resolve =>
              chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
       );
       if (!hasPermission) {
              throw new Error('Permission not granted for cookie operations.');
       }
}

/**
 * Example: Wrap existing functions
 */
export async function safeCookieToUrl(cookie) {
       await ensurePermissionForCookies();
       return cookieToUrl(cookie);
}

// Shared utility functions for permissions
export async function hasAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
       );
}

export async function requestAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
       );
}

export async function removeAllUrlsPermission() {
       return new Promise(resolve =>
              chrome.permissions.remove({ origins: ['<all_urls>'] }, resolve)
       );
}

/**
 * Extracts the base domain (eTLD+1) from a hostname.
 * This is a simplified implementation and may not cover all edge cases for complex TLDs.
 * @param {string} hostname The hostname to parse (e.g., 'sub.example.co.uk').
 * @returns {string} The base domain (e.g., 'example.co.uk').
 */
export function getBaseDomain(hostname) {
    if (!hostname) return '';
    // Remove leading dot if present (often seen in cookie domains)
    const cleanHostname = hostname.startsWith('.') ? hostname.slice(1) : hostname;

    const parts = cleanHostname.split('.');
    if (parts.length <= 2) {
        return cleanHostname;
    }

    // A simple heuristic for common TLDs that are multi-part (e.g., .co.uk, .com.au)
    const commonTlds = ['co', 'com', 'net', 'org', 'gov', 'edu'];
    if (parts.length > 2 && commonTlds.includes(parts[parts.length - 2])) {
        return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
}
