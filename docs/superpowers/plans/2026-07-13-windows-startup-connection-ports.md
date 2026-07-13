# Windows Startup Connection Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the startup progress rail from entering either device and keep endpoint geometry fixed through the connected handoff.

**Architecture:** Both startup scenes use explicit device-side ports and rail insets derived from fixed device half-widths. Progress continues to animate through inner transforms only, while Playwright records device and rail bounds before and after connection.

**Tech Stack:** Static HTML/CSS, Tauri WebView2, Playwright, Rust source assertions.

## Global Constraints

- Keep updater behavior and startup timings unchanged.
- Do not change the production application, API, SQL, or secrets.
- Keep local and production-overlay geometry equivalent.

---

### Task 1: Geometry Regression

**Files:**
- Modify: `tests/e2e/windows-tauri-shell.spec.ts`
- Modify: `windows-tauri/src-tauri/src/lib.rs`

- [x] Add assertions that rail bounds stop outside device chassis bounds and ports are visible.
- [x] Capture endpoint/device/seal bounds before and after `complete` and assert exact stability within one pixel.
- [x] Run `pnpm.cmd exec playwright test tests/e2e/windows-tauri-shell.spec.ts` against the current native QA harness and confirm the overlap assertion fails.

### Task 2: Fixed Ports and Rails

**Files:**
- Modify: `windows-tauri/ui/startup.html`
- Modify: `windows-tauri/ui/startup.css`
- Modify: `windows-tauri/ui/startup-overlay.html`
- Modify: `windows-tauri/ui/startup-overlay.css`

- [x] Add client and server port elements to both scenes.
- [x] Replace percentage center-to-center rail insets with device-edge-to-seal insets.
- [x] Ensure connected styles affect color/fill only and cannot modify layout geometry.
- [x] Run the targeted native Playwright test and confirm the geometry assertions pass.

### Task 3: Verification

**Files:**
- Modify: `docs/QA_RESULTS.md`

- [x] Run unit, Rust, typecheck, production build, and Windows Tauri QA commands.
- [x] Inspect startup and connected screenshots at the native viewport.
- [x] Run `git diff --check` and security/status guards.
- [x] Record the visual regression result in `docs/QA_RESULTS.md`.
