# LETSCUBE Unified Interface Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one coherent LETSCUBE desktop chrome across web and Tauri, compact the settings/media controls, replace misleading welcome copy, and provide a useful real-data administration dashboard.

**Architecture:** A shared React `AppTopBar` owns authenticated desktop branding and conditionally exposes narrowly scoped Tauri window controls. Sidebar/chat rows share CSS geometry tokens. Dashboard fetching moves into a bounded hook/model while presentation stays in focused components; the Windows bridge adds only main-window commands and the bundled startup page mirrors the same chrome.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Supabase JS, Recharts 2, Playwright 1.59, Node test runner, Tauri 2/Rust.

**Spec:** `docs/superpowers/specs/2026-08-20-letscube-unified-interface-chrome-design.md`

## Global Constraints

- Preserve chat, notification, search, task, media, PWA, Android and Windows updater behavior.
- Do not modify database schema, RLS, iPhone/iPad PWA implementation, Android packaging, signing or secrets.
- Keep one authenticated-shell LETSCUBE wordmark on desktop and a compact mark on mobile.
- Keep Tauri commands restricted to the `main` window and exact production origin.
- Use existing `--kub-*` tokens, Recharts and icon libraries; add no UI dependency.
- Apply every behavior change through a failing test first.

---

### Task 1: Version Label, Media Quality Track And Welcome Copy

**Files:**
- Create: `artifacts/kub/src/lib/releaseVersionLabel.ts`
- Modify: `artifacts/kub/src/components/settings/ReleaseDistributionSection.tsx`
- Modify: `artifacts/kub/src/components/chat/MessageInput.tsx`
- Modify: `artifacts/kub/src/components/chat/WelcomeScreen.tsx`
- Test: `tests/unit/release-version-label.test.mts`
- Test: `tests/e2e/unified-interface-chrome.spec.ts`

**Interfaces:**
- Produces: `getVisibleReleaseVersion(value: unknown): string | null`.
- Preserves: `MediaQuality`, `MEDIA_QUALITY_OPTIONS`, storage keys and upload/recording behavior.

- [ ] **Step 1: Add failing unit tests for release version filtering**

```ts
test("release version label hides placeholders", () => {
  assert.equal(getVisibleReleaseVersion("0.0.0"), null);
  assert.equal(getVisibleReleaseVersion("unknown"), null);
});

test("release version label accepts a real semantic version", () => {
  assert.equal(getVisibleReleaseVersion("0.2.7"), "Версия 0.2.7");
});
```

- [ ] **Step 2: Add failing Playwright contracts**

```ts
await expect(page.getByTestId("media-quality-track")).toHaveAttribute("role", "radiogroup");
await expect(page.getByTestId("welcome-capability-pills")).toHaveCount(0);
await expect(page.getByText("Шифрование", { exact: true })).toHaveCount(0);
```

- [ ] **Step 3: Run the focused tests and confirm expected failures**

Run: `node --test tests/unit/release-version-label.test.mts`  
Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts --project=chromium-desktop-1440`  
Expected: tests fail because the helper/track/new welcome contract does not exist.

- [ ] **Step 4: Implement the smallest passing UI changes**

```ts
export function getVisibleReleaseVersion(value: unknown): string | null {
  if (typeof value !== "string" || value === "0.0.0") return null;
  return /^\d+\.\d+\.\d+$/.test(value) ? `Версия ${value}` : null;
}
```

Implement a three-stop accessible radio track and one active description. Remove the welcome feature array and unsupported claims.

- [ ] **Step 5: Re-run focused tests and refactor only after green**

Run: `node --test tests/unit/release-version-label.test.mts`  
Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts --project=chromium-desktop-1440`

---

### Task 2: Shared AppTopBar And Aligned Shell Geometry

**Files:**
- Create: `artifacts/kub/src/components/layout/AppTopBar.tsx`
- Modify: `artifacts/kub/src/components/layout/MainLayout.tsx`
- Modify: `artifacts/kub/src/components/sidebar/SidebarHeader.tsx`
- Modify: `artifacts/kub/src/components/chat/ChatHeader.tsx`
- Modify: `artifacts/kub/src/index.css`
- Modify: `tests/e2e/unified-interface-chrome.spec.ts`
- Modify: `tests/e2e/visual-style-layout.spec.ts`

**Interfaces:**
- Produces: `AppTopBar` with `data-testid="app-top-bar"`.
- Produces CSS tokens: `--kub-app-topbar-height` and `--kub-control-row-height`.
- Consumes: `isDesktopApp()` and the existing LETSCUBE brand assets.

- [ ] **Step 1: Add failing shell geometry tests**

```ts
await expect(page.getByTestId("app-top-bar")).toBeVisible();
await expect(page.getByTestId("authenticated-shell-brand")).toHaveCount(1);
expect(Math.abs(sidebarBox.y + sidebarBox.height - chatBox.y - chatBox.height)).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Run the shell tests and confirm the missing top bar/baseline failure**

Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts --project=chromium-desktop-1440`

