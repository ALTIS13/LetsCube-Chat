# Logout, task detail and search focus: shared web release

2026-11-06 MSK. LETSCUBE only. No database, push provider, Android Stable or
Windows artifact changes in this web release.

- Build 49 showed an error on first logout although the exact server SID was
  retired. A separate, exact Realme WebView helper first passed nine offline
  controls. Its one live logout returned `204` from Auth; the app's deadline
  wrapper rejected before the SDK touched local storage or dispatched the
  callback. Only the dedicated fresh test SID retired. Both helper packages
  were removed and the product remained unchanged. The old iPhone PWA also
  required a second confirmation, but no HTTP status was collected on it.
- A genuine loopback HTTP `204` reproduced the constructor error in Chromium
  and WebKit before the patch. Both engines exposed a stream even though this
  status cannot carry a body. The wrapper now settles the request and returns
  the original `204`, `205` or `304` instead of constructing a new Response.
  It still bounds Auth/signing JSON and streams PostgREST bodies with their
  original deadlines. [Fetch standard](https://fetch.spec.whatwg.org/#null-body-status).
- Code: `4af6d3a1` task refresh/editor lifetime, `4f64c095` tucked mobile
  search focus, `2e1c3afc` no-body response. 41 alias imports were resolved in
  the three commits' own trees; typecheck, build `5c5b6bf64909ab0d`, 121
  focused transport/Auth tests, 100 task/sidebar cases, and 12 fictional
  Chromium/WebKit task recovery cases passed. Both themes and 1440/390 were
  checked; fictional captures only. The hidden input is not in the phone's
  Tab order; the visible opener and desktop focus remain available.
- The running image at 22:18:28Z was exactly `2e1c3afc8a260c73690890144a976de472fbdb03`,
  sole and healthy, with public SW `456b562c6750bd54`. Public/container HTML,
  JS and SW SHA-256 matched. The three code markers were absent in the old
  `9ed010f5` image and present in the new entry bundle. The old image remains
  available for rollback.
- Public guest sign-in form: Chromium 1440 and WebKit 390 returned HTTP 200,
  with zero page errors and zero attempted writes. No account or capture.

**Subsequent Android result:** first UI logout passed on the signed Realme
`0.1.49` / 50, which [was released to Stable](2026-11-06-android50-stable.md).
**Subsequent iPhone result:** first normal logout passed in installed iPhone
17 Pro Max PWA on the new public build. Exact QA Auth readback and release
of the device passed; the active worker and HTTP response were not inspected.
[Physical evidence](2026-11-05-task9-iphone-pwa.md). Signed-app live task
revoke/regrant and external delivery remain separate acceptance gates.
