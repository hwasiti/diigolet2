// Install page logic: pairs this browser with a token, bakes the user's config into the bookmarklet,
// and renders the draggable link, the copyable URL and the pairing link for other devices.
const CODE = /*__BOOKMARKLET_CODE__*/'';

function randomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function currentToken() {
  const m = location.hash.match(/pair=([A-Za-z0-9]{16,64})/);
  let t = null;
  try { t = localStorage.getItem('dl2token'); } catch { /* storage disabled */ }
  if (m) {
    t = m[1];
    try { localStorage.setItem('dl2token', t); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname);
    document.getElementById('paired-banner').hidden = false;
  }
  if (!t) {
    t = randomToken();
    try { localStorage.setItem('dl2token', t); } catch { /* ignore */ }
  }
  return t;
}

// A javascript: URL is percent-decoded before it runs, so literal % signs, whitespace and # must be encoded.
function encodeBookmarklet(code) {
  return code.replace(/[%#\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
}

function buildBookmarklet(cfg) {
  const code = CODE.replace('"%%DL2_CFG%%"', JSON.stringify(cfg));
  return 'javascript:' + encodeBookmarklet(code);
}

function main() {
  const helper = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  const token = currentToken();
  const userInput = document.getElementById('user');
  const link = document.getElementById('bm-link');
  const urlBox = document.getElementById('bm-url');
  const pairLink = document.getElementById('pair-link');
  const copyBtn = document.getElementById('copy');
  const sizeEl = document.getElementById('size');

  try { userInput.value = localStorage.getItem('dl2user') || ''; } catch { /* ignore */ }

  function refresh() {
    const user = userInput.value.trim();
    try { localStorage.setItem('dl2user', user); } catch { /* ignore */ }
    const bm = buildBookmarklet({ h: helper, t: token, u: user });
    link.setAttribute('href', bm);
    urlBox.value = bm;
    sizeEl.textContent = (bm.length / 1024).toFixed(1) + ' KB';
  }
  userInput.addEventListener('input', refresh);
  refresh();

  const pairUrl = helper + '/#pair=' + token;
  pairLink.href = pairUrl;
  pairLink.textContent = pairUrl;
  document.getElementById('token').textContent = token;

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlBox.value);
      copyBtn.textContent = 'Copied';
    } catch {
      urlBox.focus(); urlBox.select();
      copyBtn.textContent = 'Select all and copy';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy bookmarklet'; }, 2000);
  });
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.getElementById('drag-hint').hidden = false;
  });
}

main();
