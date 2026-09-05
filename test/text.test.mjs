import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromNodes, occurrences, computeNth, seek, realOffset, stripWs, escapeHtml } from '../src/bookmarklet/text.js';

const tn = (s) => ({ nodeType: 3, nodeValue: s });
const nodes = [tn('Hello world, '), tn('  '), tn('this is a test. '), tn('Hello world again.')];
const snap = snapshotFromNodes(nodes);

test('snapshot strips whitespace and skips blank nodes', () => {
  assert.equal(snap.docTxt, 'Helloworld,thisisatest.Helloworldagain.');
  assert.deepEqual(snap.list.map((e) => [e.offset, e.len]), [[0, 11], [11, 12], [23, 16]]);
});

test('occurrence scan preserves the one-character overlap quirk', () => {
  assert.equal(occurrences('aa', 'aaa').n, 2);
  assert.equal(occurrences('Helloworld', snap.docTxt).n, 2);
  assert.deepEqual(occurrences('Helloworld', snap.docTxt, 2), { n: 2, start: 23, end: 32 });
});

test('nth counts occurrences up to and including the end node', () => {
  assert.equal(computeNth(snap, 'Helloworld', nodes[3]), 2);
  assert.equal(computeNth(snap, 'Helloworld', nodes[0]), 1);
  assert.equal(computeNth(snap, 'isatest', nodes[2]), 1);
});

test('realOffset maps stripped indexes back through whitespace', () => {
  assert.equal(realOffset('this is a test. ', 4, false), 5);
  assert.equal(realOffset('this is a test. ', 10, true), 14);
});

test('seek finds boundaries inside one node', () => {
  const pos = seek(snap, 'isatest', 1);
  assert.equal(pos.startNode, nodes[2]);
  assert.equal(pos.startOffset, 5);
  assert.equal(pos.endNode, nodes[2]);
  assert.equal(pos.endOffset, 14);
  assert.equal(nodes[2].nodeValue.slice(pos.startOffset, pos.endOffset), 'is a test');
});

test('seek spans nodes and honours nth', () => {
  const pos = seek(snap, 'world,this', 1);
  assert.equal(pos.startNode, nodes[0]);
  assert.equal(pos.startOffset, 6);
  assert.equal(pos.endNode, nodes[2]);
  assert.equal(pos.endOffset, 4);
  const second = seek(snap, 'Helloworld', 2);
  assert.equal(second.startNode, nodes[3]);
  assert.equal(nodes[3].nodeValue.slice(second.startOffset, second.endOffset), 'Hello world');
  assert.equal(seek(snap, 'missing', 1), null);
  assert.equal(seek(snap, 'Helloworld', 3), null);
});

test('helpers', () => {
  assert.equal(stripWs(' a \n b\tc '), 'abc');
  assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
});
