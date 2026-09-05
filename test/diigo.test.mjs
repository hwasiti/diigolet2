import test from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../src/bookmarklet/md5.js';
import { annotationId, urlIdFor, payloads, jsonpUrl } from '../src/bookmarklet/diigo.js';

const URL_ID = '725bd63628260ff18b3a70a4f8861b9d'; // server urlId of the HubSpot test page

test('reproduces a real Diigo highlight id containing an em dash', () => {
  const content = 'Claude Design is an AI tool from Anthropic Labs that turns natural language prompts into polished visual work—prototypes';
  assert.equal(annotationId(md5, content, 'hayder78', URL_ID, 1), 'e98c64402c75bcbaf1bba6c5ab91120d');
});

test('reproduces an ASCII highlight id created through the API', () => {
  const content = 'Claude can audit for readability, visual hierarchy, contrast ratios, and accessibility.';
  assert.equal(annotationId(md5, content, 'hayder78', URL_ID, 1), 'a128c4f6a0a612f66513bc75ba8b1dac');
});

test('urlId matches the server for a path URL and a bare origin', () => {
  assert.equal(urlIdFor(md5, 'https://offers.hubspot.com/view/claude-design-use-cases-futurepedia'), URL_ID);
  assert.equal(urlIdFor(md5, 'https://example.com/'), 'c984d06aafbecf6bc55569f964148ea3');
});

test('payloads carry the fields Diigo expects', () => {
  const a = { id: 'x', content: 'hello world', extra: { nth: 2, color: 'blue', top: 1, left: 2 } };
  assert.deepEqual(payloads.load('u'), { url: 'u', what: 'bookmarkInfo annotations pageComments' });
  assert.deepEqual(payloads.add('uid', a), { urlId: 'uid', id: 'x', content: 'hello world', type: 0, extra: a.extra, groups: [] });
  assert.deepEqual(payloads.del('uid', 'x'), { urlId: 'uid', id: 'x' });
  const s = payloads.saveWith('u', 'T', a);
  assert.equal(s.mode, 2);
  assert.deepEqual(s.annotation, { id: 'x', content: 'hello world', type: 0, extra: a.extra });
});

test('JSONP URL shape', () => {
  const u = new URL(jsonpUrl('bm_loadBookmark', { url: 'https://e.com/a' }, 'me', 7));
  assert.equal(u.origin, 'https://www.diigo.com');
  assert.equal(u.pathname, '/chappai/pv=13/ct=let/cv=5.0b7/user=me/cmd=bm_loadBookmark/');
  assert.equal(u.searchParams.get('cmd'), 'bm_loadBookmark');
  assert.equal(u.searchParams.get('v'), '13');
  assert.equal(u.searchParams.get('transId'), '7');
  assert.deepEqual(JSON.parse(u.searchParams.get('json')), { url: 'https://e.com/a' });
});
