# D-298 Windows Readiness Checkpoint

- Owner: Windows source repair, coordinator owns the web runtime and shared docs.
- Stage: source/debug repair integrated and independently reviewed; packaging and
  installation remain a separate stage.
- Evidence: 50 targeted JS tests pass (17 browser behavior cases plus 33 existing
  shell/pacing checks); offline Cargo suite: 82 pass, 4 existing live-registry
  tests ignored. MSVC emits its import-library linker message warning.
- Baseline: two browser cases failed before the repair: an uncommitted workspace
  was marked connected, and boot failure left the overlay covering retry.
- Mutation evidence: removing the native Finished/loaded guard, removing the
  navigation-generation guard, and weakening the root commit marker each made
  the corresponding behavior test fail. All mutations were restored.
- Blocker: none for this source batch. Actual WebView2 callback/event scheduling
  has NOT been proved by these tests; browser fixtures and Rust state tests are
  separate evidence, not an installed native lifecycle run.
- Next: separately scoped offline WebView2
  lifecycle proof. Do not run the existing native QA wrapper for this batch:
  it performs HTTPS preflight and includes authenticated production scenarios.

## Contract And Limits

Native uses its existing exact production-origin/main-window guard, a per-document
receipt and a navigation generation. `PageLoadEvent::Finished` publishes measured
peer information and sets the load flag only; it never acknowledges React.
`app-rendered` plus the committed root marker and current `bootState=ready` are
required. The web listener may set bootState after the native event listener.
No new IPC commands, capabilities, identities or persistent document IDs.

Boot failure removes only the native overlay. It does not navigate, clear the
root, change the URL, or operate web retry. A fresh commit after that failure can
recover within the native 30-second observation window. After the deadline,
polling stops and native reports `workspace_unconfirmed` (not app failure and
not connected). Web can still become ready at 35 seconds or later, remove its
own recovery UI and remain usable with the same path/query/hash. Native readiness
remains unconfirmed until a new document navigation; there is no inbound readiness
event permission in the existing production ACL, and none was added.

Glass, markup, certificate rendering and success pacing are unchanged. Successful
completion is persisted only after the hold/fade with a still-current receipt.
Same-document native navigation seals the old receipt; a canceled navigation or
BFCache restore remains fail-closed rather than reusing an old commit.

## Repeat Locally

From the repository root in PowerShell (no server or saved browser profile):

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
node --test windows-tauri/tests/readiness.test.mjs tests/unit/tauri-shell.test.mjs tests/unit/windows-startup-pacing.test.mjs
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --offline --locked --manifest-path windows-tauri/src-tauri/Cargo.toml
git diff --check -- windows-tauri
```

Browser HTTP requests are fulfilled with fictional HTML before network access;
there is no login, tracing, screenshot, production bundle or personal profile.
