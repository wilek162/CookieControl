/**
 * popup.js — updated to obtain site-only cookies without global host permission,
 * using content script fallback (document.cookie) when needed.
 */

function $(sel) { return document.querySelector(sel); }

/* send RPC to background */
function sendMsg(msg) {
       return new Promise((resolve) => {
              chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
       });
}

/* wrapper for tabs.query */
function tabsQuery(q) {
       return new Promise((resolve) => chrome.tabs.query(q, (tabs) => resolve(tabs)));
}

/* scripting.executeScript wrapper */
function executeScriptInTab(tabId, func, args = []) {
       return chrome.scripting.executeScript({
              target: { tabId },
              func,
              args
       });
}

/* permission helpers used in UI (popup) */
function requestSitePermission(pattern) {
       return new Promise((resolve) => chrome.permissions.request({ origins: [pattern] }, (granted) => resolve(granted)));
}

/* escape HTML */
function escapeHtml(s) {
       if (!s) return '';
       return s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

/* parse document.cookie string -> array of {name, value} */
function parseDocumentCookie(dc) {
       if (!dc) return [];
       return dc.split(';').map(p => {
              const [k, ...rest] = p.trim().split('=');
              return { name: decodeURIComponent(k), value: decodeURIComponent(rest.join('=')) };
       });
}

/* UI state */
let viewMode = 'site'; // 'site' | 'all'
let currentHost = '';
let currentTabId = null;

async function init() {
       // bind view nav
       $('#view-site').addEventListener('click', () => switchView('site'));
       $('#view-all').addEventListener('click', () => switchView('all'));

       $('#btn-refresh').addEventListener('click', refresh);
       $('#btn-delete-site').addEventListener('click', deleteAllForSite);
       $('#btn-export').addEventListener('click', exportVisibleCookies);

       $('#grant-site-perm').addEventListener('click', grantSitePermission);

       // get current active tab
       const tabs = await tabsQuery({ active: true, currentWindow: true });
       const tab = tabs && tabs[0];
       if (tab && tab.url) {
              try { currentHost = new URL(tab.url).hostname; } catch (e) { currentHost = ''; }
              currentTabId = tab.id;
              $('#site').textContent = currentHost;
       } else {
              $('#site').textContent = '';
       }

       updateNav();
       await refresh();
       await updateGlobalPermissionButton();
}

function updateNav() {
       $('#view-site').setAttribute('aria-pressed', viewMode === 'site' ? 'true' : 'false');
       $('#view-all').setAttribute('aria-pressed', viewMode === 'all' ? 'true' : 'false');
}

/* switch view */
async function switchView(mode) {
       if (viewMode === mode) return;
       viewMode = mode;
       updateNav();
       $('#status').textContent = '';
       await refresh();
}

/* main refresh entry */
async function refresh() {
       $('#status').textContent = 'Loading...';
       $('#site-warning').textContent = '';
       try {
              const cookies = await fetchCookiesForView();
              $('#status').textContent = `${cookies.length} cookies (${viewMode})`;
              renderCookiesFull(cookies);
       } catch (error) {
              $('#status').textContent = `Error: ${error.message}`;
       }
}

/* read document.cookie from active tab and parse it */
async function readDocumentCookieFromTab() {
       if (!currentTabId) return [];
       try {
              const result = await executeScriptInTab(currentTabId, () => {
                     // this runs in page context
                     return document.cookie || '';
              });
              // executeScript returns array of InjectionResult objects (one per frame). We take first non-empty.
              const str = (result && result[0] && result[0].result) || '';
              return parseDocumentCookie(str);
       } catch (e) {
              console.error('readDocumentCookieFromTab error', e);
              return [];
       }
}

/* Grant site permission for the current host (user gesture) */
async function grantSitePermission() {
       if (!currentHost) { alert('No active host'); return; }
       const pattern = `*://*.${currentHost}/*`;
       const granted = await requestSitePermission(pattern);
       if (!granted) {
              alert('Permission denied (site access not granted).');
              return;
       }
       // Permission granted: refresh (background will now return full cookies)
       await refresh();
}

/* Add global permission button logic */
async function updateGlobalPermissionButton() {
       const hasPermission = await hasAllUrlsPermission();
       const button = $('#view-all');
       button.textContent = hasPermission ? 'All websites' : 'All websites (not granted)';
       button.addEventListener('click', async () => {
              if (!hasPermission) {
                     const granted = await requestAllUrlsPermission();
                     alert(granted ? 'Global access granted.' : 'Permission not granted.');
                     location.reload();
              }
       });
}

/* Render helpers */

/* render cookies coming from document.cookie (no flags, limited info) */
function renderCookiesFromDocCookie(list) {
       const tbody = $('#cookie-list');
       tbody.innerHTML = '';
       for (const c of list) {
              const tr = document.createElement('tr');
              tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td>${escapeHtml(currentHost)}</td><td>/</td><td>Session/Unknown</td><td>non-httpOnly</td><td><button class="del-doc">Delete</button></td>`;
              const btn = tr.querySelector('.del-doc');
              btn.addEventListener('click', async () => {
                     // Deleting via document.cookie: set cookie expiry in the page (requires script) — we'll try to remove by setting expiration
                     try {
                            await executeScriptInTab(currentTabId, (cookieName) => {
                                   document.cookie = cookieName + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
                            }, [c.name]);
                            tr.remove();
                     } catch (err) {
                            alert('Failed to delete cookie via page; consider granting site access for full control.');
                     }
              });
              tbody.appendChild(tr);
       }
}

/* render cookies from background (full cookie objects) */
function renderCookiesFull(cookies) {
       const tbody = $('#cookie-list');
       tbody.innerHTML = '';
       for (const c of cookies) {
              const flags = `${c.httpOnly ? 'httpOnly ' : ''}${c.secure ? 'secure' : ''}${c.sameSite ? ' ' + c.sameSite : ''}`;
              const expires = c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleString() : 'Session';
              const tr = document.createElement('tr');
              tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.domain)}</td><td>${escapeHtml(c.path)}</td><td>${expires}</td><td>${escapeHtml(flags)}</td><td><button class="del-full">Delete</button></td>`;
              const btn = tr.querySelector('.del-full');
              btn.addEventListener('click', async () => {
                     btn.disabled = true;
                     const ok = await sendMsg({ type: 'DELETE_COOKIE', cookie: c });
                     if (ok && ok.ok) tr.remove();
                     else { btn.disabled = false; alert('Delete failed'); }
              });
              tbody.appendChild(tr);
       }
}

/* Delete all for site (site view) */
async function deleteAllForSite() {
       if (viewMode !== 'site') { alert('Delete all for site only available in site view'); return; }
       if (!currentHost) return;
       if (!confirm(`Delete all cookies for ${currentHost} and its subdomains? This action cannot be undone.`)) return;

       // Prefer to ensure site permission exists for robust delete (background checks and requires site permission).
       const pattern = `*://*.${currentHost}/*`;
       const has = await new Promise(resolve => chrome.permissions.contains({ origins: [pattern] }, (g) => resolve(g)));
       if (!has) {
              const granted = await requestSitePermission(pattern);
              if (!granted) { $('#status').textContent = 'Site permission required to delete all cookies.'; return; }
       }

       $('#status').textContent = 'Deleting...';
       const res = await sendMsg({ type: 'DELETE_ALL_FOR_SITE', domain: currentHost });
       if (res && res.error) {
              $('#status').textContent = 'Error: ' + res.error;
       } else {
              $('#status').textContent = `Deleted ${res.result.removed}/${res.result.total} cookies`;
              await refresh();
       }
}

/* Export visible cookies */
async function exportVisibleCookies() {
       $('#status').textContent = 'Exporting...';
       if (viewMode === 'site') {
              // If site is limited, read via document.cookie
              const resp = await sendMsg({ type: 'GET_ACTIVE_TAB_COOKIES' });
              if (resp && resp.limited) {
                     const cookies = await readDocumentCookieFromTab();
                     downloadJSON(cookies, `cookiecontrol-site-${currentHost}-${Date.now()}.json`);
                     $('#status').textContent = `Exported ${cookies.length} cookies (non-httpOnly, site)`;
                     return;
              } else if (resp && resp.cookies) {
                     downloadJSON(resp.cookies, `cookiecontrol-site-${currentHost}-${Date.now()}.json`);
                     $('#status').textContent = `Exported ${(resp.cookies || []).length} cookies (site)`;
                     return;
              } else {
                     $('#status').textContent = 'No cookies to export';
                     return;
              }
       } else {
              const resp = await sendMsg({ type: 'GET_ALL_COOKIES' });
              if (resp.error) { $('#status').textContent = 'Error: ' + resp.error; return; }
              downloadJSON(resp.cookies || [], `cookiecontrol-all-${Date.now()}.json`);
              $('#status').textContent = `Exported ${(resp.cookies || []).length} cookies (all)`;
       }
}

function downloadJSON(obj, filename) {
       const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), cookies: obj }, null, 2)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = filename;
       document.body.appendChild(a);
       a.click();
       a.remove();
       URL.revokeObjectURL(url);
}

/* Update UI to handle limited view and request permissions */
function updateUIForLimitedView() {
       const message = $("#message");
       message.textContent = "Limited view: httpOnly cookies are not included. Click 'Grant site access' to view all cookies for this site.";
       const grantButton = $("#grant-permission");
       grantButton.style.display = 'block';
       grantButton.addEventListener('click', async () => {
              const [tab] = await tabsQuery({ active: true, currentWindow: true });
              const granted = await requestSitePermission(tab.url);
              if (granted) {
                     location.reload(); // Reload to reflect new permissions
              } else {
                     alert('Permission not granted.');
              }
       });
}

/* Refactor to use shared cookie-fetching logic */
async function fetchCookiesForView() {
       if (viewMode === 'site') {
              const resp = await sendMsg({ type: 'GET_ACTIVE_TAB_COOKIES' });
              if (resp.error) {
                     throw new Error(resp.error);
              }
              return resp.cookies || [];
       } else {
              const resp = await sendMsg({ type: 'GET_ALL_COOKIES' });
              if (resp.error) {
                     throw new Error(resp.error);
              }
              return resp.cookies || [];
       }
}

/* initialize */
document.addEventListener('DOMContentLoaded', init);
updateUIForLimitedView();
