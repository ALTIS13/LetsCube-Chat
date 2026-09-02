# Public Home, Downloads And Changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let unauthenticated browser visitors understand and download LETSCUBE without signing in, using a theme-safe, lightweight product page with real sanitized interface previews and a compact Stable changelog.

**Architecture:** Reuse the current Vite application, public route shell and release catalog. The root router sends unauthenticated browsers to `PublicHomePage`, authenticated users to the messenger, and native Windows/Android shells to auth/app. Release manifest v1 gains optional bounded highlights while remaining compatible with installed clients.

**Tech Stack:** React, Wouter, Tailwind/CSS tokens, existing LETSCUBE components, release-catalog nginx service, Bash/Node publishing tools, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`

## Global Constraints

- Do not use the base domain `letscube.ru`; public UI remains on `app.letscube.ru` and artifacts on `api.letscube.ru`.
- Do not show a working download action unless a valid Stable manifest has `available: true` and a verified artifact.
- Do not introduce a broad news portal or heavy CMS.
- Do not expose real user chats, names, phones, avatars or operational data in public assets.
- Unauthenticated browser `/` shows the product page; authenticated `/` shows the messenger.
- Windows/Android native shells skip the public home.
- iPhone/iPad PWA code is owned by another agent and is not modified here.
- Theme applies before first paint and respects stored/system preference.
- Use real product imagery, no generic marketing illustration, card-heavy layout or split card hero.
- Preserve `/privacy`, `/support`, auth callbacks, release updater and existing PWA/native routing.

## Task-Specific Skills

- Before implementing Tasks 2-4, read `build-web-apps:frontend-app-builder`, `build-web-apps:react-best-practices`, `product-design:index`, `impeccable` and `build-web-apps:frontend-testing-debugging`.
- Use Playwright for screenshot and responsive verification.

---

### Task 1: Extend release manifests with backward-compatible highlights

**Files:**
- Modify: `artifacts/kub/src/lib/releaseCatalog.ts`
- Modify: `scripts/publish-native-release.sh`
- Modify: `tests/unit/release-catalog.test.mts`
- Modify: `tests/unit/release-catalog-deploy.test.mjs`
- Modify: `tests/unit/distribution-platform.test.mts`
- Create: `tests/fixtures/release-highlights.json`
- Create: `tests/fixtures/release-manifest-v1-without-highlights.json`

**Interfaces:**
- `ReleasePlatform` becomes `"android" | "windows" | "macos" | "ios" | "web"`.
- `ReleaseManifest` gains optional `highlights: string[]` while `schemaVersion` remains `1`.
- Existing Android/Windows publishers remain the only active artifact publishers until another platform has a real distribution format.

- [x] **Step 1: Write failing parser tests**

```ts
test("parseReleaseManifest accepts bounded optional highlights", () => {
  const manifest = parseReleaseManifest(androidManifest({
    highlights: ["Быстрее открываются большие чаты", "Улучшена доставка уведомлений"],
  }), "android", "stable");
  assert.deepEqual(manifest.highlights, [
    "Быстрее открываются большие чаты",
    "Улучшена доставка уведомлений",
  ]);
});

test("highlights are capped without changing schema version", () => {
  assert.throws(() => parseReleaseManifest(androidManifest({ highlights: Array(7).fill("Изменение") }), "android"), /highlights/);
  assert.throws(() => parseReleaseManifest(androidManifest({ highlights: ["x".repeat(141)] }), "android"), /highlights/);
});
```

Also keep a raw pre-highlights v1 fixture and assert it parses to
`highlights: []`. Unknown JSON fields remain ignored. This is the explicit
backward-compatibility gate for installed clients and old manifests.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/unit/release-catalog.test.mts`

Expected: FAIL because parsed manifests do not expose `highlights`.

- [x] **Step 3: Extend the parser additively**

```ts
export type ReleaseManifest = {
  schemaVersion: 1;
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  available: boolean;
  version: string;
  build: number;
  publishedAt: string;
  minimumSupportedVersion: string | null;
  mandatory: boolean;
  notes: string;
  highlights: string[];
  artifact: ReleaseArtifact | null;
};

function parseHighlights(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 6) throw new ReleaseCatalogError("highlights");
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 140) {
      throw new ReleaseCatalogError("highlights");
    }
    return item.trim();
  });
}
```

Older manifest files without `highlights` parse as an empty list. Existing installed clients ignore the new JSON field.