- [ ] **Step 3: Implement shared geometry and desktop/mobile brand behavior**

```tsx
<div className="flex h-[var(--kub-app-topbar-height)] items-center border-b ...">
  <KubBrandLogo data-testid="authenticated-shell-brand" ... />
  <DesktopWindowControls />
</div>
```

Render the rail on `md+`, keep a compact mark in the mobile sidebar row, remove the old desktop brand strip, and set both control rows to `var(--kub-control-row-height)`.

- [ ] **Step 4: Re-run layout tests at desktop and mobile sizes**

Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts tests/e2e/visual-style-layout.spec.ts`

---

### Task 3: Bounded Dashboard Data Model

**Files:**
- Create: `artifacts/kub/src/pages/admin/dashboardModel.ts`
- Create: `artifacts/kub/src/hooks/useAdminDashboard.ts`
- Modify: `artifacts/kub/src/pages/admin/AuditTab.tsx`
- Create: `tests/unit/admin-dashboard-model.test.mts`

**Interfaces:**
- Produces: `buildRegistrationSeries(rows, now, days)`.
- Produces: `formatAdminAuditEvent(row)` shared by dashboard and audit list.
- Produces: `useAdminDashboard()` with independent `metrics`, `registrationSeries`, `recentUsers`, `recentEvents`, `loading`, `errors`, `updatedAt`, and `refresh` fields.

- [ ] **Step 1: Write failing model tests**

```ts
test("registration series returns every requested day including zero days", () => {
  const series = buildRegistrationSeries([{ created_at: "2026-08-20T09:00:00Z" }], now, 7);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1)?.value, 1);
});

test("audit formatter never exposes raw unknown payloads", () => {
  assert.equal(formatAdminAuditEvent(unknownRow), "Системное событие");
});
```

- [ ] **Step 2: Run model tests and confirm missing-module failures**

Run: `node --test tests/unit/admin-dashboard-model.test.mts`

- [ ] **Step 3: Implement bounded model and parallel hook**

Use parallel count queries, at most seven days of profile timestamps, at most six recent profiles, and at most eight audit rows. Preserve successful regions when another query fails and coalesce realtime/interval refreshes.

- [ ] **Step 4: Re-run model tests and typecheck**

Run: `node --test tests/unit/admin-dashboard-model.test.mts`  
Run: `pnpm.cmd --filter @workspace/kub run typecheck`

---

### Task 4: Operational Administration Dashboard

**Files:**
- Create: `artifacts/kub/src/pages/admin/dashboard/DashboardMetricStrip.tsx`
- Create: `artifacts/kub/src/pages/admin/dashboard/RegistrationTrend.tsx`
- Create: `artifacts/kub/src/pages/admin/dashboard/RecentActivity.tsx`
- Modify: `artifacts/kub/src/pages/admin/DashboardTab.tsx`
- Modify: `tests/e2e/unified-interface-chrome.spec.ts`

**Interfaces:**
- Consumes: `useAdminDashboard()`.
- Produces test IDs: `admin-dashboard-metrics`, `admin-registration-trend`, `admin-recent-users`, `admin-recent-events`.

- [ ] **Step 1: Add failing admin dashboard presentation tests**

```ts
await expect(page.getByTestId("admin-dashboard-metrics")).toBeVisible();
await expect(page.getByTestId("admin-registration-trend")).toBeVisible();
await expect(page.getByTestId("admin-recent-users")).toBeVisible();
await expect(page.getByTestId("admin-recent-events")).toBeVisible();
```

- [ ] **Step 2: Run the admin test and confirm the new sections are absent**

Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts --project=chromium-desktop-1440 -g "administration dashboard"`

- [ ] **Step 3: Implement the dashboard using existing Recharts**

Use a compact metrics band, an accessible seven-day line/area chart, an online composition summary, and bounded recent lists. Avoid nested cards, fake trends and blocking whole-page errors.

