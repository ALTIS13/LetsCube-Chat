# Deferred PUT Across SQL Lease Takeover - 2026-10-03

## Result

Owner: Codex coordinator, `codex/bot-inline-media-20261002`; runtime source
`3976348f`, accepted SDK checkpoint `6ae0a9f3`. The actual handler/repository and
captured ingest/upload-intent SQL run on owned local PostgreSQL **18.4**.
Final **5/5**, zero failures/skips. Storage is a controlled fictional adapter;
this is not full-schema/PostgREST or real-provider acceptance. No runtime patch
is required by the measured cases.

## Schedule And Oracles

[Deferred tests](../../tests/server/bot-media-upload-deferred.test.mjs) use A/B as
old/new requests for the same fictional bot/key, not separate users. A records
its durable pending attempt and leaves its PUT outstanding without holding a DB
transaction. The fixture explicitly expires that exact lease; B takes a new
lease, creates the controlled object and commits one message/result. Then:

1. A receives controlled 409 and verifies B's 68-byte PNG. Its actual stale
   commit returns `42501/bot_ingest_lease_invalid`, mapped to sanitized 403.
   A's own acknowledged attempt survives; B's attempt, result, original receipt
   timestamp and retained 68-byte charge remain unchanged. Cached retry adds no PUT.
2. A receives an unknown outcome after B commits: sanitized 500, A remains
   unknown/charged, no old commit; B's acknowledged attempt and result remain.
3. A compiled SQL-function mutant removes the stale-lease guard. The same old
   caller then gets `00000`/200; the literal `42501` oracle rejects it. Exact
   function definition/owner/ACL/configuration is restored in `finally`.
4. An injected B adapter assertion while A is outstanding escapes public-error
   mapping. Cleanup releases A and settles both calls and SQL before PG teardown;
   exact collected errors and both rejected jobs are checked independently.
5. An additional late A assertion must fail the single-expected-error oracle,
   even when the first assertion is already known. It cannot disappear behind
   first-error mapping or an ignored `allSettled` result.

Delivery assertions bind the actual message, both idempotency ledgers, receipt,
attempts and controlled Storage row to their exact identities and original
accounting, rather than checking row counts alone. No DELETE/overwrite is allowed.

## Review, Frozen Inputs And Cleanup

Review found a P2 in the first forced-failure oracle: `includes(expected)` and
ignored settled reasons could mask a second error. The late-error control ran
**RED: 0/1**, with the owned PG directory absent after failure. Exact error-list
and two expected job-rejection assertions fixed that harness gap. Final 5/5 and
independent reread have no remaining findings; this is a test fix, not a runtime
product fix.

Before the final child-process run, **25 reachable source inputs** and the four
actual PG executable hashes were frozen; final/current hashes match. Manifest:
`98e36f9fd96c36943f58fb2e8cbb6719f290f3da5ca01457811c3271158c4f4f`.
Completed at `2026-10-03T16:41:33.387Z`. All five owned PG copies stopped and their
exact temporary directories are absent; no handler/SQL work remains outstanding.
Deferred settling durations were **1/1/1/70/68 ms**, below the literal 20,000 ms
bound. These durations measure settling, not total PG shutdown or provider latency.

## Continuity And Limits

Reuse [installed SDK HTTP 21/21](2026-10-03-bot-media-storage-sdk-http.md) and
[full PG17 inline HTTP 6/6](2026-10-03-bot-media-inline-http.md) only for their
unchanged boundaries. The concurrent schedule has transferred to an owned
full PG17.6/PostgREST copy; next complete the
[participant/physical-generation gates](2026-10-03-bot-media-external-io-next.md).
The [full-schema transfer](2026-10-03-bot-media-deferred-full-http.md) now passes
4/4 with exact observation/identity/grant links, controlled Storage only. Its
proof is separate from this subset gate. Deployed Storage, physical incarnation,
provider terminality, avatar/variant/lifecycle participation remain unproven here.
No production SQL/main deployment, cleanup/refund, device action or native release
follows. D-336/D-337 and item 78 stay open for runtime; existing authority REDs
are not closed by this test-only increment. Never replay accepted SQL.
