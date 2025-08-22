/**
 * src/utils/permissionsUi.js
 * Encapsulates permission UI state computation for the popup.
 * Returns a config object for the permission button based on current view and granted permissions.
 */

import { permissionsContains } from './chrome.js';

/**
 * Build permission button UI config.
 * @param {'site'|'all'} viewMode
 * @param {string} currentHost
 * @param {string} currentBaseDomain
 * @returns {Promise<{visible:boolean,text:string,action:'grant'|'revoke',origins:string[],revokeClass:boolean,allPermsWarning?:boolean}>}
 */
export async function buildPermissionButtonConfig(viewMode, currentHost, currentBaseDomain) {
  if (viewMode === 'all') {
    const hasAll = await permissionsContains({ origins: ['<all_urls>'] });
    return {
      visible: true,
      text: hasAll ? 'Revoke Access' : 'Grant Full Access',
      action: hasAll ? 'revoke' : 'grant',
      origins: ['<all_urls>'],
      revokeClass: !!hasAll,
      allPermsWarning: !hasAll,
    };
  }

  // site view
  if (!currentBaseDomain) {
    return { visible: false, text: '', action: 'grant', origins: [], revokeClass: false };
  }

  const isBaseDomain = currentHost === currentBaseDomain || currentHost === `www.${currentBaseDomain}`;

  if (isBaseDomain) {
    const baseOnly = `*://${currentBaseDomain}/*`;
    const wildcard = `*://*.${currentBaseDomain}/*`;

    const [hasGlobal, hasWildcard, hasBaseOnly] = await Promise.all([
      permissionsContains({ origins: ['<all_urls>'] }),
      permissionsContains({ origins: [wildcard] }),
      permissionsContains({ origins: [baseOnly] }),
    ]);

    if (hasGlobal) {
      return { visible: true, text: 'Revoke Access', action: 'revoke', origins: ['<all_urls>'], revokeClass: true };
    }
    if (hasWildcard) {
      return { visible: true, text: `Revoke Access for *.${currentBaseDomain}`, action: 'revoke', origins: [wildcard], revokeClass: true };
    }
    if (hasBaseOnly) {
      return { visible: true, text: `Revoke Access for ${currentBaseDomain}`, action: 'revoke', origins: [baseOnly], revokeClass: true };
    }
    return { visible: true, text: `Grant Access to ${currentBaseDomain}`, action: 'grant', origins: [baseOnly], revokeClass: false };
  }

  // subdomain case
  const hostPattern = `*://${currentHost}/*`;
  const basePattern = `*://${currentBaseDomain}/*`;
  const wildcard = `*://*.${currentBaseDomain}/*`;

  const [hasGlobal, hasWildcard, hasHost, hasBase] = await Promise.all([
    permissionsContains({ origins: ['<all_urls>'] }),
    permissionsContains({ origins: [wildcard] }),
    permissionsContains({ origins: [hostPattern] }),
    permissionsContains({ origins: [basePattern] }),
  ]);

  if (hasGlobal) {
    return { visible: true, text: 'Revoke Global Access', action: 'revoke', origins: ['<all_urls>'], revokeClass: true };
  }
  if (hasWildcard) {
    return { visible: true, text: `Revoke Access for *.${currentBaseDomain}`, action: 'revoke', origins: [wildcard], revokeClass: true };
  }
  if (hasHost && hasBase) {
    return { visible: true, text: `Revoke Access for ${currentHost}`, action: 'revoke', origins: [hostPattern], revokeClass: true };
  }
  const missing = [];
  if (!hasHost) missing.push(hostPattern);
  if (!hasBase) missing.push(basePattern);
  const displayName = currentHost || currentBaseDomain;
  return { visible: true, text: `Grant Access to ${displayName}`, action: 'grant', origins: missing, revokeClass: false };
}
