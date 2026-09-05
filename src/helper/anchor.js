// Anchoring math the helper does for the page. The page sends T, its body text with all whitespace removed
// (Diigo's text model), and the helper answers in offsets into T, so the bookmark itself carries no matching code.
import { occurrences, stripWs, escapeHtml, html2txt } from '../bookmarklet/text.js';

/** Diigo's stored `content` for a selection's raw text: whitespace collapsed, HTML-escaped. */
export const contentFor = (raw) => escapeHtml(raw.replace(/\s+/g, ' ').trim());

/**
 * Diigo's nth for a new highlight: how many times its whitespace-free text occurs in the body text up to and
 * including the selection's last text node (x = length of that prefix). 1 when the text cannot be found there.
 */
export function nthFor(txt, T, x) {
  return occurrences(txt, T.slice(0, x)).n || 1;
}

/** Whitespace-free offsets [s, e] (inclusive) of the nth occurrence of a stored highlight in T, or null. */
export function locate(content, T, nth = 1) {
  const txt = stripWs(html2txt(content));
  if (!txt) return null;
  const o = occurrences(txt, T, nth);
  return o.start < 0 ? null : { s: o.start, e: o.end };
}
