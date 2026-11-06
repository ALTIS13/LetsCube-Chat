# Profile recovery: logout failure and retry

2026-11-06 MSK. Task9/authentication delta. Released web `ffe94b68`; no schema,
session-revocation scope, notification provider or release catalog change.

## Observed and repaired

- The local failure-alert change covered the account menu but did not cover
  `LoadingScreen`. A mounted browser test drove the real SDK from the profile
  recovery screen to HTTP 503: there was no user-facing error and a rejection
  escaped the click handler. Both paths now call the same `useSignOut` action.
- With the shared action, the second request returned HTTP 204 and the exit
  button disappeared, but the signed-out document was still trapped behind
  the old profile error. Clear that error on the committed `SIGNED_OUT` event;
  do not reinterpret a transient Auth read failure as a successful logout.
- Web preview retirement remains before logout. The account epoch is checked
  before dispatch and before publishing an alert. All tested exits use the
  SDK's local scope. Failure copy is generic and never includes provider text.

## Verification

- The new recovery-screen case failed first at the missing alert and then,
  with the alert handler in place, at the obsolete profile error after 204.
  It now verifies the alert, focus return, successful local retry, guest home,
  no leaked fixture detail and no page errors. Four account-menu cases also
  passed, in both themes and Chromium widths 1440/390. The shared dialog
  pixels were inspected at all four combinations; no production captures.
- 59 focused Auth/session tests passed against the installed SDK and source;
  the unchanged global-scope SDK default remains a negative control.
- Workspace typecheck and scoped diff check passed. Exact clean candidate
  Vite production-mode build: `9f506a3580a89dc4`, 17.79 seconds, fictional
  public environment only; both code markers present in the emitted entry.

## Release

The outgoing range contained exactly `ffe94b68`; 12 alias imports resolved
in its tree. Baseline `9eb97344` / `a1aa8b14f8770bc3` was healthy and lacked
both markers. At `2026-11-06T00:25:25Z`, the sole healthy web container was
`ffe94b687c5b6083f66b9a2ef78080bb6e5e716d`, SW `e089577ff7c2b290`. Exact
public and running-container HTML, JS and SW hashes matched, both markers
were present and the previous image remained available for rollback.
Live guest `/login` then rendered in Chromium 1440 and WebKit 390 (HTTP 200,
no write attempts or page errors, service workers disabled for this check).

Device scope is unchanged: Stable50 and installed iPhone PWA already proved
first-attempt logout on a healthy connection. The new failure/profile-boot
recovery was tested with isolated browser responses; it is not an Android
APK update or a new physical session test.
