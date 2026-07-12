# LETSCUBE Release Catalog And Native Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hosted release catalog on `api.letscube.ru`, show honest Android APK and Windows EXE availability/version states in Settings, and keep iOS as the only PWA installation target.

**Architecture:** A pure TypeScript release-catalog module validates and compares bounded manifests, while a React hook adds timeout, local cache and refresh behavior without blocking startup. A separate read-only Nginx container serves immutable artifacts and no-cache manifests from persistent host storage through Coolify/Traefik; releases are published atomically over SSH with a repository-managed script.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Node test runner, Playwright, Capacitor 8, Nginx Alpine, Bash, Coolify 4.1/Traefik 3.6.

## Global Constraints

- iOS Home Screen PWA is the only installed PWA target.
- Android uses the dedicated APK; Windows uses the dedicated EXE.
- Browser access remains supported on Android and Windows, but those platforms must not show a PWA install CTA.
- Release catalog origin is exactly `https://api.letscube.ru`; manifests live under `/releases/v1/` and artifacts under `/releases/files/`.
- Request timeout is 5 seconds and normal cache TTL is 6 hours.
- Browser download handoff must never show fake byte percentages.
- Manifest and artifact delivery is read-only over HTTP; publishing is SSH-only and atomic.
- No SQL, RLS or schema changes.
- No service-role, Firebase key, signing key, keystore, password or token in frontend, Git, manifests or logs.
- Existing browser/PWA push, Android FCM, auth, media, geolocation and chat behavior must remain unchanged.

---

### Task 1: Release Catalog Contract And Cache Client

**Files:**
- Create: `artifacts/kub/src/lib/releaseCatalog.ts`
- Create: `tests/unit/release-catalog.test.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ReleasePlatform`, `ReleaseChannel`, `ReleaseManifest`, `ReleaseCatalogSnapshot`, `parseReleaseManifest`, `compareReleaseVersions`, `getReleaseManifestUrl`, `createReleaseCatalogClient`.
- The client accepts injected `fetch`, `Storage`, clock and base URL so tests do not make network requests.

- [ ] **Step 1: Write failing parser/version/cache tests**

Cover a valid Android manifest, unavailable manifest, wrong origin/path, malformed SHA/size/SemVer, `0.10.0 > 0.9.9`, 5-second timeout wiring, six-hour fresh cache and stale-cache fallback after a failed refresh.

```ts
const client = createReleaseCatalogClient({
  fetchImpl,
  storage,
  now: () => now,
  baseUrl: "https://api.letscube.ru",
});
const snapshot = await client.load("android", "stable");
assert.equal(snapshot.manifest.platform, "android");
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/release-catalog.test.mts`

Expected: FAIL because `artifacts/kub/src/lib/releaseCatalog.ts` does not exist.

- [ ] **Step 3: Implement the bounded contract and client**

Use strict `major.minor.patch` SemVer, schema version `1`, an allow-list for `android|windows` and `stable`, URL validation against `https://api.letscube.ru/releases/files/`, `AbortController` timeout, and cache key `letscube:release-catalog:v1:{platform}:{channel}`. Return cache metadata instead of throwing when a valid stale cache can be used.

- [ ] **Step 4: Verify GREEN and add the focused root script**

Run: `node --test tests/unit/release-catalog.test.mts`

Expected: all release-catalog tests pass.

Add root script:

```json
"release:catalog:test": "node --test tests/unit/release-catalog.test.mts tests/unit/release-catalog-deploy.test.mjs"
```

---

### Task 2: Distribution Platform Policy

**Files:**
- Create: `artifacts/kub/src/lib/platform/distribution.ts`
- Create: `tests/unit/distribution-platform.test.mts`
- Modify: `artifacts/kub/index.html`
- Modify: `artifacts/kub/src/hooks/usePwa.ts`

**Interfaces:**
- Produces: `DistributionTarget`, `detectDistributionTarget(input)`, `getDistributionCopy(target)`.
- Consumes: existing `isNativeApp()` and `getRuntimePlatform()`.

- [ ] **Step 1: Write failing platform-policy tests**

