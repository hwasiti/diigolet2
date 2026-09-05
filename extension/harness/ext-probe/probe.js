// Probes what a content script may do under the page's CSP. Results are stored on a data attribute of <html>.
(async () => {
  const out = { href: location.href, csp: null };
  try { out.csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null; } catch {}
  const probe = document.createElement('div'); probe.id = 'csp-probe'; probe.textContent = 'x';
  document.documentElement.appendChild(probe);
  // 1. inline <style> element injected by the content script
  const st = document.createElement('style'); st.textContent = '#csp-probe{color:rgb(1, 2, 3) !important}';
  document.head.appendChild(st);
  await new Promise((r) => setTimeout(r, 50));
  out.inlineStyleElement = getComputedStyle(probe).color === 'rgb(1, 2, 3)';
  // 2. style attribute set via CSSOM
  probe.style.setProperty('background-color', 'rgb(4, 5, 6)', 'important');
  out.styleAttributeCSSOM = getComputedStyle(probe).backgroundColor === 'rgb(4, 5, 6)';
  // 3. constructed stylesheet adopted by the document
  try { const sh = new CSSStyleSheet(); sh.replaceSync('#csp-probe{font-size:7px !important}'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; await new Promise((r) => setTimeout(r, 20)); out.constructedSheet = getComputedStyle(probe).fontSize === '7px'; } catch (e) { out.constructedSheet = 'error ' + e.message; }
  // 4. shadow root with adopted stylesheet
  try { const host = document.createElement('div'); document.documentElement.appendChild(host); const root = host.attachShadow({ mode: 'open' }); const sh = new CSSStyleSheet(); sh.replaceSync('span{letter-spacing:3px}'); root.adoptedStyleSheets = [sh]; const sp = document.createElement('span'); sp.textContent = 'y'; root.appendChild(sp); await new Promise((r) => setTimeout(r, 20)); out.shadowAdopted = getComputedStyle(sp).letterSpacing === '3px'; const st2 = document.createElement('style'); st2.textContent = 'span{word-spacing:5px}'; root.appendChild(st2); await new Promise((r) => setTimeout(r, 20)); out.shadowInlineStyle = getComputedStyle(sp).wordSpacing === '5px'; host.remove(); } catch (e) { out.shadowAdopted = 'error ' + e.message; }
  // 5. CSS custom highlight API through a constructed sheet
  try { const h = new Highlight(); CSS.highlights.set('probe', h); const r = document.createRange(); r.selectNodeContents(probe); h.add(r); const sh = new CSSStyleSheet(); sh.replaceSync('::highlight(probe){background:rgb(9,9,9)}'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; out.customHighlight = CSS.highlights.has('probe'); } catch (e) { out.customHighlight = 'error ' + e.message; }
  // 6. an image from the extension package (web accessible) under the page's img-src
  out.extImage = await new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = chrome.runtime.getURL('dot.png'); setTimeout(() => res('timeout'), 4000); });
  // 7. fetch of an extension resource from the content script
  try { const r = await fetch(chrome.runtime.getURL('dot.png')); out.extFetch = r.ok; } catch (e) { out.extFetch = 'error ' + e.message; }
  // 8. a cross-origin fetch to diigo from the content script (page-origin credentials rules apply)
  try { const r = await fetch('https://www.diigo.com/chappai/pv=13/ct=let/cv=5.0b7/user=/cmd=bm_loadBookmark/?cmd=bm_loadBookmark&v=13&json=' + encodeURIComponent(JSON.stringify({ url: location.href, what: 'bookmarkInfo' })) + '&transId=1', { credentials: 'include' }); out.diigoFetchFromPage = r.status; } catch (e) { out.diigoFetchFromPage = 'error ' + e.message; }
  probe.remove(); st.remove();
  document.documentElement.setAttribute('data-csp-probe', JSON.stringify(out));
})();
