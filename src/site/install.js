// Install page logic: bakes the helper origin and the user's Diigo username into the bookmarklet and
// renders the draggable link plus the copyable URL for phones.
const CODE = /*__BOOKMARKLET_CODE__*/'';

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
  const userInput = document.getElementById('user');
  const link = document.getElementById('bm-link');
  const urlBox = document.getElementById('bm-url');
  const copyBtn = document.getElementById('copy');
  const sizeEl = document.getElementById('size');

  try { userInput.value = localStorage.getItem('dl2user') || ''; } catch { /* storage disabled */ }

  function refresh() {
    const user = userInput.value.trim();
    try { localStorage.setItem('dl2user', user); } catch { /* ignore */ }
    const bm = buildBookmarklet({ h: helper, u: user });
    link.setAttribute('href', bm);
    urlBox.value = bm;
    sizeEl.textContent = (bm.length / 1024).toFixed(1) + ' KB';
  }
  userInput.addEventListener('input', refresh);
  refresh();

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
