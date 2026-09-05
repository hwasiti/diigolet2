# Diigolet 2 Highlighter (browser extension)

An unofficial replacement for the highlighting part of Diigo's "Web Collector" extension. It writes highlights in
Diigo's own format (same `content` + `nth` anchoring, same MD5 ids), so they show up in your Diigo library, in
the official extension and in the bookmarklet, and highlights made anywhere else show up here.

## Install (developer mode)

```
npm install
npm run build:ext          # bundles extension/src/*.js into extension/dist/
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/`
folder. Disable the official Diigo extension while this one is on (both would paint the same highlights). After
`npm run build:ext` again, press the reload arrow on the extension card. Tabs that were open before the
extension was loaded get a "Enable on this page" button in the popup.

## Use

- Sign in to diigo.com in Chrome once. The popup shows who you are signed in as; the toolbar icon turns grey when
  Chrome has no Diigo login (and the popup says so, with a Sign in button that opens the Diigo sign-in page).
- Select text: a small bubble offers the four Diigo colours. Click one and the highlight is saved. If the page is
  not bookmarked yet, the bookmark is created (private by default; see Options).
- Put the cursor inside an existing highlight: the bubble offers ✕ to remove it from Diigo.
- Existing highlights are painted automatically when a page loads (Options: turn off to load on demand). The
  badge on the icon shows how many highlights Diigo has for the page.
- Shortcuts (change them at `chrome://extensions/shortcuts`): `Alt+Shift+H` highlight the selection with the
  last colour, `Alt+Shift+D` show/hide (or load) the highlights. Right-click a selection → "Highlight in Diigo".
- Popup: Pen mode (every selection is highlighted immediately), reload, open your library, Options.

## Why not fix the official extension

It is signed by Diigo and auto-updated from the Web Store, and its code is a Manifest V2 design from 2013 with a
thin Manifest V3 wrapper. The defects that matter for highlighting, confirmed in the code and (where marked)
reproduced with `harness/official-repro.mjs` in Chrome for Testing with a signed-in profile:

- Its service worker registers its message/tab listeners asynchronously (after a storage read). Reproduced: right
  after Chrome restarts the worker (it kills it after 30 s idle), the content script's first request gets no reply
  at all ("Receiving end does not exist"), so the popup button does nothing that time.
- Every worker start resets its sign-in state to "signed out" and only then checks the login cookie. Reproduced:
  the next request after a restart is answered with user "" — the page says "Please sign in first" although
  Chrome is signed in — and only about two seconds later does the worker know the user. The popup reads the
  cookie itself and disagrees with the page.
- All seven keyboard shortcuts (Ctrl+Alt+A, D, R, T, P, S, O) are dead: a multi-key preference read returns an
  array where the code expects an object. Reproduced: Ctrl+Alt+A does nothing while the popup's command works.
- Auto-show of existing highlights checks the in-memory sign-in flag before the cookie is read (skipped after a
  restart in the code; in our run it still appeared because the content script loads by itself).
- Context-menu clicks have no listener after a restart; several removed APIs (`tabs.sendRequest`,
  `extension.sendRequest`, `window`/`alert` in the worker) throw; Diigo calls have no timeout or error path, so
  an HTML error page or a dropped connection leaves a highlight painted but never saved.
- 760 KB of content script (jQuery 1.8 + a 2013 code base) on every page, with a storage round trip per key press.

A full review with 20 findings (also security ones: page-controlled `postMessage` handlers, server HTML inserted
unsanitised) is in the session notes; none of those patterns is used here.

What this extension does instead: every listener is registered at top level; nothing that matters lives in
worker globals (sign-in and per-tab state sit in `chrome.storage.session`); the sign-in state comes from the
`diigoandlogincookie` cookie *and* from the `user` field of every Diigo reply (a reply without a user marks the
session as expired), and `chrome.cookies.onChanged` pushes sign-in/sign-out to every open tab within a second;
every Diigo call has a 20 s timeout and every message gets a reply; the content script is ~19 KB, paints with the
CSS Custom Highlight API (no DOM wrappers, nothing for page scripts to trip over) and keeps its UI in a closed
shadow root with constructed stylesheets, which strict Content-Security-Policy sites (GitHub, Stack Overflow, MDN)
do not block.

