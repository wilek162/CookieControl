import { getBaseDomain } from '../utils/cookieUtils.js';
import { createStore } from '../utils/state.js';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

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

/* escape HTML */
function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>'"/]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

/* UI state */
let store; // persistent UI store
let state = {
    viewMode: 'site', // 'site' | 'all'
    currentHost: '',
    currentBaseDomain: '', // Added for base domain permissions
    currentTabId: null,
    siteCookies: [],
    allCookies: [],
    siteSearchTerm: '',
    allSearchTerm: ''
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Initialize persistent UI store and merge into runtime state
    store = await createStore('popup', {
        viewMode: state.viewMode,
        siteSearchTerm: state.siteSearchTerm,
        allSearchTerm: state.allSearchTerm
    });
    state = { ...state, ...store.get() };
    store.subscribe((s) => { state = { ...state, ...s }; });

    // Tab switching
    $('.tabs').addEventListener('click', handleTabSwitch);

    // Header & Footer controls
    $('#permission-btn').addEventListener('click', handlePermissionClick);
    $('#btn-refresh').addEventListener('click', refresh);
    $('#btn-export').addEventListener('click', exportVisibleCookies);

    // Search
    $('#search-site').addEventListener('input', (e) => handleSearch(e.target.value, 'site'));
    $('#search-all').addEventListener('input', (e) => handleSearch(e.target.value, 'all'));

    // Bulk delete
    $('#bulk-delete-site').addEventListener('click', () => handleBulkDelete('site'));
    $('#bulk-delete-all').addEventListener('click', () => handleBulkDelete('all'));

    // Apply persisted UI selections
    try {
        $('#search-site').value = state.siteSearchTerm || '';
        $('#search-all').value = state.allSearchTerm || '';
        if (state.viewMode === 'all') {
            $$('.tab-link').forEach(t => t.classList.remove('active'));
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="tab-all"]').classList.add('active');
            $('#tab-all').classList.add('active');
        } else {
            // Ensure site tab is active
            $$('.tab-link').forEach(t => t.classList.remove('active'));
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="tab-site"]').classList.add('active');
            $('#tab-site').classList.add('active');
        }
    } catch (_) { /* ignore */ }

    // Get current tab info
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.url) {
        try {
            state.currentHost = new URL(tab.url).hostname;
            state.currentBaseDomain = getBaseDomain(state.currentHost);
        } catch (e) {
            state.currentHost = '';
            state.currentBaseDomain = '';
        }
        state.currentTabId = tab.id;
        $('#site').textContent = state.currentHost;
    } else {
        $('#site').textContent = 'N/A';
    }

    await refresh();
}

function handleTabSwitch(e) {
    if (!e.target.matches('.tab-link')) return;

    const newTab = e.target.dataset.tab;
    const newMode = newTab === 'tab-site' ? 'site' : 'all';
    store.set({ viewMode: newMode });

    $$('.tab-link').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(t => t.classList.remove('active'));

    e.target.classList.add('active');
    $(`#${newTab}`).classList.add('active');

    refresh(); // Refresh content for the new tab
}

function handleSearch(term, viewMode) {
    const lowered = (term || '').toLowerCase();
    if (viewMode === 'site') {
        store.set({ siteSearchTerm: lowered });
        state.siteSearchTerm = lowered;
        renderCookies(state.siteCookies, 'site');
    } else {
        store.set({ allSearchTerm: lowered });
        state.allSearchTerm = lowered;
        renderCookies(state.allCookies, 'all');
    }
}

async function handleBulkDelete(viewMode) {
    const containerId = `#cookie-list-${viewMode}`;
    const selectedCheckboxes = $$(`${containerId} .cookie-checkbox:checked`);
    if (selectedCheckboxes.length === 0) {
        $('#status').textContent = 'No cookies selected.';
        return;
    }

    const cookiesToDelete = Array.from(selectedCheckboxes).map(cb => {
        const card = cb.closest('.cookie-card');
        return JSON.parse(card.dataset.cookie);
    });

    if (!confirm(`Delete ${cookiesToDelete.length} selected cookies?`)) return;

    const result = await sendMsg({ type: 'DELETE_COOKIES_BULK', cookies: cookiesToDelete });

    if (result && result.ok) {
        $('#status').textContent = `Deleted ${result.deletedCount} cookies.`;
        await refresh();
    } else {
        $('#status').textContent = 'Error deleting cookies.';
    }
}

