/**
 * src/options/options.js
 * Options page logic.
 */

function sendMsg(msg) {
       return new Promise((resolve) => {
              chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
       });
}

function storageSet(obj) {
       return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
}

function storageGet(keys) {
       return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res)));
}

/* Load granted origins and show them */
async function loadGrantedOrigins() {
       const resp = await sendMsg({ type: 'GET_GRANTED_ORIGINS' });
       const list = resp.origins || [];
       const container = document.getElementById('origins-list');
       if (!list.length) container.textContent = 'No origin permissions granted.';
       else {
              container.innerHTML = '';
              const ul = document.createElement('ul');
              list.forEach((o) => {
                     const li = document.createElement('li');
                     li.textContent = o;
                     ul.appendChild(li);
              });
              container.appendChild(ul);
       }
}

/* Revoke all */
document.getElementById('revoke-all').addEventListener('click', async () => {
       const resp = await sendMsg({ type: 'GET_GRANTED_ORIGINS' });
       const origins = resp.origins || [];
       if (!origins.length) { alert('No origins to revoke'); return; }
       if (!confirm('Revoke all granted host permissions?')) return;
       const rem = await sendMsg({ type: 'REMOVE_ORIGINS', origins });
       if (rem && rem.removed) {
              alert('Revoked origins');
       } else {
              alert('Revocation failed');
       }
       loadGrantedOrigins();
});

/* apply permission mode */
document.getElementById('apply-perm').addEventListener('click', async () => {
       const mode = document.querySelector('input[name=permMode]:checked').value;
       await storageSet({ 'cookiecontrol:settings': { permissionMode: mode } });
       alert('Settings saved');
});

/* export all cookies */
document.getElementById('export-all').addEventListener('click', async () => {
       const resp = await sendMsg({ type: 'EXPORT_COOKIES' });
       if (resp.error) { alert('Export error: ' + resp.error); return; }
       const data = resp.data || [];
       const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), cookies: data }, null, 2)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a'); a.href = url; a.download = `cookiecontrol-export-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
       alert('Export completed: ' + data.length + ' cookies');
});

/* import */
document.getElementById('do-import').addEventListener('click', async () => {
       const f = document.getElementById('import-file').files[0];
       if (!f) { alert('Select a JSON file'); return; }
       const text = await f.text();
       let parsed;
       try { parsed = JSON.parse(text); } catch (e) { alert('Invalid JSON'); return; }
       const cookies = parsed.cookies || parsed;
       const res = await sendMsg({ type: 'IMPORT_COOKIES', cookies });
       if (res && res.res) alert('Imported: ' + (res.res.imported || 0));
       else alert('Import failed');
});

/* Operation log view and clear */
async function loadLog() {
       const resp = await sendMsg({ type: 'GET_OP_LOG' });
       const log = resp.log || [];
       const el = document.getElementById('oplog');
       el.innerHTML = '';
       if (!log.length) { el.textContent = 'No recent operations.'; return; }
       log.forEach((l) => {
              const p = document.createElement('div');
              p.textContent = `${new Date(l.ts).toLocaleString()} — ${l.type}`;
              el.appendChild(p);
       });
}

document.getElementById('clear-log').addEventListener('click', async () => {
       await storageSet({ 'cookiecontrol:oplog': [] });
       loadLog();
});
/* Check and show global permission state */
async function showGlobalPermissionStatus() {
       const has = await new Promise(resolve => chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve));
       const el = document.getElementById('global-perm-status');
       if (el) el.textContent = has ? 'Granted' : 'Not granted';
}

/* Request global permission from Options page (user gesture) */
document.getElementById('request-global-perm').addEventListener('click', async () => {
       const granted = await new Promise(resolve => chrome.permissions.request({ origins: ['<all_urls>'] }, resolve));
       alert(granted ? 'Global host permission granted' : 'Permission denied');
       showGlobalPermissionStatus();
});

/* Remove global permission */
document.getElementById('remove-global-perm').addEventListener('click', async () => {
       const removed = await new Promise(resolve => chrome.permissions.remove({ origins: ['<all_urls>'] }, resolve));
       alert(removed ? 'Global host permission removed' : 'Failed to remove permission');
       showGlobalPermissionStatus();
});

/* Add global permission management logic */
async function updateGlobalPermissionStatus() {
       const hasPermission = await new Promise(resolve =>
              chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
       );
       const status = document.getElementById('global-perm-status');
       status.textContent = hasPermission ? 'Granted' : 'Not granted';
}

document.getElementById('request-global-perm').addEventListener('click', async () => {
       const granted = await new Promise(resolve =>
              chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
       );
       if (granted) {
              alert('Global access granted.');
       } else {
              alert('Permission not granted.');
       }
       updateGlobalPermissionStatus();
});

document.getElementById('remove-global-perm').addEventListener('click', async () => {
       const removed = await new Promise(resolve =>
              chrome.permissions.remove({ origins: ['<all_urls>'] }, resolve)
       );
       if (removed) {
              alert('Global access revoked.');
       } else {
              alert('Failed to revoke permission.');
       }
       updateGlobalPermissionStatus();
});

// Refactor to use shared permission logic
async function updatePermissionStatus() {
       const hasPermission = await hasAllUrlsPermission();
       document.getElementById('global-perm-status').textContent = hasPermission ? 'Granted' : 'Not granted';
}

document.getElementById('request-global-perm').addEventListener('click', async () => {
       const granted = await requestAllUrlsPermission();
       alert(granted ? 'Global access granted.' : 'Permission not granted.');
       updatePermissionStatus();
});

document.getElementById('remove-global-perm').addEventListener('click', async () => {
       const removed = await removeAllUrlsPermission();
       alert(removed ? 'Global access revoked.' : 'Failed to revoke permission.');
       updatePermissionStatus();
});

/* Call showGlobalPermissionStatus() on options init */
showGlobalPermissionStatus();

/* Init */
(async function init() {
       loadGrantedOrigins();
       loadLog();
       // load saved permission mode if exists
       const stored = await storageGet('cookiecontrol:settings');
       const settings = stored['cookiecontrol:settings'] || { permissionMode: 'on_demand' };
       const radio = document.querySelector(`input[name=permMode][value=${settings.permissionMode}]`);
       if (radio) radio.checked = true;
})();
