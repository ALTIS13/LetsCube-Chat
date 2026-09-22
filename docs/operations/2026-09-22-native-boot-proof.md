# Native Boot Lifecycle Proof, 2026-09-22

Owner: Codex coordinator, shared main at `d649db3f`.
Approved continuation of D-298, not a new visual redesign or native release.

## Checkpoint

- [x] Reconcile clean checkout, published source and existing QA isolation paths.
- [x] Windows: current debug Tauri, temporary app/profile root and isolated
  identity, actual WebView2 through loopback CDP: six scenarios passed.
- [x] Android: current HTML controller in an isolated Android 14 WebView harness;
  seven positive cases and three mutation controls passed on an owned emulator.
- [x] Independent final review, affected gates and persistent handoff.

The owner resumed on 2026-09-23. The QA batch began at `d649db3f`.
Windows passed 6/6; Android passed 7 positive cases and detected
3 mutations with the final harness. No product-code regression was established.
No native release/install on a personal device was performed by this batch.

## Windows Boundaries

The new runner uses existing debug-only isolation and `begin_startup_qa`; no new
IPC, certificate bypass or readiness exception. Native performs its unchanged
anonymous public HTTPS/TLS preflight. The existing catalog-failure QA mode skips
the catalog request. Renderer app resources come from the current local built
bundle; other renderer network requests are blocked. No account sign-in, captured
personal screens, notifications, update install or installed-client profile.
Service worker registration and WebSocket connections are blocked in this harness;
it does not claim offline-cache/service-worker coverage. No security checks were
weakened to make the fixture load.

The first probe reached actual native Complete on a real React commit. Fault
injection then exposed test-instrument assumptions: WebView2 service-worker
interception must be bypassed for controlled resource failures, and repeating an
identical URL containing a fragment may not create a new document. The runner
now explicitly reloads and requires a new entry request. These are harness
corrections, not reported as messenger regressions.

Target cases: healthy commit, missing/runtime-failed entry then user retry,
late commit after the web watchdog, commit after native observation expires,
fresh-document recovery thereafter. Preserve path/query/hash and synthetic
storage sentinels. Observe real native snapshots; a JS receipt alone is not proof
of native Complete. Retain the bounded `workspace_unconfirmed` contract after 30s.

No new EXE/APK release or production database/provider changes in this batch.

## Windows Results

Host: Windows 11 Pro, 10.0.26200. Actual WebView2: 153.0.4234.48.
`KUB_QA_ALLOW_MUTATIONS=0 node scripts/windows-tauri-boot-qa.mjs`: exit 0,
6/6 cases, 78 fulfilled local renderer requests, one deliberately aborted entry,
zero service workers and no
signed-in account. Native HTTPS preflight is real and separate from renderer
interception; this is not an air-gapped or OS-wide network-capture claim.

1. Real locally built React app commits; native Complete and overlay removal.
2. Aborted entry: reachable recovery, no native Complete; retry restores login.
3. Module exception: same recovery and retry, with native readiness verified.
4. Entry held past the 12-second web watchdog: release allows actual React and
   native Complete before native observation expires.
5. Entry held until native reports `workspace_unconfirmed`: actual React later
   restores login while native stays unconfirmed. Native window-state command
   remains callable. No fabricated success or automatic reload.
6. A fresh document after that expiry earns native Complete again.

All recovery cases preserve synthetic local/session storage and the login
path/query/hash. Temporary profile cleanup and owned-process exit passed.
No production UI was captured. Existing Windows build warnings remain: PDB name
collision and MSVC import-library linker output. Relevant helper/shell unit tests
37/37 and `node --check` pass. Full application suites from the preceding source
batch are reused only for unchanged product code, not claimed as fresh runs.

Independent review corrected the runner's teardown ordering (stop native before
disconnecting CDP), current-document receipt matching and request counting.
The rerun passed with these corrections. Independent reviewer confirmed all three
Windows findings closed; 25/25 read-only checks and syntax validation passed.
A subsequent review found a possible stale-PID race in teardown. Cleanup now
checks the original process creation time and executable while retaining its
.NET process handle, then uses the same process object to stop its tree. The real
WebView2 six-case run passed again with this change. Focused tests cover PID,
path and creation-time mismatches and prove that a live fixture with a stale
creation time is not stopped. Independent follow-up review closed the race.

Logs: `output/pre-react-recovery/webview2-native-reviewed.log` (sanitized).

Android proof: `output/native-boot-android/latest-report.json`, Android 14
API 34, WebView 113.0.5672.136. This is a standalone permissionless WebView harness
with exact source controller bytes and synthetic commit, **not** full Capacitor,
production APK, FCM or personal-phone proof. Final run: 10/10 results, 0 failures,
0 unexpected requests, source/APK/harness unchanged. Independently recalculated
harness digest matches the report. Owned AVD data were removed after emulator exit;
cleanup receipt exists, `cleanupVerified` is true, and QA ports are free. The
runner promotes `latest-report.json` only after result acceptance and cleanup;
failed runs retain their per-run report without replacing accepted evidence.
Initial failed probes were harness
snapshot-navigation and rejection injection issues, not established product defects.

### Android Harness Safety

Independent reviewer reproduced on stubs: the former runner's `finally` could
call `adb emu kill` after identity rejection. The runner now uses a unique AVD
name per run and checks the spawned process PID, executable, launch arguments,
current ADB AVD name and fingerprint before stopping by serial. Four negative
ownership cases and one owned case pass; the final emulator run also shut down
normally. Two medium QA risks were closed: a shared-output file lock prevents
concurrent runs, and boot polling bounds each ADB call. The final report includes
source, APK and harness digests, with post-run equality checks. These findings
concern the QA harness, not a deployed messenger defect.
