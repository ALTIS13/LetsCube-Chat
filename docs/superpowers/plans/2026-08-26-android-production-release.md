# Android Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible, fail-closed, signed LETSCUBE Android release, route verified HTTPS auth callbacks into the Capacitor application, and validate the release on supported Android devices without weakening the browser, Windows, push, media, or privacy contracts.

**Architecture:** A tracked non-secret version file is the single source for Gradle and release tooling. Signing material is read only from process environment/private local files, and release tasks fail before compilation when any input is absent. Android App Links use the final `com.kub.messenger` release certificate and the exact `https://app.letscube.ru/auth/callback` route; the frontend converts only that allowlisted URL into the existing internal auth callback. The self-hosted catalog continues serving immutable APKs, while AAB output remains an internal Play artifact.

**Tech Stack:** Capacitor 8, Android Gradle Plugin 8.13, Gradle 8.14, Java 21, TypeScript/React/Vite, Node test runner, Playwright, Android SDK build tools, ADB, Nginx, self-hosted release catalog.

**Spec:** `docs/superpowers/specs/2026-07-12-release-catalog-native-distribution-design.md`

## Global Constraints

- Package id remains exactly `com.kub.messenger`; visible app name remains exactly `LETSCUBE`.
- Canonical Android auth callback is exactly `https://app.letscube.ru/auth/callback`.
- Browser and Windows auth callbacks keep their existing same-origin behavior.
- No custom URL scheme is added; only Android verified HTTPS App Links may enter native auth routing.
- Release signing never falls back to the debug key and never logs a keystore path, alias, password, certificate token, auth code, or callback fragment.
- Keystores, signing passwords, `google-services.json`, Firebase Admin credentials and service-role credentials stay outside Git and outside frontend/mobile bundles.
- Existing browser/PWA push and iPhone/iPad PWA code remain unchanged.
- Existing Android FCM, media recording, video-circle, camera, file upload and geolocation behavior remain intact.
- Existing chat initial anchoring, history prepend anchoring and message-footer stability remain intact.
- APK is the self-hosted distribution artifact; AAB is generated for internal Play testing and is not served by the APK catalog.
- The current debug-signed `0.1.0` cannot be upgraded in place to a release-signed package; release QA uses a clean install and a same-release-key candidate-to-candidate upgrade.
- No SQL, RLS, schema, native push backend, Windows packaging, iOS/PWA implementation or package-id change is part of this plan.

---

### Task 1: Canonical Version And Fail-Closed Release Signing

