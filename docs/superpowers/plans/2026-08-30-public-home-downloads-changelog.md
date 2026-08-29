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

**Interfaces:**
- `ReleasePlatform` becomes `"android" | "windows" | "macos" | "ios" | "web"`.
- `ReleaseManifest` gains optional `highlights: string[]` while `schemaVersion` remains `1`.
- Existing Android/Windows publishers remain the only active artifact publishers until another platform has a real distribution format.

- [ ] **Step 1: Write failing parser tests**

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

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/unit/release-catalog.test.mts`

Expected: FAIL because parsed manifests do not expose `highlights`.

- [ ] **Step 3: Extend the parser additively**

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

- [ ] **Step 4: Add an optional highlights file to the publisher**

Extend legacy publish syntax with `--highlights-file FILE`. The file must be a UTF-8 JSON array of one to six strings, each 1-140 characters. Validate it before acquiring the publish lock. Pass the parsed array to both jq and Python writers as `highlights`.

Example fixture:

```json
[
  "Быстрее открываются большие чаты",
  "Улучшена доставка уведомлений"
]
```

- [ ] **Step 5: Preserve active publisher platform restrictions**

The TypeScript client recognizes future platform identifiers, but `publish-native-release.sh` continues to publish only `android` APK and `windows` EXE until real macOS/iOS distribution is designed. Tests must assert an attempted fake macOS artifact still fails rather than publishing a dead link.

- [ ] **Step 6: Run release tests and commit**

```powershell
pnpm.cmd release:catalog:test
node --test tests/unit/distribution-platform.test.mts
git add artifacts/kub/src/lib/releaseCatalog.ts scripts/publish-native-release.sh tests/unit/release-catalog.test.mts tests/unit/release-catalog-deploy.test.mjs tests/unit/distribution-platform.test.mts tests/fixtures/release-highlights.json
git commit -m "feat(release): add compact Stable changelog metadata"
```

---

### Task 2: Add explicit public-home and native-shell route decisions

**Files:**
- Create: `artifacts/kub/src/lib/publicHomeRouting.ts`
- Create: `artifacts/kub/src/pages/public/PublicHomePage.tsx`
- Create: `artifacts/kub/src/pages/public/DownloadPage.tsx`
- Modify: `artifacts/kub/src/lib/publicRoutes.ts`
- Modify: `artifacts/kub/src/lib/platform/distribution.ts`
- Modify: `artifacts/kub/src/App.tsx`
- Modify: `tests/unit/public-routes.test.mjs`
- Create: `tests/unit/public-home-routing.test.mts`

**Interfaces:**
- Produces: `decideRootExperience(input) -> "public_home" | "login" | "messenger" | "loading"`.
- Adds public route `/download`.
- Does not alter `/privacy`, `/support` or `/auth/callback` precedence.

- [ ] **Step 1: Write failing root-decision tests**

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

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs`

Expected: FAIL because the root-decision module and `/download` public route are absent.

- [ ] **Step 3: Implement the pure route decision**

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

Use existing Capacitor and Tauri runtime detection; do not rely only on user-agent strings for native shells.

- [ ] **Step 4: Restructure routing without weakening protected routes**

`RootRoutes` handles public fixed routes first. `AppRoutes` uses the pure root decision only for `/`. Any other unauthenticated protected route still redirects to `/login`. Auth callback remains first so it can establish a session.

- [ ] **Step 5: Add minimal page shells**

Create semantic `main`, header, hero and platform sections with visible `Открыть веб-версию`, `Скачать для Windows` and `Скачать для Android` entry points. At this step the buttons use release state placeholders from the hook; no static artifact URLs.

- [ ] **Step 6: Run route tests and commit**

```powershell
node --test tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
git add artifacts/kub/src/App.tsx artifacts/kub/src/lib/publicHomeRouting.ts artifacts/kub/src/lib/publicRoutes.ts artifacts/kub/src/lib/platform/distribution.ts artifacts/kub/src/pages/public/PublicHomePage.tsx artifacts/kub/src/pages/public/DownloadPage.tsx tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs
git commit -m "feat(public): route guests to LETSCUBE home"
```

---

### Task 3: Produce sanitized real-interface product assets

**Files:**
- Create: `tests/fixtures/public-home-demo.json`
- Create: `scripts/capture-public-home-previews.mjs`
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

- [ ] **Step 1: Write the asset contract test**

The test reads every asset with `sharp` and asserts: WebP format, width between 720 and 1800, height between 450 and 1200, size below 350 KiB, and no filenames or fixture text matching production QA account names, email patterns or phone patterns.

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

The script starts the existing Vite app with a test-only query flag guarded by `import.meta.env.DEV`, injects the fixture without Supabase, captures desktop and Android-shaped interface states, and writes through `sharp` as WebP quality 82. Production builds must tree-shake or reject this injection path.

- [ ] **Step 4: Produce future-platform visuals without fake downloads**

