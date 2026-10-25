# Managed Offline Media Cache

Owner: Codex coordinator. Stage: RELEASED at product `20b57a45`, shared web and
Android Stable0.1.37/build38. Source baseline `12c4cc45`; accepted text-cache/
Stable37 evidence remains valid and was not replayed. Next: uncovered physical
large-original/native export workflow and actual Apple audio; conditional SQL
bandwidth optimization is separate. The bounded cache is not all of Task3.

## Current Verification

The binary core and shared consumers/settings are implemented and released.
Realme and public Stable are 0.1.37/build38; previous37 remains recoverable.
No server SQL, package identity, signing policy or PC network change.

- Real IndexedDB in Chromium/WebKit:27 scenarios and7 omission controls pass;
  the added pre-download durable-producer fence passes12 focused cases. WebKit
  persistence stores ArrayBuffer and returns Blob; no reliance on its Blob-IDB gap.
- Main affected final unit cohort63/63, plus conversation/album checks25/25.
  TypeScript and production Vite build pass (`26b6aea037acd95e`,21.07s). Existing
  sourcemap/chunk-size warnings remain; no new dependency was installed.
- Actual mounted app matrix:8 PASS,1 explicit Windows-WebKit audio skip. Photo
  preview/original and text document survive reload with backend unavailable,
  without new object requests; actual settings search/limit/clear use durable IDB.
  Chromium voice continues after leaving its bubble and stops immediately on
  privacy retirement; the compiled omission of that subscription fails the test.
- The Windows Playwright WebKit engine fails the *unchanged standalone WAV*
  positive control before any app/cache code, even with attached audio and play.
  Do not call that an iPhone regression or claim Apple audio acceptance from it.
  Actual Apple audio remains a separate device check; WebKit photo/file/IDB pass.
- UI component20/20 and5 behavior mutations pass. Synthetic1440/390 pixels in
  both themes were inspected by worker and coordinator;360/200% text checks pass.
  [Mobbin derivation and UI evidence](2026-10-25-media-cache-ui.md).
- Actual unmodified MediaViewer loading photo/video at1440/390 in both themes:
  8/8 pass; spinner/text fit, save disabled, close/Escape work, zero external
  requests/runtime errors. The synthetic fixture is not native playback proof.

## Release And Native Proof

- Shared web: Coolify deployment `ude5wh5edqxvysmooto6bibl` finished10:37:44Z;
  sole healthy image `20b57a45c62701ad9833d65b8262beeec4f300e2`, build
  `fd39a7c4346dffb7`. Complete public/container HTML/entry/SW parity passes.
  Old `index-DJ4M96Gf.js` lacked both managed-cache markers; new
  `index-Cxm3aAac.js` contains `kub-media-cache-retirement-v1` and `kub-media-cache`.
- Android38: exact APK/AAB source/parity, four Firebase initialization values,
  QA flags false, original signer and APKv2 pass. Native web build
  `0f83e697905c91ae`; Vite15.16s/Gradle11s. APK is7,832,081B, SHA-256
  `9ffe63a24f0dabde8681a9b69831c9aed9c00efea1fd7a913a9d09e213ebcf50`.
  AAB is7,459,884B, SHA-256
  `229f82779f1a80570950feeb12ac8f905f954241b9e8398a387d1a5323085395`.
- Realme37->38 at10:35:00Z: full installed APK hash, UID/data/firstInstall
  retention, guest-to-guest normal foreground and fatal0. No clear/uninstall or
  authenticated-chat acceptance. A063 was not connected and was not tested.
- Native cache engine WARM/COLD at10:46:24Z: synthetic70B PNG and160,044B WAV
  persisted by the actual source core in the actual installed WebView. A new
  process with WiFi/data off restores exact hashes/bytes, decodes1x1 image and
  10-second PCM audio and advances playback. Durable cross-instance retirement
  rejects a held producer and leaves count/bytes zero. A scoped IDB factory
  prevents reading/pruning any non-QA partition; global eviction is therefore
  established by browser tests, not this native canary. Temporary user-gesture
  setting restored, helper uninstalled, original network restored, app returned.
  No account/content capture or production-network fixture request.
