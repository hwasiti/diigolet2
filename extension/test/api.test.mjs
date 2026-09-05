import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, apiUrl, parseReply, DiigoError } from '../src/lib/api.js';

const fakeFetch = (impl) => async (url, init) => impl(url, init);
const okResponse = (body, { ok = true, status = 200 } = {}) => ({ ok, status, text: async () => body });

test('request shape: toolbar dialect POST to www.diigo.com with the form fields Diigo expects', async () => {
  let seen;
  const c = createClient({ clientVersion: '2.0.0', fetchImpl: fakeFetch((url, init) => { seen = { url, init }; return okResponse('{"code":1,"user":"me","result":{"saved":false}}'); }) });
  const r = await c.load('https://e.com/a', 'me');
  assert.equal(r.code, 1);
  const u = new URL(seen.url);
  assert.equal(u.origin, 'https://www.diigo.com');
  assert.equal(u.pathname, '/chappai/pv=13/ct=tb/cv=2.0.0/user=me/cmd=bm_loadBookmark/');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.credentials, 'include');
  const body = seen.init.body;
  assert.equal(body.get('cmd'), 'bm_loadBookmark');
  assert.equal(body.get('v'), '13');
  assert.equal(body.get('user'), 'me');
  assert.equal(body.get('transId'), '1');
  assert.deepEqual(JSON.parse(body.get('json')), { url: 'https://e.com/a', what: 'bookmarkInfo annotations pageComments' });
});

test('an empty user is sent as an empty field (first call before the username is known)', async () => {
  let seen;
  const c = createClient({ fetchImpl: fakeFetch((url, init) => { seen = { url, init }; return okResponse('{"code":1,"user":null}'); }) });
  await c.load('https://e.com/', null);
  assert.ok(seen.url.includes('/user=/'));
  assert.equal(seen.init.body.get('user'), '');
});

test('JSONP-wrapped and plain replies both parse', () => {
  assert.deepEqual(parseReply('diigolet.callback({"code":1})'), { code: 1 });
  assert.deepEqual(parseReply(' {"code":0} '), { code: 0 });
  assert.deepEqual(parseReply('cb({"a":"x)y"});'), { a: 'x)y' });
});

test('HTML error pages, HTTP errors, network failures and timeouts become DiigoError kinds', async () => {
  const kind = async (impl, opts) => {
    try { await createClient({ fetchImpl: fakeFetch(impl), ...opts }).load('u', 'me'); } catch (e) { assert.ok(e instanceof DiigoError); return e.kind; }
    return 'no error';
  };
  assert.equal(await kind(() => okResponse('<html>sign in</html>')), 'badjson');
  assert.equal(await kind(() => okResponse('', { ok: false, status: 502 })), 'http');
  assert.equal(await kind(() => { throw new TypeError('Failed to fetch'); }), 'network');
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal(await kind(hang, { timeoutMs: 20 }), 'timeout');
});

test('apiUrl encodes the user and command', () => {
  assert.equal(apiUrl('annotation_add', 'a b', '1.0'), 'https://www.diigo.com/chappai/pv=13/ct=tb/cv=1.0/user=a%20b/cmd=annotation_add/');
});
