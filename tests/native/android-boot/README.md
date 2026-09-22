# D-298 Android Boot QA

Owner: independent Android proof worker. Only this directory and
`output/native-boot-android/` are owned. No production Android/HTML/shared docs edits.

Run from PowerShell 7:

```powershell
node --test tests/native/android-boot/prepare.test.mjs
pwsh -NoProfile -File tests/native/android-boot/run.ps1 -BuildOnly
pwsh -NoProfile -File tests/native/android-boot/run.ps1
```

The runner uses the existing local SDK, JBR and cached Gradle 8.14.3/AGP 8.13.0,
always offline. Override `-Sdk`, `-Jdk` or the even `-Port` explicitly if necessary.
No JDK/SDK install or global environment changes. Build artifacts, a disposable
QA debug certificate, generated assets, fresh AVD data and sanitized evidence stay
in ignored output. No application/release signing keys are read.

The APK is only `qa.letscube.boot`, with one WebView Activity and a platform
Instrumentation class, no dependencies or permissions. The runner never accepts a
physical serial: it starts its own empty headless AVD, checks its name/fingerprint,
refuses an emulator containing `com.kub.messenger`, installs only QA there, then
shuts down only that AVD. No private UI, screenshots, accounts or production host.
After emulator exit, the runner removes only the exact owned run's `avd/` directory,
preserving logs/reports and a cleanup receipt. Resolved parent, ownership receipt,
reparse points, emulator processes and console ports are checked before deletion.
Both emulator user-mode network backends use `restrict=on,ipv6=off` from startup;
guest radios are disabled before installation. No host routing/firewall changes.
The APK has no INTERNET permission, WebView blocks network loads and file/content
access, CSP disallows connections, and every resource is intercepted in-process.

`prepare.mjs` extracts one exact contiguous style/recovery/controller fragment
from the current `artifacts/kub/index.html`; its bytes and original icon are
packaged with SHA-256 receipts. It excludes all other application scripts,
configuration, manifest/service worker and account code. No copied controller.
Malformed/ambiguous extraction fails closed. The extracted 12000 ms timer and
browser APIs are not patched, clocked or simulated.

Seven positive scenarios cover healthy boot past the real deadline; actual failed
module and explicit same-URL reload with synthetic local/session storage; stalled
module evaluation then a 14.5-second late commit; native page-finished versus
marker/child/event acknowledgement; real exception; real unhandled rejection;
native Activity/WebView pause-resume and new-document readiness. Three separate
generated mutations remove deadline, ready guard or reload; each must fail the
matching behavioral oracle for its intended reason. Reports distinguish positive
scenarios from killed mutations. An instrumentation exit code alone is insufficient:
the runner requires ten results, zero failures, unchanged source, APK and harness
digests, and structured engine/version/timing evidence. A shared-output file lock
prevents concurrent builds/runs, and each ADB boot probe has a bounded wait.

Limits: the commit producer is a synthetic module, not React. This proves the
current HTML controller's native WebView lifecycle, not the full Capacitor shell,
SplashScreen plugin, installed messenger APK, release bundle, real authentication,
FCM, OEM process death/Doze, physical device layout or network transport. Stalled
entry is real top-level-await module evaluation, not a socket/server timeout.
Pause/resume invokes real native callbacks through Instrumentation, not physical
background navigation. No screenshots are taken; DOM state is not pixel proof.

Latest machine-readable evidence: `output/native-boot-android/latest-report.json`.
