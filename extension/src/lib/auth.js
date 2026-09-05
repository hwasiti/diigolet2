// Sign-in state helpers. Diigo marks a signed-in browser with the cookie `diigoandlogincookie` on diigo.com whose
// value is "<xx>-.-<username>-.-<xx>-.-<x>" (the official extension reads the second field). The cookie only
// says who the browser *claims* to be; every Diigo reply carries a `user` field that is the truth.
export const LOGIN_COOKIE = 'diigoandlogincookie';
export const COOKIE_URL = 'https://www.diigo.com/';

/** Username encoded in the login cookie's value, or null. */
export function userFromCookieValue(value) {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('-.-');
  if (parts.length < 2) return null;
  let u = parts[1];
  try { u = decodeURIComponent(u); } catch { /* keep as is */ }
  u = u.trim();
  return u || null;
}

/** True for a chrome.cookies.onChanged event that concerns the login cookie. */
export function isLoginCookieChange(changeInfo) {
  const c = changeInfo && changeInfo.cookie;
  return !!c && c.name === LOGIN_COOKIE && /(^|\.)diigo\.com$/i.test(String(c.domain).replace(/^\./, ''));
}

/** Diigo's own pages get no highlighter UI (Diigo renders highlights itself there). */
export function isDiigoPage(url) {
  try { return /(^|\.)diigo\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

/** Pages a content script can work on. */
export function isHighlightablePage(url) {
  return /^https?:\/\//i.test(url || '') && !isDiigoPage(url) && !/^https?:\/\/chromewebstore\.google\.com/i.test(url);
}
