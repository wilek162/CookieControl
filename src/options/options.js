/**
 * src/options/options.js
 * Options page logic for the redesigned UI.
 */

import { $, $$ } from '../utils/dom.js';
import { sendMsg, storageSessionSet } from '../utils/chrome.js';
import { createStore } from '../utils/state.js';

let store;
let uiState = {
	selectedSection: 'permissions'
};

/* Theme preference handling (light | dark | system[default]) */
function applyStoredTheme() {
    try {
        const pref = localStorage.getItem('cc_theme');
        if (pref === 'light' || pref === 'dark') {
            document.documentElement.setAttribute('data-theme', pref);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    } catch (_) { /* ignore */ }
}

function setThemePreference(mode) {
    try {
        if (mode === 'light' || mode === 'dark') {
            localStorage.setItem('cc_theme', mode);
            document.documentElement.setAttribute('data-theme', mode);
        } else {
            // 'system' or invalid -> remove override and let CSS media query apply
            localStorage.removeItem('cc_theme');
            document.documentElement.removeAttribute('data-theme');
        }
    } catch (_) { /* ignore */ }
}

// Expose minimal API for potential cross-page reuse/testing
window.CookieControlTheme = {
    set: setThemePreference,
    get: () => localStorage.getItem('cc_theme') || 'system'
};

function setupThemeSelector() {
    const sel = document.getElementById('theme-select');
    if (!sel) return;
    // Initialize current value
    sel.value = window.CookieControlTheme.get();
    sel.addEventListener('change', (e) => {
        const val = e.target.value;
        window.CookieControlTheme.set(val);
        // keep control in sync (in case invalid value set)
        sel.value = window.CookieControlTheme.get();
    });
}

function setupNavigation() {
	const navLinks = $$('.nav-link');
	const contentSections = $$('.content-section');

	// Apply persisted section on load
	try {
		navLinks.forEach(l => l.classList.remove('active'));
		contentSections.forEach(s => s.classList.remove('active'));
		const initial = uiState.selectedSection || 'permissions';
		document.querySelector(`.nav-link[data-section="${initial}"]`)?.classList.add('active');
		document.getElementById(initial)?.classList.add('active');
	} catch (_) { /* ignore */ }

	navLinks.forEach(link => {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			const section = e.target.getAttribute('data-section');
			store.set({ selectedSection: section });

			navLinks.forEach(l => l.classList.remove('active'));
			e.target.classList.add('active');

			contentSections.forEach(s => {
				s.classList.remove('active');
				if (s.id === section) {
					s.classList.add('active');
				}
			});
		});
	});
}

async function loadGrantedOrigins() {
	const resp = await sendMsg({ type: 'GET_GRANTED_ORIGINS' });
	const origins = resp.origins || [];
	const container = $('#origins-list');
	container.innerHTML = '';

	if (!origins.length) {
		container.textContent = 'No site permissions have been granted.';
		return;
	}

	origins.forEach(origin => {
		const item = document.createElement('div');
		item.className = 'origin-item';
		item.textContent = origin;
		container.appendChild(item);
	});
}

async function updateGlobalPermissionStatus() {
	const has = await sendMsg({ type: 'CHECK_PERMISSION', origins: ['<all_urls>'] });
	const statusEl = $('#global-perm-status');
	statusEl.textContent = has ? 'Status: Granted' : 'Status: Not Granted';
	$('#request-global-perm').disabled = has;
	$('#remove-global-perm').disabled = !has;
}

async function loadLog() {
	const resp = await sendMsg({ type: 'GET_OP_LOG' });
	const log = resp.log || [];
	const el = $('#oplog');
	el.innerHTML = '';

	if (!log.length) {
		el.textContent = 'No recent operations to display.';
		return;
	}

	log.reverse().forEach((l) => {
		const entry = document.createElement('div');
		entry.className = 'log-entry';
		entry.textContent = `${new Date(l.ts).toLocaleString()} — ${l.type}`;
		el.appendChild(entry);
	});
}

function setupEventListeners() {
	// Permissions
	$('#revoke-all').addEventListener('click', async () => {
		const resp = await sendMsg({ type: 'GET_GRANTED_ORIGINS' });
		const origins = resp.origins || [];
		if (!origins.length) {
			alert('No site permissions to revoke.');
			return;
		}
		if (confirm('Are you sure you want to revoke all site permissions?')) {
			const rem = await sendMsg({ type: 'REMOVE_ORIGINS', origins });
			if (rem && rem.removed) {
				alert('All site permissions have been revoked.');
				loadGrantedOrigins();
			} else {
				alert('Failed to revoke permissions.');
			}
		}
	});

	$('#request-global-perm').addEventListener('click', async () => {
		const granted = await sendMsg({ type: 'REQUEST_PERMISSION', origins: ['<all_urls>'] });
		alert(granted ? 'Global access has been granted.' : 'Permission was not granted.');
		updateGlobalPermissionStatus();
	});

	$('#remove-global-perm').addEventListener('click', async () => {
		const removed = await sendMsg({ type: 'REMOVE_ORIGINS', origins: ['<all_urls>'] });
		alert(removed ? 'Global access has been revoked.' : 'Failed to revoke permission.');
		updateGlobalPermissionStatus();
	});

	// Import / Export
	$('#export-all').addEventListener('click', async () => {
		const resp = await sendMsg({ type: 'EXPORT_COOKIES' });
		if (resp.error) {
			alert('Export error: ' + resp.error);
			return;
		}
		const data = resp.data || [];
		const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), cookies: data }, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `cookiecontrol-export-${Date.now()}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		alert(`Exported ${data.length} cookies.`);
	});

	$('#do-import').addEventListener('click', async () => {
		const fileInput = $('#import-file');
		const file = fileInput.files[0];
		if (!file) {
			alert('Please select a JSON file to import.');
			return;
		}
		const text = await file.text();
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			alert('Error: Invalid JSON file.');
			return;
		}
		const cookies = parsed.cookies || (Array.isArray(parsed) ? parsed : []);
		const res = await sendMsg({ type: 'IMPORT_COOKIES', cookies });
		if (res && res.res && res.res.imported > 0) {
			alert(`Successfully imported ${res.res.imported} cookies.`);
		} else {
			alert('Import failed. No cookies were imported.');
		}
		fileInput.value = ''; // Reset file input
	});

	// Log
	$('#clear-log').addEventListener('click', async () => {
		if (confirm('Are you sure you want to clear the operation log?')) {
			            await storageSessionSet({ 'cookiecontrol:oplog': [] });
			loadLog();
		}
	});
}

async function init() {
	// Apply theme override (if any) before rendering UI
	applyStoredTheme();

	// init store and subscribe
	store = await createStore('options', { selectedSection: uiState.selectedSection });
	uiState = { ...uiState, ...store.get() };
	store.subscribe((s) => { uiState = { ...uiState, ...s }; });

	setupNavigation();
	setupEventListeners();
	setupThemeSelector();
	loadGrantedOrigins();
	updateGlobalPermissionStatus();
	loadLog();
}

document.addEventListener('DOMContentLoaded', init);
