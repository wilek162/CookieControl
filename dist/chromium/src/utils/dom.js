// Shared DOM helper utilities across extension pages
// Using a dedicated module avoids re-declaring helper functions in every script
// and provides a single place to extend functionality (e.g. scoped querying).

export function $(sel) { return document.querySelector(sel); }
export function $$(sel) { return document.querySelectorAll(sel); }
