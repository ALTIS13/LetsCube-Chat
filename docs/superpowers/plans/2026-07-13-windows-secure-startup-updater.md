# Windows Secure Startup And Signed Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the second Tauri splash window with one real-state-driven main-window startup scene and add a signed stable/test Windows updater with a compact non-blocking control.

**Architecture:** The Tauri main window starts on a bundled local startup document, while a Rust controller performs exact-origin HTTPS preflight and release checks. The same WebView then navigates to `https://app.letscube.ru/`; a narrow frozen desktop bridge exposes typed updater state and commands to a Windows-only React controller. The official Tauri updater verifies signed artifacts and installs only after an explicit user action, except that critical stable releases gate normal use until installation is started.

**Tech Stack:** Tauri 2.11, Rust 1.77.2+, `tauri-plugin-updater` 2.x, reqwest 0.13, React 19, TypeScript 5.9, Vite 7, Playwright 1.59, Node test runner, NSIS current-user installer, static HTTPS release catalog.

## Global Constraints

- Use one Windows main window from process start; remove the separate `splash` window and its taskbar/focus lifecycle.
- Production navigation is exact-origin `https://app.letscube.ru` only; updater endpoints are exact HTTPS URLs under `https://api.letscube.ru`.
- HEX groups are illustrative state animation, never actual private keys, TLS secrets, or claimed certificate fingerprints.
- `stable` is default. `test` is explicit local opt-in and never selected automatically.
- Normal updates require a click. Critical stable updates block normal use but still require the user to start installation.
- Tauri updater signature verification cannot be disabled. Private signing material never enters git, frontend, public env, logs, docs, or Coolify build output.
- Browser/PWA, Android APK, browser push, Android push, chat synchronization and existing media/geolocation behavior stay unchanged.
- No SQL, RLS, schema, SMS, deep-link or native-push changes.
- Every behavior change follows RED -> GREEN -> regression verification.

---

### Task 1: Native Startup And Update State Models

**Files:**
- Create: `windows-tauri/src-tauri/src/startup.rs`
- Create: `windows-tauri/src-tauri/src/updater.rs`
- Modify: `windows-tauri/src-tauri/src/lib.rs`
- Test: Rust unit tests inside both new modules

**Interfaces:**
- Produces `StartupStage`, `StartupSnapshot`, `StartupErrorCode`, and guarded `StartupState::transition`.
- Produces `UpdateChannel`, `DesktopUpdatePhase`, `DesktopUpdateSnapshot`, `is_critical_stable`, and exact `update_endpoint`.
- Later tasks consume serializable camelCase snapshots and the `stable`/`test` endpoint mapping.

- [ ] **Step 1: Write failing startup transition tests**

```rust
#[test]
fn startup_only_reaches_connected_after_every_real_stage() {
    let mut state = StartupState::new();
    assert!(state.transition(StartupStage::TlsOriginCheck).is_err());
    state.transition(StartupStage::NetworkCheck).unwrap();
    state.transition(StartupStage::TlsOriginCheck).unwrap();
    state.transition(StartupStage::UpdateCheck).unwrap();
    state.transition(StartupStage::ProductionNavigation).unwrap();
    state.transition(StartupStage::WorkspaceReady).unwrap();
    state.transition(StartupStage::Complete).unwrap();
    assert_eq!(state.snapshot().stage, StartupStage::Complete);
}

#[test]
fn recoverable_error_never_reports_connected() {
    let mut state = StartupState::new();
    state.fail(StartupErrorCode::Network);
    assert_eq!(state.snapshot().stage, StartupStage::RecoverableError);
    assert!(!state.snapshot().connected);
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cd windows-tauri/src-tauri && cargo test startup::tests -- --nocapture`
Expected: FAIL because `startup` and its types do not exist.

- [ ] **Step 3: Implement the minimal startup state machine**

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupStage {
    Boot,
    NetworkCheck,
    TlsOriginCheck,
    UpdateCheck,
    ProductionNavigation,
    WorkspaceReady,
    Complete,
    RecoverableError,
    CriticalUpdateRequired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub stage: StartupStage,
    pub connected: bool,
    pub error_code: Option<StartupErrorCode>,
}
```

Use an explicit allowed-transition match. `connected` is true only for `Complete`.

- [ ] **Step 4: Write failing channel/critical-update tests**

```rust
#[test]
fn stable_is_default_and_endpoints_are_not_user_supplied() {
    assert_eq!(UpdateChannel::default(), UpdateChannel::Stable);
    assert_eq!(
        update_endpoint(UpdateChannel::Stable).as_str(),
        "https://api.letscube.ru/releases/updater/v1/windows/stable.json"
    );
    assert_eq!(
        update_endpoint(UpdateChannel::Test).as_str(),
        "https://api.letscube.ru/releases/updater/v1/windows/test.json"
    );
}

