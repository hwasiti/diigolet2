const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage(m).then((r) => { if (!r || !r.ok) throw new Error(r ? r.e.message : 'No reply'); return r.r; });

function show(p) { $('autoload').checked = !!p.autoload; $('privateDefault').checked = !!p.privateDefault; $('color').value = p.color || 'yellow'; }
async function save() {
  await bg({ t: 'set-prefs', prefs: { autoload: $('autoload').checked, privateDefault: $('privateDefault').checked, color: $('color').value } });
  $('saved').textContent = 'Saved';
  setTimeout(() => { $('saved').textContent = ''; }, 1500);
}
for (const id of ['autoload', 'privateDefault', 'color']) $(id).addEventListener('change', save);
bg({ t: 'prefs' }).then(show).catch((e) => { $('saved').textContent = e.message; });
