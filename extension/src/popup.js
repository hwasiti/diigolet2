// Action popup. It never assumes state: it asks the worker about sign-in and the tab's content script about the page.
import { isHighlightablePage } from './lib/auth.js';

const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage(m).then((r) => { if (!r) throw new Error('No reply from the extension'); if (!r.ok) throw new Error(r.e.message); return r.r; });
const page = (tabId, m) => chrome.tabs.sendMessage(tabId, m);
let tab, status;

function renderAuth(auth) {
  const line = $('auth-line');
  if (auth.signedIn) { line.className = 'status ok'; line.textContent = 'Signed in to Diigo as ' + auth.user; }
  else if (auth.stale) { line.className = 'status warn'; line.textContent = 'Your Diigo session expired (' + auth.user + '). Sign in again.'; }
  else { line.className = 'status warn'; line.textContent = 'Not signed in to Diigo'; }
  $('signin').hidden = auth.signedIn;
  $('signout').hidden = !auth.user;
  $('library').hidden = !auth.signedIn;
}

function renderPage() {
  const line = $('page-line');
  $('page-actions').hidden = true; $('enable-row').hidden = true;
  if (!tab || !isHighlightablePage(tab.url)) { line.textContent = 'Diigolet does not run on this page.'; return; }
  if (!status) { line.textContent = 'Diigolet is not active in this tab.'; $('enable-row').hidden = false; return; }
  const n = status.count;
  line.textContent = status.loaded ? (n ? `${n} highlight${n === 1 ? '' : 's'} on this page${status.shown ? '' : ' (hidden)'}` : 'No highlights on this page yet') : (status.signedIn === false ? 'Sign in to load highlights.' : 'Highlights not loaded yet.');
  $('page-actions').hidden = false;
  $('toggle').textContent = status.loaded ? (status.shown ? 'Hide highlights' : 'Show highlights') : 'Load highlights';
  $('pen').textContent = 'Pen: ' + (status.pen ? 'on' : 'off');
}

async function refreshPage() {
  status = null;
  if (tab && isHighlightablePage(tab.url)) { try { status = await page(tab.id, { t: 'status' }); } catch { status = null; } }
  renderPage();
}

async function init() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  const forced = new URLSearchParams(location.search).get('tab'); // test harness: popup opened as a tab for another tab
  tab = forced ? await chrome.tabs.get(Number(forced)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try { renderAuth(await bg({ t: 'auth', refresh: true })); } catch (e) { $('auth-line').textContent = e.message; }
  await refreshPage();
}

$('signin').onclick = () => bg({ t: 'open-signin', tabId: tab && tab.id }).then(() => window.close());
$('signout').onclick = () => bg({ t: 'open-signout' }).then(() => window.close());
$('library').onclick = () => bg({ t: 'open-library' }).then(() => window.close());
$('options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('hl').onclick = () => page(tab.id, { t: 'command', name: 'highlight-selection' }).then(() => window.close());
$('toggle').onclick = () => page(tab.id, status && status.loaded ? { t: 'set', shown: !status.shown } : { t: 'set', reload: true }).then(() => setTimeout(refreshPage, 400));
$('pen').onclick = () => page(tab.id, { t: 'set', pen: !(status && status.pen) }).then(refreshPage);
$('reload').onclick = () => page(tab.id, { t: 'set', reload: true }).then(() => setTimeout(refreshPage, 1500));
$('enable').onclick = () => bg({ t: 'inject', tabId: tab.id }).then(() => setTimeout(refreshPage, 500)).catch((e) => { $('page-line').textContent = e.message; });
chrome.runtime.onMessage.addListener((m) => { if (m && m.t === 'auth-changed') { renderAuth(m.auth); setTimeout(refreshPage, 800); } });

init();