- [ ] **Step 4: Re-run desktop/mobile admin tests and typecheck**

Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts`  
Run: `pnpm.cmd --filter @workspace/kub run typecheck`

---

### Task 5: Windows Main-Window Bridge And Custom Title Bar

**Files:**
- Modify: `windows-tauri/src-tauri/src/lib.rs`
- Modify: `windows-tauri/src-tauri/tauri.conf.json`
- Create: `windows-tauri/src-tauri/permissions/autogenerated/desktop_start_dragging.toml`
- Create: `windows-tauri/src-tauri/permissions/autogenerated/desktop_minimize.toml`
- Create: `windows-tauri/src-tauri/permissions/autogenerated/desktop_toggle_maximize.toml`
- Create: `windows-tauri/src-tauri/permissions/autogenerated/desktop_is_maximized.toml`
- Create: `windows-tauri/src-tauri/permissions/autogenerated/desktop_close_to_tray.toml`
- Modify: `windows-tauri/src-tauri/capabilities/production.json`
- Modify: `artifacts/kub/src/types/desktop.d.ts`
- Modify: `artifacts/kub/src/lib/platform/desktop.ts`
- Modify: `artifacts/kub/src/components/layout/AppTopBar.tsx`
- Modify: `tests/unit/tauri-shell.test.mjs`

**Interfaces:**
- Extends `window.letscubeDesktop` with `startDragging`, `minimize`, `toggleMaximize`, `isMaximized`, and `closeToTray`.
- Preserves exact-origin capability and close-to-tray semantics.

- [ ] **Step 1: Add failing Tauri contract tests**

```js
assert.equal(tauriConfig.app.windows[0].decorations, false);
for (const command of ["desktop_start_dragging", "desktop_minimize", "desktop_toggle_maximize", "desktop_is_maximized", "desktop_close_to_tray"]) {
  assert.match(libRs, new RegExp(`fn ${command}`));
}
```

- [ ] **Step 2: Run Tauri tests and confirm failures**

Run: `pnpm.cmd windows:tauri:test`

- [ ] **Step 3: Implement fail-closed main-window commands and bridge methods**

Each command calls `require_production_main`, checks `window.label() == "main"`, and invokes only the corresponding Tauri window method. Add controls to `AppTopBar` only when `isDesktopApp()` is true.

- [ ] **Step 4: Re-run Rust/unit/type checks**

Run: `pnpm.cmd windows:tauri:test`  
Run: `cargo test --manifest-path windows-tauri/src-tauri/Cargo.toml`  
Run: `pnpm.cmd --filter @workspace/kub run typecheck`

---

### Task 6: Bundled Startup Chrome Parity

**Files:**
- Modify: `windows-tauri/ui/startup.html`
- Modify: `windows-tauri/ui/startup.css`
- Modify: `windows-tauri/ui/startup.js`
- Modify: `tests/e2e/windows-tauri-startup.spec.ts`
- Modify: `tests/e2e/windows-tauri-shell.spec.ts`

**Interfaces:**
- Consumes the same bridge window commands.
- Produces stable `startup-titlebar` geometry matching `AppTopBar`.

- [ ] **Step 1: Add failing startup titlebar tests**

```ts
await expect(page.getByTestId("startup-titlebar")).toBeVisible();
await expect(page.getByTestId("startup-window-minimize")).toBeVisible();
await expect(page.getByTestId("startup-window-close")).toBeVisible();
```

- [ ] **Step 2: Run startup tests and confirm failure**

Run: `pnpm.cmd exec playwright test tests/e2e/windows-tauri-startup.spec.ts`

- [ ] **Step 3: Implement matching startup chrome without moving handshake geometry**

Replace the old 82px header with the shared 44px titlebar treatment. Keep the handshake endpoints, progress rails, status, update checks and minimum visible durations unchanged.

- [ ] **Step 4: Re-run startup and shell tests**

Run: `pnpm.cmd exec playwright test tests/e2e/windows-tauri-startup.spec.ts tests/e2e/windows-tauri-shell.spec.ts`

---

### Task 7: Full Visual, Functional And Release-Safe Verification

**Files:**
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify only if findings require it: changed frontend/Windows files from Tasks 1-6

**Interfaces:**
- Produces final screenshots under ignored `output/playwright/`.
- Produces no schema, secret, generated release or tracked screenshot changes.

- [ ] **Step 1: Run focused unit and browser suites**

Run: `node --test tests/unit/release-version-label.test.mts tests/unit/admin-dashboard-model.test.mts tests/unit/tauri-shell.test.mjs`  
Run: `pnpm.cmd exec playwright test tests/e2e/unified-interface-chrome.spec.ts tests/e2e/visual-style-layout.spec.ts tests/e2e/release-distribution-settings.spec.ts`

- [ ] **Step 2: Run project validation**

Run: `git diff --check`  
Run: `pnpm.cmd --filter @workspace/kub run typecheck`  
Run: `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`  
Run: `pnpm.cmd e2e:smoke`

- [ ] **Step 3: Run Windows verification**

Run: `pnpm.cmd windows:tauri:test`  
Run: `cargo test --manifest-path windows-tauri/src-tauri/Cargo.toml`  
Run: `pnpm.cmd windows:tauri:qa`

- [ ] **Step 4: Inspect representative screenshots and layout metrics**

Check 3840x2160, 1920x1080, 1440x900, 390x844, 412x915, and Tauri 1360x860/minimum size. Verify one wordmark, aligned baselines, no horizontal overflow, compact quality control, readable dashboard and stable titlebar.

- [ ] **Step 5: Run the required Impeccable detector once after UI completion**

Run: `node C:\Users\maksi\.agents\skills\impeccable\scripts\detect.mjs --json artifacts/kub/src/components/layout artifacts/kub/src/components/sidebar/SidebarHeader.tsx artifacts/kub/src/components/chat/MessageInput.tsx artifacts/kub/src/components/chat/WelcomeScreen.tsx artifacts/kub/src/pages/admin`

- [ ] **Step 6: Update tracker, review the diff, commit and push only after all required checks pass**

```powershell
git status --short
git diff --stat
git add -- <reviewed files>
git commit -m "Polish LETSCUBE interface and Windows chrome"
git push origin main
```
