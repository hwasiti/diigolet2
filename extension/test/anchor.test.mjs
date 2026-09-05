import test from 'node:test';
import assert from 'node:assert/strict';
import { nthAtRangeEnd } from '../src/lib/anchor.js';
import { snapshotFromNodes, stripWs } from '../../src/bookmarklet/text.js';

// Minimal stand-ins for text nodes and a Range (no DOM needed).
const node = (nodeValue) => ({ nodeType: 3, nodeValue });
const range = (nodes, startNode, endNode, endOffset) => ({
  endContainer: endNode, endOffset,
  intersectsNode: (n) => { const i = nodes.indexOf(n), a = nodes.indexOf(startNode), b = nodes.indexOf(endNode); return i >= a && i <= b; },
});

test('the selection is the nth occurrence counted up to its own end, not the end of its text node', () => {
  const n1 = node('foo bar foo bar');
  const S = snapshotFromNodes([n1]);
  // select the first "foo bar" (ends at offset 7 of the node)
  assert.equal(nthAtRangeEnd(range([n1], n1, n1, 7), S, stripWs('foo bar')), 1);
  // select the second "foo bar" (ends at the node's end)
  assert.equal(nthAtRangeEnd(range([n1], n1, n1, 15), S, stripWs('foo bar')), 2);
});

test('occurrences in earlier nodes count; whitespace in the end node is ignored', () => {
  const n1 = node('the cat'), n2 = node('sat on the mat'), n3 = node('  the  cat  ');
  const S = snapshotFromNodes([n1, n2, n3]);
  assert.equal(nthAtRangeEnd(range([n1, n2, n3], n3, n3, 12), S, 'thecat'), 2);
  assert.equal(nthAtRangeEnd(range([n1, n2, n3], n1, n1, 7), S, 'thecat'), 1);
});

test('a selection that ends in an element (whole paragraph) still counts its own text', () => {
  const n1 = node('alpha beta'), n2 = node('alpha beta');
  const S = snapshotFromNodes([n1, n2]);
  const p = { nodeType: 1 }; // element end container: intersects n2 only
  const r = { endContainer: p, endOffset: 1, intersectsNode: (n) => n === n2 };
  assert.equal(nthAtRangeEnd(r, S, 'alphabeta'), 2);
});

test('a one-character text does not loop forever (occurrences() cannot advance on it)', () => {
  const n1 = node('a a a');
  const S = snapshotFromNodes([n1]);
  assert.equal(nthAtRangeEnd(range([n1], n1, n1, 5), S, 'a'), 1);
  assert.equal(nthAtRangeEnd(range([n1], n1, n1, 5), S, ''), 1);
});

test('text that cannot be found yields 1, like Diigo', () => {
  const n1 = node('hello');
  const S = snapshotFromNodes([n1]);
  assert.equal(nthAtRangeEnd(range([n1], n1, n1, 5), S, 'zzz'), 1);
});