- Publication first REFUSED before lock/mutation: seven highlights exceeded the
  catalog's six-item contract. Actual Stable37 unchanged, version/backup absent.
  A separate attempt retains that refusal, validates six <=140 UTF-16-unit
  highlights and uses unchanged APK/publisher/catalog guards. Seven private
  contract checks pass; no release guard or immutable artifact was weakened.
- Android Stable38 is public at10:48:44Z, mandatory=false; old37 catalog/artifact
  retained. Entire public APK download matches the exact size/hash above.
  [APK](https://api.letscube.ru/releases/files/android/0.1.37/letscube-0.1.37.apk).
  AAB is built but not submitted to a store. Windows renderer receives the shared
  web; no Windows shell or Apple native binary was rebuilt by this slice.

Refused buildr1 is preserved: a concurrent primary-main fast-forward changed a
guarded metadata input. Buildr2 then refused stale UP-TO-DATE outputs. Only exact
hash-verified generated APK/AAB outputs were archived/removed before freshr3;
the accepted artifact isr3. No old result was relabelled as accepted.

## Review Repairs

Independent review identified four integration gaps, all addressed before release:
privacy retirement now stops the global player (settings-only clearing does not);
late-but-successful signing offers no longer count as server refusal; cold
signed-only viewers accept their cached Blob; and path-only history remains in
the playlist, whose selected file is read lazily rather than loading all Blobs.
Actual helper tests cover both viewer surfaces and the playlist; omission controls
reject the old HTTP-only viewer admission. A pre-fetch producer captures the durable
epoch so another document's clear cannot be adopted by a late download.

Mounted desktop QA also exposed a duplicated settings-section inventory: search
found the new row but hid its section. Section visibility now derives from the
same `SETTINGS_ROWS` inventory; actual mounted search passes after the repair.

## Remaining Boundaries

- Android's existing gallery bridge accepts first-party HTTP URLs, not Blob URLs.
  Online export keeps its original address/filename. Offline gallery export is
  explicitly not implemented by this slice; browser save/share use cached bytes.
- Large objects above32MiB still stream/download normally but are not retained;
  no unlimited cache, automatic huge download or all-platform full-media claim.
- Played-video warming is implemented separately from originals. A broad physical
  video/send/edit/save matrix, Apple real-device audio, conditional SQL bandwidth
  optimization and wider task backlog remain open, not silently marked done.

## Decisions

- Use a separate IndexedDB database, not Cache Storage: shell activation owns and
  deletes its other caches. Do not modify the service worker for media persistence.
- Keep backend/account/session/chat ownership, generation-fenced retirement and
  SHA-256 integrity. Never persist URLs, signatures, credentials or provider data.
- Default 128 MiB per owner, 64/128/256 MiB controls, 256 MiB global ceiling,
  seven-day LRU retention and 32 MiB per object. These are cache bounds, not limits
  on sending or streaming files. Eviction never deletes server data or messages.
- Preserve cheap-preview/explicit-original admission. Cache previews separately
  from original bytes; a preview must never masquerade as an original for save.
- Fetch only owned Storage addresses, bound streamed bytes and concurrency, cancel
  stale producers on retirement. A storage failure must not break ordinary media.
- Hook clear/logout/account switch and existing privacy retirement. Offline media
  is last-known display, not authorization; fresh refusal removes local copies.
- Provide real usage/limit/clear controls on every shared client. Keep the current
  visual language; reference evidence belongs in the linked UI report.

## Verification

New tests must cover cold binary restoration, byte integrity, quota/TTL/LRU,
cross-owner isolation, delayed reads/downloads/writes versus retirement, real IDB
commit and browser consumer display with `media_url=null` from text snapshots.
Render changed settings at 1440/390, both themes, and enlarged text. No production
captures or personal bodies. Record physical/native proof separately from fixtures.
