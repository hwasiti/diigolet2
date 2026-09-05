Reviewed the supplied **Diigo Web Collector 3.5.0** sources without modifying files. All numbered code references below refer to the beautified copies.

This is a source review backed by read-only Node VM checks with mocked Chrome APIs. Those checks reproduced several defects described below. **The Chrome reproduction recipes are proposed tests, not claims of completed browser tests.** Server response schemas are inferred from fields the client reads; no authenticated Diigo traffic was captured.

**1. High — Background listeners are registered too late to reliably receive the event that wakes the worker**

**Source:** [js_bg2.js:1546–1617][bg].

`init()` waits for `getStorage(null).then(...)` before registering `runtime.onMessage`, `tabs.onUpdated`, and `tabs.onRemoved`. Thus, worker evaluation finishes without those listeners registered. Chrome explicitly requires synchronous listener registration for reliable service-worker event delivery. [Chrome’s migration guidance](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers).

The VM check found zero message/tab listeners immediately after importing the complete worker, and one of each after asynchronous initialization.

**Symptom:** The first action after inactivity fails, while repeating it works. Initial bookmark loading, highlighting, and tab-update processing can be missed.

**Reproduction:** Stop the worker, then immediately select text and invoke highlighting, or navigate to a bookmarked page. Repeat cold and warm runs while recording message delivery. Force termination when testing: an attached debugger can affect idle shutdown.

The background message wrapper does return `true` after dispatching to its handlers; the central defect here is **when the listener is registered**, rather than a universally missing asynchronous-response return.

---

**2. High — Worker startup publishes a false logout and can erase a loaded tab’s bookmark state**

**Source:** [js_bg2.js:649–721,1147–1158,1555–1556][bg]; [js_content_diigolet.js:1918–1931,6205–6215][content].

Every worker start calls `resetGlobalData()`. It writes this into `chrome.storage.local`, not just memory:

```js
{ signedIn: false, user: "", /* empty profile, tags, groups, etc. */ }
```

Only afterward does it start checking the cookie. Neither `initialData` nor callers wait for authentication initialization. Moreover, `checkSignInCookie()` calls the asynchronous `onUsernameSeen()` without awaiting it.

This produces two problems:

- During initialization, a genuinely signed-in user can receive `globalData.user === ""`.
- Once the cookie is recognized, startup treats the user as newly signed in and broadcasts `signIn` to existing tabs.

The content script’s `signIn` handler checks whether the old bookmark is loaded, then calls `l.reset()`. That reset replaces the bookmark with a fresh, unsaved bookmark, but leaves `l.generated` and existing annotations intact. If the bookmark was already loaded, it skips reloading it first.

**Symptom:** Intermittent “Please sign in first”; existing bookmarks temporarily become “unsaved”; subsequent actions can submit empty tags/descriptions instead of preserving the loaded metadata.

**VM reproduction:** A loaded private bookmark with `tags: ["keep"]` became an unsaved bookmark with empty tags, while `generated` remained `true` and no reload was requested.

**Browser reproduction:** Load a saved bookmark with distinctive tags and description. Stop and wake the worker while leaving the page open. Observe the subsequent `signIn` message and inspect the next highlight/save request. It can use `bm_saveBookmark` instead of `annotation_add`, carrying reset bookmark metadata. Whether that overwrites existing server metadata should be checked with a disposable bookmark.

---

**3. High — API fetches do not request credentials**

**Source:** [js_bg2.js:1971–2020][bg].

The main request is:

```js
fetch(url, {
  method: "POST",
  body: objectToParams(parameters),
  headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  }
})
```

There is no `credentials: "include"`. Fetch defaults to `same-origin`; an extension origin and `https://toolbar3.diigo.com` are different origins. Reading a cookie through `chrome.cookies` does not attach it to subsequent fetches. [Fetch credentials behavior](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials).

The manifest grants sufficient host access through `<all_urls>`, but host permission and fetch credential mode are separate matters.

**Symptom:** The popup recognizes the account while bookmark/annotation requests behave as unauthenticated requests, receive login/error responses, or appear to hang.

**Reproduction:** With a valid Diigo session, capture a worker request and its actual cookie headers. Compare with an explicitly credentialed request using a harmless load operation. Record redirects and response content type as well as status.