async function refresh() {
    $('#status').textContent = 'Loading...';
    $('#site-warning').textContent = '';
    await updatePermissionUI();

    try {
        if (state.viewMode === 'site') {
            const resp = await sendMsg({ type: 'GET_ACTIVE_TAB_COOKIES' });
            if (resp.error) throw new Error(resp.error);
            if (resp.limited) {
                $('#site-warning').textContent = "Limited view: httpOnly cookies not shown. Grant permission for full access.";
            }
            state.siteCookies = resp.cookies || [];
            renderCookies(state.siteCookies, 'site');
        } else {
            const resp = await sendMsg({ type: 'GET_ALL_COOKIES' });
            if (resp && resp.error) {
                throw new Error(resp.error);
            }
            state.allCookies = (resp && resp.cookies) || [];
            renderCookies(state.allCookies, 'all');
            if (resp && resp.limited) {
                $('#status').textContent = 'Limited view: showing granted sites only.';
            } else {
                // leave status set by renderCookies
            }
        }
    } catch (error) {
        $('#status').textContent = `Error: ${error.message}`;
    }
}

function renderCookies(cookies, viewMode) {
    const listId = `#cookie-list-${viewMode}`;
    const searchTerm = viewMode === 'site' ? state.siteSearchTerm : state.allSearchTerm;
    const container = $(listId);
    container.innerHTML = '';

    const filteredCookies = cookies.filter(c =>
        c.name.toLowerCase().includes(searchTerm) ||
        c.domain.toLowerCase().includes(searchTerm)
    );

    if (filteredCookies.length === 0) {
        container.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">No cookies found.</div>';
        $('#status').textContent = 'No cookies to display.';
        return;
    }

    if (viewMode === 'all') {
        const groupedByDomain = groupCookiesByDomain(filteredCookies);
        Object.keys(groupedByDomain).sort().forEach(domain => {
            const groupContainer = createDomainGroup(domain, groupedByDomain[domain]);
            container.appendChild(groupContainer);
        });
    } else {
        filteredCookies.forEach(c => {
            const card = createCookieCard(c);
            container.appendChild(card);
        });
    }

    $('#status').textContent = `${filteredCookies.length} of ${cookies.length} cookies shown.`;
}

function groupCookiesByDomain(cookies) {
    return cookies.reduce((acc, cookie) => {
        const baseDomain = getBaseDomain(cookie.domain) || 'Unknown Domain';
        if (!acc[baseDomain]) {
            acc[baseDomain] = [];
        }
        acc[baseDomain].push(cookie);
        return acc;
    }, {});
}

function createDomainGroup(domain, cookies) {
    const details = document.createElement('details');
    details.className = 'domain-group';

    const summary = document.createElement('summary');
    summary.className = 'domain-group-header';
    summary.innerHTML = `
		<span class="domain-name">${escapeHtml(domain)}</span>
		<span class="cookie-count">(${cookies.length} cookies)</span>
	`;
    details.appendChild(summary);

    const cookieList = document.createElement('div');
    cookieList.className = 'cookie-list-inner';
    cookies.forEach(cookie => {
        const card = createCookieCard(cookie);
        cookieList.appendChild(card);
    });
    details.appendChild(cookieList);

    return details;
}

