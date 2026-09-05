import test from 'node:test';
import assert from 'node:assert/strict';
import { userFromCookieValue, isLoginCookieChange, isDiigoPage, isHighlightablePage } from '../src/lib/auth.js';

test('username is the second -.- field of the login cookie', () => {
  assert.equal(userFromCookieValue('ab-.-hayder78-.-cd-.-e'), 'hayder78');
  assert.equal(userFromCookieValue('abc-.-hayder78'), 'hayder78');
  assert.equal(userFromCookieValue('abc-.-h%40x-.-1'), 'h@x');
  assert.equal(userFromCookieValue('justonefield'), null);
  assert.equal(userFromCookieValue(''), null);
  assert.equal(userFromCookieValue(undefined), null);
  assert.equal(userFromCookieValue('a-.- -.-b'), null);
});

test('login cookie changes are recognised on any diigo.com domain form', () => {
  assert.ok(isLoginCookieChange({ cookie: { name: 'diigoandlogincookie', domain: '.diigo.com' } }));
  assert.ok(isLoginCookieChange({ cookie: { name: 'diigoandlogincookie', domain: 'www.diigo.com' } }));
  assert.ok(!isLoginCookieChange({ cookie: { name: '_ga', domain: '.diigo.com' } }));
  assert.ok(!isLoginCookieChange({ cookie: { name: 'diigoandlogincookie', domain: 'evil.com' } }));
  assert.ok(!isLoginCookieChange(null));
});

test('page classification', () => {
  assert.ok(isDiigoPage('https://www.diigo.com/user/x'));
  assert.ok(isDiigoPage('https://groups.diigo.com/'));
  assert.ok(!isDiigoPage('https://notdiigo.com/'));
  assert.ok(isHighlightablePage('https://example.org/a'));
  assert.ok(!isHighlightablePage('https://www.diigo.com/'));
  assert.ok(!isHighlightablePage('chrome://extensions'));
  assert.ok(!isHighlightablePage('https://chromewebstore.google.com/detail/x'));
  assert.ok(!isHighlightablePage(undefined));
});
