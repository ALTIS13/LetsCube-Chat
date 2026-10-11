# Hidden-History Batch Waiting

Owner: coordinator. Stage: web main/runtime `d252b4a5` accepted at23:34:04 UTC.
This is a bounded finding adjacent to tracker item87, not proof
of the unidentified tester's delay or a complete latency repair.

## Cause And Change

`fetchMessages` waits for hidden-message verification before publishing history.
The helper serialized independent 100-ID queries. A fetched page with reply IDs
can require two chunks, adding a second sequential round trip to this boundary.

Only `fetchHiddenMessageIdSet` in `artifacts/kub/src/hooks/useMessages.ts` changes:
at most two parallel queries, still at most100 IDs each. Each wave must finish
before another starts. Complete hidden-ID union, owner retirement and error
refusal remain required before history admission. No cache bypass, SQL, server,
renderer, auth, media policy or native package change is included.

## Evidence

- Actual helper/caller regression: baseline3 PASS/2 FAIL; patched9/9 PASS, zero
  skips. Four compiled omission controls detect dropped second batch, oversized
  first chunk, missing owner check and failed-read admission. Reply/late-held IDs,
  retired session/chat/topic/request, rejected query and wave ordering are covered.
- A fresh fictional full React baseline uses the old main `cc0f164d`, source
  SHA `72397e8ab8cfbaa20e5fc85209240d89ba6b1ea85981e2e7e7722489d89cf4f4`.
  Vite build `d3391826a528aeb3` completed in10.68s. No listener or real account.
- Actual baseline render `8ac2b6` / completion `25d0af` ends expected exit1:
  only one of the two independent chunks starts while the first is held. Final
  calibration verifies exactly two disjoint100-ID groups covering200 fictional
  IDs, a visible latest message, no partial history and zero page errors.
- Earlier render `20f810` was a test-setup selector ambiguity, not product RED.
  The corrected exact-text/all-bubble/coverage oracles were independently reviewed;
  the retry reused the same immutable baseline assets without rebuilding.

Current source SHA:
`3450ea5fbce0f1c064af581fd8891f5ed82918116842838e0bc2abcc24dd9aa8`.
Regression SHA:
`e2cd1524a625a3c557218abb5a985de716b4c181ef747211b680e35f753df536`.

Private immutable receipts and generated fictional assets remain under
`.ops-private/chat-hidden-render-20261012`; source review/report files are local
only. These contain no real messages or credentials and are not committed.

## Integration And Actual Rollout

Independent product and amended render/publication source reviews accept this
delta. Patched full React render `496c9b` / completion `c71346` passes4/4 at1440
and390 in both themes: two distinct requests overlap, all bubbles stay absent
until both responses complete, exact200-ID coverage and final render pass, zero
page errors. All four fictional screenshots were viewed. `hiddenReads` in the
private render receipt counts only requests seen by the fallback fixture, not
all intercepted held reads; it is not a request-count or latency measurement.

Narrow main `d252b4a55d32cc063b58ee42308aa52db501471d` contains exactly three
paths. Its actual source, test, ChatWindow and merge/actor dependencies match
the accepted source tests byte-for-byte; those tests were reused, not replayed.
Typecheck `19a947` / completion `6a23ea` passes. Real Vite build `ccb713` /
completion `2c7150` exits0 with `73ad4c9a243ce1c5` and10.23s. The existing
sourcemap/mixed-import/chunk warnings remain; they are not new repaired defects.
Own-tree check `f118a9` resolves29 aliases across the one reviewed commit and
preserves the private Android metadata. No unowned sidebar/search path entered it.

Actual before `584e67` matches accepted runtime `cc0f164d`. After `eb8cc6` at
23:34:04 UTC accepts the sole healthy image
`l64kyyu1sysev2izzjjbizhe:d252b4a55d32cc063b58ee42308aa52db501471d`.
Hidden helper old1/new0 becomes old0/new1; the notification-read, send-epoch,
voice and Storage consumers all retain old0/new1. Public/container JS and SW
digests agree; previous entry and image are retained. Local fixture and
production bundle hashes are deliberately different configuration domains.

```text
entry /assets/index-BN3RAR4A.js
JS SHA256 e25f228bf6f9b7e8edc61cad05e094a3c4f5606cb14abc280e4cdccb39fb872e
SW SHA256 d6da6e485fed318d02b8e6c9310c7b56fbee1569e7009ab10d987b0280196894
image sha256:ec992c3f70ef93eedae5ef48393519f14c7d583551a1616cb6e43b33334c44f5
```

Fresh anonymous smoke `a2a0eb`,23:34:05 UTC mounts home and follows the actual
login link with the accepted entry:0 page errors/0 mutation requests, no personal
session/capture/trace/video/download. Private immutable runtime receipts remain
under `.ops-private/chat-hidden-rollout-20261012`.

AndroidStable remains0.1.16/build17. No SQL, installed-device acceptance,
Windows/APK parity or production loading time is claimed. Item87 stays open for
its unidentified client/state; this fix removes one demonstrated dependency only.
