/**
 * src/utils/permissionHelpers.js
 * Rena hjälp-funktioner för att härleda behörighetsläge och minsta begäran/revoke.
 * Innehåller inga Chrome-API-anrop och kan enhetstestas i Node.
 */

export function buildPatterns(hostname, baseDomain) {
  if (!baseDomain) return { host: null, baseOnly: null, wildcard: null };
  const host = hostname ? `*://${hostname}/*` : null;
  const baseOnly = `*://${baseDomain}/*`;
  const wildcard = `*://*.${baseDomain}/*`;
  return { host, baseOnly, wildcard };
}

export function isBaseHost(hostname, baseDomain) {
  if (!hostname || !baseDomain) return false;
  return hostname === baseDomain || hostname === `www.${baseDomain}`;
}

/**
 * Beräkna aktuellt behörighetsläge givet beviljade origins.
 * @param {string} hostname
 * @param {string} baseDomain
 * @param {string[]} grantedOrigins
 * @returns {{
 *  isBaseDomain: boolean,
 *  hasGlobal: boolean,
 *  hasWildcard: boolean,
 *  hasBaseOnly: boolean,
 *  hasHost: boolean,
 *  effective: 'global'|'wildcard'|'pair'|'baseOnly'|'none',
 *  grantMissing: string[],
 *  revokeTarget: string|null
 * }}
 */
export function computePermissionState(hostname, baseDomain, grantedOrigins = []) {
  const set = new Set(grantedOrigins || []);
  const baseView = isBaseHost(hostname, baseDomain);
  const { host, baseOnly, wildcard } = buildPatterns(hostname, baseDomain);

  const hasGlobal = set.has('<all_urls>');
  const hasWildcard = wildcard ? set.has(wildcard) : false;
  const hasBaseOnly = baseOnly ? set.has(baseOnly) : false;
  const hasHost = host ? set.has(host) : false;

  let effective = 'none';
  if (hasGlobal) effective = 'global';
  else if (hasWildcard) effective = 'wildcard';
  else if (baseView) effective = hasBaseOnly ? 'baseOnly' : 'none';
  else if (hasHost && hasBaseOnly) effective = 'pair';

  let grantMissing = [];
  if (effective === 'none') {
    if (baseView) {
      if (baseOnly) grantMissing = [baseOnly];
    } else {
      // subdomän: kräver host + baseOnly
      if (host && !hasHost) grantMissing.push(host);
      if (baseOnly && !hasBaseOnly) grantMissing.push(baseOnly);
    }
  }

  let revokeTarget = null;
  if (effective === 'global') revokeTarget = '<all_urls>';
  else if (effective === 'wildcard') revokeTarget = wildcard;
  else if (effective === 'baseOnly' && baseView) revokeTarget = baseOnly;
  else if (effective === 'pair' && !baseView) revokeTarget = host;

  return {
    isBaseDomain: baseView,
    hasGlobal,
    hasWildcard,
    hasBaseOnly,
    hasHost,
    effective,
    grantMissing,
    revokeTarget
  };
}