The macOS/iOS images may show the same sanitized LETSCUBE conversation inside platform-appropriate framing, but accompanying UI labels them `В разработке` until a Stable manifest exists. They must not imply App Store availability.

- [ ] **Step 5: Run asset validation and commit**

```powershell
node scripts/capture-public-home-previews.mjs
node --test tests/unit/public-product-assets.test.mjs
git add tests/fixtures/public-home-demo.json scripts/capture-public-home-previews.mjs artifacts/kub/public/product tests/unit/public-product-assets.test.mjs
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
- Create: `tests/e2e/public-home.spec.ts`

**Interfaces:**
- Produces ordered platform view models with `available`, `loading`, `stale`, `unavailable` and `error` states.
- Download anchors use only validated manifest artifact URLs.
- Changelog uses at most six current Stable highlights.

- [ ] **Step 1: Write failing release-view-model tests**

Test these exact mappings: valid available manifest -> download; valid unavailable -> `В разработке`; no manifest -> unavailable, not error button; stale valid manifest -> enabled with quiet stale note; malformed artifact -> no link.

- [ ] **Step 2: Implement the release model**

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

- [ ] **Step 3: Build an immersive first viewport**

Use a full-width product band with LETSCUBE name, concise messenger description, primary platform-aware action and a visible preview of the next section. Do not place the hero in a card, use a split card layout, gradient illustration or decorative orb. The actual messenger interface is the primary visual.

- [ ] **Step 4: Build platform sections and downloads**

Each platform section has a stable responsive aspect ratio, theme-matched screenshot, platform icon, status and one clear action. Avoid nested cards. Buttons use icons and preserve their dimensions while loading. Windows/Android actions download directly without auth.

- [ ] **Step 5: Build the compact `Что нового` module**

Show the newest available Stable release, platform, version, date and up to six highlights. If highlights are empty, show the bounded `notes` string. Additional details expand in place; no `/news` route or CMS is introduced.

- [ ] **Step 6: Preserve pre-paint theme behavior**

Keep the inline bootstrap in `index.html` synchronized with `THEME_INIT_SCRIPT`. Add `color-scheme: light dark` and theme-correct `theme-color` handling without a React paint in the wrong theme.

- [ ] **Step 7: Add responsive and accessibility tests**

At `1920x1080`, `1440x900`, `390x844` and `412x915`, assert no horizontal scroll, no clipped buttons, actual images loaded, next section visible from hero, correct light/dark screenshots, keyboard navigation and reduced-motion support. Assert no visible computer-club terminology.

- [ ] **Step 8: Run tests and commit**

```powershell
node --test tests/unit/public-release-model.test.mts tests/unit/release-catalog.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/public-home.spec.ts tests/e2e/privacy-support-public.spec.ts tests/e2e/letscube-brand-auth-layout.spec.ts
git add artifacts/kub/src/components/public artifacts/kub/src/hooks/usePublicReleaseCatalog.ts artifacts/kub/src/lib/publicReleaseModel.ts artifacts/kub/src/pages/public artifacts/kub/src/index.css artifacts/kub/index.html tests/unit/public-release-model.test.mts tests/e2e/public-home.spec.ts
git commit -m "feat(public): add LETSCUBE app showcase"
```

---

### Task 5: Validate and deploy public downloads independently

**Files:**
- Create: `docs/operations/public-home-release.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`

**Interfaces:**
- Consumes the existing `letscube-web` and `letscube-releases` Coolify services.
- Produces browser-accessible downloads without changing native updater endpoints.

- [ ] **Step 1: Run complete local validation**

```powershell
git diff --check
pnpm.cmd typecheck
pnpm.cmd release:catalog:test
pnpm.cmd e2e:smoke
pnpm.cmd exec playwright test tests/e2e/public-home.spec.ts tests/e2e/visual-style-layout.spec.ts tests/e2e/release-distribution-settings.spec.ts
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

Expected: all PASS; no PWA-specific iPhone files changed.

- [ ] **Step 2: Check release catalog production responses**

Fetch Android and Windows Stable manifests without printing private values. Verify HTTPS, `content-type`, artifact origin, SHA-256 shape, size, availability and optional highlights. Missing macOS/iOS manifests remain a valid unavailable state.

- [ ] **Step 3: Deploy the web application**

Push the validated commit, verify Coolify auto-deploy uses the exact commit and wait for a healthy replacement. A docs-only release-catalog change must not redeploy unrelated workers.

- [ ] **Step 4: Run production visual QA**

Verify unauthenticated `/`, `/download`, `/privacy`, `/support`, authenticated `/`, Windows native startup and Android native startup. Capture dark/light desktop and mobile screenshots and verify the download artifacts begin from `api.letscube.ru` without login.

- [ ] **Step 5: Record rollout evidence and commit**

```powershell
git add docs/operations/public-home-release.md docs/PRODUCTION_PRIORITY_TRACKER.md
git commit -m "docs(public): record public home rollout"
```