- [x] **Step 4: Add an optional highlights file to the publisher**

Extend legacy publish syntax with `--highlights-file FILE`. The file must be a UTF-8 JSON array of one to six strings, each 1-140 characters. Validate it before acquiring the publish lock. Pass the parsed array to both jq and Python writers as `highlights`.

The exact legacy grammar becomes:

```text
publish-native-release.sh PLATFORM CHANNEL VERSION BUILD ARTIFACT [NOTES] [--highlights-file FILE]
```

The first non-flag argument after `ARTIFACT` is the optional notes value.
`--highlights-file` may appear once after it or directly after `ARTIFACT`; an
unknown option, duplicate flag, missing file argument, symlink or invalid JSON
fails before `acquire_publish_lock`. Existing five- and six-positional-argument
invocations remain unchanged. Tests exercise both jq and Python writer paths and
assert identical optional-field output.

Example fixture:

```json
[
  "Быстрее открываются большие чаты",
  "Улучшена доставка уведомлений"
]
```

- [x] **Step 5: Preserve active publisher platform restrictions**

The TypeScript client recognizes future platform identifiers, but `publish-native-release.sh` continues to publish only `android` APK and `windows` EXE until real macOS/iOS distribution is designed. Tests must assert an attempted fake macOS artifact still fails rather than publishing a dead link.

- [x] **Step 6: Run release tests and commit**

```powershell
pnpm.cmd release:catalog:test
node --test tests/unit/distribution-platform.test.mts
git add artifacts/kub/src/lib/releaseCatalog.ts scripts/publish-native-release.sh tests/unit/release-catalog.test.mts tests/unit/release-catalog-deploy.test.mjs tests/unit/distribution-platform.test.mts tests/fixtures/release-highlights.json tests/fixtures/release-manifest-v1-without-highlights.json
git commit -m "feat(release): add compact Stable changelog metadata"
```

---

### Task 2: Add explicit public-home and native-shell route decisions

**Files:**
- Create: `artifacts/kub/src/lib/publicHomeRouting.ts`
- Create: `artifacts/kub/src/pages/public/PublicHomePage.tsx`
- Create: `artifacts/kub/src/pages/public/DownloadPage.tsx`
- Modify: `artifacts/kub/src/lib/publicRoutes.ts`
- Modify: `artifacts/kub/src/lib/platform/desktop.ts`
- Modify: `artifacts/kub/src/App.tsx`
- Modify: `tests/unit/public-routes.test.mjs`
- Create: `tests/unit/public-home-routing.test.mts`

**Interfaces:**
- Produces: `decideRootExperience(input) -> "public_home" | "login" | "messenger" | "loading"`.
- Adds public route `/download`.
- Does not alter `/privacy`, `/support` or `/auth/callback` precedence.
- `nativeShell` is sourced only from `isNativeApp() || isDesktopShell()`; user-agent
  distribution classification is not an authority for root routing.

- [x] **Step 1: Write failing root-decision tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decideRootExperience } from "../../artifacts/kub/src/lib/publicHomeRouting.ts";

test("unauthenticated browser sees public home", () => {
  assert.equal(decideRootExperience({ loading: false, authenticated: false, nativeShell: false }), "public_home");
});

test("native shells skip public home", () => {
  assert.equal(decideRootExperience({ loading: false, authenticated: false, nativeShell: true }), "login");
});

