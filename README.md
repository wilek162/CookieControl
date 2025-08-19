# CookieControl — Privacy-first Cookie Manager (Chrome MV3)

A lightweight, privacy-first Chrome extension to view, edit, delete, import/export and bulk-manage cookies.

## Highlights

- MV3 service worker background.
- Permission-on-demand by default, optional global host access.
- Local-only: no network requests or telemetry.
- Export/import cookies to/from JSON.
- Lightweight popup for active-tab quick access, full options page for advanced actions and logs.

## Quick install (developer)

1. Clone or copy repository to a folder.
2. In Chrome, open `chrome://extensions/`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and choose the project root folder.

## File structure

cookie-control/
├── manifest.json
├── README.md
├── package.json
└── src/
├── background.js
├── utils/cookieUtils.js
├── popup/
│ ├── popup.html
│ ├── popup.css
│ └── popup.js
└── options/
├── options.html
├── options.css
└── options.js

## Security & privacy design choices

- Minimal host permissions at install: we request origins only when needed.
- All processing is local in the extension (no external servers).
- Clear UI to revoke permissions and clear logs/backups.
- No telemetry, off by default.

## Further work / roadmap

- Add `cookies.txt` (Netscape) import/export support.
- Add cookie purpose heuristics and common tracker lists.
- Add automation rules (Phase 2).
- Add unit & integration tests (Puppeteer).
- Add nicer UI (React + Tailwind) while keeping service worker untouched.

## References

Follow Chrome extension docs for MV3 & the cookies API: <https://developer.chrome.com/docs/extensions/>