**Files:**
- Create: `android/version.properties`
- Create: `scripts/android-release-metadata.mjs`
- Create: `scripts/build-android-release.mjs`
- Modify: `android/app/build.gradle`
- Modify: `scripts/build-android-production.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `tests/unit/android-release-signing.test.mjs`
- Test: `tests/unit/android-production-build.test.mjs`
- Test: `tests/unit/android-release-assets.test.mjs`

**Interfaces:**
- Produces `readAndroidReleaseMetadata(root): { versionName: string; versionCode: number }` from `android/version.properties`.
- Release signing consumes exactly `LETSCUBE_ANDROID_KEYSTORE_PATH`, `LETSCUBE_ANDROID_KEY_ALIAS`, `LETSCUBE_ANDROID_STORE_PASSWORD`, and `LETSCUBE_ANDROID_KEY_PASSWORD` from the process environment.
- `pnpm.cmd android:build:production:release` builds both `app-release.apk` and `app-release.aab`, verifies the APK signer and package metadata, and prints only artifact paths, version, build, size and SHA-256.
- Existing `pnpm.cmd android:build:production:debug` remains unsigned/debug and continues forwarding only public Vite settings.

- [ ] **Step 1: Add failing release metadata and signing contract tests**

Create assertions that:

```js
assert.deepEqual(readAndroidReleaseMetadata(root), {
  versionName: "0.1.1",
  versionCode: 2,
});
assert.match(gradle, /LETSCUBE_ANDROID_KEYSTORE_PATH/);
assert.match(gradle, /LETSCUBE_ANDROID_KEY_ALIAS/);
assert.match(gradle, /LETSCUBE_ANDROID_STORE_PASSWORD/);
assert.match(gradle, /LETSCUBE_ANDROID_KEY_PASSWORD/);
assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
assert.match(releaseBuilder, /assembleRelease/);
assert.match(releaseBuilder, /bundleRelease/);
assert.match(releaseBuilder, /apksigner/);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
node --test tests/unit/android-release-signing.test.mjs tests/unit/android-production-build.test.mjs tests/unit/android-release-assets.test.mjs
```

Expected: failure because canonical metadata, release builder and fail-closed signing do not exist.

- [ ] **Step 3: Add canonical release metadata**

Create `android/version.properties` with exactly:

```properties
VERSION_NAME=0.1.1
VERSION_CODE=2
```

Implement strict SemVer and positive safe-integer parsing in `scripts/android-release-metadata.mjs`. Make Gradle load these values instead of hard-coded literals. Make both Android build scripts consume the same parser.

- [ ] **Step 4: Add fail-closed Gradle signing**

Determine whether the requested task graph contains a release task. For release tasks, require all four environment variables and require the keystore to be a regular existing file. Configure one `release` signing config and attach it only to `buildTypes.release`. Throw a sanitized `GradleException` naming only the missing variable, never its value. Debug configuration must continue to work without signing variables.

- [ ] **Step 5: Add the production release builder**

Reuse the public build allowlist from the debug production builder, then run:

```text
pnpm.cmd --filter @workspace/kub run build
pnpm.cmd android:sync
gradlew.bat assembleRelease bundleRelease
apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk
apkanalyzer manifest application-id android/app/build/outputs/apk/release/app-release.apk
apkanalyzer manifest version-name android/app/build/outputs/apk/release/app-release.apk
apkanalyzer manifest version-code android/app/build/outputs/apk/release/app-release.apk
```

Reject package, version or build drift. Do not print signer DN, fingerprint or any signing input from the normal build command.

- [ ] **Step 6: Add root scripts and secret ignores**

Add:

```json
"android:build:production:release": "node scripts/build-android-release.mjs"
```

Ignore `*.jks`, `*.keystore`, `*.p12`, `android-signing*.env`, and generated release outputs without ignoring tracked Android source.

- [ ] **Step 7: Verify GREEN and commit**

Run the focused tests, `pnpm.cmd --filter @workspace/kub run typecheck`, `git diff --check`, then commit:

```powershell
git add android/version.properties android/app/build.gradle scripts/android-release-metadata.mjs scripts/build-android-production.mjs scripts/build-android-release.mjs package.json .gitignore tests/unit/android-release-signing.test.mjs tests/unit/android-production-build.test.mjs tests/unit/android-release-assets.test.mjs
git commit -m "build(android): add fail-closed release signing"
```

---

### Task 2: Verified App Links And Native Auth Callback Routing

**Files:**
- Create: `artifacts/kub/src/lib/platform/androidAppLinks.ts`
- Create: `artifacts/kub/src/hooks/useAndroidAppLinks.ts`
- Create: `scripts/generate-android-assetlinks.mjs`
- Modify: `artifacts/kub/src/lib/authRedirect.ts`
- Modify: `artifacts/kub/src/App.tsx`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `docs/deploy/nginx.conf`
- Test: `tests/unit/android-app-links.test.mjs`
- Test: `tests/unit/auth-redirect.test.mjs`
- Test: `tests/e2e/auth-app-link-callback.spec.ts`

**Interfaces:**
- `ANDROID_AUTH_CALLBACK_URL` is exactly `https://app.letscube.ru/auth/callback`.
- `parseAndroidAuthAppLink(value: string): string | null` returns an internal `/auth/callback` route with the original query/hash only for the canonical HTTPS URL.
- `useAndroidAppLinks()` uses `App.getLaunchUrl()` and `App.addListener("appUrlOpen")` only on native Android and routes through Wouter without external navigation.
- `generate-android-assetlinks.mjs APK OUTPUT` reads the verified release APK certificate SHA-256 and writes a bounded Digital Asset Links statement for `com.kub.messenger`; Task 4 creates the tracked production output after the release identity exists.

