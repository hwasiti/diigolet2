# Plan: Diigolet 2 browser extension (replacement for the official Diigo Web Collector)

## Why

The official extension (id pnhplgjpclknigjpccbcnmicgcieojbh, v3.5.0) is a 2013-era Manifest V2 code base ported
to Manifest V3 with minimal changes. Its user reports: "sometimes it does not know I am signed in", "on some sites
I cannot highlight", "the login cookie does not seem to be saved". We cannot fix it in place (it is signed by Diigo,
auto-updated from the Web Store, and half its code is dead weight: jQuery 1.8, Twitter OAuth, ZeroClipboard,
Google Buzz, bit.ly). We write our own small extension that does the part that matters (highlighting, compatible
with Diigo's storage format) correctly, for personal use in developer mode, and possibly for publication later.

## What is wrong with the official extension

From reading the code (line numbers refer to the beautified copies in the scratchpad `pretty/` folder) and from
a Codex review of the same code (`codex/official-review.md`, 20 findings); items marked [repro] are reproduced in
`extension/harness/official-repro.mjs` in Chrome for Testing with a signed-in profile.

1. **Listeners registered asynchronously in the service worker.** `init()` registers `runtime.onMessage`,
   `tabs.onUpdated`, `tabs.onRemoved` inside `getStorage(null).then(...)` (bg2.js:1547-1617). The event that
   wakes a terminated worker can be dropped: the content script's `sendMessage({name:'initialData'}, cb)` gets
   `cb(undefined)` and throws (`A.run(undefined)`), so the popup button / shortcut does nothing that time.
2. **"Please sign in first" while signed in.** Every worker start runs `resetGlobalData()` (signedIn:false,
   user:"", also written to chrome.storage.local) and only then starts the asynchronous cookie check
   (bg2.js:1555-1556); `onUsernameSeen` is not awaited. Any `initialData` answered in that window carries
   `user:""` and the content script answers "Please sign in first" (content:574, 6721-6737). When the cookie is
   then recognised, the worker broadcasts `signIn` to every tab, whose handler calls `l.reset()` and replaces a
   loaded bookmark with a fresh unsaved one (tags/description lost for the next save). [repro: T2/T3]
3. **Auto-show of existing highlights skipped after a restart.** `Preloader.onTabUpdated` returns early when
   `SignInManager.isSignedIn()` is false (bg2.js:795), i.e. on the first navigation after every restart; the
   preload table lives only in worker memory. [repro: T4b]
4. **All seven keyboard shortcuts and "private by default" are dead.** `getStorage([...keys])` returns an
   *array* (storage.js:589-592) but every consumer indexes it as an object (`c["prefs.shortcutAnnotate"]`), so the
   shortcut handler (content:6718-6747) never matches and `preloadedPrefs` is garbage. Ctrl+Alt+A does nothing.
   [repro: T1 shortcut vs. popup command]
5. **Diigo calls without credentials, timeouts or error paths.** `fetch(url, {method:'POST', body, headers})`
   with no `credentials` option (bg2.js:2004-2021), no HTTP status check, no `.catch`: an HTML error page, a 502 or
   a network failure means the content script's callback never runs (highlight painted, never saved, spinner
   forever). Whether the default credentials mode carries the diigo.com cookies from a worker is verified in the
   harness (`cred-check.mjs`).
6. **Context-menu clicks lost after a restart.** The `contextMenus.onClicked` listener is only registered inside
   `createContextMenu`, which runs when the `prefs.contextMenu` preference is *created or changed*
   (bg2.js:1770-1777, 1851): after the first install, later workers have menus but no listener.
7. **Sign-in state does not follow the cookie.** No `cookies.onChanged`; the popup reads the cookie itself
   (popup.js:1343) while the page trusts the worker's stale `GlobalData`, so popup and page disagree. The
   "Please sign in first" notification's link is broken by a typo (`"team_url" == !$(this).attr("id")`,
   content:6871). The sign-in return trip depends on tab-URL sniffing (`/images/diigo-logo.png#SIGNED_IN`) and the
   in-memory `activateTheTabIdAfterSignIn`.
