# Critical & Severe Code Smells

- Global mutable `state` inside `src/popup/popup.js`
  - Impact: Hard to trace updates, tight coupling between UI and data, brittle tests.

- UI logic and imperative DOM manipulation tightly coupled with data fetching and permissions (`popup.js`)
  - Impact: Violates separation of concerns; hard to reuse and reason about; error handling dispersed.

- Repeated wrappers for `chrome.*` APIs across files (e.g., `sendMsg`, `tabsQuery`, storage wrappers)
  - Impact: Duplication; inconsistent error handling; scattered abstractions.

- Inconsistent permission checks (mix of `<all_urls>` and per-origin logic across popup/background)
  - Impact: Confusing UX; potential over-permissioning or unexpected denials.

- Background RPC switch is monolithic and mixes orchestration with domain logic
  - Impact: Hard to unit test; high cognitive load to modify; prone to regression.

- Weak input validation in import flow (`importCookies` minimal checks; accepts partial cookies)
  - Impact: Silent failures; inconsistent cookie states; unclear user feedback.

- Error handling mostly via `console.error` and user `alert()`
  - Impact: Non-actionable logs in production; poor UX; no structured error taxonomy.

- Time computations for cookie expiration assume `expirationDate` always present
  - Impact: NaN/Invalid dates when missing; inconsistent rendering.

- Lack of centralized state/event system for popup view modes and filters
  - Impact: Re-renders scattered; event listeners directly mutate DOM and state.

- Mixed naming and minor i18n issues (e.g., Swedish comments in `popup.js`)
  - Impact: Maintainability/readability; localization readiness. 