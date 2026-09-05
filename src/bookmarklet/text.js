// Diigo-compatible text model.
// Diigo anchors a highlight by (content, nth): `content` is the selected text (HTML) and `nth` is which
// occurrence of its whitespace-stripped text it is, counting over the whitespace-stripped text of the
// page body in DOM order, up to and including the node where the selection ends. Everything here mirrors
// the original Diigolet algorithm so that records written by this tool render in Diigo's own clients.

export const TAG_BLACKLIST = new Set(
  'applet,area,base,basefont,bdo,button,frame,frameset,iframe,head,hr,img,input,link,map,meta,noframes,noscript,optgroup,option,param,script,select,style,textarea,title'.split(','),
);

export const stripWs = (s) => s.replace(/\s+/g, '');

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Element filter identical to Diigolet's domSnapshotNodeFilter, plus our own UI (data-dl2). */
export function acceptElement(el) {
  if (TAG_BLACKLIST.has(el.tagName.toLowerCase())) return false;
  if (el.hasAttribute('data-dl2')) return false;
  const c = el.getAttribute('class');
  if (c && /(^|\s)diigolet(\s|$)/.test(c) && !/(^|\s)diigoHighlight(\s|$)/.test(c)) return false;
  return true;
}

/** All text nodes under root in document (pre-)order, skipping rejected elements and their subtrees. */
export function collectTextNodes(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === 3) { out.push(n); continue; }
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) continue;
    if (n.nodeType === 1 && n !== root && !acceptElement(n)) continue;
    const kids = n.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

/** Build the whitespace-free body text and the offset table used to map matches back to nodes. */
export function snapshotFromNodes(nodes) {
  let docTxt = '';
  const list = [];
  for (const node of nodes) {
    const t = stripWs(node.nodeValue);
    if (!t) continue;
    list.push({ offset: docTxt.length, node, len: t.length });
    docTxt += t;
  }
  return { docTxt, list, nodes };
}

export function snapshot(root = document.body) {
  return snapshotFromNodes(collectTextNodes(root));
}

/**
 * Diigolet's occurrence scan. After a match at s the next search starts at s + len - 1, so matches may
 * overlap by one character; the quirk is preserved because saved `nth` values depend on it.
 */
export function occurrences(txt, hay, wantNth = Infinity) {
  let n = 0, s = 0, e = 0;
  while ((s = hay.indexOf(txt, e)) > -1) {
    n++;
    e = s + txt.length - 1;
    if (n === wantNth) return { n, start: s, end: e };
  }
  return { n, start: -1, end: -1 };
}

const FOLLOWING = 4, CONTAINED_BY = 16;

function firstOffsetAfter(snap, node, includeDescendants) {
  if (typeof node.compareDocumentPosition !== 'function') return snap.docTxt.length;
  for (const e of snap.list) {
    const p = node.compareDocumentPosition(e.node);
    if ((p & FOLLOWING) || (includeDescendants && (p & CONTAINED_BY))) return e.offset;
  }
  return snap.docTxt.length;
}

/** nth for a selection whose end boundary sits in `endContainer` (Diigolet: walk stops at that node). */
export function computeNth(snap, txt, endContainer) {
  let prefix = snap.docTxt.length;
  if (endContainer) {
    if (endContainer.nodeType === 3) {
      const e = snap.list.find((x) => x.node === endContainer);
      prefix = e ? e.offset + e.len : firstOffsetAfter(snap, endContainer, false);
    } else {
      prefix = firstOffsetAfter(snap, endContainer, true);
    }
  }
  return occurrences(txt, snap.docTxt.slice(0, prefix)).n || 1;
}

/** Real character offset in nodeValue of the strippedIdx-th non-whitespace character (end: one past it). */
export function realOffset(nodeValue, strippedIdx, isEnd) {
  let k = 0;
  for (let i = 0; i < nodeValue.length; i++) {
    if (/\s/.test(nodeValue[i])) continue;
    if (k === strippedIdx) return isEnd ? i + 1 : i;
    k++;
  }
  return nodeValue.length;
}

/** Locate the nth occurrence of whitespace-free `txt`; returns node/offset boundaries or null. */
export function seek(snap, txt, nth = 1) {
  if (!txt) return null;
  const { start, end } = occurrences(txt, snap.docTxt, nth);
  if (start < 0) return null;
  let sEntry = null, eEntry = null;
  for (const e of snap.list) {
    if (!sEntry && start >= e.offset && start < e.offset + e.len) sEntry = e;
    if (end >= e.offset && end < e.offset + e.len) { eEntry = e; break; }
  }
  if (!sEntry || !eEntry) return null;
  return {
    startNode: sEntry.node,
    startOffset: realOffset(sEntry.node.nodeValue, start - sEntry.offset, false),
    endNode: eEntry.node,
    endOffset: realOffset(eEntry.node.nodeValue, end - eEntry.offset, true),
  };
}

export function toRange(pos) {
  const r = document.createRange();
  r.setStart(pos.startNode, pos.startOffset);
  r.setEnd(pos.endNode, pos.endOffset);
  return r;
}

/** Text of stored HTML content, using the same element filter (mirrors Diigolet's html2txt). */
export function html2txt(html) {
  if (!/[<&]/.test(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return collectTextNodes(doc.body).map((n) => n.nodeValue).join('');
  } catch {
    const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return html.replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, '0x'), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ent[e.toLowerCase()] ?? m);
  }
}

/** Describe a live Range in Diigo terms: raw text, whitespace-free txt, HTML-escaped content, nth. */
export function describeRange(range, snap) {
  let raw = '';
  for (const n of snap.nodes) {
    if (!range.intersectsNode(n)) continue;
    let s = 0, t = n.nodeValue.length;
    if (n === range.startContainer) s = range.startOffset;
    if (n === range.endContainer) t = range.endOffset;
    raw += n.nodeValue.slice(s, t);
  }
  const txt = stripWs(raw);
  const content = escapeHtml(raw.replace(/\s+/g, ' ').trim());
  return { raw, txt, content, nth: computeNth(snap, txt, range.endContainer) };
}