function createCookieCard(cookie) {
    const card = document.createElement('div');
    card.className = 'cookie-card';
    card.dataset.cookie = JSON.stringify(cookie); // Store full cookie data

    const expires = cookie.session ? 'Session' : new Date(cookie.expirationDate * 1000).toLocaleString();

    card.innerHTML = `
		<div class="cookie-card-header">
			<input type="checkbox" class="cookie-checkbox">
			<span class="cookie-name">${escapeHtml(cookie.name)}</span>
			<button class="delete-btn">×</button>
		</div>
		<div class="cookie-domain">${escapeHtml(cookie.domain)}</div>
		<div class="cookie-details">
			<span>Path: ${escapeHtml(cookie.path)}</span>
			<span>Expires: ${escapeHtml(expires)}</span>
		</div>
		<div class="cookie-flags">
			${cookie.httpOnly ? '<span class="cookie-flag">HttpOnly</span>' : ''}
			${cookie.secure ? '<span class="cookie-flag">Secure</span>' : ''}
			${cookie.sameSite ? `<span class="cookie-flag">${escapeHtml(cookie.sameSite)}</span>` : ''}
		</div>
		<div class="cookie-editor">
			<input type="text" class="cookie-value-input" placeholder="Value" aria-label="Cookie value">
			<button class="undo-btn" title="Undo" disabled>
				<span>↺</span>
				<span class="undo-badge" style="display:none">0</span>
			</button>
		</div>
	`;

    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        const ok = await sendMsg({ type: 'DELETE_COOKIE', cookie });
        if (ok && ok.ok) {
            card.remove();
        } else {
            e.target.disabled = false;
            alert('Delete failed');
        }
    });

    // Inline editor logic
    const valueInput = card.querySelector('.cookie-value-input');
    const undoBtn = card.querySelector('.undo-btn');
    const undoBadge = card.querySelector('.undo-badge');

    // Do NOT prefill value for privacy unless cookie.httpOnly is false and user opts in.
    // For usability, we show value if cookie is not httpOnly. httpOnly cookies cannot be read by the page, but are available to the extension.
    // To stay privacy-first, we avoid persisting values and only keep them transiently in memory.
    valueInput.value = cookie.value || '';

    const cookieKey = `${cookie.name}|${cookie.domain}|${cookie.path || '/'}|${cookie.storeId || ''}`;
    const undoStacks = createCookieCard._undoStacks || (createCookieCard._undoStacks = new Map());
    if (!undoStacks.has(cookieKey)) undoStacks.set(cookieKey, []);

    function setUndoState() {
        const stack = undoStacks.get(cookieKey) || [];
        undoBtn.disabled = stack.length === 0;
        undoBadge.textContent = String(stack.length);
        undoBadge.style.display = stack.length ? 'inline-block' : 'none';
    }

    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 1500);
    }

    let debounceTimer = null;
    let pendingSet = null; // to track in-flight set for conflict handling

    function scheduleSet(newValue) {
        if (debounceTimer) clearTimeout(debounceTimer);
        valueInput.classList.remove('error', 'success');
        valueInput.classList.add('pending');
        debounceTimer = setTimeout(async () => {
            try {
                pendingSet = { name: cookie.name, domain: cookie.domain, path: cookie.path };
                const url = buildCookieUrl(cookie);
                const setObj = {
                    url,
                    name: cookie.name,
                    value: newValue,
                    path: cookie.path || '/',
                    secure: !!cookie.secure,
                    httpOnly: !!cookie.httpOnly
                };
                if (cookie.expirationDate) setObj.expirationDate = cookie.expirationDate;
                if (cookie.sameSite) setObj.sameSite = cookie.sameSite;

                const resp = await sendMsg({ type: 'SET_COOKIE', details: setObj });
                if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'set_failed');
                valueInput.classList.remove('pending');
                valueInput.classList.add('success');
                setTimeout(() => valueInput.classList.remove('success'), 800);
                showToast('Cookie updated');
                // Update local cookie snapshot (value only) without persisting raw history
                cookie.value = newValue;
                card.dataset.cookie = JSON.stringify(cookie);
            } catch (err) {
                valueInput.classList.remove('pending');
                valueInput.classList.add('error');
                showToast(`Update failed: ${err && err.message ? err.message : err}`);
            } finally {
                pendingSet = null;
            }
        }, 450);
    }

    function buildCookieUrl(c) {
        const host = c.domain ? (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) : '';
        const scheme = c.secure ? 'https' : 'http';
        const path = c.path || '/';
        return `${scheme}://${host}${path}`;
    }

    // Track edits locally but postpone applying until user confirms
    valueInput.addEventListener('input', () => {
        // Remove any previous status indication but do not push to history or update cookie yet
        valueInput.classList.remove('error', 'success');
        valueInput.classList.add('dirty');
        applyBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
    });

    // Apply change when user presses Enter
    valueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyEdit(valueInput, cookie);
            valueInput.blur();
        }
    });

    undoBtn.addEventListener('click', async () => {
        const stack = undoStacks.get(cookieKey);
        if (!stack.length) return;
        const prev = stack.shift();
        setUndoState();
        valueInput.value = prev;
        // Immediately set without waiting for debounce; but still show pending
        if (debounceTimer) clearTimeout(debounceTimer);
        valueInput.classList.add('pending');
        try {
            const url = buildCookieUrl(cookie);
            const resp = await sendMsg({
                type: 'SET_COOKIE', details: {
                    url,
                    name: cookie.name,
                    value: prev,
                    path: cookie.path || '/',
                    secure: !!cookie.secure,
                    httpOnly: !!cookie.httpOnly,
                    expirationDate: cookie.expirationDate,
                    sameSite: cookie.sameSite
                }
            });
            if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'undo_failed');
            cookie.value = prev;
            card.dataset.cookie = JSON.stringify(cookie);
            valueInput.classList.remove('pending');
            valueInput.classList.add('success');
            setTimeout(() => valueInput.classList.remove('success'), 800);
            showToast('Undo applied');
        } catch (e) {
            valueInput.classList.remove('pending');
            valueInput.classList.add('error');
            showToast(`Undo failed: ${e && e.message ? e.message : e}`);
        }
    });

    // Add Apply and Cancel buttons
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.className = 'apply-btn';
    applyBtn.style.display = 'none';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'cancel-btn';
    cancelBtn.style.display = 'none';

    valueInput.addEventListener('focus', () => {
        valueInput.classList.add('active');
        applyBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
    });

    valueInput.addEventListener('blur', (e) => {
        // Check if the blur event is caused by clicking the buttons
        const relatedTarget = e.relatedTarget;
        if (relatedTarget && (relatedTarget === applyBtn || relatedTarget === cancelBtn)) {
            return;
        }
        valueInput.classList.remove('active');
        applyBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    });

    applyBtn.addEventListener('click', () => {
        applyEdit(valueInput, cookie);
        valueInput.classList.remove('active');
    });

    cancelBtn.addEventListener('click', () => {
        cancelEdit(valueInput, cookie);
        valueInput.classList.remove('active');
    });

    valueInput.addEventListener('focus', () => {
        valueInput.classList.add('active');
        applyBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
    });

    valueInput.addEventListener('blur', (e) => {
        // Check if the blur event is caused by clicking the buttons
        const relatedTarget = e.relatedTarget;
        if (relatedTarget && (relatedTarget === applyBtn || relatedTarget === cancelBtn)) {
            return;
        }
        valueInput.classList.remove('active');
        applyBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    });

    applyBtn.addEventListener('click', () => {
        applyEdit(valueInput, cookie);
        valueInput.classList.remove('active');
    });

    cancelBtn.addEventListener('click', () => {
        cancelEdit(valueInput, cookie);
        valueInput.classList.remove('active');
    });

    card.appendChild(applyBtn);
    card.appendChild(cancelBtn);

    function applyEdit(input, cookie) {
        const newVal = input.value;
        if (newVal === cookie.value) {
            // Nothing changed
            input.classList.remove('active');
            applyBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            return;
        }

        // Push previous value onto undo stack only if it differs from latest entry
        const stack = undoStacks.get(cookieKey);
        if (stack[0] !== cookie.value) {
            stack.unshift(cookie.value || '');
            if (stack.length > 10) stack.pop();
            setUndoState();
        }

        input.classList.add('pending');
        (async () => {
            try {
                const url = buildCookieUrl(cookie);
                const resp = await sendMsg({
                    type: 'SET_COOKIE',
                    details: {
                        url,
                        name: cookie.name,
                        value: newVal,
                        path: cookie.path || '/',
                        secure: !!cookie.secure,
                        httpOnly: !!cookie.httpOnly,
                        expirationDate: cookie.expirationDate,
                        sameSite: cookie.sameSite
                    }
                });
                if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'set_failed');
                cookie.value = newVal; // Update local snapshot
                card.dataset.cookie = JSON.stringify(cookie);
                input.classList.remove('pending');
                input.classList.remove('dirty');
                input.classList.add('success');
                setTimeout(() => input.classList.remove('success'), 800);
                showToast('Cookie updated');
            } catch (err) {
                input.classList.remove('pending');
                input.classList.add('error');
                showToast(`Update failed: ${err && err.message ? err.message : err}`);
            } finally {
                input.classList.remove('active');
                applyBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
            }
        })();
    }

    function cancelEdit(input, cookie) {
        input.value = cookie.value;
        input.classList.remove('active', 'dirty');
        applyBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    }

    // External change sync
    if (!createCookieCard._onChangedBound) {
        createCookieCard._onChangedBound = true;
        chrome.cookies.onChanged.addListener((changeInfo) => {
            try {
                const c = changeInfo.cookie;
                const key = `${c.name}|${c.domain}|${c.path || '/'}|${c.storeId || ''}`;
                const inputs = document.querySelectorAll('.cookie-card');
                inputs.forEach((node) => {
                    try {
                        const parsed = JSON.parse(node.dataset.cookie);
                        const nodeKey = `${parsed.name}|${parsed.domain}|${parsed.path || '/'}|${parsed.storeId || ''}`;
                        if (nodeKey !== key) return;
                        const inputEl = node.querySelector('.cookie-value-input');
                        if (!inputEl) return;
                        // If there is a pending local set, prefer local and notify
                        if (inputEl.classList.contains('pending')) {
                            showToast('Cookie changed externally while editing');
                            return;
                        }
                        // Update snapshot and input value
                        parsed.value = c.value || '';
                        node.dataset.cookie = JSON.stringify(parsed);
                        inputEl.value = parsed.value;
                    } catch (_) { /* ignore */ }
                });
            } catch (_) { /* ignore */ }
        });
    }

    setUndoState();

    return card;
}

