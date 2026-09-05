import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFor, nthFor, locate } from '../src/helper/anchor.js';

test('content collapses whitespace and escapes HTML', () => {
  assert.equal(contentFor('  a <b>\n  &  c  '), 'a &lt;b&gt; &amp; c');
});

test('nth counts occurrences in the prefix up to the end node', () => {
  const T = 'thecatsatthecatranthecatslept';
  assert.equal(nthFor('thecat', T, 6), 1);
  assert.equal(nthFor('thecat', T, 15), 2);
  assert.equal(nthFor('thecat', T, T.length), 3);
  assert.equal(nthFor('missing', T, T.length), 1, 'unfound text falls back to 1');
});

test('locate finds the nth occurrence and returns inclusive offsets', () => {
  const T = 'thecatsatthecatranthecatslept';
  assert.deepEqual(locate('the cat', T, 1), { s: 0, e: 5 });
  assert.deepEqual(locate('the cat', T, 2), { s: 9, e: 14 });
  assert.deepEqual(locate('the &amp; cat', 'xthe&caty'), { s: 1, e: 7 });
  assert.equal(locate('the cat', T, 4), null);
  assert.equal(locate('', T), null);
});
