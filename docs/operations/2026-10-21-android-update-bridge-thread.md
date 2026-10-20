# Android Update Bridge Thread Ownership

## Resume

- Owner: Codex coordinator; canonical `android-current-20261015`, branch
  `codex/ui-motion-updates-20261019`, released repair `3a73975f` / Stable34.
- Stage: physical D-384 failure and thread cause confirmed; final source repair,
  integration87/87 and independent review pass. Released metadata is0.1.33/build34;
  Native34 artifact/device/publication proof now passes below.
- Next: persistent received-text history admission. Keep complete in-app
  installation as a separate natural-next-legitimate-release boundary.

## Physical Failure and Diagnosis

Installed A06332 reaches the signed-in main interface, but updater UI enters
failed without a version. The bounded controlled click cannot proceed to the
download; the original90-sample REFUSED receipt is retained, not relabelled.
Test-only instrumentation is removed; no target update, account clear, personal
screen/body/token capture or VPN configuration change occurs in this case.

A subsequent actual JS-to-native `AndroidUpdates.status()` call is rejected with
`ANDROID_UPDATE_UNAVAILABLE`, despite plugin availability, allowed JS origin and
default port. Direct read-only native runtime status remains idle. In the same
app UID, the public release catalog returns200 and core health401, so this is
not the earlier bad-VPN DNS/TCP failure. Public catalog shape/types and exact
approved artifact URL also match the native policy; no policy relaxation is
justified.

The actual WebView URL read succeeds on its UI thread with allowed origin/default
port, but reading that same WebView from the instrumentation worker throws
RuntimeException. Only these booleans/error class are retained, not URL paths.
The installed Capacitor8.3.4 `Bridge.callPluginMethod` posts plugin invocation to
its `CapacitorPlugins` HandlerThread. `AndroidUpdatesPlugin.runtime` reads
`getWebView().getUrl()` there and catches the resulting exception as unavailable.
The main-thread origin check in `MessagePreviewsPlugin` is a working local
reference, not another affected surface or a reason to alter preview privacy.

## Repair Contract

Read the current document origin on the owning UI thread, preserving the existing
allowed origins/default-port refusal. Return runtime/state/file work to the
Capacitor worker; network/download/hashing must not move onto UI. Native permission
and system-installer UI retain their explicit handoff. Preserve fixed catalog/
artifact source, package/signer/hash/size/version checks, owned file paths,
generation/cancel guards and the React call/draft confirmation contract.

Regression must execute the actual compiled plugin, with distinct finite UI and
plugin queues and a WebView owner-thread check, before the source is repaired.
Cover all entry commands, denied origins, missing activity/bridge, delayed origin
changes, actual callbacks and loaded literal omissions. Native class/registration
presence or a source grep does not prove this entry point works.

The original compiled-plugin case is RED1 PASS/1 FAIL on shippedb50; its first
repair passes27/27 and the initial integrated native cohort79/79. Review then
finds a real lifecycle defect in that repair: the destroyed Activity's closed
Capacitor queue can silently drop install-refusal cleanup, leaving app-owned
runtime in `installing`. The held-preparation/closed-Bridge test is RED0/1 before
repair. Finalization now runs on the existing runtime executor, preserving the
owner/generation check and responding only after persistence, without new threads
or UI file IO. The final changed cohort passes35/35, including four actual-runtime
cases and nine loaded omissions. Coordinator's final integrated affected cohort
passes87/87 with zero skips; independent delta review is clean and diff checks
pass. Final source SHA256: plugin
`8d65835d5ddde9d06a789a4daf0386b7772ae691907ba945892b91f56866a896`, runtime
`3defd93c83f93ac937f15f252d13c133415bad08e5aa49e12df73849a8e7f94b`.
Unchanged history155 and previous visual evidence are reused, not rerun.

The private instrumentation's original early one-second finish could interrupt
asynchronous installer preparation. It was repaired before any install attempt:
observe the normal approved system-installer intent plus parent-window focus
loss, then independently verify the actual system surface. A click or observed
intent is not installed-version proof. All private APK/probe artifacts stay
ignored and cannot ship as a production diagnostic bridge.

## Bootstrap and Remaining Acceptance

The broken32/33 native bridge cannot install its own fix. Use an ordinary
one-time APK upgrade without clear/uninstall; keep UID/data/firstInstall and
actual signed-in recovery proof separate from Realme's guest startup. Release
notes must say manual bootstrap is needed for0.1.31/0.1.32, not claim automatic
update success. Do not issue a dummy release or bypass same-version/source/
signature checks solely to manufacture a positive installer case.

Source acceptance/manual bootstrap must not close the complete future in-app
download/ready/permission/install path or the entire cross-vendor matrix.

## Stable34 Release

Product `3a73975fea5f831d7e29ba8f8aa970527f3215d0` built freshly:
`sw.js build 4e663c88db3db74b`, `built in 11.37s`, `BUILD SUCCESSFUL in 12s`.
APK7,816,329B SHA256
`fffd1b238aa3237cbb9df0c0b6ca18a987fc317c4fc89e4bf7861a7729eaa8ce`;
AAB7,444,124B SHA256
`3a6b0d1695973fd89fb606ae64bd0340736dd64970686ab0faf56629a1886fb5`.
Original sole signer/APKv2, exact Firebase4, false QA flags,42-file web/config/
DEX parity and updater5 class definitions/registration/provider pass. AAB manifest
was not independently protobuf-decoded; no broader AAB claim follows.

Realme33 ->34 guest upgrade preserves UID/data/firstInstall, fatal0. A06332 ->34
is a manual bootstrap without clear/uninstall: those identities persist and the
installed APK's full bytes match the candidate. Actual signed-in main and
`/assets/index-BujnSSVJ.js` match the Native34 bundle. Real JS/native status is
RESOLVED/current, native runtime current, failed banner absent and app-UID public
catalog/core health200/401. This precedes publication and uses the valid prior
Stable33 catalog, exercising no-newer/no-downgrade, not a higher-build download.
The worker WebView-read negative control still throws; owning-UI read succeeds.

Probe package removed, normal LETSCUBE relaunched, no personal screens/bodies/
URL paths/tokens captured, VPN/profile/PC routing unchanged. Stable0.1.33/build34
is published at2026-10-20 21:40:34Z, mandatory=false: prior-catalog CAS, rollback33
and complete public APK bytes/hash pass. Notes explicitly require one-time manual
bootstrap for0.1.31/0.1.32. No SQL, Windows shell/identity or native Apple change.
Sole-healthy shared image3a73975f/build `affacc90ed0418d6` has public/container
parity at21:42:34Z; HTML/JS/SW are byte-identical to verifiedb50 (native-only code).

Remaining: full fixed34 ->next real-release updater UI/system acceptance, wider
OEM/lifecycle, persistent received history and generic-only Windows WNS. Do not
repeat accepted cohorts or manufacture a release solely for QA.
