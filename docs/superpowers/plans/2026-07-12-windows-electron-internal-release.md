# Windows Electron Internal Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package LETSCUBE as a hardened internal Windows x64 NSIS executable, connect its installed version to the existing release catalog, and publish the unsigned internal installer through `api.letscube.ru`.

**Architecture:** Electron loads only the production origin `https://app.letscube.ru` in a sandboxed renderer with Node integration disabled. A minimal read-only preload bridge identifies the Windows shell and returns its installed version; navigation, external URLs, and permissions are controlled by pure allowlist functions covered by unit tests. `electron-builder` produces an unsigned NSIS installer, while the existing SSH-only publisher updates the Windows release manifest atomically.

**Tech Stack:** Electron 43, electron-builder 26, React/Vite, Node test runner, Playwright, NSIS, existing LETSCUBE release catalog.

## Global Constraints

- Do not apply SQL or change Supabase/RLS.
- Do not place secrets, signing certificates, passwords, or tokens in the repository or package.
- Keep `nodeIntegration: false`, `contextIsolation: true`, and renderer sandboxing enabled.
- Load only `https://app.letscube.ru` in packaged builds.
- Browser/PWA, Capacitor Android, push, media, geolocation, and chat scroll behavior must remain unchanged.
- The internal installer is unsigned; do not claim production signing or native Windows push readiness.

---

### Task 1: Desktop runtime contract

**Files:**
- Modify: `artifacts/kub/src/lib/platform/distribution.ts`
- Create: `artifacts/kub/src/lib/platform/desktop.ts`
- Create: `artifacts/kub/src/types/desktop.d.ts`
- Modify: `artifacts/kub/src/lib/platform/capabilities.ts`
- Modify: `artifacts/kub/src/hooks/usePwa.ts`
- Modify: `artifacts/kub/src/hooks/useReleaseCatalog.ts`
- Test: `tests/unit/distribution-platform.test.mts`

**Interfaces:**
- Produces `windows_native` as a distribution target.
- Produces `getDesktopRuntimeInfo(): Promise<{ platform: "windows"; version: string; build: number } | null>`.

- [ ] Add failing tests proving the desktop bridge wins over Windows browser detection and cannot become a PWA target.
- [ ] Run `pnpm.cmd release:catalog:test` and confirm the new assertion fails.
- [ ] Add the typed desktop bridge reader and `windows_native` distribution path.
- [ ] Read installed Windows version/build in `useReleaseCatalog` and add native Windows copy to `usePwa`.
- [ ] Run release catalog tests and frontend typecheck.

### Task 2: Hardened Electron shell

**Files:**
- Create: `desktop/security.mjs`
- Create: `desktop/main.mjs`
- Create: `desktop/preload.mjs`
- Test: `tests/unit/electron-shell.test.mjs`

**Interfaces:**
- Produces pure URL/permission allowlist functions for the main process.
- Exposes only `window.letscubeDesktop.platform` and `window.letscubeDesktop.getRuntimeInfo()`.

- [ ] Add failing tests for production navigation, safe external protocols, permission scope, and required shell security settings.
- [ ] Run the Electron shell unit test and confirm failure because the module/files do not exist.
- [ ] Implement exact-origin navigation, safe external browser handoff, media/geolocation/notification permission filtering, single-instance behavior, and a sandboxed BrowserWindow.
- [ ] Validate IPC senders before returning version metadata and never expose filesystem or arbitrary shell APIs.
- [ ] Run the Electron shell tests and security guard scans.

### Task 3: Windows NSIS packaging

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Create: `electron-builder.yml`
- Create: `scripts/build-windows-internal.mjs`
- Modify: `.gitignore`
- Test: `tests/unit/electron-shell.test.mjs`

**Interfaces:**
- Produces `pnpm.cmd windows:run`, `pnpm.cmd windows:build:internal`, and `pnpm.cmd windows:test`.
- Produces `dist/windows/LETSCUBE-<version>-x64-setup.exe`.

- [ ] Add failing config assertions for app id, product name, x64 NSIS target, ASAR, output path, and unsigned internal status.
- [ ] Install pinned current Electron/electron-builder dependencies through `pnpm.cmd` and allow Electron's required install script.
- [ ] Add deterministic builder configuration and a build wrapper that validates the generated EXE without reading private env files.
- [ ] Build the internal x64 NSIS installer and verify the output exists.

### Task 4: Desktop regression and physical Windows QA

**Files:**
- Create: `tests/e2e/windows-desktop-shell.spec.ts`
- Modify: `tests/e2e/release-distribution-settings.spec.ts`

**Interfaces:**
- Verifies native Windows Settings copy/version status without changing browser behavior.

- [ ] Add Playwright coverage for the bridge-driven Windows native state and absence of PWA installation UI.
- [ ] Run Playwright at 3840x2160, 1920x1080, 1440x900 and verify settings layout.
- [ ] Launch the unpacked Electron application, check startup/login shell, console errors, external-link handoff, and camera/microphone permission path where available.
- [ ] Install/uninstall the NSIS package on the local Windows machine only if the installer flow is non-interactive and safe; otherwise report manual QA pending.

### Task 5: Publish and document the internal Windows release

**Files:**
- Modify: `docs/native/WINDOWS_PACKAGING_PLAN.md`
- Modify: `docs/native/NATIVE_QA_CHECKLIST.md`
- Modify: `docs/PWA_NATIVE_READINESS.md`
- Modify: `docs/QA_RESULTS.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`

**Interfaces:**
- Publishes Windows stable manifest version `0.1.0`, build `1`, through the existing atomic publisher.

- [ ] Transfer the generated EXE to the server without logging secrets and run `/usr/local/sbin/letscube-publish-native-release windows stable 0.1.0 1 <artifact>`.
- [ ] Verify TLS, CORS, manifest fields, immutable artifact headers, size, and SHA-256 parity.
- [ ] Run `git diff --check`, typecheck, production web build, catalog tests, targeted Playwright, smoke, DB type drift, RLS smoke, and guard scans.
- [ ] Update the tracker with exact limitations: unsigned internal installer, native Windows push pending, signing/upgrade/deep-link QA pending.
- [ ] Commit, push `main`, verify Coolify web deployment, and leave release files outside Git.

