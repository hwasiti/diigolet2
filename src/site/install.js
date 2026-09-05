// Install page logic: bakes the helper origin into the bookmarklet and renders the draggable link plus the
// copyable text for phones. No username is needed: the helper learns it from Diigo's replies.
const CODE = /*__BOOKMARKLET_CODE__*/'';

// A javascript: URL is percent-decoded before it runs, so literal % signs, whitespace and # must be encoded.
function encodeBookmarklet(code) {
  return code.replace(/[%#\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
}

function main() {
  const helper = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  const bm = 'javascript:' + encodeBookmarklet(CODE.replace('"%%DL2_CFG%%"', JSON.stringify({ h: helper })));
  const link = document.getElementById('bm-link');
  const urlBox = document.getElementById('bm-url');
  const copyBtn = document.getElementById('copy');
  link.setAttribute('href', bm);
  urlBox.value = bm;
  document.getElementById('size').textContent = bm.length + ' characters';

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