- [ ] **Step 1: Add failing parser, redirect and deployment tests**

Cover the canonical callback plus rejection of HTTP, foreign host, explicit port, credentials, sibling paths, encoded path confusion and arbitrary return URLs. Assert that web keeps same-origin redirects while native Android uses `ANDROID_AUTH_CALLBACK_URL`. Assert Manifest contains `android:autoVerify="true"` with the exact scheme/host/path and Nginx serves the association file without SPA fallback.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --test tests/unit/android-app-links.test.mjs tests/unit/auth-redirect.test.mjs
```

Expected: failure because the parser, listener, intent filter and asset association do not exist.

- [ ] **Step 3: Implement strict URL parsing and native redirect selection**

Use `new URL(value)` and require:

```ts
url.protocol === "https:"
url.hostname === "app.letscube.ru"
url.port === ""
url.username === ""
url.password === ""
url.pathname === "/auth/callback"
```

Return only `${url.pathname}${url.search}${url.hash}`. Never log the input or rejected URL.

- [ ] **Step 4: Wire warm and cold native URL handling**

Mount `useAndroidAppLinks()` inside `WouterRouter`. Process `App.getLaunchUrl()` once and register one `appUrlOpen` listener with cleanup. Ignore malformed and non-auth links. Route accepted links with replacement so the existing `AuthCallback` owns PKCE exchange, recovery mode and URL cleanup.

- [ ] **Step 5: Add the verified HTTPS intent filter**

Add a separate browsable filter to `MainActivity`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="https"
        android:host="app.letscube.ru"
        android:path="/auth/callback" />
</intent-filter>
```

- [ ] **Step 6: Implement association generation and exact serving**

Implement generation from a release APK, never from a debug certificate. The document contains only relation `delegate_permission/common.handle_all_urls`, target namespace `android_app`, package `com.kub.messenger`, and the release SHA-256 fingerprint. Add an exact Nginx location returning `application/json`, `nosniff`, a one-hour public cache, and `404` when the file is absent. Tests generate into a temporary directory from a release-certificate fixture; no production fingerprint is invented.

- [ ] **Step 7: Verify unit/browser contracts and commit**

Run focused unit tests, the auth callback Playwright test, typecheck, production web build and `git diff --check`, then commit:

```powershell
git add artifacts/kub/src/lib/platform/androidAppLinks.ts artifacts/kub/src/hooks/useAndroidAppLinks.ts artifacts/kub/src/lib/authRedirect.ts artifacts/kub/src/App.tsx scripts/generate-android-assetlinks.mjs android/app/src/main/AndroidManifest.xml docs/deploy/nginx.conf tests/unit/android-app-links.test.mjs tests/unit/auth-redirect.test.mjs tests/e2e/auth-app-link-callback.spec.ts
git commit -m "feat(android): add verified auth app links"
```

---

### Task 3: Release Verification, Store Assets And QA Harness

**Files:**
- Create: `scripts/verify-android-release.mjs`
- Create: `scripts/android-device-matrix.ps1`
- Create: `scripts/generate-android-store-assets.mjs`
- Create: `assets/android/store/icon-512.png`
- Create: `assets/android/store/feature-graphic-1024x500.png`
- Create: `docs/native/ANDROID_STORE_LISTING.md`
- Modify: `android/app/src/main/res/xml/file_paths.xml`
- Modify: `package.json`
- Test: `tests/unit/android-release-verifier.test.mjs`
- Test: `tests/unit/android-store-assets.test.mjs`
- Test: `tests/unit/android-file-provider.test.mjs`

