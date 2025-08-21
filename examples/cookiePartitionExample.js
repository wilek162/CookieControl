// Example usage of the cookie partition utilities.
// Run this in the background / service worker context of your extension.

import { cookiesGetAllWithPartitionKey } from '../src/utils/cookiePartition.js';

(async () => {
  // Query cookies for the active tab and main frame.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const cookies = await cookiesGetAllWithPartitionKey({ domain: 'example.com' }, { tabId: activeTab.id });
  console.log('Cookies including partitioned ones:', cookies);
})();
