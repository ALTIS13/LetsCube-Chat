# Windows Tauri Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the retired Electron Windows package with a compact, clean-profile Tauri 2 client with tray, animated startup, native foreground notifications and release-catalog integration.

**Architecture:** An isolated `windows-tauri` package owns the Tauri CLI/Rust shell and loads only `https://app.letscube.ru` in WebView2. Rust owns profile isolation, navigation, splash and tray; the React app uses a minimal official Tauri API adapter and retains the existing semantic notification/release model.

**Tech Stack:** Tauri 2.11, Rust stable-msvc, WebView2, React/Vite, Tauri notification/single-instance/opener plugins, Playwright, existing release catalog.

## Global Constraints

- Electron is retired and must not remain an offered Windows download.
- Do not import the Electron profile or QA auth state.
- Keep Tauri dependencies outside the root pnpm workspace/Coolify install.
- Remote IPC is exact-origin and minimum-capability only.
- Do not apply SQL or add signing/Firebase/service-role secrets.
- Browser/PWA and Android behavior must remain unchanged.

---

### Task 1: Retire Electron and isolate build state

**Files:**
- Remove: `desktop/`, `electron-builder.yml`, `scripts/build-windows-internal.mjs`
- Modify: `package.json`, `.gitignore`, `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Test: `tests/unit/electron-shell.test.mjs`

**Interfaces:**
- Produces an unavailable Windows manifest until Tauri is published.
- Produces no root Electron dependency or runnable Electron script.

- [ ] Save the current manifest and atomically set Windows stable to unavailable.
- [ ] Add a failing repository test that rejects Electron dependencies/scripts/source.
- [ ] Remove Electron source, standalone lockfile and Electron-only tests/config.
- [ ] Verify root frozen install and web/Android builds remain valid.
- [ ] Commit the retirement independently.

### Task 2: Install and verify the Windows Tauri toolchain

**Files:**
- Modify: `docs/native/WINDOWS_PACKAGING_PLAN.md`

**Interfaces:**
- Produces working `rustc`, `cargo`, MSVC linker and WebView2 runtime checks.

- [ ] Install Rust stable-msvc without changing Java/JDK configuration.
- [ ] Install Microsoft C++ Build Tools Desktop workload non-interactively.
- [ ] Verify `rustc --version`, `cargo --version`, `cl.exe`/MSVC discovery and WebView2.
- [ ] Record exact versions without storing machine credentials.

### Task 3: Create the minimum-capability Tauri shell

**Files:**
- Create: `windows-tauri/package.json`, `windows-tauri/pnpm-lock.yaml`
- Create: `windows-tauri/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`
- Create: `windows-tauri/src-tauri/src/lib.rs`, `main.rs`
- Create: `windows-tauri/src-tauri/capabilities/production.json`
- Create: `windows-tauri/ui/splash.html`, `windows-tauri/icons/*`
- Test: `tests/unit/tauri-shell.test.mjs`

**Interfaces:**
- Produces `pnpm.cmd windows:tauri:run`, `windows:tauri:test`, `windows:tauri:build:internal`.
- Produces runtime info `{ platform: "windows", version, build }`.

- [ ] Add failing static/pure tests for origin, profile directory, capability scope, tray and splash.
- [ ] Scaffold pinned standalone Tauri dependencies and Rust crate.
- [ ] Implement exact-origin navigation, temporary-test profile override and stable production profile.
- [ ] Implement animated splash, load failure retry, single instance and tray close-to-hide.
- [ ] Add notification/opener plugins with only required remote permissions.
- [ ] Build the x64 internal installer and assert it is under 25 MiB.
- [ ] Commit the shell.

### Task 4: Replace the Electron frontend adapter

**Files:**
- Replace: `artifacts/kub/src/lib/platform/desktop.ts`
- Modify: `artifacts/kub/src/types/desktop.d.ts`
- Modify: `artifacts/kub/src/hooks/usePwa.ts`, `usePush.ts`, `useReleaseCatalog.ts`, `useMessages.ts`
- Modify: `artifacts/kub/src/lib/platform/capabilities.ts`, `distribution.ts`
- Test: `tests/unit/distribution-platform.test.mts`, `tests/e2e/windows-tauri-shell.spec.ts`

**Interfaces:**
- Consumes official Tauri runtime/version and notification APIs.
- Preserves the existing `windows_native` distribution contract.

- [ ] Add failing tests proving Tauri wins over Windows browser detection.
- [ ] Implement lazy Tauri detection/runtime info with browser-safe fallback.
- [ ] Keep PWA/SW/Browser Push disabled only inside packaged Windows.
- [ ] Route foreground message notifications to Tauri native notification API.
- [ ] Verify browser, iOS PWA and Android paths are unchanged.
- [ ] Commit the adapter.

### Task 5: Physical Windows parity and publication

**Files:**
- Modify: `docs/native/NATIVE_QA_CHECKLIST.md`, `docs/QA_RESULTS.md`, `docs/PRODUCTION_PRIORITY_TRACKER.md`

**Interfaces:**
- Publishes an immutable Tauri Windows stable artifact through `api.letscube.ru`.

- [ ] Verify a temporary clean profile opens login with zero auth state.
- [ ] Install the package and test tray, single instance, splash and session restore.
- [ ] Test auth/chat/realtime/media/camera/mic/video/geolocation/clipboard/fullscreen.
- [ ] Run web/PWA/Android regression suites and security scans.
- [ ] Publish only the verified Tauri artifact and validate manifest size/SHA/TLS/CORS.
- [ ] Commit docs, push `main` and verify exact-commit Coolify deployments.