**Interfaces:**
- `verify-android-release.mjs APK` verifies signature, package id, version/build, debuggable=false, exported components, permission allowlist, certificate association and SHA-256 without printing signer identity.
- `android-device-matrix.ps1` accepts `-Apk`, optional `-Serial`, and `-Mode install|upgrade|links|permissions|smoke`; it reports only device model/API, command verdicts and sanitized failures.
- Store assets are generated deterministically from tracked LETSCUBE brand assets at exact Google Play dimensions.

- [ ] **Step 1: Add failing verifier, asset and FileProvider tests**

Assert verifier fail-closed command usage and package/version checks. Assert store icon is exactly `512x512`, feature graphic exactly `1024x500`, both are opaque RGB/RGBA PNGs, and the FileProvider exposes only app-owned files/cache paths rather than the external-storage root.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test tests/unit/android-release-verifier.test.mjs tests/unit/android-store-assets.test.mjs tests/unit/android-file-provider.test.mjs
```

- [ ] **Step 3: Implement the release verifier**

Resolve `apksigner` and `apkanalyzer` from `ANDROID_HOME`; reject missing tools, unsigned APKs, wrong package/version/build, debug packages, unexpected exported components, unexpected dangerous permissions and mismatch between APK certificate and `assetlinks.json`. Output a single JSON-safe summary containing path basename, version, build, bytes and lowercase SHA-256.

Add root script:

```json
"android:verify:release": "node scripts/verify-android-release.mjs"
```

- [ ] **Step 4: Restrict FileProvider scope**

Replace external root access with only:

```xml
<files-path name="files" path="." />
<cache-path name="cache" path="." />
<external-files-path name="external_files" path="." />
<external-cache-path name="external_cache" path="." />
```

Keep the provider non-exported and grant URI permissions only for explicit shares.

- [ ] **Step 5: Generate store assets and listing material**

Generate an opaque 512px icon and 1024x500 feature graphic from the existing blue/magenta LETSCUBE mark and neutral dark brand surface. No club/cyber-arena copy is allowed. Document the short/long listing copy, support URL, privacy URL, permissions explanation and Data Safety inventory without legal claims beyond the existing Privacy Policy.

- [ ] **Step 6: Add the device-matrix harness**

Implement safe ADB selection, package identity checks, install/upgrade commands, portrait assertion, permission inspection, verified-link resolution and launch checks. Never run `pm clear`, factory reset, uninstall or revoke user data unless an explicit mode requires a clean install and prints that action before execution.

- [ ] **Step 7: Verify GREEN and commit**

Run all Task 3 tests, the existing Android contracts, typecheck and `git diff --check`, then commit:

```powershell
git add scripts/verify-android-release.mjs scripts/android-device-matrix.ps1 scripts/generate-android-store-assets.mjs assets/android/store docs/native/ANDROID_STORE_LISTING.md android/app/src/main/res/xml/file_paths.xml package.json tests/unit/android-release-verifier.test.mjs tests/unit/android-store-assets.test.mjs tests/unit/android-file-provider.test.mjs
git commit -m "test(android): add production release gates"
```

---

### Task 4: Signed Candidate, Physical Matrix, Deployment And Evidence

**Files:**
- Create: `artifacts/kub/public/.well-known/assetlinks.json`
- Modify: `android/version.properties`
- Modify: `docs/native/ANDROID_CAPACITOR_PLAN.md`
- Modify: `docs/native/NATIVE_PUSH_PLAN.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/QA_RESULTS.md`

**Interfaces:**
- Private signing material is created under the existing ignored `.ops-private` area and loaded into process environment without printing values.
- The same release key signs the candidate baseline and final candidate.
- Final self-hosted artifact is a verified signed APK; AAB remains local/internal until a Play Console app exists.

- [ ] **Step 1: Create and protect the release identity outside Git**

Create one PKCS12 RSA-4096 keystore with alias `letscube-release`, organization `ООО КУБ`, country `RU`, and at least 25-year validity. Generate independent random store/key passwords, store them only in an ignored private env file with ACL limited to the current Windows user, and create one encrypted local backup copy. Record only the owner, creation date, certificate expiry and backup requirement in tracked documentation.

- [ ] **Step 2: Build and verify signed APK/AAB**

Load signing variables without echoing them, restore the ignored local production/Firebase inputs, then run:

```powershell
pnpm.cmd android:build:production:release
pnpm.cmd android:verify:release -- android/app/build/outputs/apk/release/app-release.apk
```

Confirm the AAB exists, no secret files are tracked, and the release APK contains production public connection settings only.

- [ ] **Step 3: Generate the production Digital Asset Links document**

Generate `artifacts/kub/public/.well-known/assetlinks.json` from the signed baseline APK. Verify the document contains exactly the release certificate fingerprint and `com.kub.messenger`. Re-running the generator against the final same-key APK must produce byte-identical JSON.

- [ ] **Step 4: Run signed clean-install and explicit callback QA**

On an official-GMS physical device, uninstall only after recording that the old debug signature cannot upgrade, install the signed candidate, log in with a QA account, and use an explicit-component `VIEW` intent to test warm/cold/killed-process callback routing before production domain verification. Confirm malformed/foreign URLs do not navigate or crash.

- [ ] **Step 5: Prove same-key upgrade and session retention**

Build/install a signed candidate baseline with the same release key, authenticate, then increment `android/version.properties` to final `VERSION_NAME=0.1.2` and `VERSION_CODE=3`, rebuild and install with `adb install -r`. Verify the account session, chats and local notification registration survive. The final tracked version is `0.1.2` build `3`.

- [ ] **Step 6: Run Android 13/14/15/16 matrix**

Use Google Play system images for API 33 and 34 plus the existing API 36 emulator and Android 15 Nothing device. Cover fresh install, portrait, login/logout/session restore, push permission, foreground/background/killed push, tap routing, offline/reconnect, camera, photo, regular video, video-circle, voice, media picker/upload/quality/playback, geolocation, large-chat scroll and message-footer stability. The Realme microG device is UI/media coverage only and is not an FCM acceptance device.

- [ ] **Step 7: Run repository-wide validation and security guards**

Run:

```powershell
git diff --check
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd release:catalog:test
pnpm.cmd e2e:smoke
pnpm.cmd db:types:check
pnpm.cmd rls:smoke
pnpm.cmd exec playwright test tests/e2e/release-distribution-settings.spec.ts tests/e2e/auth-app-link-callback.spec.ts tests/e2e/visual-style-layout.spec.ts
pnpm.cmd android:sync
pnpm.cmd android:build:production:release
```

Scan tracked files for service-role credentials, Firebase private keys, keystores, signing envs and raw FCM tokens. Expected: no tracked secret material.

- [ ] **Step 8: Record local evidence and commit**

Record devices/API levels, commands, pass/fail/skips, artifact hashes, catalog status, App Link status, first-release debug-signature reinstall caveat and remaining Play/external-backup work. Commit:

```powershell
git add artifacts/kub/public/.well-known/assetlinks.json android/version.properties docs/native/ANDROID_CAPACITOR_PLAN.md docs/native/NATIVE_PUSH_PLAN.md docs/PRODUCTION_PRIORITY_TRACKER.md docs/QA_RESULTS.md
git commit -m "release(android): validate signed production candidate"
```

---

## Post-Implementation Release Runbook

Run only after all four tasks pass task review, the whole-branch review is clean, and the validated branch is integrated into `main`:

1. Push `main` and wait for the `letscube-web` Coolify deployment to become healthy.
2. Verify `https://app.letscube.ru/.well-known/assetlinks.json` returns `200`, `application/json`, `nosniff`, the intended cache policy and exact final APK fingerprint parity.
3. Force Android domain verification and confirm `app.letscube.ru` is approved for `com.kub.messenger`.
4. Repeat warm/cold/killed-process password-recovery callback routing through the normal HTTPS App Link.
5. Publish only final `0.1.2` build `3` through the existing atomic SSH publisher.
6. Verify public manifest version/build, immutable APK URL, size and SHA-256 parity. Do not publish the AAB or submit to Google Play.
7. Commit the final production evidence update and push it only after repository validation remains green.
