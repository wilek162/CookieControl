import { getBaseDomain } from '../utils/cookieUtils.js';

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
    state.viewMode = newTab === 'tab-site' ? 'site' : 'all';

    $$('.tab-link').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(t => t.classList.remove('active'));

    e.target.classList.add('active');
    $(`#${newTab}`).classList.add('active');

    refresh(); // Refresh content for the new tab
}

function handleSearch(term, viewMode) {
    if (viewMode === 'site') {
        state.siteSearchTerm = term.toLowerCase();
        renderCookies(state.siteCookies, 'site');
    } else {
        state.allSearchTerm = term.toLowerCase();
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
            if (resp.error === 'permission_denied') {
                state.allCookies = [];
                renderCookies([], 'all');
                $('#status').textContent = 'Permission required to view all cookies.';
            } else if (resp.error) {
                throw new Error(resp.error);
            } else {
                state.allCookies = resp.cookies || [];
                renderCookies(state.allCookies, 'all');
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
                btn.textContent = 'Revoke Global Access';
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
        $('#search-all').disabled = !hasAllUrlsPerm;
        $('#bulk-delete-all').disabled = !hasAllUrlsPerm;
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
