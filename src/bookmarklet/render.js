// Paints highlights without touching the page's stylesheet rules that CSP polices.
// Preferred: CSS Custom Highlight API + a constructed stylesheet (CSSOM, not subject to style-src).
// Fallback: wrap text nodes in <em class="diigoHighlight ..."> exactly like Diigo, colouring via element.style.
export const COLORS = { yellow: '#ffff99', blue: '#abd5ff', green: '#b2e57e', pink: '#ffcccc' };

function hasHighlightApi() {
  return typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights
    && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;
}

export function createRenderer() {
  const painted = new Map(); // id -> { range, color } | { els, color }
  const groups = {};
  let api = hasHighlightApi();
  if (api) {
    try {
      const sheet = new CSSStyleSheet();
      let css = '';
      for (const [c, hex] of Object.entries(COLORS)) {
        css += `::highlight(dl2-${c}){background-color:${hex};color:#111}`;
        groups[c] = new Highlight();
        CSS.highlights.set('dl2-' + c, groups[c]);
      }
      css += '::highlight(dl2-pending){text-decoration:underline dotted #555}';
      groups.pending = new Highlight();
      CSS.highlights.set('dl2-pending', groups.pending);
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      api = false;
    }
  }

  function paint(id, range, color, pending) {
    unpaint(id);
    const c = COLORS[color] ? color : 'yellow';
    if (api) {
      const r = range.cloneRange();
      groups[c].add(r);
      if (pending) groups.pending.add(r);
      painted.set(id, { range: r, color: c });
    } else {
      painted.set(id, { els: wrapRange(range, c, id), color: c });
    }
  }

  function setPending(id, pending) {
    const p = painted.get(id);
    if (!p) return;
    if (p.range) { pending ? groups.pending.add(p.range) : groups.pending.delete(p.range); }
    else for (const el of p.els) el.style.textDecoration = pending ? 'underline dotted' : '';
  }

  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function unpaint(id) {
    const p = painted.get(id);
    if (p) {
      if (p.range) {
        groups[p.color].delete(p.range);
        groups.pending.delete(p.range);
      } else {
        for (const el of p.els) unwrap(el);
      }
      painted.delete(id);
    }
    // Diigo's own extension may have wrapped the same highlight in <em class="diigoHighlight id_…">; clear that too.
    for (const el of document.querySelectorAll('em.diigoHighlight.id_' + id)) unwrap(el);
  }

  function idAtPoint(x, y) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; offset = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; offset = r.startOffset;
    } else return null;
    for (const [id, p] of painted) {
      if (p.range) {
        try { if (p.range.isPointInRange(node, offset)) return id; } catch { /* detached */ }
      } else if (p.els.some((el) => el.contains(node))) return id;
    }
    return null;
  }

  return { paint, unpaint, setPending, idAtPoint, usesApi: () => api };
}

function wrapRange(range, color, id) {
  const nodes = [];
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (range.intersectsNode(n) && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  if (!nodes.length) return [];
  const last = nodes[nodes.length - 1];
  if (last === range.endContainer && range.endOffset < last.nodeValue.length) last.splitText(range.endOffset);
  const first = nodes[0];
  if (first === range.startContainer && range.startOffset > 0) nodes[0] = first.splitText(range.startOffset);
  return nodes.map((t) => {
    const em = document.createElement('em');
    em.className = `diigoHighlight id_${id} type_0 ${color}`;
    em.setAttribute('data-dl2-hl', id);
    em.style.backgroundColor = COLORS[color];
    em.style.color = '#111';
    em.style.fontStyle = 'inherit';
    t.parentNode.insertBefore(em, t);
    em.appendChild(t);
    return em;
  });
}