8. **Removed or worker-hostile APIs** in several branches: `chrome.tabs.sendRequest` (bg2.js:1333),
   `chrome.extension.sendRequest` (popup.js:1598-1610), `window`/`document`/`alert`/`$` in the worker
   (bg2.js:617, 975, 1004, 1366, 1518), `postMessageRefreashPage` typo (bg2.js:616 vs 1090).
9. **Security patterns not to copy:** `window.message` handlers without origin checks that trigger extension
   actions and leak library metadata to the page (content:662-667, 6761-6843); stored annotation HTML inserted
   with `.html()` after a script-tag-only "sanitiser"; web-accessible extension pages for `<all_urls>`; embedded
   bit.ly key and Twitter consumer secret; every visited URL sent to Diigo even with autoload off.
10. **Anchoring quirks:** when fewer occurrences exist than the stored `nth`, `seek()` paints the *last*
    occurrence instead of reporting the highlight as lost (content:3858-3864); hidden text is indexed; shadow DOM
    is not; `contenteditable` is wrapped with `<em>` elements.
11. **Weight:** ~760 KB of content script (jQuery 1.8 + 404 KB diigolet.js) on every http/https page, a storage
    round trip on every key press, `document.body.id` rewritten to `dummybodyid`.
12. Not the cause: CSP. A probe extension confirmed (Chrome 148) that content-script `<style>` elements,
    `chrome-extension://` images, constructed stylesheets and the CSS Custom Highlight API all work on GitHub,
    Stack Overflow, MDN, Hacker News, NYT, Guardian, web.dev, Google Docs. Only page-context fetches to
    diigo.com fail (CORS), so Diigo traffic must go through the worker.

## Goals for the replacement

- Highlight selected text in four Diigo colours, show existing highlights automatically (optional), remove a
  highlight, keep everything in Diigo's own format (`content` + `nth` anchoring, MD5 ids) so highlights made here
  render in Diigo's site/apps and vice versa. Reuse the verified modules in `src/bookmarklet/` (text model,
  payloads, MD5 low-byte quirk, URL canonicalisation).
- Never lie about sign-in state. Sources of truth: the `diigoandlogincookie` cookie *and* the `user` field of
  every Diigo reply. React to `chrome.cookies.onChanged` (sign-in / sign-out in any tab updates icon, popup and
  pages within a second).
- Manifest V3 done right: every listener at top level, no state in worker globals (chrome.storage.session), every
  Diigo call with a timeout and an error path, every message answered.
- Small, CSP-proof content script: no jQuery, UI in a closed shadow root with constructed stylesheets, painting
  with the Custom Highlight API (no DOM wrappers, so page scripts, editors and the bookmarklet are undisturbed).
- Single-page apps: reload highlights when the URL changes without a reload; re-locate after DOM re-renders.

## Non-goals (first version)

Sticky notes, notes/comments on highlights, screenshots, PDF annotation, outliner sidebar, read later, search,
sharing, groups, frames and shadow-DOM text. Candidates for later: a note on a highlight, "save bookmark with
tags", read later (all simple `bm_saveBookmark` calls).

## Architecture (implemented in `extension/`)

```
manifest.json     MV3; permissions storage, cookies, tabs, contextMenus, activeTab, scripting;
                  host_permissions https://*.diigo.com/*; content script on http/https at document_idle;
                  commands Alt+Shift+H (highlight selection), Alt+Shift+D (show/hide or load)
src/bg.js         worker: Diigo client, auth state, per-tab state, badge, commands, context menu, sign-in tabs
src/content.js    content script: text model, Custom Highlight painting, selection bubble, SPA/mutation watch
src/popup.js      popup: asks the worker for auth and the tab for status; never assumes state
src/options.js    autoload, private-by-default, colour
src/lib/api.js    chappai client: POST www.diigo.com ct=tb (verified to answer plain JSON with the diigo.com
                  cookies), 20 s AbortController timeout, HTTP/JSON guards -> DiigoError kinds
src/lib/auth.js   cookie parsing (username = second `-.-` field), cookie-change filter, page classification
src/lib/anchor.js nth = occurrences of the whitespace-free text up to the END of the selection (official rule)
build.mjs         esbuild -> dist/ (gitignored); `npm run build:ext`
harness/          puppeteer + Chrome for Testing: official-repro, ext-smoke, ext-e2e, ext-sites, probe
```

