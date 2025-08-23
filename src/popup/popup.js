import { getBaseDomain, isTrackingCookie } from '../utils/cookieUtils.js';
import { createStore } from '../utils/state.js';
import { $, $$ } from '../utils/dom.js';
import { sendMsg, permissionsRequest, permissionsRemove, storageSet } from '../utils/chrome.js';
import { applyStoredTheme, exposeThemeAPI } from '../utils/theme.js';
import { buildPermissionButtonConfig } from '../utils/permissionsUi.js';


/* escape HTML */
function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>'"\/]/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
        '/': '&#x2F;'
    }[c]));
}

function isFirefox() {
    try { return /firefox/i.test(navigator.userAgent); } catch (_) { return false; }
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

// Theme API exposure for consistency with existing code paths
exposeThemeAPI();

document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Apply theme override (if any) before rendering UI
    applyStoredTheme();

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
    // Delete all for current site (base domain)
    $('#delete-domain-site').addEventListener('click', handleDeleteAllForSite);

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
    const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
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
    const selectedCookieCbs = $$(`${containerId} .cookie-checkbox:checked`);
    const selectedDomainCbs = $$(`${containerId} .domain-checkbox:checked`);

    if (selectedCookieCbs.length === 0 && selectedDomainCbs.length === 0) {
        $('#status').textContent = 'Nothing selected.';
        return;
    }

    // Collect individual cookies
    let cookiesToDelete = Array.from(selectedCookieCbs).map(cb => {
        const card = cb.closest('.cookie-card');
        return JSON.parse(card.dataset.cookie);
    });

    // Collect selected domains (base domains stored on the details element)
    const selectedDomains = Array.from(new Set(Array.from(selectedDomainCbs).map(cb => {
        const details = cb.closest('.domain-group');
        return details ? details.dataset.domain : null;
    }).filter(Boolean)));

    // Exclude cookies that belong to selected domains to avoid double work
    if (selectedDomains.length) {
        const selectedDomainSet = new Set(selectedDomains);
        cookiesToDelete = cookiesToDelete.filter(c => !selectedDomainSet.has(getBaseDomain(c.domain)));
    }

    const parts = [];
    if (cookiesToDelete.length) parts.push(`${cookiesToDelete.length} selected cookie${cookiesToDelete.length > 1 ? 's' : ''}`);
    if (selectedDomains.length) parts.push(`ALL cookies for ${selectedDomains.length} domain${selectedDomains.length > 1 ? 's' : ''}`);
    const msg = `Delete ${parts.join(' and ')}?`;
    if (!confirm(msg)) return;

    let totalDeleted = 0;
    // Process domain deletions first (with permission checks inside)
    for (const d of selectedDomains) {
        const res = await deleteAllForDomain(d, { skipConfirm: true, silent: true, noRefresh: true });
        if (res && res.ok) totalDeleted += (res.removed || 0);
    }

    // Then process individual cookie deletions
    if (cookiesToDelete.length) {
        const result = await sendMsg({ type: 'DELETE_COOKIES_BULK', cookies: cookiesToDelete });
        if (result && result.ok) {
            totalDeleted += (result.deletedCount || 0);
        } else {
            $('#status').textContent = 'Error deleting selected cookies.';
            await refresh();
            return;
        }
    }

    const domainNote = selectedDomains.length ? ` across ${selectedDomains.length} domain${selectedDomains.length > 1 ? 's' : ''}` : '';
    $('#status').textContent = `Deleted ${totalDeleted} cookies${domainNote}.`;
    await refresh();
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
                if (resp.msg === 'unsupported_tab') {
                    $('#site-warning').textContent = 'Unsupported tab (non-http/https). Navigate to a website to manage cookies.';
                } else {
                    $('#site-warning').textContent = 'Limited view: httpOnly cookies not shown. Grant permission for full access.';
                }
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
    details.dataset.domain = domain;

    const summary = document.createElement('summary');
    summary.className = 'domain-group-header';
    const trackingCount = cookies.reduce((acc,c)=> acc + (isTrackingCookie(c)?1:0),0);
    summary.innerHTML = `
        <span class="domain-name">${escapeHtml(domain)}</span>
        ${trackingCount > 0 ? `<span class="tracking-summary">${trackingCount} tracking cookie${trackingCount > 1 ? 's' : ''} found</span>` : ''}
        <span class="cookie-count">(${cookies.length} cookies)</span>
    `;
    // Add domain-level selection checkbox (with larger hit area)
    const domainCheckbox = document.createElement('input');
    domainCheckbox.type = 'checkbox';
    domainCheckbox.className = 'domain-checkbox';
    const domainHit = document.createElement('span');
    domainHit.className = 'checkbox-hit';
    domainHit.appendChild(domainCheckbox);
    domainHit.addEventListener('click', (e) => {
        // Toggle checkbox when clicking near it and prevent summary toggling
        e.stopPropagation();
        if (e.target !== domainCheckbox) {
            domainCheckbox.checked = !domainCheckbox.checked;
            domainCheckbox.dispatchEvent(new Event('change', { bubbles: false }));
        }
    });
    domainCheckbox.addEventListener('click', (e) => e.stopPropagation());
    domainCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const checked = domainCheckbox.checked;
        const cards = details.querySelectorAll('.cookie-checkbox');
        cards.forEach(cb => { cb.checked = checked; cb.dispatchEvent(new Event('change', { bubbles: false })); });
    });
    summary.prepend(domainHit);
    // Add per-domain delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm delete-domain-btn';
    deleteBtn.textContent = 'Delete All';
    deleteBtn.title = `Delete all cookies for ${domain}`;
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent toggling the details element
        await deleteAllForDomain(domain);
    });
    summary.appendChild(deleteBtn);
    details.appendChild(summary);

    const cookieList = document.createElement('div');
    cookieList.className = 'cookie-list-inner';
    cookies.forEach(cookie => {
        const card = createCookieCard(cookie);
        // Attach listener to update domain checkbox state when any child changes
        const cb = card.querySelector('.cookie-checkbox');
        if (cb) {
            cb.addEventListener('change', (e) => {
                const all = details.querySelectorAll('.cookie-checkbox');
                const checked = details.querySelectorAll('.cookie-checkbox:checked');
                domainCheckbox.indeterminate = checked.length > 0 && checked.length < all.length;
                domainCheckbox.checked = checked.length === all.length && all.length > 0;
            });
        }
        cookieList.appendChild(card);
    });
    details.appendChild(cookieList);

    // Initialize domain checkbox state
    setTimeout(() => {
        const all = details.querySelectorAll('.cookie-checkbox');
        const checked = details.querySelectorAll('.cookie-checkbox:checked');
        domainCheckbox.indeterminate = checked.length > 0 && checked.length < all.length;
        domainCheckbox.checked = checked.length === all.length && all.length > 0;
    }, 0);

    return details;
}

