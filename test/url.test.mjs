import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl } from '../src/bookmarklet/url.js';

test('strips tracking parameters and the fragment, keeps the rest verbatim', () => {
  assert.equal(
    canonicalUrl('https://offers.hubspot.com/view/claude?hubs_signup-url=x&hubs_signup-cta=submit#'),
    'https://offers.hubspot.com/view/claude',
  );
  assert.equal(canonicalUrl('https://a.com/p?utm_source=x&id=5&utm_medium=y'), 'https://a.com/p?id=5');
  assert.equal(canonicalUrl('https://a.com/p?q=a%20b&fbclid=1'), 'https://a.com/p?q=a%20b');
  assert.equal(canonicalUrl('https://www.youtube.com/watch?v=abc&si=xyz'), 'https://www.youtube.com/watch?v=abc');
});

test('leaves URLs without junk untouched, including a bare origin', () => {
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/');
  assert.equal(canonicalUrl('https://a.com:8443/x/y?z=1'), 'https://a.com:8443/x/y?z=1');
});

test('non-http URLs pass through', () => {
  assert.equal(canonicalUrl('file:///C:/doc.html'), 'file:///C:/doc.html');
  assert.equal(canonicalUrl('not a url'), 'not a url');
});