#[test]
fn only_stable_can_force_a_critical_gate() {
    assert!(is_critical_stable(UpdateChannel::Stable, true, true));
    assert!(!is_critical_stable(UpdateChannel::Test, true, true));
    assert!(!is_critical_stable(UpdateChannel::Stable, false, true));
}
```

- [ ] **Step 5: Run updater tests and verify RED**

Run: `cd windows-tauri/src-tauri && cargo test updater::tests -- --nocapture`
Expected: FAIL because the updater model is not implemented.

- [ ] **Step 6: Implement minimal typed updater state**

```rust
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel { #[default] Stable, Test }

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateSnapshot {
    pub channel: UpdateChannel,
    pub phase: DesktopUpdatePhase,
    pub installed_version: String,
    pub available_version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub mandatory: bool,
    pub error_code: Option<String>,
}
```

Keep phase mutation behind `DesktopUpdateState` methods so progress cannot move backward from `Installing` to `Downloading`.

- [ ] **Step 7: Verify GREEN and commit**

Run: `cd windows-tauri/src-tauri && cargo fmt --check && cargo test`
Expected: all Rust tests pass.

```powershell
git add windows-tauri/src-tauri/src/startup.rs windows-tauri/src-tauri/src/updater.rs windows-tauri/src-tauri/src/lib.rs
git commit -m "Add Windows startup and update state models"
```

---

### Task 2: One Main Window And Approved Startup Scene

**Files:**
- Rename: `windows-tauri/ui/splash.html` -> `windows-tauri/ui/startup.html`
- Rename: `windows-tauri/ui/splash.css` -> `windows-tauri/ui/startup.css`
- Rename: `windows-tauri/ui/splash.js` -> `windows-tauri/ui/startup.js`
- Modify: `windows-tauri/src-tauri/tauri.conf.json`
- Rename: `windows-tauri/src-tauri/capabilities/splash.json` -> `windows-tauri/src-tauri/capabilities/startup.json`
- Modify: `windows-tauri/src-tauri/src/lib.rs`
- Modify: `tests/unit/tauri-shell.test.mjs`
- Modify: `tests/e2e/windows-tauri-shell.spec.ts`

**Interfaces:**
- Consumes `StartupSnapshot` and `StartupStage` from Task 1.
- Produces local `startup.html` DOM test ids and `letscube://startup-state` event rendering.
- Produces one `main` WebView that transitions local -> exact production URL.

- [ ] **Step 1: Replace old splash assertions with failing single-window contracts**

```js
test("Windows startup uses one main window and a local approved handshake scene", () => {
  const config = readJson("windows-tauri/src-tauri/tauri.conf.json");
  assert.deepEqual(config.app.windows.map((window) => window.label), ["main"]);
  assert.equal(config.app.windows[0].url, "startup.html");
  assert.equal(config.app.windows[0].visible, true);
  assert.equal(existsSync(new URL("../../windows-tauri/ui/splash.html", import.meta.url)), false);

  const html = readText("windows-tauri/ui/startup.html");
  const css = readText("windows-tauri/ui/startup.css");
  assert.match(html, /data-testid="startup-client-fingerprint"/);
  assert.match(html, /data-testid="startup-server-fingerprint"/);
  assert.match(html, /data-testid="startup-center-seal"/);
  assert.match(css, /grid-template-columns:\s*1fr\s+34px\s+1fr/);
  assert.match(css, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run Node test and verify RED**

Run: `node --test tests/unit/tauri-shell.test.mjs`
Expected: FAIL because config still creates `splash` and startup assets do not exist.

- [ ] **Step 3: Build the single main-window local startup surface**

The config window is decorated, resizable, centered, visible, and uses the production minimum dimensions:

```json
{
  "label": "main",
  "title": "LETSCUBE",
  "url": "startup.html",
  "width": 1360,
  "height": 860,
  "minWidth": 960,
  "minHeight": 640,
  "center": true,
  "visible": true
}
```

Implement the approved PC/server rack, four cycling HEX groups per side, symmetric progress halves, center seal, stage row, compact version pill, retry state, and reduced-motion fallback. Use semantic HTML and no inline script.

- [ ] **Step 4: Wire real state and same-window navigation**

`lib.rs` must:

1. obtain the configured `main` window instead of creating a second one;
2. set the production profile directory before remote navigation;
3. run HTTPS preflight asynchronously;
4. emit serialized startup snapshots to the local page;
5. navigate the same window only after successful preflight;
6. mark `WorkspaceReady` only when `PageLoadEvent::Finished` is for exact production origin;
7. keep retry in the same main window.

The startup page maps state, never timers, to successful CSS classes:

```js
function renderStartup(snapshot) {
  document.body.dataset.stage = snapshot.stage;
  const connected = snapshot.stage === "complete" && snapshot.connected === true;
  document.querySelector("#startup-handshake").classList.toggle("is-connected", connected);
  document.querySelector("#startup-center-seal").setAttribute("aria-hidden", String(!connected));
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
node --test tests/unit/tauri-shell.test.mjs
cd windows-tauri/src-tauri
cargo fmt --check
cargo test
```

Expected: Node and Rust tests pass; no splash label/assets remain.

- [ ] **Step 6: Add physical startup assertions and commit**

Extend `tests/e2e/windows-tauri-shell.spec.ts` to connect before production navigation, assert one page/window, observe startup states, then wait for the exact production target. Add geometry checks proving the status label is below the rail and progress halves do not cross the seal.

```powershell
pnpm.cmd windows:tauri:qa
git add windows-tauri tests/unit/tauri-shell.test.mjs tests/e2e/windows-tauri-shell.spec.ts
git commit -m "Embed secure startup in the Windows main window"
```

---

### Task 3: Signed Native Updater And Channel Persistence

**Files:**
- Modify: `windows-tauri/src-tauri/Cargo.toml`
- Modify: `windows-tauri/src-tauri/Cargo.lock`
- Modify: `windows-tauri/src-tauri/tauri.conf.json`
- Modify: `windows-tauri/src-tauri/src/updater.rs`
- Modify: `windows-tauri/src-tauri/src/lib.rs`
- Modify: `windows-tauri/src-tauri/capabilities/production.json`
- Modify: `windows-tauri/src-tauri/capabilities/startup.json`
- Test: Rust tests in `updater.rs`
- Test: `tests/unit/tauri-shell.test.mjs`

**Interfaces:**
- Produces Rust commands `desktop_get_update_state`, `desktop_get_update_channel`, `desktop_set_update_channel`, `desktop_check_update`, and `desktop_install_update`.
- Produces a frozen bridge with matching Promise-returning JavaScript methods.
- Consumes static exact endpoints and `DesktopUpdateState` from Task 1.

- [ ] **Step 1: Add failing native updater security assertions**

```js
assert.match(cargoToml, /^tauri-plugin-updater = "2\.[^"]+"$/m);
assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
assert.equal(typeof tauriConfig.plugins.updater.pubkey, "string");
assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
assert.doesNotMatch(libRs, /dangerous_accept_invalid_certs|dangerous_accept_invalid_hostnames/);
assert.match(libRs, /desktop_install_update/);
assert.match(libRs, /window\.label\(\)\s*!=\s*"main"/);
```

- [ ] **Step 2: Run Node/Rust tests and verify RED**

Run: `node --test tests/unit/tauri-shell.test.mjs && cd windows-tauri/src-tauri && cargo test updater::tests`
Expected: FAIL because updater plugin/config/commands are absent.

- [ ] **Step 3: Install pinned updater dependencies**

Use exact versions resolved by the current toolchain:

```powershell
cd windows-tauri/src-tauri
cargo add tauri-plugin-updater@2.10.1
cargo add reqwest@0.13.4 --features json
```

Register `tauri_plugin_updater::Builder::new().build()` and keep command access narrow.

- [ ] **Step 4: Persist only the enum channel**

Store `{"channel":"stable"}` or `{"channel":"test"}` under the Tauri app local data directory. Reject unknown fields/values and recover malformed files to stable. Write atomically through temporary file + rename. Never accept an endpoint from the frontend.

- [ ] **Step 5: Implement exact-channel check and critical rules**

Build the updater dynamically:

```rust
let updater = app
    .updater_builder()
    .endpoints(vec![update_endpoint(channel)])?
    .timeout(Duration::from_secs(8))
    .build()?;
let update = updater.check().await?;
```

Read only bounded custom fields from `update.raw_json`: `build`, `mandatory`, and `minimumSupportedVersion`. A test channel can never produce `CriticalUpdateRequired`.

- [ ] **Step 6: Implement explicit download/install progress**

`desktop_install_update` rejects calls unless phase is `Available` or `CriticalUpdateRequired`. Update byte counters from the plugin progress callback, move to `Installing` only after verified download completion, and sanitize all errors to bounded codes.

- [ ] **Step 7: Generate signing identity without exposing it**

Create the dedicated updater signing key in an already ignored local secrets directory. Do not print the private key or password. Track only the public key in `tauri.conf.json`. Verify:

```powershell
git status --short
git ls-files | rg "updater.*(key|password)|\.key$"
```

Expected: no private updater key/password is tracked.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```powershell
node --test tests/unit/tauri-shell.test.mjs
cd windows-tauri/src-tauri
cargo fmt --check
cargo test
cargo build --release
```

Expected: all tests/build pass and release binary contains no private signing material or debug CDP flags.

```powershell
git add windows-tauri/src-tauri windows-tauri/pnpm-lock.yaml
git commit -m "Add signed Windows updater core"
```

---

### Task 4: Windows Update Pill And Settings Channel Control

**Files:**
- Modify: `artifacts/kub/src/types/desktop.d.ts`
- Modify: `artifacts/kub/src/lib/platform/desktop.ts`
- Create: `artifacts/kub/src/lib/platform/desktopUpdates.ts`
- Create: `artifacts/kub/src/hooks/useDesktopUpdate.ts`
- Create: `artifacts/kub/src/components/desktop/DesktopUpdatePill.tsx`
- Modify: `artifacts/kub/src/components/layout/MainLayout.tsx`
- Modify: `artifacts/kub/src/components/settings/ReleaseDistributionSection.tsx`
- Modify: `artifacts/kub/src/index.css`
- Create: `tests/unit/desktop-update-state.test.mts`
- Modify: `tests/e2e/windows-tauri-shell.spec.ts`

**Interfaces:**
- Consumes the frozen `window.letscubeDesktop` updater methods from Task 3.
- Produces `parseDesktopUpdateSnapshot`, `getDesktopUpdatePresentation`, `useDesktopUpdate`, and `DesktopUpdatePill`.
- Browser/PWA/Android return `null` and never render or call native update methods.

- [ ] **Step 1: Write failing parser/presentation tests**

```ts
test("normal update is compact and requires a click", () => {
  const state = parseDesktopUpdateSnapshot({
    channel: "stable", phase: "available", installedVersion: "0.2.0",
    availableVersion: "0.2.1", downloadedBytes: 0, totalBytes: 1_200_000,
    mandatory: false, errorCode: null,
  });
  assert.equal(getDesktopUpdatePresentation(state).blocking, false);
  assert.equal(getDesktopUpdatePresentation(state).action, "install");
});

test("only critical stable presentation blocks the messenger", () => {
  const stable = fixture({ channel: "stable", phase: "critical_update_required", mandatory: true });
  const testChannel = fixture({ channel: "test", phase: "available", mandatory: false });
  assert.equal(getDesktopUpdatePresentation(stable).blocking, true);
  assert.equal(getDesktopUpdatePresentation(testChannel).blocking, false);
});
```

- [ ] **Step 2: Run unit test and verify RED**

Run: `node --test tests/unit/desktop-update-state.test.mts`
Expected: FAIL because the parser/presentation module is missing.

- [ ] **Step 3: Implement strict frontend state parsing**

Reject unknown channels/phases, invalid SemVer, negative byte counts, and `downloadedBytes > totalBytes`. Return `null` rather than throwing raw bridge payloads into React.

- [ ] **Step 4: Implement the hook**

`useDesktopUpdate`:

- activates only when `isDesktopApp()` is true;
- polls every 250 ms only while checking/downloading/installing;
- polls every six hours and on focus while idle/current;
- coalesces concurrent commands;
- exposes `check`, `install`, and `setChannel`;
- reports sanitized errors through existing monitoring without payloads.

- [ ] **Step 5: Implement the compact pill and critical gate**

Render the pill once at the top-right of `MainLayout`, below modal/popover z-index and outside chat scroll containers. Use Lucide/Kub icons, a stable fixed width, `aria-live="polite"`, determinate progress, and reduced-motion support. Current-state pill auto-collapses; available/error/test state remains discoverable.

Critical stable state renders a bounded full-shell gate with the same install action. It does not clear auth/session/chat state.

- [ ] **Step 6: Add stable/test control to Settings**

For `windows_native`, replace the external `Скачать` link with native state, current version, and a segmented `Stable / Test` control. Selecting Test requires one confirmation explaining prerelease risk. Web/Android rendering stays byte-for-byte behaviorally equivalent.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
node --test tests/unit/desktop-update-state.test.mts tests/unit/desktop-notification-adapter.test.mts tests/unit/distribution-platform.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd windows:tauri:qa
```

Expected: unit/type/build/native-shell tests pass with zero console errors.

```powershell
git add artifacts/kub/src tests/unit/desktop-update-state.test.mts tests/e2e/windows-tauri-shell.spec.ts
git commit -m "Add Windows desktop update controls"
```

---

### Task 5: Atomic Stable/Test Updater Publication

**Files:**
- Modify: `scripts/publish-native-release.sh`
- Modify: `deploy/release-catalog/nginx.conf`
- Modify: `tests/unit/release-catalog-deploy.test.mjs`
- Modify: `tests/unit/release-catalog.test.mts`
- Modify: `docs/native/WINDOWS_PACKAGING_PLAN.md`
- Modify: `docs/infra/SECRETS_MATRIX.md`

**Interfaces:**
- Consumes Tauri updater artifact and `.sig` from Task 3.
- Produces immutable updater files plus atomic:
  - `/releases/updater/v1/windows/stable.json`
  - `/releases/updater/v1/windows/test.json`
- Preserves current `/releases/v1/windows/stable.json` download catalog.

- [ ] **Step 1: Write failing publisher and Nginx tests**

Assert that:

- channel is exactly `stable` or `test`;
- updater signature is required and non-empty;
- updater artifact URL stays under the matching immutable version path;
- manifests are written to a temporary file and renamed;
- Nginx serves manifests with `no-store` and artifacts immutable;
- private key/password variable names may be documented but values never appear.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd release:catalog:test`
Expected: FAIL because updater manifests/channel publication are absent.

- [ ] **Step 3: Extend publisher with a signed updater mode**

Required CLI shape:

```text
publish-native-release.sh windows 0.2.1 <installer> <notes> \
  --channel stable --updater-artifact <signed-bundle> --signature-file <sig>
```

Validate platform, SemVer, file existence, SHA-256, signature length, and HTTPS URL before writing. Keep every artifact immutable and use `mv` for atomic manifest replacement.

- [ ] **Step 4: Add channel-safe Nginx rules and docs**

Expose only read-only GET/HEAD paths. Block directory listing, dotfiles, upload methods and path traversal. Document updater signing private key/password as local/release-host secrets without values.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
pnpm.cmd release:catalog:test
git diff --check
```

```powershell
git add scripts/publish-native-release.sh deploy/release-catalog/nginx.conf tests/unit/release-catalog* docs/native/WINDOWS_PACKAGING_PLAN.md docs/infra/SECRETS_MATRIX.md
git commit -m "Publish signed Windows update channels"
```

---

### Task 6: Failure Injection And Physical Windows QA

**Files:**
- Modify: `scripts/windows-tauri-qa.mjs`
- Modify: `tests/e2e/windows-tauri-shell.spec.ts`
- Create: `tests/e2e/windows-tauri-startup.spec.ts`
- Modify: `tests/unit/tauri-shell.test.mjs`
- Modify: `docs/native/NATIVE_QA_CHECKLIST.md`
- Modify: `docs/QA_RESULTS.md`

**Interfaces:**
- Consumes the startup/updater state injection points and signed test channel.
- Produces repeatable success, offline, catalog-failure, normal-update, critical-update and cleanup QA modes.

- [ ] **Step 1: Write failing wrapper contracts**

Add explicit local-only debug env modes:

```text
LETSCUBE_TAURI_QA_STARTUP_MODE=success|offline|catalog_failure|normal_update|critical_update
```

Unit tests require these modes to be compiled/accepted only under `debug_assertions` and absent from release strings.

- [ ] **Step 2: Run Node tests and verify RED**

Run: `node --test tests/unit/tauri-shell.test.mjs`
Expected: FAIL because failure-injection contracts do not exist.

- [ ] **Step 3: Implement bounded debug-only injection**

Production/release builds always use real network and signed update state. QA modes may replace only the state source, never production URL, credentials, updater public key, endpoint or installer path.

- [ ] **Step 4: Add Playwright geometry/state tests**

Test one main window, fingerprint convergence, center boundary, no text overlap, retry, compact pill, critical gate, test opt-in and exact production handoff. Capture screenshots at 1920x1080, 1440x900 and the minimum 960x640 window.

- [ ] **Step 5: Run complete Windows QA**

```powershell
pnpm.cmd windows:tauri:test
pnpm.cmd windows:tauri:qa
cd windows-tauri/src-tauri
cargo fmt --check
cargo test
cargo build --release
```

Scan the release EXE for debug mode names, CDP flags, secret names and private key fragments; expected matches: zero.

- [ ] **Step 6: Commit**

```powershell
git add scripts/windows-tauri-qa.mjs tests/e2e/windows-tauri* tests/unit/tauri-shell.test.mjs docs/native/NATIVE_QA_CHECKLIST.md docs/QA_RESULTS.md
git commit -m "Cover Windows startup and updater lifecycle"
```

---

### Task 7: Signed 0.2.1 Upgrade Rehearsal And Production Regression

**Files:**
- Modify: `windows-tauri/package.json`
- Modify: `windows-tauri/src-tauri/Cargo.toml`
- Modify: `windows-tauri/src-tauri/tauri.conf.json`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/QA_RESULTS.md`

**Interfaces:**
- Produces signed Windows `0.2.1` installer/updater artifact and stable/test manifests.
- Verifies real `0.2.0 -> 0.2.1` update while preserving the production profile.

- [ ] **Step 1: Bump all three Windows version sources consistently**

Set Tauri package, Cargo package and shell package version to `0.2.1`; increment `desktopBuild` from `4` to `5`. Extend unit tests to reject version drift.

- [ ] **Step 2: Build signed updater artifacts**

Supply private key/password only through the local release environment, build NSIS/update artifacts, and verify `.sig` exists. Record installer/update artifact size and SHA-256 without logging secrets.

- [ ] **Step 3: Publish to test first**

Atomically publish `0.2.1` to the test channel. On installed `0.2.0`, opt into test, check, download/install, relaunch, verify bridge reports `0.2.1/5`, auth profile is preserved, tray/single-instance works, and rollback/downgrade is not automatic.

- [ ] **Step 4: Promote exact immutable artifact to stable**

After test QA, point stable metadata to the same immutable signed artifact. Verify stable manifest, artifact size/hash and signature over HTTPS.

- [ ] **Step 5: Run cross-platform regression**

```powershell
git diff --check
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd e2e:smoke
pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts
pnpm.cmd db:types:check
pnpm.cmd rls:smoke
pnpm.cmd android:sync
pnpm.cmd android:build:debug
pnpm.cmd windows:tauri:test
pnpm.cmd windows:tauri:qa
```

Expected: all executable checks exit 0; advisory type/RLS findings are reported separately.

- [ ] **Step 6: Security guard and independent review**

Verify no service role in frontend, no updater private key/password, no credentials, no keystore/google-services changes, no wildcard CDP origin, and no SQL. Request independent diff review and resolve all findings.

- [ ] **Step 7: Commit, push and deploy verification**

```powershell
git add windows-tauri docs/PRODUCTION_PRIORITY_TRACKER.md docs/QA_RESULTS.md
git commit -m "Release signed Windows secure startup update"
git push origin main
```

Wait for exact-commit Coolify web/worker deployments, verify `https://app.letscube.ru/` and both updater manifests return 200, then record deployment IDs and physical upgrade result.

## Completion Criteria

- Exactly one visible Windows main window from process start through messenger readiness.
- The approved fingerprint handshake is driven by real preflight state and never claims to display real secrets.
- Normal update control does not obstruct chat; test is explicit opt-in; critical stable is the only blocking state.
- Signed `0.2.0 -> 0.2.1` physical upgrade succeeds with profile/session preservation.
- Browser/PWA and Android behavior regressions are absent.
- No SQL, service role frontend usage, credentials, updater private key, keystore or Firebase config enters git.