Assert that iPhone/iPad return `ios_pwa`, Android browser returns `android_download`, Capacitor Android returns `android_native`, Windows returns `windows_download`, and other platforms return `web_only`. Assert `supportsPwaInstall` is true only for the iOS PWA target.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/distribution-platform.test.mts`

Expected: FAIL because the distribution module is absent.

- [ ] **Step 3: Implement policy and remove Android/desktop PWA copy**

Move deterministic user-agent/platform mapping into `distribution.ts`. Keep service-worker registration for normal web use, but make the Settings install button and installation guidance iOS-only. Replace the unconditional manifest link in `index.html` with a pre-hydration iPhone/iPad-only manifest injection so Chrome on Android/Windows cannot independently offer PWA installation. Android and Windows copy must describe APK/EXE availability, not browser installation.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/distribution-platform.test.mts tests/unit/release-catalog.test.mts`

Expected: all focused tests pass.

---

### Task 3: Release Status Hook And Settings UX

**Files:**
- Create: `artifacts/kub/src/hooks/useReleaseCatalog.ts`
- Create: `artifacts/kub/src/components/settings/ReleaseDistributionSection.tsx`
- Modify: `artifacts/kub/src/components/sidebar/SettingsModal.tsx`
- Modify: `artifacts/kub/src/index.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/e2e/pwa-install-settings.spec.ts`
- Create: `tests/e2e/release-distribution-settings.spec.ts`

**Interfaces:**
- `useReleaseCatalog(target)` returns `{ state, manifest, cached, checking, refresh, beginDownload }`.
- `ReleaseDistributionSection` owns only presentation and delegates native/PWA behavior to the hooks.

- [ ] **Step 1: Update Playwright expectations before UI code**

Tests must assert: iOS still shows one Home Screen install action; Android browser has no PWA CTA and shows APK status; Windows browser has no PWA CTA and shows EXE status; unavailable/offline states are friendly; the download action accepts only validated release URLs; the block has no horizontal overflow at 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.

- [ ] **Step 2: Run the focused specs and verify RED**

Run: `pnpm.cmd exec playwright test tests/e2e/pwa-install-settings.spec.ts tests/e2e/release-distribution-settings.spec.ts --project=chromium-desktop-1440`

Expected: FAIL because Android/Windows still expose PWA copy and release status does not exist.

- [ ] **Step 3: Implement hook and component**

Add `@capacitor/app` and use `App.getInfo()` only inside native Android to obtain the installed version/build. The hook checks when Settings opens, coalesces `online`/visibility refresh, preserves a valid stale cache, and never blocks app startup. The component renders checking, preparing, available, current, update, stale and unavailable states. Use restrained opacity/transform/shimmer animation and disable it under `prefers-reduced-motion`. Browser downloads show an indeterminate handoff followed by `Загрузка передана системе`, never a fake percentage.

- [ ] **Step 4: Verify focused unit and browser tests**

Run:

```powershell
node --test tests/unit/distribution-platform.test.mts tests/unit/release-catalog.test.mts
pnpm.cmd exec playwright test tests/e2e/pwa-install-settings.spec.ts tests/e2e/release-distribution-settings.spec.ts
```

Expected: focused unit and all configured Playwright viewport projects pass or auth-dependent cases report an explicit environment skip.

---

### Task 4: Static Release Service And Atomic Publisher

**Files:**
- Create: `docs/deploy/release-catalog/Dockerfile`
- Create: `docs/deploy/release-catalog/nginx.conf`
- Create: `docs/deploy/release-catalog/docker-compose.yml`
- Create: `scripts/publish-native-release.sh`
- Create: `tests/unit/release-catalog-deploy.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Container mounts `/srv/letscube/releases/public` read-only at `/usr/share/nginx/html`; the host root itself contains `releases/v1` and `releases/files`.
- Publisher signature: `publish-native-release.sh PLATFORM CHANNEL VERSION BUILD ARTIFACT [NOTES]`.

- [ ] **Step 1: Write failing deployment-contract tests**

Assert no directory listing, no-cache manifest location, immutable artifact location, read-only mount, no public write method, path/version allow-lists, SHA-256 generation, temporary copy plus atomic rename, and no secret-bearing variables.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/release-catalog-deploy.test.mjs`

Expected: FAIL because deployment files do not exist.

- [ ] **Step 3: Implement static service and publisher**