async function handlePermissionClick() {
    const btn = $('#permission-btn');
    const action = btn.dataset.action;
    let origins = btn.dataset.origin.split(',');

    if (!action || !origins || origins.length === 0) return;

    let success = false;
    if (action === 'grant') {
        success = await sendMsg({ type: 'REQUEST_PERMISSION', origins });
    } else if (action === 'revoke') {
        success = await sendMsg({ type: 'REVOKE_PERMISSION', origins });
    }

    if (success) {
        await refresh();
    } else {
        alert('Permission action failed.');
    }
}

async function updatePermissionUI() {
    const btn = $('#permission-btn');
    btn.style.display = 'none'; // Hide by default

    if (state.viewMode === 'site') {
        if (!state.currentBaseDomain) return;

        const isBaseDomain = state.currentHost === state.currentBaseDomain || state.currentHost === `www.${state.currentBaseDomain}`;

        if (isBaseDomain) {
            // Basdomän: godkänn antingen base-only eller wildcard eller global
            const baseOnly = `*://${state.currentBaseDomain}/*`;
            const wildcard = `*://*.${state.currentBaseDomain}/*`;
            const [hasGlobal, hasWildcard, hasBaseOnly] = await Promise.all([
                sendMsg({ type: 'CHECK_PERMISSION', origins: ['<all_urls>'] }),
                sendMsg({ type: 'CHECK_PERMISSION', origins: [wildcard] }),
                sendMsg({ type: 'CHECK_PERMISSION', origins: [baseOnly] })
            ]);

            if (hasGlobal) {
                btn.textContent = 'Revoke Access';
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = '<all_urls>';
            } else if (hasWildcard) {
                btn.textContent = `Revoke Access for *.${state.currentBaseDomain}`;
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = wildcard;
            } else if (hasBaseOnly) {
                btn.textContent = `Revoke Access for ${state.currentBaseDomain}`;
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = baseOnly;
            } else {
                // Föreslå minimal åtkomst: base-only
                btn.textContent = `Grant Access to ${state.currentBaseDomain}`;
                btn.dataset.action = 'grant';
                btn.classList.remove('revoke');
                btn.dataset.origin = baseOnly;
            }
            btn.style.display = 'block';
        } else {
            // Subdomän: minimal åtkomst är host + bas. Revoke ska bara ta bort host, inte bas.
            const hostPattern = `*://${state.currentHost}/*`;
            const basePattern = `*://${state.currentBaseDomain}/*`;
            const wildcard = `*://*.${state.currentBaseDomain}/*`;

            const [hasGlobal, hasWildcard, hasHost, hasBase] = await Promise.all([
                sendMsg({ type: 'CHECK_PERMISSION', origins: ['<all_urls>'] }),
                sendMsg({ type: 'CHECK_PERMISSION', origins: [wildcard] }),
                sendMsg({ type: 'CHECK_PERMISSION', origins: [hostPattern] }),
                sendMsg({ type: 'CHECK_PERMISSION', origins: [basePattern] })
            ]);

            if (hasGlobal) {
                btn.textContent = 'Revoke Global Access';
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = '<all_urls>';
            } else if (hasWildcard) {
                btn.textContent = `Revoke Access for *.${state.currentBaseDomain}`;
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = wildcard;
            } else if (hasHost && hasBase) {
                // Full åtkomst via minsta uppsättning – låt revoke endast ta bort host
                btn.textContent = `Revoke Access for ${state.currentHost}`;
                btn.dataset.action = 'revoke';
                btn.classList.add('revoke');
                btn.dataset.origin = hostPattern;
            } else {
                // Bygg minsta set att begära för full åtkomst
                const missing = [];
                if (!hasHost) missing.push(hostPattern);
                if (!hasBase) missing.push(basePattern);
                const displayName = state.currentHost || state.currentBaseDomain;
                btn.textContent = `Grant Access to ${displayName}`;
                btn.dataset.action = 'grant';
                btn.classList.remove('revoke');
                btn.dataset.origin = missing.join(',');
            }
            btn.style.display = 'block';
        }

    } else { // 'all' view
        const allUrlsPattern = '<all_urls>';
        const hasAllUrlsPerm = await sendMsg({ type: 'CHECK_PERMISSION', origins: [allUrlsPattern] });

        btn.textContent = hasAllUrlsPerm ? 'Revoke Access' : 'Grant Full Access';
        btn.dataset.action = hasAllUrlsPerm ? 'revoke' : 'grant';
        btn.classList.toggle('revoke', hasAllUrlsPerm);
        btn.dataset.origin = allUrlsPattern;
        btn.style.display = 'block';

        $('#all-perms-warning').style.display = hasAllUrlsPerm ? 'none' : 'block';
        // Keep search and bulk delete enabled even without full access so users can work
        // with cookies from already granted sites.
    }
}

async function exportVisibleCookies() {
    const viewMode = state.viewMode;
    const searchTerm = viewMode === 'site' ? state.siteSearchTerm : state.allSearchTerm;
    const cookies = viewMode === 'site' ? state.siteCookies : state.allCookies;

    const filteredCookies = cookies.filter(c =>
        c.name.toLowerCase().includes(searchTerm) ||
        c.domain.toLowerCase().includes(searchTerm)
    );

    if (filteredCookies.length === 0) {
        $('#status').textContent = 'No cookies to export.';
        return;
    }

    downloadJSON(filteredCookies, `cookiecontrol-${viewMode}-${Date.now()}.json`);
    $('#status').textContent = `Exported ${filteredCookies.length} cookies.`;
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
