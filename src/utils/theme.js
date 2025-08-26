/**
 * src/utils/theme.js
 * Deduplicated theme preference helpers used by popup and options pages.
 */

export function applyStoredTheme() {
  try {
    const pref = localStorage.getItem('cc_theme');
    if (pref === 'light' || pref === 'dark') {
      document.documentElement.setAttribute('data-theme', pref);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (_) { /* ignore */ }
}

export function setThemePreference(mode) {
  try {
    if (mode === 'light' || mode === 'dark') {
      localStorage.setItem('cc_theme', mode);
      document.documentElement.setAttribute('data-theme', mode);
    } else {
      localStorage.removeItem('cc_theme');
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (_) { /* ignore */ }
}

export function getThemePreference() {
  try {
    const pref = localStorage.getItem('cc_theme');
    return pref === 'light' || pref === 'dark' ? pref : 'system';
  } catch (_) {
    return 'system';
  }
}

// Optional: expose window.CookieControlTheme for existing code paths
export function exposeThemeAPI() {
  try {
    window.CookieControlTheme = {
      set: setThemePreference,
      get: getThemePreference,
    };
  } catch (_) { /* ignore */ }
}

// Options page helper to wire up a select element with id 'theme-select'
export function setupThemeSelector(selectId = 'theme-select') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.value = getThemePreference();
  sel.addEventListener('change', (e) => {
    const val = e.target.value;
    setThemePreference(val);
    // keep control in sync (in case invalid value set)
    sel.value = getThemePreference();
  });
}
