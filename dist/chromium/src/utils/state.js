export async function createStore(name, defaultState = {}, options = {}) {
	const storageKeyPrefix = options.storageKeyPrefix || 'cookiecontrol:ui:';
	const KEY = `${storageKeyPrefix}${name}`;

	const storageArea = chrome.storage?.session || chrome.storage.local; // fallback for older browsers

	let state = { ...defaultState };
	const subscribers = new Set();

	// Load existing state from storage (session)
	const stored = await new Promise((resolve) => storageArea.get([KEY], (res) => resolve(res)));
	if (stored && stored[KEY]) {
		state = { ...state, ...stored[KEY] };
	}

	function get() {
		return { ...state };
	}

	function notify() {
		subscribers.forEach((cb) => {
			try { cb(get()); } catch (e) { /* no-op */ }
		});
	}

	async function persist() {
		return new Promise((resolve) => storageArea.set({ [KEY]: state }, () => resolve()));
	}

	function set(partialOrUpdater) {
		const nextPatch = typeof partialOrUpdater === 'function' ? partialOrUpdater(get()) : (partialOrUpdater || {});
		const nextState = { ...state, ...nextPatch };
		const changed = JSON.stringify(nextState) !== JSON.stringify(state);
		if (!changed) return;
		state = nextState;
		void persist();
		notify();
	}

	function subscribe(cb) {
		subscribers.add(cb);
		try { cb(get()); } catch (e) { /* ignore */ }
		return () => subscribers.delete(cb);
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		const expectedArea = storageArea === chrome.storage.session ? 'session' : 'local';
		if (area !== expectedArea) return;
		if (!changes[KEY]) return;
		const newValue = changes[KEY].newValue || {};
		state = { ...defaultState, ...newValue };
		notify();
	});

	return { get, set, subscribe, key: KEY };
} 