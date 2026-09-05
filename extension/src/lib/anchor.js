// Anchoring helpers on top of the shared Diigo text model (src/bookmarklet/text.js).
import { occurrences, stripWs } from '../../../src/bookmarklet/text.js';

/**
 * Diigo's nth for a new highlight: how many times its whitespace-free text `txt` occurs in the body text up to
 * the END of the selection. The official extension walks the text up to the selection's end container and
 * slices that text node at the end offset, so the selection itself is the last occurrence counted, and every
 * client that seeks the nth occurrence lands on the selected text. `range` needs intersectsNode, endContainer
 * and endOffset; `S` is a snapshot {docTxt, list:[{node, offset, len}]}.
 */
export function nthAtRangeEnd(range, S, txt) {
  // occurrences() restarts one character before a match's end (Diigo's quirk); a one-character text would
  // never advance, so such selections are not anchored by occurrence.
  if (!txt || txt.length < 2) return 1;
  let prefix = 0;
  for (const e of S.list) {
    if (!range.intersectsNode(e.node)) continue;
    const end = e.node === range.endContainer ? e.offset + stripWs(e.node.nodeValue.slice(0, range.endOffset)).length : e.offset + e.len;
    if (end > prefix) prefix = end;
  }
  return occurrences(txt, S.docTxt.slice(0, prefix)).n || 1;
}
