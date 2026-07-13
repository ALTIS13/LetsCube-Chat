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

## Review Fixes

Date: 2026-07-13

### Review Notification: Full Findings List

1. **Retry preflight entry:** `StartupState::retry()` already moved `RecoverableError` to `NetworkCheck`, but `run_preflight()` attempted the same `NetworkCheck` transition again and returned before creating/sending the HTTPS request.
2. **Local startup guard:** `is_local_startup_url()` accepted broad `http`/`https` localhost and any path ending in `/startup.html`, so the navigation and local-only commands were not restricted to the exact bundled Tauri document.
3. **Connected seal lifecycle:** the local document was replaced before `WorkspaceReady -> Complete`, leaving no production-origin listener to render the connected green seal and approved 250-400 ms fade in the same WebView.

All three findings are fixed in the follow-up commit described by this appended section.

### Finding 1: Retry And Repeated HTTPS Path

RED:

- Added `retry_entry_continues_into_the_https_preflight_path` against the production-used preflight entry API.
- `cargo test retry_entry_continues_into_the_https_preflight_path` failed because `enter_preflight` / `PreflightEntry` did not exist.
- Strengthened the regression with a real async request closure.
- The focused test failed because `launch_https_path` did not exist.

GREEN:

- `enter_preflight` transitions `Boot -> NetworkCheck`, accepts an already prepared retry `NetworkCheck`, and rejects all other stages.
- `run_preflight` calls `prepare_preflight`, then uses the same generic `launch_https_path` exercised by the regression for the real `reqwest` send future.
- The regression executes the request closure exactly once after `fail -> retry` and observes `https-request-started`.
- `cargo test retry_entry_continues_into_the_https_preflight_path`: 1 passed, 0 failed.

### Finding 2: Exact Bundled Startup Guard

RED:

- Expanded `only_the_bundled_startup_document_is_allowed_before_production` with `http://localhost:4317/startup.html`, nested path, HTTPS scheme, and query-string rejection.
- The focused test failed on the arbitrary localhost URL, proving the old predicate was broad.

GREEN:

- The single predicate now accepts only `http://tauri.localhost/startup.html` byte-for-byte.
- `on_navigation`, local page-load handling, `retry_main`, and `begin_startup_qa` all use that same predicate.
- Physical Playwright waits for and then asserts the exact bundled URL before starting preflight.
- `cargo test only_the_bundled_startup_document_is_allowed_before_production`: 1 passed, 0 failed.

### Finding 3: Production Connected Overlay

RED:

- Added `production_overlay_is_origin_guarded_and_records_connected_fade_lifecycle`; it failed because `production_overlay_script` did not exist.
- Added physical assertions requiring a production overlay, a `complete/connected/sealConnected` history entry, removal after fade, and no overlay after production reload.
- First physical run exposed a reload regression: the overlay remounted after native state was already `Complete` and intercepted login clicks.
- Added a session completion-marker assertion; the focused Rust test failed because no `sessionStorage` lifecycle marker existed.

GREEN:

- Added bundled `startup-overlay.html`, `startup-overlay.css`, and `startup-overlay.js` templates to the origin-guarded initialization script.
- Overlay is mounted only when `window.location.origin === https://app.letscube.ru` and uses open Shadow DOM plus a constructable stylesheet, without remote capability changes.
- The existing Rust state events deliver `WorkspaceReady -> Complete`; the overlay records a safe event history, applies `is-connected`, exposes the green seal, fades for 320 ms, then removes its host.
- `sessionStorage` marks successful removal so ordinary production reloads do not remount a completed startup overlay.
- Physical QA observes one page before and after navigation, complete/connected seal history before removal, overlay removal, exact production origin, no overlay after reload, and the authenticated production flow.

### Final Verification Commands

- `node --test tests/unit/tauri-shell.test.mjs`: 5 passed, 0 failed.
- `cargo fmt --check`: exit 0.
- `cargo test`: 18 passed, 0 failed.
- `pnpm.cmd windows:tauri:qa`: 2 passed, 0 failed.
- Physical QA wrapper cleanup completed: owned Tauri/Playwright processes terminated and the isolated temporary profile was removed.
- `git diff --check`: exit 0 before report append.

### Review Self-Check

- One configured `main` window and one WebView page remain throughout startup and production navigation.
- No remote capability, frontend application, SQL, secrets, updater plugin, or Task 3 files changed.
- The QA hold remains debug/env/local-URL gated and does not inject failures.
- The earlier concern that a same-WebView transition could not show the post-load connected fade is resolved by the exact-origin initialization overlay; no second window or WebView is created.
- Existing Cargo PDB/linker informational warnings remain the only known warning.