test("authenticated users enter messenger", () => {
  assert.equal(decideRootExperience({ loading: false, authenticated: true, nativeShell: false }), "messenger");
});
```

Add precedence coverage for loading, auth callback/recovery, unauthenticated
protected deep links, Capacitor Android, future Capacitor iOS, Tauri Windows and
future Tauri macOS. iPhone/iPad browser sessions remain browsers and therefore
keep their externally owned `ios_pwa` behavior.

- [x] **Step 2: Run tests and verify they fail**

Run: `node --test tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs`

Expected: FAIL because the root-decision module and `/download` public route are absent.

- [x] **Step 3: Implement the pure route decision**

```ts
export function decideRootExperience(input: {
  loading: boolean;
  authenticated: boolean;
  nativeShell: boolean;
}) {
  if (input.loading) return "loading" as const;
  if (input.authenticated) return "messenger" as const;
  return input.nativeShell ? "login" as const : "public_home" as const;
}
```

Add platform-neutral `isDesktopShell()` to `platform/desktop.ts`; it detects the
presence of the trusted LETSCUBE desktop bridge independently of the bridge's
reported platform. Root routing uses `isNativeApp() || isDesktopShell()`. Keep
the existing Windows-only `isDesktopApp()` unchanged for updater, notification
and Windows capability calls, so a future macOS bridge does not inherit Windows
privileges. Do not rely on user-agent strings or download-target classification
for native shells.

- [x] **Step 4: Restructure routing without weakening protected routes**

`RootRoutes` handles public fixed routes first. `AppRoutes` uses the pure root decision only for `/`. Any other unauthenticated protected route still redirects to `/login`. Auth callback remains first so it can establish a session.

- [x] **Step 5: Add minimal page shells**

Create semantic `main`, header, hero and platform sections with visible `Открыть веб-версию`, `Скачать для Windows` and `Скачать для Android` entry points. At this step the buttons use release state placeholders from the hook; no static artifact URLs.

- [x] **Step 6: Run route tests and commit**

```powershell
node --test tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs tests/unit/distribution-platform.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
git add artifacts/kub/src/App.tsx artifacts/kub/src/lib/publicHomeRouting.ts artifacts/kub/src/lib/publicRoutes.ts artifacts/kub/src/lib/platform/desktop.ts artifacts/kub/src/pages/public/PublicHomePage.tsx artifacts/kub/src/pages/public/DownloadPage.tsx tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs tests/unit/distribution-platform.test.mts
git commit -m "feat(public): route guests to LETSCUBE home"
```

---

**Task 2 closed on 2026-09-01.** Implemented across `fdd8933` (routing),
`aeaaace` (mounted coverage), `a455610` (unconfigured matrix and near matches),
`0e406a3` (scoped review fixes) and `f4ab801` (independent review hardening).

Two independent reviews of `3990715..0e406a3` both returned APPROVED with no
P0/P1. Every required contract was mutation-tested: moving the configuration
gate ahead of the public routes, widening `isPublicRoute` to prefix matching,
dropping a route from the public set and forcing `isSupabaseConfigured()` to
`true` all turn the suite red.

Coverage is split across two matrices. The configured one runs against the
shared dev server; the unconfigured one owns port `5188` and starts its own Vite
with every public Supabase name stripped from the inherited environment, which
is what makes the missing-configuration precedence observable at all. It refuses
a busy port, refuses to run when an env file under `artifacts/kub` could
re-supply configuration, requires the child to announce the port itself before
being trusted, and fails loudly rather than skipping when its prerequisites are
absent.

Final validation: mounted matrix 15/15, routing unit suites 15/15 with no skips,
typecheck, production build and `git diff --check` clean, both dev-server ports
released afterwards.

Deferred follow-up, deliberately outside this task: `isSupabaseConfigured()` has
no direct coverage, so mutating its `&&` to `||` keeps the suite green while a
half-configured build would enter `AppRoutes` and throw instead of rendering the
configuration screen. Closing it needs a third dev-server variant.

### Task 3: Produce sanitized real-interface product assets

**Files:**
- Create: `tests/fixtures/public-home-demo.json`
- Create: `scripts/capture-public-home-previews.mjs`
- Create: `artifacts/kub/src/lib/publicPreviewFixture.ts`
- Create: `artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx`
- Modify: `artifacts/kub/src/App.tsx`
- Create: `artifacts/kub/public/product/windows-messenger-dark.webp`
- Create: `artifacts/kub/public/product/windows-messenger-light.webp`
- Create: `artifacts/kub/public/product/android-messenger-dark.webp`
- Create: `artifacts/kub/public/product/android-messenger-light.webp`
- Create: `artifacts/kub/public/product/macos-preview-placeholder.webp`
- Create: `artifacts/kub/public/product/ios-preview-placeholder.webp`
- Create: `tests/unit/public-product-assets.test.mjs`

**Interfaces:**
- Produces deterministic public assets with demo-only content.
- Assets are WebP, bounded in dimensions and file size, and contain no production account data.
- Produces a capture-only route that exists only when both `import.meta.env.DEV`
  and `VITE_PUBLIC_PREVIEW_FIXTURE=1` are true.

- [ ] **Step 1: Write the asset contract test**

The test reads every asset with `sharp` and asserts: WebP format, width between 720 and 1800, height between 450 and 1200, size below 350 KiB, and no filenames or fixture text matching production QA account names, email patterns or phone patterns. A production build contract also asserts the capture route marker and fixture payload are absent. Retain a documented human visual privacy sign-off for the generated pixels; compressed-byte string scans are not accepted as proof of image privacy.

- [ ] **Step 2: Add a deterministic demo fixture**

Use only fictional neutral content:

```json
{
  "currentUser": { "name": "Алекс", "username": "alex_demo" },
  "chats": [
    { "name": "Команда проекта", "preview": "Макет готов к просмотру" },
    { "name": "Мария", "preview": "Отправила документ" }
  ],
  "messages": [
    { "sender": "Мария", "text": "Встречаемся в 15:00" },
    { "sender": "Алекс", "text": "Принято, добавил в задачи" }
  ]
}
```

- [ ] **Step 3: Implement a local-only capture route or fixture injection**

The script starts the existing Vite app with
`VITE_PUBLIC_PREVIEW_FIXTURE=1` in a clean browser context with no storage state.
`App.tsx` exposes `/__qa/public-preview` only behind the two-part DEV guard and
lazy-loads `PublicPreviewCapturePage`; `publicPreviewFixture.ts` validates the
checked-in fictional fixture without Supabase or authentication. Query flags
alone never enable capture mode. Production builds must omit the route marker
and fixture payload, which the asset contract test verifies.

- [ ] **Step 4: Produce future-platform visuals without fake downloads**

The macOS/iOS images may show the same sanitized LETSCUBE conversation inside platform-appropriate framing, but accompanying UI labels them `В разработке` until a Stable manifest exists. They must not imply App Store availability.

- [ ] **Step 5: Run asset validation and commit**

```powershell
node scripts/capture-public-home-previews.mjs
node --test tests/unit/public-product-assets.test.mjs
git add tests/fixtures/public-home-demo.json scripts/capture-public-home-previews.mjs artifacts/kub/src/lib/publicPreviewFixture.ts artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx artifacts/kub/src/App.tsx artifacts/kub/public/product tests/unit/public-product-assets.test.mjs
git commit -m "feat(public): add sanitized LETSCUBE product previews"
```

---

### Task 4: Build the themed platform presentation and compact changelog

**Files:**
- Create: `artifacts/kub/src/components/public/PublicHeader.tsx`
- Create: `artifacts/kub/src/components/public/PlatformShowcase.tsx`
- Create: `artifacts/kub/src/components/public/ReleaseDownloadAction.tsx`
- Create: `artifacts/kub/src/components/public/ReleaseChangelog.tsx`
- Create: `artifacts/kub/src/hooks/usePublicReleaseCatalog.ts`
- Create: `artifacts/kub/src/lib/publicReleaseModel.ts`
- Create: `tests/unit/public-release-model.test.mts`
- Modify: `artifacts/kub/src/pages/public/PublicHomePage.tsx`
- Modify: `artifacts/kub/src/pages/public/DownloadPage.tsx`
- Modify: `artifacts/kub/src/index.css`
- Modify: `artifacts/kub/index.html`
- Modify: `artifacts/kub/src/hooks/useTheme.ts`
- Create: `tests/e2e/public-home.spec.ts`

**Interfaces:**
- Produces ordered platform view models with `loading`, `available`, `unavailable`
  and `error` states plus an independent `stale` boolean overlay.
- Download anchors use only validated manifest artifact URLs.
- Changelog uses at most six current Stable highlights.

- [x] **Step 1: Write failing release-view-model tests**

Test these exact mappings: valid available manifest -> download; valid unavailable -> `В разработке`; no manifest -> unavailable, not error button; stale valid manifest -> enabled with quiet stale note; malformed artifact -> no link.

- [x] **Step 2: Implement the release model**

```ts
export type PublicPlatformState = {
  platform: ReleasePlatform;
  title: string;
  state: "loading" | "available" | "unavailable" | "error";
  version: string | null;
  href: string | null;
  highlights: string[];
  stale: boolean;
};
```

Only Android and Windows are requested as active download manifests. macOS and iOS render unavailable until their owning agent adds valid catalog support.
For macOS and iOS, tests require `href: null`, no download control and no App
Store availability claim. Preview imagery never implies release availability.

- [x] **Step 3: Build an immersive first viewport**

Use a full-width product band with LETSCUBE name, concise messenger description, primary platform-aware action and a visible preview of the next section. Do not place the hero in a card, use a split card layout, gradient illustration or decorative orb. The actual messenger interface is the primary visual.

- [x] **Step 4: Build platform sections and downloads**

Each platform section has a stable responsive aspect ratio, theme-matched screenshot, platform icon, status and one clear action. Avoid nested cards. Buttons use icons and preserve their dimensions while loading. Windows/Android actions download directly without auth.

- [x] **Step 5: Build the compact `Что нового` module**

Show the newest available Stable release, platform, version, date and up to six highlights. If highlights are empty, show the bounded `notes` string. Additional details expand in place; no `/news` route or CMS is introduced.

- [x] **Step 6: Preserve pre-paint theme behavior**

Keep the inline bootstrap in `index.html` synchronized with `THEME_INIT_SCRIPT`
in `artifacts/kub/src/lib/themeRuntime.ts` through a parity test. Add `color-scheme: light dark` and
theme-correct `theme-color` handling before React paint and on resolved-theme
changes. The existing iPhone/iPad-only PWA manifest injection block remains
behaviorally unchanged and is covered by its current distribution regression.

- [x] **Step 7: Add responsive and accessibility tests**

At `1920x1080`, `1440x900`, `390x844` and `412x915`, assert no horizontal scroll, no clipped buttons, actual images loaded, next section visible from hero, correct light/dark screenshots, keyboard navigation and reduced-motion support. Assert no visible computer-club terminology. For macOS/iOS cards assert no artifact `href`, no download action and no store-availability claim.

- [x] **Step 8: Run tests and commit**

```powershell
node --test tests/unit/public-release-model.test.mts tests/unit/release-catalog.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/public-home.spec.ts tests/e2e/privacy-support-public.spec.ts tests/e2e/letscube-brand-auth-layout.spec.ts
git add artifacts/kub/src/components/public artifacts/kub/src/hooks/usePublicReleaseCatalog.ts artifacts/kub/src/hooks/useTheme.ts artifacts/kub/src/lib/publicReleaseModel.ts artifacts/kub/src/pages/public artifacts/kub/src/index.css artifacts/kub/index.html tests/unit/public-release-model.test.mts tests/e2e/public-home.spec.ts
git commit -m "feat(public): add LETSCUBE app showcase"
```

---

**Task 4 closed on 2026-09-01.** Implemented in `a31d7ac` and `c28d3bf`.

Two deviations from the file list, both deliberate. `PublicHeader.tsx` was not
created: `PublicPageShell` already renders the public header and footer, so a
second one would be duplication. And macOS and iOS carry no screenshot, because
a single image cannot be theme matched and reusing another platform's render
under an unreleased heading would suggest a product that does not exist; that
also removed two byte-identical assets from the public payload, leaving four.

Validation is recorded against the head it was run at, because the suite grew
during review and a bare count silently stops matching the tree it sits in.
`docs/operations/public-home-release.md` carries the commands; the numbers below
are the runs, each against the head named.

| Head | Mounted suites, four release viewports | Unit suites |
| --- | --- | --- |
| `c28d3bf` | 55/55 | 66/66 |
| `a169033` | 71/71 | 84/84 |
| `ed51bb9` | 75/75 | 89/89 |
| `19eac6a` | 75/75 | 87/87 |
| this head | 75/75 | 604/605 |

The mounted figure counts `tests/e2e/public-home.spec.ts` plus
`tests/e2e/public-home-routing.spec.ts` across `chromium-desktop-1920`,
`chromium-desktop-1440`, `chromium-mobile-390` and `chromium-mobile-412`; the
routing spec deliberately runs once, so its other-project runs are skips.

The unit figure changes shape on the last row on purpose. Earlier rows counted
only the suites this plan touches, which is why a review round that added tests
could raise the number without anything else being run. The final row is the
whole `tests/unit` directory, so it also states what this branch leaves behind:
one failure, `android-release-signing`, which fails on this workstation because
its temporary fixture never receives a Gradle wrapper and the assertion reads a
shell "command not found" instead of the signing guard. Neither that test nor
the scripts it exercises is modified on this branch, so it is equally red on
`main`; it is tracked separately and is not an Android signing regression.

### Task 5: Validate and deploy public downloads independently

**Files:**
- Create: `docs/operations/public-home-release.md`
- Create: `scripts/verify-public-release-artifact.mjs`
- Create: `tests/unit/public-release-artifact-verification.test.mjs`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`