Nginx serves `/releases/v1/` with `no-cache, no-store, must-revalidate`, `/releases/files/` with `public, max-age=31536000, immutable`, denies dotfiles and directory indexes, and exposes `/healthz`. Publisher rejects existing version destinations, computes lowercase SHA-256 and size, writes bounded JSON through `jq`, then atomically renames both artifact and manifest.

- [ ] **Step 4: Verify GREEN and syntax**

Run:

```powershell
node --test tests/unit/release-catalog-deploy.test.mjs
bash -n scripts/publish-native-release.sh
docker compose -f docs/deploy/release-catalog/docker-compose.yml config
```

Expected: tests and syntax pass; Docker config may be reported unavailable locally without blocking server-side validation.

---

### Task 5: Production Coolify Route And Initial Catalog

**Files:**
- Modify remotely: `/srv/letscube/releases/public/` contents and permissions.
- Create remotely through Coolify: application `letscube-releases`.

**Interfaces:**
- Public origin: `https://api.letscube.ru`.
- Health endpoint: `https://api.letscube.ru/healthz`.
- Initial manifests: Android `stable` and Windows `stable`, both valid even when no artifact is published.

- [ ] **Step 1: Push the validated repository changes to `main`**

Confirm the web auto-deploy starts only for frontend-relevant changes and obtain the exact commit SHA.

- [ ] **Step 2: Create host storage safely over SSH**

Create `/srv/letscube/releases/public/releases/v1/{android,windows}` and `/srv/letscube/releases/public/releases/files/{android,windows}`. Grant the existing `techadmin` release group write access without broad root permissions. Do not remove or overwrite unrelated `/srv/letscube` data. Mount `/srv/letscube/releases/public` at `/usr/share/nginx/html` so public URLs contain exactly one `/releases/` segment.

- [ ] **Step 3: Create the Coolify application**

Create a GitHub/Dockerfile application from `ALTIS13/kub-messenger.git`, branch `main`, Dockerfile `/docs/deploy/release-catalog/Dockerfile`, exposed port `8080`, domain `https://api.letscube.ru`, health path `/healthz`, and persistent host storage mounted at `/usr/share/nginx/html`. The image runs as non-root `nginx`, so the root-owned catalog files are not writable even though Coolify's host bind itself is read-write.

- [ ] **Step 4: Deploy and verify TLS before enabling client use**

Run external checks for certificate verification, HTTP 200 health, directory listing denial, manifest cache headers and schema. If TLS is not valid, do not publish an `available: true` manifest.

- [ ] **Step 5: Publish the current internal Android APK only after build validation**

Build the production-configured debug/internal APK, compute SHA-256, upload through the SSH publisher and verify remote HEAD/GET size and checksum. Keep Windows `available: false` until an EXE exists.

---

### Task 6: Regression Validation, Documentation And Production Evidence

**Files:**
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/QA_RESULTS.md`
- Modify: `docs/native/ANDROID_CAPACITOR_PLAN.md`
- Modify: `docs/native/WINDOWS_PACKAGING_PLAN.md`

- [ ] **Step 1: Run full local validation**

```powershell
git diff --check
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd release:catalog:test
pnpm.cmd e2e:smoke
pnpm.cmd db:types:check
pnpm.cmd rls:smoke
pnpm.cmd exec playwright test tests/e2e/pwa-install-settings.spec.ts tests/e2e/release-distribution-settings.spec.ts
```

- [ ] **Step 2: Run Android regression when native files/assets changed**

```powershell
pnpm.cmd android:sync
pnpm.cmd android:build:production:debug
```

Verify the APK exists and retains `LETSCUBE`, package `com.kub.messenger`, FCM configuration isolation and production public backend parameters.

- [ ] **Step 3: Run security guard scans**

Confirm no service-role in frontend, no signing/Firebase/private keys in Git, no raw tokens and no SQL change.

- [ ] **Step 4: Record exact production evidence**

Update tracker and QA docs with commit, deployment UUID/status, TLS result, manifest URL, cache headers, artifact size/SHA parity, tested viewports and honest skips.

- [ ] **Step 5: Commit, push and verify deployed behavior**

Push `main`, wait for relevant Coolify applications to become healthy, then verify `app.letscube.ru` Settings and `api.letscube.ru` release endpoints from a real browser and direct HTTPS requests.
