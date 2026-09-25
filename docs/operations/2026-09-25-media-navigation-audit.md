# Media and mobile navigation audit, 2026-09-25

Owner: Codex. Stage: source and synthetic-device validation; production rollout
is recorded separately. Source: current `main` plus this change set. Next:
verify authenticated save on a physical Android device and measure a managed
private cache before adding it.

## Changed behavior

- Small recorded photo originals (at most 1 MiB) and existing compressed
  previews load inline. A known large original without a preview reserves its
  image slot and waits for a tap. Legacy messages without a recorded byte size
  retain the previous behavior rather than becoming invisible.
- On Android 10+, explicit image/video save in the viewer or message menu uses
  MediaStore in `Pictures/LETSCUBE` or `Movies/LETSCUBE`. Older Android keeps
  the system document picker. A failed transfer removes its pending MediaStore
  item. The bridge accepts only first-party storage URLs and rejects HTML
  responses before publishing a gallery item.
- A viewer load failure has an in-place retry. On phones, the own Profile tab
  retains the bottom navigation without covering Save or the settings scroller;
  leaving with an unsaved profile draft still asks for confirmation.

## Verification and limits

Android 14 isolated-AVD instrumentation checked the gallery bytes, path,
published state and incomplete-item cleanup. Synthetic Playwright fixtures
checked requests, retry, save action and navigation at 390/1440 in light/dark
without using personal conversations or writing production data. These tests
do not establish physical-device gallery behavior, real mobile-data volume or
authenticated large-file handling.

Remaining gaps, in priority order:

1. There is no managed app-private cache with a user-visible size/retention
   limit and account-scoped cleanup. WebView's HTTP cache may avoid some fetches,
   but it is not an explicit product cache. Design this alongside media URL
   privacy (D-208) and verify offline reopen and account switching.
2. Saving a viewed large original starts another HTTPS transfer. There is no
   byte-level reuse between viewer and MediaStore export. Measure before
   introducing an app-private copy or streaming cache.
3. Gallery export shows busy/success/error but no byte progress or cancel
   control. Verify slow transfers, Back and disconnect before choosing a
   cancellable protocol; cleanup on stream failure has isolated-AVD proof.
4. Video `preload="metadata"` can fetch some bytes before a tap. The amount
   depends on server range support and WebView; it is not yet measured.
5. The Android bridge intentionally covers photos and videos only. Documents
   and voice notes still need a separate, scoped destination decision.

No exact Telegram or Discord cache limits were copied. The reference evidence
is in `reference-clients.md` section 20.