function createCookieCard(cookie) {
    const isTracker = isTrackingCookie(cookie);
    const card = document.createElement('div');
    card.className = 'cookie-card';
    card.dataset.cookie = JSON.stringify(cookie); // Store full cookie data

    const expires = cookie.session ? 'Session' : new Date(cookie.expirationDate * 1000).toLocaleString();

    card.innerHTML = `
    <div class="cookie-card-header">
        <span class="checkbox-hit"><input type="checkbox" class="cookie-checkbox"></span>
        <span class="cookie-name">${escapeHtml(cookie.name)}</span>
        <div class="cookie-flags">
            ${isTracker ? '<span class="cookie-flag tracking">Tracking</span>' : ''}
            ${cookie.httpOnly ? '<span class="cookie-flag">HttpOnly</span>' : ''}
            ${cookie.secure ? '<span class="cookie-flag">Secure</span>' : ''}
            ${cookie.sameSite ? `<span class="cookie-flag">${escapeHtml(cookie.sameSite)}</span>` : ''}
        </div>
        <button class="delete-btn" aria-label="Delete cookie">×</button>
    </div>
    <div class="cookie-details">
        <span>${escapeHtml(cookie.domain)}</span>
        <span>Path: ${escapeHtml(cookie.path || '/')}</span>
        <span>Expires: ${escapeHtml(expires)}</span>
    </div>
    <div class="cookie-editor">
        <input type="text" class="cookie-value-input" placeholder="Value" aria-label="Cookie value">
        <button class="undo-btn" title="Undo" disabled>
            <span>↺</span>
            <span class="undo-badge" style="display:none">0</span>
        </button>
    </div>
    `;

    // Expand checkbox click target within cookie cards
    const cookieHit = card.querySelector('.checkbox-hit');
    const cookieCb = card.querySelector('.cookie-checkbox');
    if (cookieHit && cookieCb) {
        cookieHit.addEventListener('click', (e) => {
            if (e.target !== cookieCb) {
                cookieCb.checked = !cookieCb.checked;
                cookieCb.dispatchEvent(new Event('change', { bubbles: false }));
            }
        });
    }

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

async function deleteAllForDomain(baseDomain, opts = {}) {
    const { skipConfirm = false, silent = false, noRefresh = false } = opts;
    if (!baseDomain) {
        alert('No domain detected.');
        return;
    }
    const confirmMsg = `Permanently delete ALL cookies for ${baseDomain} (including subdomains)?\nThis cannot be undone.`;
    if (!skipConfirm) {
        if (!confirm(confirmMsg)) return { ok: false, canceled: true };
    }

    const wildcard = baseDomain.includes('.') ? `*://*.${baseDomain}/*` : `*://${baseDomain}/*`;
    // Check permission for wildcard; if missing, request it
    let hasPerm = await sendMsg({ type: 'CHECK_PERMISSION', origins: [wildcard] });
    if (!hasPerm) {
        if (isFirefox()) {
            try { await storageSet({ 'cookiecontrol:pending-origins': [wildcard] }); } catch (_) { /* ignore */ }
            try {
                if (chrome.runtime.openOptionsPage) {
                    chrome.runtime.openOptionsPage();
                } else {
                    const url = chrome.runtime.getURL('src/options/options.html');
                    chrome.tabs.create({ url });
                }
            } catch (_) {
                const url = chrome.runtime.getURL('src/options/options.html');
                try { chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
            }
            window.close();
            return { ok: false, error: 'permission_request_redirect' };
        }
        const granted = await permissionsRequest({ origins: [wildcard] });
        if (!granted) {
            alert('Permission was not granted. Cannot delete cookies for this domain.');
            return { ok: false, error: 'permission_denied' };
        }
    }

    if (!silent) $('#status').textContent = 'Deleting cookies...';
    const resp = await sendMsg({ type: 'DELETE_ALL_FOR_SITE', domain: baseDomain });
    if (resp && resp.result) {
        const { removed, total } = resp.result;
        if (!silent) $('#status').textContent = `Deleted ${removed} of ${total} cookies for ${baseDomain}.`;
        if (!noRefresh) await refresh();
        return { ok: true, removed, total };
    } else {
        if (!silent) $('#status').textContent = 'Delete failed.';
        if (resp && resp.error === 'permission_denied') alert('Missing permission. Please grant access and try again.');
        return { ok: false, error: resp && resp.error };
    }
}

async function handleDeleteAllForSite() {
    const base = state.currentBaseDomain;
    await deleteAllForDomain(base);
}

async function handlePermissionClick() {
    const btn = $('#permission-btn');
    const action = btn.dataset.action;
    let origins = btn.dataset.origin.split(',');

    if (!action || !origins || origins.length === 0) return;

    let success = false;
    if (action === 'grant') {
        // In Firefox, requesting from the browserAction popup may not surface the doorhanger reliably.
        // Open the Options page (top-level extension page) to trigger the prompt with an explicit user gesture.
        if (isFirefox()) {
            try { await storageSet({ 'cookiecontrol:pending-origins': origins }); } catch (_) { /* ignore */ }
            try {
                if (chrome.runtime.openOptionsPage) {
                    chrome.runtime.openOptionsPage();
                } else {
                    const url = chrome.runtime.getURL('src/options/options.html');
                    chrome.tabs.create({ url });
                }
            } catch (_) {
                const url = chrome.runtime.getURL('src/options/options.html');
                try { chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
            }
            // Close the popup so the doorhanger isn't hidden behind it
            window.close();
            return;
        }
        // Try batch first
        success = await permissionsRequest({ origins });
        // If batch fails and there are multiple entries, try sequentially per-origin
        if (!success && origins.length > 1) {
            for (const o of origins) {
                const ok = await permissionsRequest({ origins: [o] });
                if (ok) success = true;
            }
        }
    } else if (action === 'revoke') {
        success = await permissionsRemove({ origins });
    }

    if (success) {
        await refresh();
    } else {
        alert('Permission action failed.');
    }
}

async function updatePermissionUI() {
    const btn = $('#permission-btn');
    btn.style.display = 'none';

    const cfg = await buildPermissionButtonConfig(
        state.viewMode === 'all' ? 'all' : 'site',
        state.currentHost,
        state.currentBaseDomain
    );

    if (!cfg || !cfg.visible) {
        if (state.viewMode === 'all') {
            $('#all-perms-warning').style.display = 'block';
        }
        return;
    }

    btn.textContent = cfg.text;
    btn.dataset.action = cfg.action;
    btn.classList.toggle('revoke', !!cfg.revokeClass);
    btn.dataset.origin = (cfg.origins || []).join(',');
    btn.style.display = 'block';

    if (state.viewMode === 'all') {
        $('#all-perms-warning').style.display = cfg.allPermsWarning ? 'block' : 'none';
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
