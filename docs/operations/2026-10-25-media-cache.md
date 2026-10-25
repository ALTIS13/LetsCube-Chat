# Managed Offline Media Cache

Owner: Codex coordinator. Stage: implementation, not released. Source baseline:
`12c4cc45`; accepted text-cache/Stable37 evidence remains valid and is not replayed.
Next: bounded binary storage, mounted consumers/settings, focused browser/native
offline proof, independent privacy review, then readiness-gated publication.

## Current Verification

The binary core and shared consumers/settings are implemented. Android candidate
is 0.1.37/build38; installed/public Stable remains37 until release gates complete.
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

- Native38 build/original signer/Firebase/parity, Realme data-retaining upgrade,
  synthetic engine cache canary, Stable publication and live-web parity pending.
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
