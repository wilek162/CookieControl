/* global chrome */
import { buildTopLevelSite, getPartitionKey, cookiesGetAllWithPartitionKey } from '../src/utils/cookiePartition.js';

// Jest fake timers for async callbacks
jest.useFakeTimers();

// Minimal mock for chrome APIs used in the utility.
beforeEach(() => {
    global.chrome = {
        cookies: {
            getPartitionKey: jest.fn(),
            getAll: jest.fn((filter, cb) => cb([])),
        },
        tabs: {
            get: jest.fn((id, cb) => cb({ id, url: 'https://sub.example.com/page' })),
        },
        runtime: { lastError: null },
    };
});

afterEach(() => {
    delete global.chrome;
});

describe('buildTopLevelSite', () => {
    it('returns scheme and eTLD+1 for a given URL', () => {
        expect(buildTopLevelSite('https://sub.example.co.uk/path')).toBe('https://example.co.uk');
        expect(buildTopLevelSite('http://foo.bar.example.com')).toBe('http://example.com');
    });
});

describe('getPartitionKey', () => {
    it('uses chrome.cookies.getPartitionKey when available', async () => {
        const pk = { topLevelSite: 'https://example.com' };
        chrome.cookies.getPartitionKey.mockImplementation((frame, cb) => cb(pk));

        const res = await getPartitionKey({ tabId: 1 });
        expect(chrome.cookies.getPartitionKey).toHaveBeenCalledWith({ tabId: 1, frameId: 0 }, expect.any(Function));
        expect(res).toEqual(pk);
    });

    it('falls back to deriving from tab URL when API absent', async () => {
        delete chrome.cookies.getPartitionKey;
        const res = await getPartitionKey({ tabId: 123 });
        expect(chrome.tabs.get).toHaveBeenCalledWith(123, expect.any(Function));
        expect(res).toEqual({ topLevelSite: 'https://example.com' });
    });
});

describe('cookiesGetAllWithPartitionKey', () => {
    it('injects partitionKey when absent', async () => {
        chrome.cookies.getPartitionKey.mockImplementation((frame, cb) => cb({ topLevelSite: 'https://example.com' }));
        const filter = { domain: 'example.com' };
        await cookiesGetAllWithPartitionKey(filter, { tabId: 4 });

        expect(chrome.cookies.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ domain: 'example.com', partitionKey: { topLevelSite: 'https://example.com' } }),
            expect.any(Function)
        );
    });
});
