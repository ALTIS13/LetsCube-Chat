# Task 2 Report: Single Main Window And Approved Startup Scene

Date: 2026-07-13
Base commit: `a55b19b6e67d1a95c727ac268d552b9cb2319a02`

## Status

Implemented and physically verified on Windows/WebView2. The shell now creates one visible, decorated, resizable `main` window from the sole `WindowConfig`, starts it at bundled `startup.html`, preserves the isolated absolute WebView2 profile override, performs a real HTTPS/exact-origin preflight, and navigates the same WebView to production.

## TDD Evidence

### RED

1. Added the single-window/startup asset assertions to `tests/unit/tauri-shell.test.mjs`.
2. Ran `node --test tests/unit/tauri-shell.test.mjs`.
3. Result: expected failure, 3 passed / 2 failed. Failures were specifically:
   - missing `WebviewWindowBuilder::from_config`;
   - configured window label was `splash` instead of `main`;
   - startup assets did not exist.
4. Added the retryable TLS/origin state assertion to `startup.rs`.
5. Ran `cargo test tls_origin_failure_is_retryable_without_connecting`.
6. Result: expected compile failure because `StartupErrorCode::TlsOrigin` did not exist.

### GREEN

- `node --test tests/unit/tauri-shell.test.mjs`: 5 passed, 0 failed.
- `cargo test`: 16 passed, 0 failed.
- `pnpm.cmd windows:tauri:qa`: 2 passed, 0 failed.

The first physical QA attempt exposed a real orchestration race: Playwright connected after the same WebView had already reached `/login`. Starting Playwright before Tauri was still insufficient because preflight completed before WebView2 published the local CDP target. The final solution uses `LETSCUBE_TAURI_QA_HOLD_PREFLIGHT=1` only in the isolated QA wrapper and a local-URL/debug-gated `begin_startup_qa` command. It synchronizes observation; it does not inject network, catalog, TLS, origin, or updater failures. Normal debug and all release startup paths run preflight immediately.

## Implementation

- Replaced the old `splash.*` files and capability with `startup.*` and `startup.json`.
- Configured exactly one `main` window at `startup.html`, `1360x860`, minimum `960x640`, centered, visible, decorated, and resizable.
- Used `create:false` plus `WebviewWindowBuilder::from_config`, then applied the resolved absolute production/QA `data_directory` before building the WebView.
- Added the approved computer/server-rack handshake scene, four independent HEX groups per side, capped symmetric rails, neutral/connected seal, stage row, version pill, retry state, and reduced-motion fallback.
- Removed the old 15-second UI/Rust failure timers. CSS animation never advances runtime state.
- Added a Rust `StartupController` around the existing `StartupState`/`StartupSnapshot` API.
- Added a `reqwest` HTTPS preflight using rustls platform verification, a 15-second request timeout, exact production-origin redirect policy, final exact-origin/status validation, and sanitized retryable network/TLS-origin states.
- Kept stable update-catalog failure non-critical by awaiting the existing typed stable endpoint and continuing regardless of catalog request result.
- Emits `letscube://startup-state` snapshots and dispatches the matching local DOM event without enabling the global Tauri API.
- Marks `WorkspaceReady` and `Complete` only for `PageLoadEvent::Finished` on the exact production origin.
- Retry is accepted only from the local `main` startup URL and cannot be invoked from production.

## Changed Files

- `windows-tauri/src-tauri/tauri.conf.json`
- `windows-tauri/src-tauri/Cargo.toml`
- `windows-tauri/src-tauri/Cargo.lock`
- `windows-tauri/src-tauri/src/lib.rs`
- `windows-tauri/src-tauri/src/startup.rs`
- `windows-tauri/src-tauri/capabilities/splash.json` -> `startup.json`
- `windows-tauri/ui/splash.html` -> `startup.html`
- `windows-tauri/ui/splash.css` -> `startup.css`
- `windows-tauri/ui/splash.js` -> `startup.js`
- `tests/unit/tauri-shell.test.mjs`
- `tests/e2e/windows-tauri-shell.spec.ts`
- `scripts/windows-tauri-qa.mjs`
- `.superpowers/sdd/task-2-report.md`

No frontend application, SQL, secrets, updater plugin, or Task 3 updater integration was changed.

## Physical Tauri QA

Environment: Windows, real Tauri debug executable, WebView2 CDP on an isolated loopback port, temporary isolated profile, Playwright `chromium-desktop-1440` project.

Verified:

- exactly one WebView page before and after navigation;
- local path ends in `/startup.html` before preflight;
- client/server fingerprints are visible;
- observed state sequence contains `boot`, `network_check`, `tls_origin_check`, `update_check`, and `production_navigation`;
- status label is physically below the center rail;
- left/right progress halves stop at the center seal;
- same Playwright `Page` reaches exact `https://app.letscube.ru` origin;
- production desktop bridge/version/build contract remains intact;
- authenticated sidebar, chat composer, attachment controls, notification panel, and settings flow remain usable;
- no unexpected console errors in the authenticated production flow;
- QA-owned process and temporary profile cleanup completed.

Screenshots:

- `output/playwright-test/windows-tauri-shell-LETSCU-c98b1-n-navigation-in-one-WebView-chromium-desktop-1440/tauri-approved-startup.png`
- `output/playwright-test/windows-tauri-shell-LETSCU-b43f0-s-and-authenticated-core-UI-chromium-desktop-1440/tauri-authenticated-shell.png`

## Self-Review

- Security: HTTPS only; exact origin includes scheme/host/port; escaped redirects are not followed; no invalid-certificate switch; QA CDP remains loopback/debug-only; profile isolation remains absolute; production cannot invoke retry or QA start because both validate current URL and QA env state.
- State integrity: only `StartupState` transitions set success; network/catalog animation timing does not set stages; update-catalog failure is explicitly non-critical; duplicate preflight starts are rejected atomically.
- Scope: no frontend, SQL, secrets, domain hardcoding outside the existing native exact-origin constants, or updater plugin work.
- Visual: inspected the physical 1360x860 screenshot; corrected the existing dark SVG wordmark contrast; no overlap or rail/seal crossing observed.
- Diff hygiene: `git diff --check` is clean.

## Concerns

- Cargo emits the repository's existing debug PDB output-filename collision and localized linker informational warnings; tests/build still exit successfully.
- A same-WebView navigation replaces the bundled startup document before `WorkspaceReady/Complete` can be rendered there. Therefore the local scene reaches full rails at `production_navigation`, while the exact-origin `PageLoadEvent::Finished` transition is recorded natively after the production document replaces it. A true 250-400 ms post-load local-layer fade/green-seal reveal would require a production-page/native overlay contract beyond Task 2 and would conflict with the stated one-WebView/local-document transition model.
- Offline/TLS retry UI is covered by state/unit contracts and production code paths, but Task 2 intentionally adds no physical failure injection; those physical error scenarios remain for the later failure-injection task.