**SameSite qualification:** It would be incorrect to assume that `SameSite=Strict` alone prevents extension authentication. Chrome documents special same-site treatment for extension requests with host permission. Cookie domain/path, cookie settings, partitioning, and credential mode still matter. A host-only `www.diigo.com` cookie also does not automatically match `toolbar3.diigo.com`. [Chrome’s cookie documentation](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

The missing option is confirmed. The live server’s precise authentication requirements remain unverified.

---

**4. High — Network failures can leave highlights unsaved indefinitely, and the retry path drops the original annotation**

**Source:** [js_bg2.js:2004–2020][bg]; [js_content_diigolet.js:2334–2362,2754–2784,2956–2998,3096–3104,3227–3228][content].

The main fetch chain has:

- No rejection handler.
- No HTTP-status check before parsing JSON.
- No timeout or `AbortController`.
- No completion callback when fetching or `response.json()` fails.

An HTML login page, proxy error, HTTP 502 page, empty response, or connection failure therefore prevents `complete()` from running.

The worker also stopped forwarding HTTP status consistently: for only three commands it assigns `e.status = f.status`, where `f` is the **parsed JSON**, not the HTTP response.

Highlights are painted before the save request completes. Deletions and recoloring also update the local display optimistically, without a reliable rollback path.

A separate failure exists when `bm_saveBookmark` reaches its failure handler: it retries using `saveBookmark(null, ...)`. A first highlight was supplied through the original call’s optional `annotation` argument, so the retry omits it.

**Symptom:** A highlight appears successful but disappears after reload; a deleted highlight returns; a retry saves a bookmark without its highlight.

**Reproduction:**

1. Intercept an annotation/save request and return HTML, or abort the request. Observe the visible highlight and absence of a completion/error recovery.
2. For a first highlight, return a correctly enveloped JSON failure for `bm_saveBookmark`; inspect the retry’s `json` field. Its embedded annotation is absent.

The VM check confirmed that an HTML-response parse failure produced an unhandled rejection and **zero completion callbacks**.

---

**5. High — Multi-key preference reads break privacy defaults and all seven configurable shortcuts**

**Source:** [js_storage.js:585–596][storage]; [js_bg2.js:1147–1158,1621,1698–1703][bg]; [js_content_diigolet.js:1827–1841,5160–5164,6640–6651,6718–6747][content].

`getStorage(["key1", "key2"])` returns an array of values:

```js
["true", "A"]
```

However, its consumers expect an object:

```js
prefs["prefs.shortcutAnnotate"]
prefs["prefs.bookmark.privateByDefault"]
```

Consequently:

- Every named preference lookup in the global shortcut handler is `undefined`.
- `initialData.preloadedPrefs` is an array, and the content cache stores numeric keys.
- `va.fromDocument()` consequently defaults the bookmark to `mode: 0`, meaning public, instead of the configured private default.
- Some popup hints and permission/trial preference logic have the same mismatch.

**Symptom:** Configured shortcuts do nothing; some save/read-later paths disregard “private by default.”

**Reproduction:** Set the private preference to `"true"`, then request it through `getPrefs` with an array of keys. Inspect the response and a new unsaved page’s bookmark mode. On a disposable page, inspect a Read Later request’s `mode`. Try the configured shortcuts separately.

**Qualification:** First-highlight creation separately reads `chrome.storage.local` and can explicitly apply private mode at [js_content_diigolet.js:3181–3186][content]. Therefore, this is not evidence that every newly created highlight is public.

The preference-array mismatch was reproduced in the VM.

---

**6. High — Any website can send messages into privileged extension workflows and obtain library metadata**

**Source:** [js_content_diigolet.js:662–667,6761–6843,9889–9891][content]; [js_bookmark-window.js:603–647][bookmark].

The content script’s `window.message` handlers do not validate `event.origin` or `event.source`. Recognized messages include:

- `createList`
- `qdeletebookmark`
- `start-upload-image`
- `onload`, which changes stored outliner preferences
- `ifbookmark`, which requests bookmark/library context

Replies to `ifbookmark` contain bookmark information, lists, outliners, groups, tags, tag counts, permissions, and recent tags. `Va()` sends that data to whichever DOM element currently has ID `diigo-bookmark-frame`, using target origin `"*"`.

The host page controls the shared DOM and can create or replace that iframe.

**Symptom/security impact:** A visited page can trigger extension actions or receive account/library metadata without going through the intended extension UI. Actual server writes may currently be obstructed by defect 3, but that does not repair this trust boundary.

**Reproduction:** On a controlled test page, create a same-origin iframe named `diigo-bookmark-frame`, register a message listener inside it, and post `{type: "ifbookmark"}` to the parent window. With account data loaded, inspect the `sendCtx` response. For action tests, intercept outgoing requests rather than altering a real library.

The manifest exposes `bookmark-window.html`, `reader.html`, `process.html`, and other resources to all sites. That increases the importance of authenticating these message channels.

---

**7. High — Stored annotation HTML is inserted into the live page without adequate sanitization**

**Source:** [js_content_diigolet.js:4071–4094,4582–4602,5870–5882,9481–9484][content]; [js_options2.js:110–121][options].

Examples include:

- Orphan-highlight content inserted with `.html(a.content)`.
- `html2txt_pretty()` placing supplied highlight HTML into `document.body`.
- Server-provided names and group labels interpolated into HTML.
- Outliner/list titles concatenated into options-page markup.

`stripScripts()` only removes matching `<script>...</script>` text. It does not remove event attributes, dangerous elements, or unsafe URLs.

**Symptom/security impact:** Markup injection is definite. Script execution depends on the sink and applicable CSP; it should not be assumed to grant direct service-worker privileges. Even when execution is blocked, attacker-controlled markup and resource requests remain undesirable.

**Reproduction:** Intercept a bookmark-load response and supply an orphan annotation containing harmless marker markup, then an image with an `onerror` handler that sets a test DOM attribute. Open the orphan UI on a controlled page and inspect the result.

Some comment paths use escaping helpers such as `H.content2Html()` at [js_content_diigolet.js:1215–1220][content]. The unsafe behavior is not universal across every comment renderer.

---

**8. Medium — Autoload depends on fragile, ephemeral preload state**

**Source:** [js_bg2.js:781–843,1595–1597][bg]; [js_content_diigolet.js:2918–2945,6411–6424,6687–6701][content].

`Preloader.table` exists only in worker memory. On a `"loading"` event, preloading requires the user already to be recognized. The tab handler calls `Preloader.onTabUpdated()` before initiating that event’s cookie recheck.

On `"complete"`:

- If no table entry exists, it logs the missing entry and stops.
- If loading finished without a valid result, it dereferences `result.annotations`.

The content script has a fallback load path, but ordinary initialization loads bookmark data without necessarily painting it: painting in `cb_bm_loadBookmark_success()` is conditional on `"showbar"`.

**Symptom:** Existing highlights fail to appear automatically, while opening the toolbar or reloading later may reveal them.

**Reproduction:** Stop the worker between a page’s loading and completion events, or delay cookie recognition until after `"loading"`. Compare `Preloader.table`, load requests, `run: autoshow`, and actual highlight elements.

Also distinguish intentional account restrictions from defects: autoload preferences and `autoShowAnnotation` permissions exist. However, the trial-count handling is itself affected by the array/object mismatch in defect 5.

---

**9. Medium — Cancellation does not cancel fetch, and late preload completions access the wrong tab entry**

**Source:** [js_bg2.js:805–822,835–840,2000–2020][bg].

`cancel()` still tries to abort `this.xhr`, but requests now use fetch and never assign that XHR.

A preload completion executes:

```js
e.table[tabId].loading = false;
```

before checking `m.cancelled`. By then, the entry may have been deleted or replaced by another navigation.

**Symptom:** Exceptions after navigating away or closing a tab; a new navigation’s preload can be incorrectly marked finished; autoshow subsequently fails.

**Reproduction:** Delay `bm_loadBookmark`, then navigate the tab again or close it before releasing the response. Observe access to the missing/replaced entry.

The VM confirmed that a canceled fetch still called completion. It also reproduced the `"complete"` handler’s exception when an entry lacked a valid result.

---

**10. Medium — Context menus remain visible after restart, but their click handler is missing**

**Source:** [js_bg2.js:1629–1642,1770–1777,1851–1927][bg].

The click listener is registered inside `createContextMenu()`. Startup’s `ContextMenu.init()` only registers a preference observer.

On fresh storage, initializing the missing `prefs.contextMenu` preference triggers menu creation and listener registration. On later worker starts, the preference already exists, so that path does not run.

This is more precise than saying the listener is literally registered inside `onInstalled`: it is effectively tied to initial preference creation, or subsequent changes through the observed preference path.

**Symptom:** Right-click → Diigo → Highlight works initially, then silently stops after worker termination.

**Reproduction:** Test a menu action immediately after installation, terminate the worker, and repeat. The VM found one context-menu listener on fresh storage and zero on restart with the preference already set.

The observer also calls `createContextMenu()` when the preference changes to false; it does not branch to `removeContextMenu()`. Repeated creation risks duplicate-ID errors and duplicate listeners.

---

**11. Medium — Authentication state does not track cookie changes cleanly, and logout leaves stale content-script identity**

**Source:** [js_bg2.js:674–701,723–734,2017–2018][bg]; [js_content_diigolet.js:573–595,1918–1931,6217–6218][content].

The sign-in detector:

1. Reads only `diigoandlogincookie` for `https://www.diigo.com`.
2. Uses `cookie.value.split("-.-")[1]` as the username.
3. Treats that username as evidence of sign-in.

There is no `cookies.onChanged` listener in the reviewed worker path. Refresh depends on startup/tab events. API responses update the detected username only when `response.user` is truthy; an empty user does not directly trigger logout there.

On the content side, `Hb()` unpaints annotations and calls `l.reset()`, but that reset does not clear `l.user`, `l.signedIn`, `l.generated`, or the annotation array.

**Symptom:** Popup and page disagree about the account; an open page retains an old identity after logout or account changes.

**Reproduction:** Keep an annotated page open while signing out or switching accounts elsewhere. Inspect its isolated-world context before and after the worker’s `signOut` message.

**Cookie-persistence conclusion:** I found no demonstrated deletion of the Diigo login cookie in this path. The extension reads it; browser/server cookie attributes determine its persistence. The startup state reset is a strong explanation for apparent “cookie loss” even when the cookie remains present. A malformed or absent legacy cookie can also defeat detection, but whether Diigo currently creates such a situation needs live inspection.

---

**12. Medium — SPA navigation and later DOM replacement are not handled as new annotation documents**

**Source:** [js_bg2.js:787–824][bg]; [js_content_diigolet.js:1918–1928,2918–2942,3783–3806,6124–6136][content].

There is no general `pushState`/`popstate`/`hashchange` integration that resets bookmark context and reloads annotations. The preload handler processes status changes, rather than treating every changed URL as a new document.

The content script also lacks general observation and restoration of highlight-bearing DOM. Its visible `MutationObserver` is specifically for Kindle notebook changes.

**Symptom:** Highlights disappear after a framework rerender; a new SPA route retains old bookmark data; a new highlight can be associated with the previous route.

**Reproduction:** Highlight on route A, use `history.pushState()` and replace the article with route B without reloading, then highlight again. Inspect the submitted URL and `urlId`. Separately replace a highlighted subtree and observe whether the wrappers are restored automatically.

---

**13. Medium — Frames and Shadow DOM are outside the highlighting model; editable content is not protected**

**Source:** [js_content_diigolet.js:2042–2049,3779–3809,4020–4068,4131–4148][content]; raw manifest.

The manifest does not set `all_frames`. The manual launch path additionally checks `window.top != window.self` and refuses frame operation.

Text indexing recursively follows `firstChild`/`nextSibling` from `document.body`; it never traverses `shadowRoot`. There is no general `contenteditable`/`isContentEditable` exclusion.

**Symptom:**

- Text inside an embedded reader/editor cannot be highlighted from the top frame.
- Shadow-tree text is missing from the index or cannot be restored.
- Highlighting editable text inserts `<em>` wrappers into the editor’s own document and can conflict with its model.

**Reproduction:** Compare identical text in the main document, an iframe, an open shadow root, and a `contenteditable` element. For the editable example, inspect both serialized editor HTML and behavior after typing/rerendering.

Input and textarea elements are explicitly blacklisted; ordinary editable elements are not.

---

**14. Medium — Quote-plus-occurrence anchoring can silently move highlights to the wrong text**

**Source:** [js_content_diigolet.js:3783–3806,3854–3901,4020–4068][content].

Restoration searches normalized document text for the saved quote and occurrence number. It stores no robust surrounding-text context or structural selector.

Two particularly concrete problems:

- Adding/removing an earlier occurrence shifts the target.
- If fewer occurrences now exist than the stored `nth`, `seek()` deliberately falls back to the **last available occurrence**, rather than reporting an unresolved highlight.

The index also includes text in hidden elements, because its filter does not test visibility.

**Symptom:** An old highlight appears on the wrong repeated phrase instead of being marked orphaned.

**Reproduction:** Save a highlight on the third occurrence of a sentence. Remove the first two occurrences, reload, and observe the fallback. Also test insertion of a hidden duplicate before the visible target.

Overlapping selections are separately rejected when they contain or touch existing Diigo highlight/UI elements. The error text says 5–2000 characters, but the implemented upper check is `c.txt.length > 3000`; there is no corresponding five-character minimum check.

---

**15. Medium — Several background branches still require a window or removed messaging APIs**

**Source:** [js_bg2.js:973–975,998–1015,1287–1288,1332–1336,1518–1529][bg]; [js_cachePage.js:289–319][cache]; [js_crossPromotion.js:596–604][promotion]; [js_popup.js:1597–1613][popup].

Examples:

| Branch | Defect |
|---|---|
| `captureVideo` | Uses `document`, jQuery, canvas DOM, and `new Image` in the worker. |
| `googleEvent` | `window.ga && ...` throws because `window` itself is absent. |
| `newtip` | Calls `window.open`. |
| Unsupported-page toolbar path | Calls `alert` in the worker. |
| Cache transaction checking | Calls `$.each`, although the worker imports no jQuery. |
| Promotion loading | Calls `$.ajax` in the worker. |
| `doc_html` relay | Calls `chrome.tabs.sendRequest`. |
| Legacy popup screenshot subcommands | Call `chrome.extension.sendRequest`. |

The old request APIs are marked MV2-only in Chrome’s documentation. [Tabs API](https://developer.chrome.com/docs/extensions/mv2/reference/tabs/), [extension API](https://developer.chrome.com/docs/extensions/mv2/reference/extension/).

**Symptom:** Particular secondary features fail with `ReferenceError` or “not a function.”

**Reproduction:** Invoke the relevant handler while watching the worker console; for cache/promotion flows, use mocked successful upstream responses to reach the failing branch.

These are branch-specific defects. The ordinary content script’s main highlighting transport uses `runtime.sendMessage`, and the normal screenshot entry uses newer messages.

Also, the helper declared as `postMessageRefreashPage` at [js_bg2.js:616–619][bg] is referenced as `postMessageRefreshPage` at [js_bg2.js:1084–1091][bg]. That outliner-refresh branch fails on the spelling mismatch. A function containing `window.postMessage` would be legitimate if correctly passed for execution in a page; its mere declaration in the worker is not itself a failure.

---

**16. Medium — Concurrent updates to stored account data can overwrite one another**

**Source:** [js_storage.js:613–621][storage].

`updateStorage()` performs an unsynchronized read–merge–write. Two callers can read the same old object, merge different fields, then each replace the entire stored object. The later write loses the other caller’s changes.

It also does not await/return the `saveStorage()` promise, so completion of `updateStorage()` does not mean its write has completed.

**Symptom:** Stored profile, permissions, or account state intermittently disagrees with worker memory or another UI.

**Reproduction:** In a harness, hold two `getStorage("globalData")` callbacks until both updates are pending, return the same original object, then allow both writes. Inspect the lost field.

Regarding error handling: `runtime.lastError` is checked in `saveStorage()` at [js_storage.js:579–580][storage]. It is **not** generally checked in the main content-script messaging callbacks, cookie reads, or storage reads. “Never checked anywhere” would therefore be inaccurate.

---

**17. Medium — The “Please sign in first” notification’s link does nothing**

**Source:** [js_content_diigolet.js:573–575,6864–6872][content].

The notification creates an anchor with `id="signIn"` and `href="#"`. Its handler condition is:

```js
"team_url" == !$(this).attr("id")
```

That compares `"team_url"` with a boolean. It is false for both the sign-in anchor and the team link.

**Symptom:** The user follows the instruction to sign in, clicks the notification’s link, and no sign-in window opens.

**Reproduction:** Trigger the signed-out highlight warning and click its link. The popup’s separate sign-in button at [js_popup.js:1481–1482][popup] uses a different handler and is not affected by this particular typo.

---

**18. Low — UI initialization changes the page’s body ID and assumes an HTML body exists**

**Source:** [js_content_diigolet.js:598–614,2033–2039,2094–2098][content].

`qa()` assigns `dummybodyid` when the body has no ID and prefixes IDs that do not begin with a letter. That can break the host page’s ID-based CSS or JavaScript.

It also dereferences `document.body` unconditionally, as does snapshot collection. A retry exists in one early-loading notification path, but it is not a general guard around these operations.

**Symptom:** Host-page behavior changes after Diigo initializes; special documents or pages that remove their body can produce unhandled exceptions.

**Reproduction:** Use a page whose body has `id="9"` and whose code depends on `getElementById("9")`. Initialize Diigo and inspect the ID. Separately test a document with no HTML body.

For ordinary HTML, `document_end` runs after DOM construction; it should not itself be blamed for a routine “body not parsed yet” race. [Chrome content-script timing](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

---

**19. Low — Returning to the original tab after login relies on lost memory**

**Source:** [js_bg2.js:1180–1182,1578–1583][bg]; [js_content_diigolet.js:591–595][content].

`D.activateTheTabIdAfterSignIn` is only an in-memory field. It disappears if the worker stops while the user is completing login.

**Symptom:** Login completes but the original page is not reactivated correctly.

**Reproduction:** Start the extension’s login flow, terminate its worker before completing login, then finish the redirect.

`tabs.update({selected: true})` is deprecated, but remains documented; it is not equivalent to the removed `sendRequest` APIs. Use `active` for an explicit activation operation in the replacement. [Current Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

---

**20. Low — Avoid copying the broad disclosure, logging, and embedded-secret patterns**

**Source:** [js_bg2.js:787–807,1251–1272,1547–1548,2076–2117][bg]; [js_twitter.js:572–576,704–737][twitter]; raw manifest.

Relevant observations:

- Preloading sends applicable visited URLs to Diigo even when `prefs.autoload` is false; that preference gates showing annotations, not the initial load request.
- Install/login telemetry posts to `https://www.diigo.com/stats`.
- The Bitly URL embeds a shared API key. The shortening code additionally references nonexistent `req`, then falls back to the original URL.
- Twitter OAuth includes a consumer secret in distributed code. Stored tokens are merely Base64/ROT13 encoded, and the token-loading path logs decoded credentials.
- Worker logging prints all stored options and API response objects.
- Web-accessible resources are exposed to `<all_urls>`, including executable extension pages. This is a specific resource list, not unrestricted exposure of every extension file.

**Reproduction:** Observe requests and logs while opening an ordinary page, signing in, shortening a URL, and loading stored Twitter authentication. Do not copy actual credentials into test reports.

**Items not established as defects**

- **A page overriding `$`, jQuery, or `Array.prototype`:** The manifest’s content scripts run in an isolated world. Ordinary main-world overrides do not replace their JavaScript globals/prototypes. Shared DOM, CSS, and events can still interfere. Merely bundling jQuery 1.8 does not prove a particular modern-site failure. [Chrome’s isolation documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).
- **Strict `style-src` or `img-src` automatically breaking highlighting:** Inline stylesheet creation is confirmed at [js_content_diigolet.js:598–614][content], but its failure under a particular page policy was not browser-tested. Execution world and Chrome’s CSP handling matter. Test nonce-only/style-blocking/image-blocking fixtures and inspect computed styles, resource failures, and CSP violations; do not infer failure from the header alone.
- **A wrong hardcoded extension ID:** The development ID in CSS/templates is replaced by `Ba()` at [js_content_diigolet.js:447–464][content].
- **Every exception aborting the entire extension:** An uncaught exception aborts its current execution path. Many failures here occur in callbacks while other listeners remain installed.

The content script and its connected panels expose the following feature set. “Present” means the implementation exists, not that its current server integration was verified.

| Feature | Implemented behavior | Beautified source |
|---|---|---|
| Text highlights | Yellow, blue, green, pink; remembered color; selection popup; toolbar highlighting; continuous highlighter pen; recolor/delete | [js_content_diigolet.js:1695–1746,1869–1872,5796–5820][content] |
| Highlight notes | Add private inline notes; edit/delete notes; group comments and sharing | [js_content_diigolet.js:3265–3313,4151–4322][content] |
| Floating sticky notes | Independent type-2 annotation; draggable position; private/group note UI | [js_content_diigolet.js:1751–1759,2504–2584][content] |
| Annotation navigation | Annotation list, jump to highlight, individual/all copying, scroll markers, orphan-highlight warnings and copying | [js_content_diigolet.js:2281–2302,9470–9541,9621–9680][content] |
| Bookmark organization | URL/title, description, tags, privacy, unread state, lists/outliners, groups, share-existing-annotations option | [js_content_diigolet.js:2956–3001,5136–5176][content] |
| Focused Research | Reuse remembered tags, privacy, description, groups and outliner/list settings | [js_content_diigolet.js:2997,3169–3186][content]; [js_options2.js:542–556][options] |
| Read Later | Save/toggle unread status; optionally close the tab afterward; auto-close default is enabled | [js_content_diigolet.js:3076–3079,6369–6370][content]; [js_bg2.js:1663][bg] |
| Share | Annotated links, individual-highlight links, email with optional quoted annotations, Facebook/Twitter and legacy Google integrations | [js_content_diigolet.js:3403–3419,7433–7682][content] |
| Outliner | Online sidebar, opening/closing and remembered destination, text/highlight/image drag-and-drop, list creation | [js_content_diigolet.js:2786–2831,9839–9948][content] |
| Clean reader | Embedded reader and annotation-list integration | [js_content_diigolet.js:9762–9836][content] |
| Screenshot/image collection | Screenshot entry and editor integration; image upload/save/attach; legacy visible/selected/entire screenshot subcommands also remain | [js_popup.js:1575–1613][popup]; [js_content_diigolet.js:2833–2871][content] |
| Video-frame capture | Capture a frame through canvas, with a cross-origin retry path; upload/attach result | [js_content_diigolet.js:6070–6114][content] |
| Search | Search Diigo+Google for selected text; Google-query recommendations; worker-side combined-search integration | [js_content_diigolet.js:5673–5680,6439–6442][content]; [js_bg2.js:1597–1607,1933–1936][bg] |
| PDF | Open the bundled PDF viewer; separate PDF-related UI | [js_bg2.js:1325–1330][bg]; [js_popup.js:1615–1621][popup] |
| Page cache | Snapshot page HTML/text and upload; MHTML integration | [js_content_diigolet.js:2076–2135,6253–6260][content]; [js_cachePage.js:200–336][cache] |
| Kindle import | Read notebook highlights/notes and initiate import, subject to permission | [js_content_diigolet.js:6119–6176][content] |

The default global shortcuts are defined at [js_bg2.js:1650–1680][bg] and handled at [js_content_diigolet.js:6718–6747][content]:

| Default | Action |
|---|---|
| Ctrl+Alt+D | Bookmark |
| Ctrl+Alt+R | Read Later |
| Ctrl+Alt+A | Show annotation tools |
| Ctrl+Alt+T | Annotate Article / clean reader |
| Ctrl+Alt+P | Open PDF annotation |
| Ctrl+Alt+S | Screenshot |
| Ctrl+Alt+O | Toggle outliner sidebar |

These use JavaScript `ctrlKey`/`altKey` checks, not manifest `commands`. They do not automatically become Command+Option on macOS. All seven are affected by defect 5.

Additional panel keys include Ctrl/Cmd+S to save a private note, Ctrl+Enter to submit a group comment, and Enter/Escape behavior in the bookmark dialog. [js_content_diigolet.js:4295–4296,4757,5034–5035][content].

**Legacy-code classification**

| Component | Classification |
|---|---|
| `js_bg.js` | Not imported by the declared worker; do not attribute its behavior to the active background path. |
| `js_diigolet-c.js` | **Not wholly dead.** It is absent from ordinary webpage injection, but raw `reader.html` loads it; the active content script opens that reader at [js_content_diigolet.js:9811–9818][content]. |
| ZeroClipboard | Flash-based legacy bundle imported by `reader.html`. The ordinary content script’s copy path uses messaging and `document.execCommand`, at [js_content_diigolet.js:6263–6286][content]. Remaining `copyClient` fields alone do not establish active Flash usage. |
| Twitter OAuth | Still imported and wired to message handlers; not dead code. Uses the legacy PIN/OAuth flow and API 1.1 endpoints. Live operability was not checked. [js_bg2.js:1231–1249][bg]; [js_twitter.js:572–636][twitter]. |
| Google Buzz / Google Reader / Google+ | Obsolete integration branches remain, including `gBuzz_viaGoogleReaderDeprecated` and Google Reader form submissions. [js_content_diigolet.js:7552–7663][content]. |
| Old full-width toolbar | Legacy markup/controller remains alongside the active panel. Its inline event handlers should not be treated as the implementation of every current toolbar action. [js_content_diigolet.js:3421–3528][content]. |
| `js_options2.js` | Still loaded by the options page; not an unused copy. |

The wire protocol below describes the **ordinary webpage content-script → worker → Diigo API path**.

**Transport and envelope**

**Source:** [js_bg2.js:1019–1033,1971–2025,2121–2125][bg]; [js_content_diigolet.js:2750–2784][content].

```text
POST https://toolbar3.diigo.com/chappai/pv=13/ct=tb/cv=3.5.0/user={username}/cmd={command}/
Content-Type: application/x-www-form-urlencoded
```

The body contains URL-encoded fields:

```text
cmd={command}
v=13
_nocache={Math.random()}
json={JSON.stringify(commandPayload)}
user={username}
transId={transactionId}
```

`objectToParams()` applies `encodeURIComponent` to keys and values and leaves a trailing `&`.

The worker’s default configuration is the `www` configuration. `user_signIn` has a special URL without the `/user=.../` segment. A separate grouped-PDF branch posts `{cmd, extra, image}` to the supplied `src_url`; that is not the normal annotation protocol.

The expected response envelope is:

```json
{
  "cmd": "annotation_add",
  "transId": 17,
  "code": 1,
  "user": "alice",
  "result": {}
}
```

This is a **client-inferred envelope**, not a captured server example:

- `code === 1`: success.
- `code === 0`: command-specific failure dispatch.
- `cmd`: selects the content script’s response handler.
- `transId`: selects and deletes a registered callback.
- Truthy `user`: updates worker sign-in state.
- `result`: command-specific data.
- Some paths also inspect a JSON `status`; it is not reliably populated from HTTP status.

The content script increments its own transaction counter from 1. The worker uses that supplied ID or a worker-local counter starting at 1. Counters restart with their respective contexts. Reuse across different tabs is not automatically a collision because callbacks live in separate content-script contexts. Missing/mismatched response IDs can leave registered callbacks unresolved; there is no durable pending-operation log or established idempotency mechanism.

**`bm_loadBookmark`**

**Source:** [js_content_diigolet.js:2908–2945][content]; [js_bg2.js:805–807][bg].

Content-script payload:

```json
{
  "url": "https://example.test/article",
  "what": "bookmarkInfo annotations pageComments",
  "permalinkParams": null
}
```

The background preloader sends `url` and `what`, omitting `permalinkParams`.

For permalink launch modes, `permalinkParams` may contain `user`, `key`, `mode`, `url`, and `legacy`; its URL replaces the normal request URL.

Fields consumed from `result`:

```text
url
urlId
annotated
groups
saved
b_id

bookmarkInfo:
  title, mode, tags, unread, alert, description,
  datetime, onlyInGroup, lists, outliners

annotations[]:
  id, user, realName, mode, type, content,
  datetime, extra, groups, onlyInGroup, comments[]

pageComments[]
```

Loaded annotations are marked `saved: true`. Their comments are associated with the enclosing annotation’s ID.

Common comment fields consumed elsewhere are:

```text
id, annotationId, user, realName, mode, datetime,
datetime2, content, userOnline, groups, onlyInGroup
```

Not every field above is necessarily mandatory in every response.

**`annotation_add`**

**Source:** [js_content_diigolet.js:3153–3210][content].

```json
{
  "urlId": "existing-page-id",
  "id": "client-generated-highlight-id",
  "content": "<b>Selected text</b>",
  "type": 0,
  "extra": {
    "nth": 2,
    "color": "yellow",
    "top": 420,
    "left": 32
  },
  "groups": []
}
```

Details:

- `content` is selected **HTML**, not merely plain text.
- Type `0` is a text highlight; `1` is an image annotation; `2` is a floating note.
- `groups` normally contains names of bookmark groups shared by the current user. New type-2 annotations use `null`.
- `inlineComment` may be supplied.
- Painting can add `top`/`left` before the request is sent.

Fields consumed from the success result:

```text
id
onlyInGroup
groups?
__bookmark_groups?
inlineComment?
annPermission?
```

The client finds its existing local annotation using the returned ID and marks it saved.

**Important:** If the bookmark is not yet saved, this command is not used. The annotation is embedded in `bm_saveBookmark`.

**`annotation_delete`**

**Source:** [js_content_diigolet.js:3212–3225][content].

Personal annotation:

```json
{
  "urlId": "page-id",
  "id": "annotation-id"
}
```

Group copy:

```json
{
  "urlId": "page-id",
  "idInGroup": "group-annotation-id"
}
```

The success handler only consumes optional `result.annPermission`. Local removal happens before success, with no dependable failure rollback.

**`annotation_update` — the observed command is actually `annotation_updateExtra`**

**Source:** [js_content_diigolet.js:3353–3365,4315–4322,5796–5805][content].

I found no ordinary `annotation_update` invocation in the examined active/alternate annotation code.

Recoloring and position changes use:

```json
{
  "urlId": "page-id",
  "id": "annotation-id",
  "idsInGroup": ["group-copy-owned-by-current-user"],
  "extra": {
    "nth": 2,
    "color": "pink",
    "top": 420,
    "left": 32
  }
}
```

`idsInGroup` is derived from annotation groups whose `user` matches the current user.

There is no dedicated success-result handler establishing a more specific response schema. Do not invent one from the command name.

Note text uses separate comment commands, particularly `ic_add`, `ic_edit`, and `ic_delete`; page comments use `pc_add`/`pc_delete`.

**`bm_saveBookmark`**

**Source:** [js_content_diigolet.js:2956–3094][content].

Base content-script payload:

```json
{
  "url": "https://example.test/article",
  "mode": 2,
  "title": "Article title",
  "tags": ["tag-one"],
  "description": "Description",
  "unread": false,
  "groups": [],
  "shareExistingAnnotations": false,
  "lists": []
}
```

`mode: 0` means public; `mode: 2` means private. Groups/lists can also be `null` in the client’s initial state.

A first highlight adds:

```json
{
  "annotation": {
    "id": "client-generated-id",
    "content": "<b>Selected text</b>",
    "type": 0,
    "groups": [],
    "extra": {
      "nth": 2,
      "color": "yellow"
    }
  }
}
```

The nested annotation omits `urlId`, unlike standalone `annotation_add`.

Optional nested structures:

```text
pageComment:
  content, mode, groups, justForGroups

annotation.inlineComment:
  mode, content, groups, justForGroups
```

Research-mode settings can override privacy, unread status, description, tags, groups, and lists.

Fields consumed from the save result:

```text
url, urlId, b_id, datetime, alert
groups
lists?
pageComment?
annotation?
result_shareExisting?
```

`annotation` may contain `id`, `groups`, `inlineComment`, and `annPermission`. `result_shareExisting` contains annotation/page-comment group-sharing updates.

Popup/bookmark-window paths forward their data objects through the worker and may include UI fields such as `tabId` and cache-related flags. See [js_bg2.js:960–962,1197–1200][bg].

**`user_loadMyStuff`**

**Source:** [js_bg2.js:736–778][bg]; [js_content_diigolet.js:3315–3351][content].

```json
{
  "what": "myTags myGroups myProfile myBookmarkLists myContacts permissions"
}
```

The content script can request a subset, such as `"permissions"`.

Fields consumed from `result`:

```text
myTags
myTagsWithCount
myGroups
myList
outliners
myProfile.realName
myContacts
permissions
```

The naming mismatch is significant: the request says `myBookmarkLists`, while the content handler reads `myList` and assigns it to its internal `myBmLists`.

Observed permission fields include `autoShowAnnotation`, `snapshot`, `createOutliner`, `importKindle`, and nested quota/permission objects such as `annPermission`.

**Highlight identity and DOM-range compatibility**

**Source:** [js_content_diigolet.js:312–444,1695–1707,2203–2224,2330–2333,3783–4091][content].

For a new ordinary text highlight:

```text
content = serialized selected HTML after stripScripts()
nth = occurrence count computed at selection time

urlId = server-provided bookmark.urlId
        or, if absent, legacyMD5(window.location.href)

id = legacyMD5(content + user + urlId + nth)
```

There are **no separators** between the concatenated fields. `nth` is then copied into `extra.nth`; color goes into `extra.color`.

Saved annotations retain their supplied IDs. Floating notes use a random/time-derived ID; the special `"video"` path hashes content alone.

The MD5 helper has an important compatibility quirk: it packs `charCodeAt()` values directly into words without first UTF-8 encoding the string and without masking each value to eight bits. A normal UTF-8 MD5 library therefore produces different results for non-ASCII input.

VM-verified vectors:

| Input | Official helper |
|---|---|
| `abc` | `900150983cd24fb0d6963f7d28e17f72` |
| `\u00e9` | `3406877694691ddd1dfb0aca54681407` |
| `\u6f22\u5b57` | `17f7fef0defb15436c93f0f1d8f1f21b` |
| `\ud83d\ude00` | `2843eed96aa1750ead0763263455f324` |

An ASCII compatibility example:

```text
url     = https://example.test/article
urlId   = 669b8d9449f413a60c141ff85c266386
content = <b>Hello world</b>
user    = alice
nth     = 2

id      = ef44d9661827677f8418a517e524b3ae
```

`nth` computation and restoration proceed as follows:

1. **Capture HTML.** Clone the selected DOM range into a temporary `<div>`, serialize its HTML, and remove matching script blocks. [js_content_diigolet.js:4030–4046,4071–4076][content].
2. **Normalize the quote.** Parse that HTML, traverse eligible text nodes, concatenate their values, collapse whitespace to spaces, and trim. [js_content_diigolet.js:4078–4091][content].
3. **Count occurrences up to the selected end.** Traverse eligible body text in DOM order, stopping at the selection’s end container/offset. Normalize whitespace and count quote occurrences. Searching advances by one character, so overlapping matches count. That count becomes `nth`. [js_content_diigolet.js:3854–3856,4050–4068][content].
4. **Build a restoration index.** `domSnapshot()` records normalized text and a mapping back to DOM text nodes. It excludes blacklisted tags and Diigo UI, but includes existing highlight text and does not traverse frames or shadow trees. [js_content_diigolet.js:3779–3806][content].
5. **Find the occurrence.** `seek(content, extra.nth)` locates the normalized quote, defaulting a falsy `nth` to 1 and falling back to the last match if too few remain. [js_content_diigolet.js:3858–3901][content].
6. **Recover offsets and paint.** It maps the match to start/end nodes, reconstructs offsets accounting for whitespace normalization, splits text nodes, and wraps pieces in `<em>` elements with classes such as `diigoHighlight`, `id_<id>`, `type_0`, and the color. [js_content_diigolet.js:3823–3852,3903–3969][content].

For compatibility, preserve existing IDs and the legacy quote/occurrence representation when reading stored highlights. Stronger anchoring can be added alongside that representation; it should not require recomputing existing IDs.

[bg]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_bg2.js
[storage]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_storage.js
[content]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_content_diigolet.js
[popup]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_popup.js
[options]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_options2.js
[bookmark]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_bookmark-window.js
[cache]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_cachePage.js
[promotion]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_crossPromotion.js
[twitter]: C:/Users/Haider/AppData/Local/Temp/claude/E--Projects-diigolet2/386d3875-6233-4c5d-bc12-e562b90d152d/scratchpad/pretty/js_twitter.js
tokens used
22,620
Reviewed the supplied **Diigo Web Collector 3.5.0** sources without modifying files. All numbered code references below refer to the beautified copies.

This is a source review backed by read-only Node VM checks with mocked Chrome APIs. Those checks reproduced several defects described below. **The Chrome reproduction recipes are proposed tests, not claims of completed browser tests.** Server response schemas are inferred from fields the client reads; no authenticated Diigo traffic was captured.

