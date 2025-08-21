import { getBaseDomain } from '../src/utils/cookieUtils.js';

function expectEqual(a, b, msg) {
  if (a !== b) {
    throw new Error(`Assertion failed: ${msg}\nExpected: ${b}\nActual:   ${a}`);
  }
}

// Basic domains
expectEqual(getBaseDomain('example.com'), 'example.com', 'simple .com base');
expectEqual(getBaseDomain('sub.example.com'), 'example.com', 'subdomain .com base');

// Leading dot handling
expectEqual(getBaseDomain('.example.com'), 'example.com', 'leading dot removed');

// UK multi-part suffixes
expectEqual(getBaseDomain('service.gov.uk'), 'service.gov.uk', 'already base for gov.uk stays');
expectEqual(getBaseDomain('sub.service.gov.uk'), 'service.gov.uk', 'gov.uk three-label base');
expectEqual(getBaseDomain('www.example.co.uk'), 'example.co.uk', 'co.uk base domain');

// AU multi-part suffixes
expectEqual(getBaseDomain('www.example.com.au'), 'example.com.au', 'com.au base');
expectEqual(getBaseDomain('a.b.c.example.com.au'), 'example.com.au', 'deep subdomains com.au');

// JP multi-part suffixes
expectEqual(getBaseDomain('foo.co.jp'), 'foo.co.jp', 'already base for co.jp stays');
expectEqual(getBaseDomain('bar.foo.co.jp'), 'foo.co.jp', 'co.jp base');

// BR/CN
expectEqual(getBaseDomain('news.com.br'), 'news.com.br', 'com.br base');
expectEqual(getBaseDomain('sub.news.com.br'), 'news.com.br', 'com.br base deep');
expectEqual(getBaseDomain('foo.com.cn'), 'foo.com.cn', 'com.cn base');

console.log('cookieUtils getBaseDomain tests passed');
