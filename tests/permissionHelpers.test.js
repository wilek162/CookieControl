import { computePermissionState, buildPatterns, isBaseHost } from '../src/utils/permissionHelpers.js';

function expectEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`Assertion failed: ${msg}\nExpected: ${JSON.stringify(b)}\nActual:   ${JSON.stringify(a)}`);
  }
}

// Base domain view with base-only granted
{
  const host = 'google.com';
  const base = 'google.com';
  const { baseOnly } = buildPatterns(host, base);
  const s = computePermissionState(host, base, [baseOnly]);
  expectEqual(s.effective, 'baseOnly', 'base-only on base domain');
  expectEqual(s.revokeTarget, baseOnly, 'revoke base-only on base domain');
}

// Subdomain view requires pair (host + base)
{
  const host = 'mail.google.com';
  const base = 'google.com';
  const { host: hp, baseOnly } = buildPatterns(host, base);
  const s1 = computePermissionState(host, base, [hp]);
  expectEqual(s1.grantMissing.includes(baseOnly), true, 'missing base when only host granted');
  const s2 = computePermissionState(host, base, [hp, baseOnly]);
  expectEqual(s2.effective, 'pair', 'pair when host+base granted');
  expectEqual(s2.revokeTarget, hp, 'revoke only host when pair');
}

// Wildcard dominates
{
  const host = 'mail.google.com';
  const base = 'google.com';
  const { wildcard } = buildPatterns(host, base);
  const s = computePermissionState(host, base, [wildcard]);
  expectEqual(s.effective, 'wildcard', 'wildcard effective');
  expectEqual(s.revokeTarget, wildcard, 'revoke wildcard');
}

// Global dominates all
{
  const host = 'mail.google.com';
  const base = 'google.com';
  const s = computePermissionState(host, base, ['<all_urls>']);
  expectEqual(s.effective, 'global', 'global effective');
  expectEqual(s.revokeTarget, '<all_urls>', 'revoke global');
}

console.log('permissionHelpers tests passed');


