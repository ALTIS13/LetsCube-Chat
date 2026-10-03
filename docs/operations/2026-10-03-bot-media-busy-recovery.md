# Message busy recovery, 2026-10-03

Owner: this Codex chat. Branch `codex/bot-inline-media-20261002`; starting source
`5db656bd`. This is the approved caller continuation of
[HTTP boundaries](2026-10-03-bot-media-http-boundaries.md), not installation of
the retained-authority, coverage or preflight SQL prototypes.

## Cause And Change

PostgREST 14.12 returns HTTP **500** for SQLSTATE **55P03**. The old classifier
treated this rolled-back lock refusal as final, removed the durable entry and
left nothing for `retryNow`. Three real-app tests were RED before the narrow fix.

`outboxRules.ts` now classifies only the exact `500/55P03` pair as unanswered.
The existing runner retains the entire text/media entry and schedules its first
retry after **2,000 ms**, with the original actor, client ID and payload. No
upload is replayed. Other 500 errors, 400/0A000, permissions and nonexact codes
remain final; existing transport/502/503/504 behavior is unchanged.

The actual `appOutbox` private send and ACK paths, real application store and
real supabase-js query builder are loaded by the new Node harness. Only device
storage, remote fetch and monitoring are replaced. An authenticated ACK of an
already committed delivery after a denied duplicate INSERT is not a newly
authorized send. A denied new delivery must still fail and leave no queued loop.

Bot Gateway exposes **503 `service_unavailable`**, `retry_after: 2` and
`Retry-After: 2` only for 55P03 returned by these exact RPCs with a valid replay
key and fingerprint:

- `bot_message_command_internal`: the seven supported message mutations;
- `bot_media_command_preflight_internal`: the four supported media sends;
- `bot_media_ingest_commit_internal`: receipt-backed commit, not a new PUT.

No internal retry was added. Command-list changes, reserve/read/authorize/touch
calls and thrown transport errors do not inherit this contract. Existing
55000 ingest rate-limit/lease-expiry handling remains unchanged. SQL grants,
policies, authority and accounting were not changed in production.

## Verification

| Boundary | Result | What It Proves |
| --- | --- | --- |
| Actual app and Gateway focused cases | 57/57 | Private send/ACK, retained payload, literal 1,999/2,000 ms timing, exact errors, real repository/handler/router envelope and header |
| Compiled Gateway mutation gate | 7/7 | One positive control; six executed mutants rejected by literal consumer assertions: delay, SQLSTATE, fingerprint, key, command-list and method expansion |
| Client mutation cases | 2, included in focused total | Removing the exact busy rule and changing first delay to 1,000 ms both produce RED |
| Browser and real IndexedDB | 27/27 | Chromium 1440/390 and WebKit 390; reload after a processed busy response, scheduled retry, same durable identity, fresh denial and lost-response ACK |
| Exact PostgREST/full PG17 HTTP | 9/9 | Six actual-app and three actual-Gateway cases on the final frozen inputs |
| Web/API typecheck and builds | Pass | Real web `sw.js build 73f59773f2cf5c46`, `built in 22.80s`; API rebuilt after the allowlist correction |

The browser gate waits for persisted `attempts >= 1` before reload/revocation,
then for a newly processed attempt after reload before recovery. Pending paint
or an initial IndexedDB record alone is insufficient. Fictional-only screenshots
were rendered and inspected at 1440/390 in both themes: the clock is retained,
the composer is usable and no elements overlap. This is not native/PWA hardware
or Service Worker acceptance; the suite blocks SW to keep routed reloads honest.

The full unit run recorded **4,941 passed, zero failed, 13 pre-existing optional
skips** out of 4,954 tests. The broad diagnostic server run recorded **648 passed,
8 failed, zero skips** out of 656. It began before the final review correction;
final changed caller/mutation files were rerun together at 64/64. The eight REDs
are the unchanged `bot-media-authority-contention` (two) and
`bot-media-authority-retention` (six) cases against accepted, unrepaired SQL:
late source acquisition and retained source/content/receiver/chat/membership/
hiding authority. This must not be relabelled an all-green release.
The final joint caller/compiled-mutation run is **64/64**, no skips. Separately,
the unchanged contention/retention fixtures with `BOT_MEDIA_AUTHORITY_REPAIR=1`
pass **9/9**, including all eight default-mode authority failures. This is a
test-only positive control, not installation of those repairs.

## Exact Isolated HTTP Evidence

Final fresh checksum-verified backup: `20261003-174626`; database SHA256:
`57192baade8103eab687fac682a84d0faf6d325f3ad1cd6571dc56a8b2597f5a`.
The full database and roles were restored to an exact-image PG **17.6** owned
copy: network `none`, no ports or mounts, one CPU / one GB, cron launch disabled
and restored jobs inactive. Only fictional `e507...` inputs were addressed.

The exact PostgREST **14.12** binary/image matches the prior HTTP gate:
binary SHA256 `3b452073d38d5cb9ffb1cace1ef261afe4fa443a447d74062baf041474a1ec02`;
image `sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c`.
It used owned loopback/socket and a new QA JWT key, not a production key.

Before importing application/fixture modules the operator froze **71 reachable
sources**; actual loaded client modules were checked against that closure and
the final manifest matched. Manifest SHA256:
`46727843dfc21b9f2432b5786d95be0533b6c6f0cd845e0589374f40f704b860`.
Fixture installation first ran under a transaction and rolled back to the exact
row/function/trigger digest. Copied relation existence and original row-hash
multiplicities were checked after all cases. The production runtime identity
was unchanged before/after. Private receipts retain evidence, not public data.

Actual-app cases cover scheduled text/media retry, real mute before either retry,
lost committed media response with immediate ACK and later muted duplicate ACK,
and real unsupported-isolation refusal. Gateway cases cover busy file-ID command
with no ledger/accounting effects, cached preflight under an actual membership
UPDATE, and revoked membership before retry. Router header acceptance is the
separate focused test, not an HTTP-listening Gateway claim.

One review found the command-list allowlist expansion and a pre-response browser
reload race. Both were corrected; the command-list test went RED before its fix,
the browser gate and a fresh exact-source HTTP copy were rerun. The earlier 9/9
trial is not substituted for the final source-bound gate.
Both exact owned copies were removed after ID/owner/isolation checks; absence
and unchanged production runtime were verified independently. Backups remain.
The owned fixture Vite server was stopped after browser/pixel inspection.

## Remaining Boundary

**D-336/D-337 and tracker item 78 remain open for runtime.** Caller recovery is
implemented and verified on this candidate, but retained-authority/coverage and
preflight fixes remain test-only. No main push, production deployment/migration,
provider/Storage PUT, device operation, native release or paid session occurred.
Whole-chat-media purge hold, Android/native HOLD and A063 exclusion remain.

The previous runner-only HTTP busy-loss case belongs to the frozen `5db656bd`
characterization, not the current caller's desired outcome. Reproduce historical
evidence at that source; use `bot-media-app-outbox-http.fixture.mjs` for the new
private send/ACK acceptance. Earlier authority and coverage evidence is reused,
not renamed or automatically rerun.

Next: actual inline-ingest caller/HTTP and external-I/O boundaries, followed by
the remaining physical-generation/avatar/variant lifecycle proof. Review a
production migration and rollback only after those gates; do not replay the
already accepted identity/resolver/observation/hold SQL or enable reclamation.

Primary mapping reference:
[PostgREST 14 errors](https://docs.postgrest.org/en/v14/references/errors.html).
The literal status/code and rollback results above come from isolated HTTP.
