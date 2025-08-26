# Refactor Plan – Predictable State, Separation of Concerns, Deduplication

Goals:
- Predictable, testable state management for popup/options.
- Separate UI rendering, state transitions, and background RPC/API.
- Consolidate repetitive helpers into parameterized utilities.
- Preserve current features/behavior.

## Architecture

- `/src/state/` – state containers and reducers
  - `popupState.js`: holds popup view state (mode, host, filters, cookie lists)
  - `optionsState.js`: holds options view state (grants, log summaries)
  - Simple reducer-style pure functions: `(state, action) => nextState`

- `/src/api/` – background RPC client and chrome.* wrappers
  - `rpc.js`: `send(messageType, payload)` + typed helpers (e.g., `getActiveTabCookies()`)
  - `chromeWrappers.js`: promise-wrapped `tabs.query`, `permissions.contains/request/remove`, `storage.local` helpers

- `/src/ui/` – rendering and event wiring
  - `popupView.js`: DOM renderers for lists, groups, and controls; receives props only
  - `optionsView.js`: renders granted origins, global status, and log
  - `events.js`: attaches listeners and dispatches actions to state

- `/src/domain/` – cookie domain logic (pure)
  - `cookies.js`: grouping, formatting, base-domain logic (wraps `getBaseDomain`), import validation

## State Pattern

- Single source of truth per surface (popup/options) with immutable updates
- Action creators: small set (e.g., `setViewMode`, `setSearchTerm(scope, term)`, `setCookies(scope, list)`, `setPermissionStatus`) 
- Derived state helpers: `getFilteredCookies(state)` to keep rendering simple

## API Consolidation

- Replace ad-hoc `sendMsg`, `tabsQuery` duplicates with `api/rpc.js` and `api/chromeWrappers.js`
- Parameterize permission checks: `checkOrigins(origins: string[])`, `requestOrigins(origins: string[])`
- Cookie operations unified: `getAll`, `getForActive`, `deleteOne`, `deleteMany`, `exportAll`, `importMany`

## Background Structure (no behavior change)

- Keep listener switch but delegate to functions in `domain/cookies.js` and `api/permissions.js`
- Extract storage/permissions wrappers to `api/chromeWrappers.js`

## Deduplication Targets

- `sendMsg` (popup/options) -> `api/rpc.send`
- `tabsQuery` (popup) -> `api/chromeWrappers.tabs.query`
- Export/download routines -> `ui/download.js` with `downloadJSON(name, data)`
- Permission UI checks -> `domain/permissions.uiModel(currentHost, baseDomain, has)` returning button model

## Migration Plan

1) Introduce new modules alongside current files (no rewrites yet)
2) Gradually route popup calls to `api/rpc.js` and use state reducer for view state
3) Move cookie grouping/formatting to `domain/cookies.js`; update renderers to consume
4) Extract download/permission model helpers; update call sites
5) Once stable, split `popup.js` into `state`, `ui`, and `events` files
6) Repeat similarly for options page

## Testing & Safety

- Add unit tests for reducers and domain helpers (pure functions)
- Smoke-test flows: site view, all view, permission grant/revoke, bulk delete, import/export
- Monitor runtime errors via console; keep logs as-is until a later telemetry phase

## Non-Goals (now)

- No visual redesign
- No permission policy changes
- No background logic changes beyond function extraction 