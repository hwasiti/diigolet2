// Diigo keys bookmarks and highlights by exact URL, so tracking parameters create duplicate entries.
// We strip the well-known junk, drop the fragment, and otherwise keep the URL byte-for-byte.
const JUNK = /^((utm_|hubs_|_hs)[\w-]*|hsCtaTracking|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|mkt_tok|igshid|ref_src|ref_url|yclid|_ga|_gl|oly_anon_id|oly_enc_id|vero_id|vero_conv|wickedid|twclid|ttclid|s_kwcid|ncid|srsltid|si)$/i;

function isJunk(pair) {
  let key = pair.split('=')[0];
  try { key = decodeURIComponent(key); } catch { /* keep raw */ }
  return JUNK.test(key);
}

export function canonicalUrl(href) {
  let u;
  try { u = new URL(href); } catch { return href; }
  if (!/^https?:$/.test(u.protocol)) return href;
  const search = u.search.startsWith('?') ? u.search.slice(1) : u.search;
  const keep = search ? search.split('&').filter((p) => p && !isJunk(p)) : [];
  return u.origin + u.pathname + (keep.length ? '?' + keep.join('&') : '');
}
