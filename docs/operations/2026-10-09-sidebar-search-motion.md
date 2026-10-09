# Sidebar Search Motion

## Scope

Coordinator, 2026-10-09. Narrow main-based candidate; no pending native-preview
branch commits are included. Owner intake item93 remains **OPEN / PARTIAL**:
ordinary search animation lag has not been reproduced on a physical device.
This patch fixes the separately reproduced reduced-motion violation only.

The rendered search wrapper used a fixed 200ms opacity duration while the
application's reduced-motion token correctly changed to 1ms. Replace that
duration and easing with existing application motion tokens. Do not change
height, focus, scroll policy, search semantics or native identities.

## Verification

- Calibrated shipped-source RED: independent CSS media control was 1ms but
  the real search wrapper retained 200ms and failed a literal <=1ms assertion.
- Candidate reduced-motion selection: 1/1 passed; wrapper and control 1ms.
- Separate visual selection: 4/4 passed, 1440x900 and 390x844, both themes.
  Coordinator inspected all 17 fictional-only crops, including query, tucked
  header and in-chat search. No incoherent overlaps were observed.
- Page-only mutation: exactly one failed case, unchanged literal <=1ms assertion
  measured 200ms while the independent control remained 1ms. Shared source was
  not mutated; bindings remained unchanged and owned servers/processes closed.
- Durable portable spec: final 3/3 passed in 13.2s, desktop1440/mobile390/wide3840.
  The scroll scenario caps height at900 while retaining the selected width.
  It proves actual wheel scrolling of24 results, focus/query preservation,
  two-stage Escape and normal220ms/reduced1ms duration using literal assertions.
- Independent review: final source and test have no outstanding findings.
- Main-based application typecheck passed. Production build ran, not just an
  exit-zero wrapper: `sw.js build b620d8203433f4f1`, `built in 12.54s`.
  That build used fictional public backend configuration, not production Auth.

Earlier startup failures and test-fixture failures are retained separately;
they are not counted as successful product checks. Performance baseline was
not repeated. Fictional fixtures blocked external/unmocked backend requests,
WebSockets and service workers; mutations were disabled. No personal session,
screenshots, media or message bodies were captured.

## Publication Boundary

At commit preparation, production still served main4765bcad and the old200ms
marker. Its healthy container and rollback image were verified; backup
20261009-035102 passed15 checksums and archive-list readability, without a
database change. Publish only this narrow reviewed commit, then verify the
running40-character image revision, old/new content markers, public/container
asset hashes and retained previous entry. A webhook is not deployment evidence.

No SQL, Android APK, release signing, device installation, Firebase delivery or
native-preview activation is admitted by these web checks. Next item93 step is
the owner's ordinary native-client lag scenario, without repeating unrelated QA.