### Decisions taken

- **Endpoint:** `POST https://www.diigo.com/chappai/pv=13/ct=tb/cv=<ver>/user=<user>/cmd=<cmd>/` (form body,
  `credentials:'include'`). Verified from a diigo.com page that www accepts the toolbar dialect and returns JSON;
  no JSONP parsing, no URL-length limit for long highlights, same host as the login cookie.
- **Auth state** = `{user, stale, signedIn}` in `storage.session`; recomputed from the cookie on every worker
  start and on every cookie change; a Diigo reply with `user:null` while the cookie exists sets `stale` ("session
  expired", popup offers sign-in). Sign-in opens `https://www.diigo.com/sign-in` in a tab; the cookie change is
  the completion signal (no URL sniffing); the originating tab id is kept in `storage.session` to refocus it.
- **URL keys:** load highlights for the canonical URL (tracking parameters and fragment stripped) *and* for the
  exact URL (highlights the official client stored under tracking-parameter URLs), save under the canonical URL.
- **nth:** counted up to the end of the selection (official rule; the shared `computeNth` in the bookmarklet
  counts up to the end of the last text node, which differs only when the phrase repeats inside that node — not
  changed there, it belongs to the other session). Missing nth -> "not found", never the last occurrence.
- **Bookmark creation:** the first highlight on an unsaved page uses `bm_saveBookmark` with the annotation
  (private by default, option); an existing bookmark gets `annotation_add` (re-saving wipes tags).
- **Deletes are verified** by reloading after 1.2 s (Diigo answers success to deletes it does not perform).
- **Autoload** is an option (default on) and is the only case in which URLs are sent to Diigo without a user
  action; signed-out browsers send nothing.
- **Popup for pre-existing tabs:** if the tab has no content script (opened before install), the popup offers
  "Enable on this page" which injects `dist/content.js` via `scripting.executeScript` (activeTab).
- **No `webNavigation`:** `tabs.onUpdated` with `changeInfo.url` (fires for pushState too) clears per-tab state;
  the content script watches `location.href` (1 s poll + popstate) and reloads.

## Testing

- Unit (node:test, `npm run test:ext`): cookie parser, page classification, API client (request shape, JSON /
  JSONP parsing, badjson / http / network / timeout kinds), nth computation.
- Harness (puppeteer, Chrome for Testing 148, persistent signed-in profile):
  `official-repro.mjs` T1-T4 (above); `ext-smoke.mjs` (throwaway profile: worker, content script, popup,
  options); `ext-e2e.mjs` (highlight a paragraph, verify in Diigo, reload, worker restart, remove, verify);
  `ext-sites.mjs` (GitHub, Wikipedia, Stack Overflow, MDN, HN, NYT, Guardian, Medium, web.dev, BBC, arXiv,
  Google Docs, Reddit: content script alive, bubble on selection, no errors; read-only); `cred-check.mjs`
  (whether a worker fetch without `credentials:'include'` carries the Diigo cookies — decides how bad official
  defect 5 is).
- Manual: load unpacked in the user's real Chrome ("Profile 1").

## Open questions for the reviewer

- Anything in `src/bg.js` / `src/content.js` that still violates the MV3 rules above, or races (e.g. two
  `pageState` writers for one tab, `auth` cache invalidation)?
- Is skipping the "last occurrence" fallback the right call for highlights made by the official client on pages
  that changed?
- Should the content script exclude `contenteditable` regions and hidden text from the index (the official one
  does neither)?
- Is the closed shadow root + `all:initial` host enough isolation from page CSS, or should the bubble live in an
  iframe?
