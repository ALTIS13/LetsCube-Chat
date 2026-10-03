# Deferred PUT On Full PG17 HTTP - 2026-10-03

## Result

Owner: Codex coordinator, `codex/bot-inline-media-20261002`; runtime source
`3976348f`, accepted local deferred checkpoint `2cadd611`. The
[public fixture](../../tests/server/bot-media-deferred-http.fixture.mjs) passes
final **4/4** on a fresh full PG17.6/PostgREST copy. Both startup fault controls
and the real lost-handle cleanup control/compiled mutant pass. Final 47-input
hashes match; copied rows and catalog are unchanged, owned HTTP/SQL work is
closed. All three owned copies are removed and independently absent, backups
retained. This is not a runtime rollout. Source review has no remaining P1/P2;
the reviewer did not execute or independently verify remote evidence.

## Boundary And Oracles

Real handler/repository reserve/begin/finish/commit requests use the deployed
PostgREST 14.12 binary in an owned full PostgreSQL 17.6 restore. Test-only
combined coverage/authority/preflight bodies and a fictional token are installed
only there. Storage is controlled metadata plus local 68-byte PNG bytes, not a
provider PUT, physical incarnation or terminality claim. The Gateway router,
bot-token authentication and production proxy are not exercised by this seam.

Four distinct-key scenarios cover:

1. B really commits while A's controlled PUT remains pending. A's later 409
   verifies the bytes, then its actual stale commit must return `42501`/403.
2. A's later unknown outcome records unknown and returns sanitized 500 without
   an old commit, preserving B's complete receipt and acknowledged attempt.
3. An injected B assertion releases A in `finally`; both jobs reject outside
   public error mapping, and all adapter/HTTP/SQL work settles within 20 seconds.
4. An independent late A assertion makes the exact one-expected-error oracle
   fail, instead of disappearing behind the first error.

Assertions bind exact bot/key/token/chat/path/hash, original receipt/attempt
timestamps, both leases and their logical identity, grant binding, both ledgers,
returned message and canonical registered observation. Baseline-to-after deltas
avoid assuming the copied tables are empty. Cached success performs no PUT and
does not erase the old pending/unknown history or retained charge.

The old PUT has no autonomous completion timer: only the explicit scenario
release or its `finally` can complete it. Transport/call limits and a separate
literal 20-second settling bound control failure cleanup. No DB transaction
spans controlled network I/O, and no DELETE/overwrite/refund is permitted.

## Harness Corrections

An initial import refused a nonexistent root esbuild path before remote work;
the existing API-package resolution is now used and its actual package identity
is frozen. The first restored-copy run refused a missing fictional token before
any A/B ingest: bootstrap now guards zero existing tokens, seeds only a fictional
hash, and includes that seed in both rollback and committed setup. The next
attempt failed SSH with exit 255 during startup controls, before A/B execution.
Neither is a reproduced product defect. Both owned copies were closed/removed
and their exact IDs/names independently absent; backups retained.

Review corrected operational-CLI imports in the fingerprint helper, missing
fallback cleanup before acquiring an HTTP handle, missing catalog-only final
comparison, an autonomous fake-PUT timer and overly broad production-proof
labels. The fingerprint is now pure literal SQL, byte-equivalent to the accepted
expanded digest; the runner rejects operational CLI arguments before imports.
The runner's unconditional cleanup is also tested with a compiled omission
mutant and a deliberately lost real listener handle. Probe cleanup is itself
unconditional. Separate after-launch/lost-launch-reply controls require zero
owned listeners and unchanged digest.

## Frozen Inputs And Cleanup

The final run froze **47 reachable inputs** before fixture/operator imports,
including the installed esbuild package identity. Final/current hashes match.
Manifest SHA256:
`350c653b7f68621ca96a148893f650f09e0e0b1dc14e2e4897c02f07a75b2977`.
Completed at `2026-10-03T17:13:48.850Z`; verified backup `20261003-201028`, DB
archive SHA256 `be20cd3b185a88a1b2bd4464bc754cf25557f151d08afbedc728440505cc1db5`.
PG is the deployed 17.6 image; the owned copy has network none, zero ports/mounts,
1 GB/1 CPU, cron off and restored jobs inactive. PostgREST is the exact deployed
14.12 binary, SHA256 `3b452073d38d5cb9ffb1cace1ef261afe4fa443a447d74062baf041474a1ec02`,
with owned loopback/socket configuration and fresh fictional JWT secret only.

Four receipts retain **272 bytes**, eight attempts and four logical identities;
two controlled objects/messages/grants/ledgers/canonical registered observations,
two cached retries without new PUT. Eight controlled PUT attempts and one
controlled download are not provider traffic. Scenario settling was
**1/1/627/612 ms**, final settling **1 ms**, under the literal 20,000 ms bound;
this does not measure total shutdown/provider latency. No work is outstanding.

The compiled cleanup-omission mutant leaves one real owned listener and fails
the zero-listener oracle; corrected cleanup leaves zero. Both call the SQL-close
callback once and return in **11,229/13,880 ms**; unconditional probe cleanup
restores zero listeners and identical digest. The callback control is distinct
from the actual SQL session closure verified by the final runner.
Bootstrap rollback covers rows/functions/triggers/security/ACL/RLS/policies;
final catalog-only equality and original row-hash multiplicities/relations pass.
Exact owner/ID/image/isolation checks preceded removal; final ID/name absence and
unchanged production **DB container/cluster identity** are verified separately.
No claim that every live production row or application byte stayed unchanged.

## Continuity

The [local SQL-subset 5/5](2026-10-03-bot-media-deferred-put.md),
[installed SDK 21/21](2026-10-03-bot-media-storage-sdk-http.md) and
[prior full-PG17 inline 6/6](2026-10-03-bot-media-inline-http.md) remain distinct
unchanged evidence, not substitutes for this concurrent full-schema gate.

Next: [physical-generation and remaining participants](2026-10-03-bot-media-external-io-next.md).
Avatar setters, variants and lifecycle participants remain unproven; existing
authority REDs, D-336/D-337 and item 78 remain open for runtime. Production SQL,
main deployment, cleanup/refund, native/device actions and release are not
authorized by this test-only increment. Whole-chat-media and Android/native
holds remain; accepted SQL must never be replayed.
