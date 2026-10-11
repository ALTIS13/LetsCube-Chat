# Hidden-History Batch Waiting

Owner: coordinator. Stage: source and baseline-render evidence; integration and
rollout pending. This is a bounded finding adjacent to tracker item87, not proof
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
Main integration, patched rendered1440/390 light/dark checks, typecheck/build,
compiled consumer and real deployment verification remain pending. Android
Stable remains0.1.16/build17; no installed-device or production timing is claimed.