**Interfaces:**
- Consumes the existing `letscube-web` and `letscube-releases` Coolify services.
- Produces browser-accessible downloads without changing native updater endpoints.

- [x] **Step 1: Run complete local validation**

```powershell
git diff --check
pnpm.cmd typecheck
pnpm.cmd release:catalog:test
node --test tests/unit/public-release-artifact-verification.test.mjs
pnpm.cmd e2e:smoke
pnpm.cmd exec playwright test tests/e2e/public-home.spec.ts tests/e2e/visual-style-layout.spec.ts tests/e2e/release-distribution-settings.spec.ts
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

Expected: all PASS. The shared `index.html` theme bootstrap may change, but the
iPhone/iPad-only manifest injection and `ios_pwa` ownership contract must remain
behaviorally unchanged and covered by regression tests.

- [x] **Step 2: Check release catalog production responses**

Fetch Android and Windows Stable manifests without printing private values.
Verify HTTPS, `content-type`, artifact origin, availability and optional
highlights, then stream each available immutable artifact through
`verify-public-release-artifact.mjs`. The verifier accepts only the exact
catalog origin/path, enforces a bounded maximum size, hashes the actual bytes and
requires both byte count and SHA-256 to equal the manifest before a public link
is considered eligible. Missing macOS/iOS manifests remain a valid unavailable
state.

- [x] **Step 3: Deploy the web application**

Push the validated commit, verify Coolify auto-deploy uses the exact commit and wait for a healthy replacement. A docs-only release-catalog change must not redeploy unrelated workers.

- [x] **Step 4: Run production visual QA**

Verify unauthenticated `/`, `/download`, `/privacy`, `/support`, authenticated
`/`, Windows native startup and Android native startup. Native startup must show
no public-home flash or redirect. Capture dark/light desktop and mobile
screenshots and verify the byte-validated download artifacts begin from
`api.letscube.ru` without login.

- [x] **Step 5: Record rollout evidence and commit**

```powershell
git add docs/operations/public-home-release.md docs/PRODUCTION_PRIORITY_TRACKER.md
git commit -m "docs(public): record public home rollout"
```

## Task 5 closure

Steps 2, 3 and 5 are complete. Steps 1 and 4 are marked `[~]` rather than `[x]`
because part of each is blocked on something outside this repository, and
marking them done would misreport what was actually verified.

Complete in step 1: `git diff --check`, the full workspace typecheck across all
four projects, `release:catalog:test` 35/35 with no skips against the pinned jq
1.7.1, `public-release-artifact-verification` 12/12, the public-home and routing
matrices 75/75 across the four release viewports, and the production build.

Also complete in step 1, after an unblocking detour: `e2e:smoke` passes 5/5
against production, and `visual-style-layout.spec.ts` with
`release-distribution-settings.spec.ts` pass 31 of 35 executed cases. Running
them is what exposed the harness defect described in `docs/QA_RESULTS.md` — the
auth helper inferred sign-in from the absence of a password field, which the
public home made permanently true, so the authenticated suite had been running
as a guest and reporting success. The helper now proves sign-in, and the stale
QA owner password it then surfaced has been reset.

Two constraints came out of that and belong in the runbook rather than in a
pass mark. Authenticated suites must run with `--workers=1` while every viewport
shares one QA account, or parallel sign-ins fail intermittently. And the four
remaining failures, all on the mobile viewports, are recorded as unverified:
a second run failed a different set, and one screenshot shows the application
stuck on its retryable loading screen, which matches the proxied network on this
workstation that was already measured stalling requests until an abort.

Complete in step 4: unauthenticated `/`, `/download`, `/privacy` and `/support`
verified against production in both themes at 1440x900 and 390x844, including
the summary-versus-sections agreement check, image decoding, absence of
horizontal overflow and a clean console.

Also complete in step 4: authenticated `/` is verified against production by the
smoke suite across all five release viewports.

Native startup is now exercised on real hardware, recorded in
`docs/QA_RESULTS.md`. Two Android 15 phones, each started as a guest from a
cleared state with a build of the current branch, go splash to loading to the
login form with the public home in no frame. The Windows shell loads the live
production origin rather than bundled assets, so the installed release already
runs today's web code; it opened straight into the messenger with no public-home
frame.

The one part still not exercised directly is the Windows *guest* path, because
this machine holds a session. It is left recorded as unexercised rather than
inferred. What supports it is that the Tauri webview registers an
initialization script, so `window.letscubeDesktop` exists before any page script
runs, and that Android exercised the same `nativeShell` branch on hardware.
