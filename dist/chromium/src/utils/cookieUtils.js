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
// Removed unused domainToOriginPattern to reduce bundle size.

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

/**
 * Example: Wrap existing functions
 */

// Removed unused all_urls permission helpers (hasAllUrlsPermission, requestAllUrlsPermission, removeAllUrlsPermission).

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

/**
 * Determine if a cookie is a known advertising / tracking cookie that is safe to remove.
 * We only include identifiers that are widely recognised as non-essential and will not
 * break normal site functionality when removed. The list is deliberately conservative –
 * if in doubt, we return false.
 *
 * @param {chrome.cookies.Cookie} cookie
 * @returns {boolean}
 */
export function isTrackingCookie(cookie) {
    if (!cookie || !cookie.name) return false;
    const name = cookie.name.toLowerCase();
    const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();

    // 1. Name-based detection (fast path)
    const NAME_PATTERNS = [
        /^_ga/,              // Google Analytics
        /^_gid$/,            // Google Analytics session ID
        /^_gat/,             // Google Analytics throttling
        /^__gads$/,          // Google Marketing Platform
        /^__qca$/,           // Quantcast
        /^_fbp$/,            // Facebook / Meta pixel
        /^fr$/,              // Facebook / Meta ads
        /^ide$/,             // Google DoubleClick
        /^dsid$/,            // Google DoubleClick
        /^anid$/,            // Google Ads
        /^1p_jar$/,          // Google Ads (first-party)
        /^cto_bundle$/,      // Criteo
        /^cto_lwid$/,        // Criteo
        /^cto_bidid$/,       // Criteo
        /^_uet/,             // Microsoft / Bing ads (_uet* family)
        /^scid$/,            // Snapchat ads
        /^ajs_.*/,           // Segment analytics
        /^mp_.*_mixpanel$/,  // Mixpanel
        /^hubspotutk$/,      // HubSpot tracking
        /^adid$/,            // Various ad IDs
    ];
    if (NAME_PATTERNS.some((re) => re.test(name))) {
        return true;
    }

    // 2. Domain-based detection (used when cookie name alone is ambiguous)
    const TRACKING_DOMAINS = [
        'doubleclick.net',
        'googleadservices.com',
        'googlesyndication.com',
        'googletagmanager.com',
        'googletagservices.com',
        'facebook.com',
        'facebook.net',
        'ads-twitter.com',
        'snapchat.com',
        'criteo.com',
    ];
    if (TRACKING_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
        return true;
    }

    return false;
}
