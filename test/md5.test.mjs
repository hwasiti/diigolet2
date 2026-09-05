import test from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../src/bookmarklet/md5.js';

test('RFC 1321 vectors', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'), '57edf4a22be3c955ac49da2e2107b67a');
});

test('block boundaries (55, 56, 64 bytes)', () => {
  assert.equal(md5('a'.repeat(55)), 'ef1772b6dff9a122358552954ad0df65');
  assert.equal(md5('a'.repeat(56)), '3b0c8ac703f828b04c6c197006d17218');
  assert.equal(md5('a'.repeat(64)), '014842d480b571495a4a0363793f7367');
});

test('non-ASCII uses the low byte of each code unit, like Diigo', () => {
  assert.equal(md5('—'), '15f41a2e96bae341dde485bb0e78f485');
});
