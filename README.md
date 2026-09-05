# Diigolet 2

A [Diigo](https://www.diigo.com/) highlighter bookmarklet that works where the original Diigolet died. Diigolet
downloads its engine from diigo.com, which most sites' Content Security Policy now forbids, so it silently fails
on GitHub, Wikipedia, HubSpot and many others. Diigolet 2 is a tiny bookmark (under Android Chrome's 5,000
character limit) that paints highlights through browser APIs CSP does not police and talks to a helper page on
our own origin, which holds all the Diigo logic. It runs on desktop Chrome and Firefox and, because Android
Chrome has no extensions, it is the way to highlight there.

Highlights are written in Diigo's own format (same `content` + `nth` anchoring, same MD5 ids), so they render in
Diigo's website, apps and official extension, and highlights made elsewhere render here.

## How it works

- **Entry.** Browsers exempt a bookmarklet's own code from the page CSP when it is launched from the address bar
  or a bookmark (Chromium `LocalFrame::LoadJavaScriptURL`, Firefox since 69). Only sub-resources are blocked, so
  the bookmark loads no script. `eval` is not exempt, so the bookmark cannot fetch code either.
- **Size limit.** Chrome for Android truncates a bookmark's address at 5,000 characters (a longer paste becomes a
  syntax error and nothing runs), and Chrome Sync silently drops big bookmarks (a 3.6 KB bookmarklet synced, a
  23 KB one did not). `build.mjs` refuses to build a bookmarklet URL longer than 5,000 characters.
- **Thin client, fat helper.** The bookmark (`src/lite/lite.js`, about 4.6 KB minified) only does what needs the
  page's DOM: collects the text nodes in Diigo's order, builds the whitespace-free body text `T`, maps text offsets
  back to DOM ranges, paints with the CSS Custom Highlight API (a constructed stylesheet, so `style-src` does not
  apply), shows a pen, a palette and a status line, and talks to the helper. The helper (`src/helper/`) receives
  `T` and the selection, computes Diigo's `nth`, `content` and MD5 ids, calls Diigo's JSONP API with the visitor's
  own cookies and answers with offsets into `T`. New Diigo logic therefore ships by redeploying the helper; the
  bookmark itself rarely changes.
- **Channels.** The helper is reached first as a hidden iframe, then as a popup opened on a tap. The frame needs
  the page to allow embedding our origin (`frame-src`, `child-src` or `default-src`); of 16 popular sites surveyed,
  11 restrict frames, so the popup path matters. The popup needs the page not to send
  `Cross-Origin-Opener-Policy: same-origin` (stackoverflow.com does; GitHub and most publishers do not). Page and
  helper find each other with a hello/ready handshake, so a helper window left open by an earlier page is adopted
  instead of reported as unreachable. On phones a popup is a full tab, so the page opens it per action and asks it
  to close itself afterwards.
- **Origin-bound relay.** The helper only honours requests about URLs on the origin that sent them, and derives
  urlIds from its own Diigo replies. A hostile page embedding the helper can therefore only touch highlights on its
  own pages, which Diigo's public JSONP endpoint already allows any page to do. The helper stores nothing, so it
  also works under third-party storage partitioning.
- **Not yet in the thin client.** Removing a highlight from the page (the earlier, larger build had it) was cut to
  fit the 5,000 character limit; it will return through the helper's own window. Diigo answers "success" to deletes
  it does not perform on some old bookmarks, so removal must verify by reloading.

## What the pen and the status line mean

- **Blue pen straight away**: the site allows the hidden helper frame; saves are silent.
- **Grey pen**: the site blocks frames. One tap opens the helper (a small window on desktop that stays; on phones a
  tab that closes itself within a couple of seconds and drops you back on the article). On phones every save then
  flashes that tab once.
- **"Sign in to Diigo"**: the browser has no Diigo login cookie; sign in at diigo.com in that browser.
- **"Popups isolated"** or **"Popup blocked"**: the site blocks frames and severs or blocks popups, so no channel
  to Diigo could be opened.
- **"Helper unreachable"**: the helper page did not answer within a few seconds.

## Develop

```
npm install
npm test          # node:test unit tests (anchoring, ids, URLs)
npm run build     # dist/client.js, dist/client.dev.js, docs/ (install page + helper)
npm run serve     # http://localhost:8765/ serves docs/
```

`docs/` is the built static site and is committed so GitHub Pages can serve it (Settings → Pages → Deploy from a
branch → `main`, folder `/docs`). Pages caches files for ten minutes, so helper URLs carry the build stamp and a
new bookmarklet always fetches matching helper code. `dist/client.dev.js` is the client with the helper origin from
`DL2_HELPER` (default `http://localhost:8765`) baked in, for injecting into pages during testing. `docs/test.html`
is a playground page with repeated phrases for exercising the anchoring. Running the bookmarklet a second time on a
page hides or shows its UI.

## Testing on a real Android phone

Enable USB debugging, plug the phone in, then forward Chrome's DevTools socket and drive it with the script in
`tools/`:

```
adb shell cat /proc/net/unix | grep devtools_remote      # find Chrome's socket (other Chromium browsers have their own)
adb forward tcp:9301 localabstract:chrome_devtools_remote_<pid>
CDP_PORT=9301 node tools/phone.mjs tabs
CDP_PORT=9301 node tools/phone.mjs inject <tab> dist/client.dev.js   # DL2_HELPER=https://... npm run build first
CDP_PORT=9301 node tools/phone.mjs listen <tab> 20                  # print the tab's exceptions and console output
adb shell input tap <x> <y>                              # real touches (physical pixels)
```

Synthetic DevTools touch events do not trigger Android's long-press selection; use `adb shell input swipe x y x y 800`
for a long press. Background tabs are frozen on Android and do not answer DevTools calls until brought to the
front (`curl http://localhost:9301/json/activate/<tab>`). Typing a `javascript:` URL into the address bar runs a
Google search instead; the bookmark must be saved through Chrome's bookmark editor (paste into the address field)
and launched by typing its name and tapping the starred suggestion.

## Layout

```
src/lite/          the bookmark: thin client (text nodes, ranges, painting, UI, channel)
src/helper/        the helper: Diigo protocol, anchoring math, JSONP, origin checks
src/bookmarklet/   shared modules: text model (Diigo anchoring), Diigo payloads, url canonicalisation, md5
src/site/          install page + helper page shell
docs/              built site (generated by build.mjs, committed for GitHub Pages)
test/              unit tests
build.mjs          esbuild bundle + site assembly
```
