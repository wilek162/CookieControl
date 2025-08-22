# Extensions – Quick Reference Links

- Chrome API Reference: https://developer.chrome.com/docs/extensions/reference/api
- Chrome Permissions List: https://developer.chrome.com/docs/extensions/reference/permissions-list
- Chrome Manifest Documentation: https://developer.chrome.com/docs/extensions/reference/manifest
- Chrome MV3 Development Guide: https://developer.chrome.com/docs/extensions/mv3/devguide/

- MDN permissions API: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions
- MDN permissions.request(): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request
- MDN optional_host_permissions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_host_permissions
- Firefox Extension Workshop – Request the right permissions: https://extensionworkshop.com/documentation/develop/request-the-right-permissions/

Notes:
- Prefer Promise-based APIs when available (Chrome 95+, Firefox supports `browser.*` Promises).
- Most features require declaring install-time or optional host permissions. Request optional host permissions contextually with a clear user gesture (Options page banner on Firefox).