## How it talks to Diigo

`POST https://www.diigo.com/chappai/pv=13/ct=tb/cv=<version>/user=<user>/cmd=<cmd>/` with a form body
(`cmd, v, _nocache, json, user, transId`), which is the official extension's "toolbar" dialect; www.diigo.com
answers it with plain JSON (the bookmarklet uses the JSONP `ct=let` dialect on the same host). The worker sends
`credentials: 'include'`; a worker fetch to a host in `host_permissions` carries the diigo.com cookies even
without it (measured with `harness/cred-check.mjs`), but being explicit costs nothing. Commands used:
`bm_loadBookmark`, `annotation_add`, `annotation_delete`, `bm_saveBookmark` (only for a page Diigo reports as
unsaved, because re-saving wipes the bookmark's tags). Highlight ids are `MD5(content + user + urlId + nth)` with
Diigo's low-byte MD5 quirk (`src/bookmarklet/md5.js`). `nth` counts occurrences of the whitespace-free text up
to the end of the selection, which is what the official extension does; the bookmarklet's shared `computeNth`
counts up to the end of the selection's last text node instead, which differs only when the same phrase repeats
inside that node.

Highlights are loaded for the canonical URL (tracking parameters and fragment removed, see
`src/bookmarklet/url.js`) and for the exact URL, and saved under the canonical one.

## Layout

```
extension/manifest.json     MV3 manifest (permissions: storage, cookies, tabs, contextMenus, activeTab, scripting)
extension/src/bg.js         service worker: Diigo client, sign-in state, per-tab state, badge, commands, menu
extension/src/content.js    content script: text model, Custom Highlight painting, selection bubble, SPA watch
extension/src/popup.js      action popup; options.js the options page
extension/src/lib/api.js    Diigo chappai client (toolbar dialect, timeouts, JSON/JSONP parsing)
extension/src/lib/auth.js   cookie parsing, page classification
extension/src/lib/anchor.js nth computation
extension/test/             node:test unit tests (npm run test:ext)
extension/harness/          puppeteer + Chrome for Testing: smoke, end-to-end and official-extension reproduction
```

## Testing

```
npm run test:ext                                  # unit tests
cd extension/harness && npm install               # puppeteer + Chrome for Testing (once)
node ext-smoke.mjs                                # throwaway profile, no login: worker, content script, popup
node ext-e2e.mjs                                  # logged-in profile: highlight, reload, worker restart, remove
node official-repro.mjs                           # the official extension's failure modes
node probe.mjs https://github.com/ https://x.com/ # what a content script may do under each site's CSP
```

The end-to-end scripts need `harness/profile` to be signed in to Diigo. `node signin-and-test.mjs` opens the
test browser at Diigo's sign-in page, waits for you to sign in (Diigo shows a CAPTCHA to automated browsers after
a few attempts), makes the session cookies persistent and then runs the four suites into `harness/results/`.
The profile directory is gitignored. Note that `ext-e2e.mjs` creates a real bookmark for its test page in your
library (the highlight it makes is removed again, the bookmark stays).

Results on 2026-09-05 (Chrome for Testing 148, signed in): `official-repro` reproduced the lost first reply and
the "user empty" second reply after a worker restart and the dead shortcut; `ext-e2e` passed all 17 checks;
`ext-sites` found the content script and its bubble working on GitHub, Wikipedia, MDN, Hacker News, NYT, Guardian,
Medium, web.dev, BBC, arXiv and Google Docs (Reddit's SPA replaced the test harness's script context, not a
failure of the extension); `cred-check` showed cookies are sent with the default credentials mode.
