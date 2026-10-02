# Bot Media Reference Resolver - 2026-10-02

## Scope And Plan

Owner: Codex coordinator. Base: `6bbff06b`. Continue the accepted
[lifecycle contract](2026-10-02-bot-media-lifecycle.md); do not repeat the
[upload-intent rollout](2026-10-02-bot-upload-intents-rollout.md).

This slice changes the trusted read-only advisory preflight, not runtime,
database schema, scheduled cleanup, Storage contents or retained accounting.
Unsupported references remain unresolved for every charged receipt. A complete
scan is not a reference-writer fence or permission to delete.

1. `[x]` Add failing actual-PostgreSQL cases for single-pass percent-encoded
   object references in messages/avatars and encoded purge paths. Implement a
   bounded ASCII subset at the exact trusted origin, preserving path case,
   query/fragment separation and every existing hold. Keep malformed, foreign,
   relative, nested-encoded, non-ASCII and ambiguous paths unresolved.
2. `[x]` Run literal-oracle mutants, focused SQL regressions and independent
   whole-diff review. Inventory remaining writers separately without editing
   their implementation or weakening existing purge behavior.
3. `[x]` Execute the exact reviewed script in a production READ ONLY REPEATABLE
   READ transaction ending in ROLLBACK, emit aggregates only, and save evidence
   plus the next checkpoint. No files/charges are removed or refunded.

## Acceptance

- Old literal-only source must demonstrably miss a fixture's encoded reference.
- Seven receipt fixtures exercise all authors, deleted rows, previews, every
  variant state, moderation holds and the strict claim-expiry boundary.
- New URL classes partition the selected nonempty rows. Known other-bucket
  references are distinguished from unsupported ones but are not orphan proof.
- Decode exactly once, with hard URL length and object-path limits. No DDL or
  writes are needed to decode; the database is not given a new helper function.
- Counts, not identifiers, object names, URLs or signed query tokens, leave the
  trusted query. Failure must not expose values in database error output.
- Existing catalog, bypass-RLS, receipt cap and read-only refusals remain.
- Literal assertions catch removal of the decoder/holds, unsafe origin matching,
  repeated decoding, path-case folding and weakened input limits.

## Progress

Task 1 RED: actual PostgreSQL fixture saw six references where seven were
independently required; the encoded legacy message was lost by the shipped
literal-only source. GREEN: three new groups passed (36 URL cases, encoded
message and encoded purge), followed by all 11 then-existing groups. The eight
new executable mutants passed their independent refusal/count oracles.
Task 2 validation: final 12-group preflight plus the unchanged nine-group ingest
audit pass **21/21** on PostgreSQL 18.4, no skips, 139.65 seconds. Eight new
decoder mutants plus seven existing semantic/cap/read-only mutations were
exposed or rejected. Independent spec/quality review approved the exact diff
without P1/P2; it additionally ran 43 narrow PGlite controls.
[Source writer inventory](2026-10-02-bot-media-writer-inventory.md) is complete
as source-only evidence; its live definitions still need a fresh catalog check
before any migration. All bounded workers are closed.

Frozen SQL SHA256:
`3bb9eee86aea34f3945a905e6551bba0111fd25ccb0aeed8479a34e96c93c4cf`.
Frozen test SHA256:
`ed25b74f746d422097ea7aeb3e5abaf68a3d694701d61d18ee9e70a4002c5bbe`.
Both matched the reviewed inputs and production observer's before/after check.

## Resolver Contract

`scripts/bot-media-reference-preflight.sql` now emits
`bot_media_reference_preflight_v2`. No persistent decoder function is created.
The accepted canonical audit and its shared fixture remain unchanged.

- Accepted authority: exact HTTPS `core.letscube.ru`, case-insensitive authority
  and optional port 443; no userinfo, suffix host, alternate port or relative URL.
- Endpoint: object or rendered-image public/sign/authenticated address. Endpoint,
  bucket and object path are not case-folded. Query and fragment are not identity.
- Percent escapes: exactly one ASCII decoding pass. Escaped bucket/separators and
  unreserved characters can resolve; nested encoding, controls, DEL, non-ASCII,
  backslashes, remaining percent signs, query/fragment characters in a decoded
  path, empty/dot segments or leading/trailing slash remain unresolved.
- Bounds: raw URL at most 8192 bytes, each encoded pointer part at most 3072
  bytes, decoded bucket 1-128 ASCII identifier characters, decoded path 1-1024
  bytes. No truncation turns a long input into a different valid reference.
- Purge: decode its queued `chat-media` path once, as the existing worker does.
  An unsupported queued path is counted separately, not omitted as proven absent.
- Output: `url_classes` partitions rows into literal/encoded chat-media,
  known-other-bucket and unresolved. The old
  `encoded_or_unrecognized_url_rows` remains the count outside the *literal
  chat-media* class; it is not a count of broken links. Known-other-bucket is
  a parsed identity observation, not exhaustive consumer or orphan proof.

The client's `mediaObjectRef.ts`, the variant worker and purge worker have
different legacy normalisation rules. This intentionally strict subset does
not claim all three are equivalent; unsupported or foreign forms still block
reclamation globally, including in an empty snapshot. Existing canonical and
variant references, deleted rows and report holds continue to count.

No client, worker, Gateway, SQL migration, upload receipt or Storage policy is
changed. Application builds/native QA are not repeated for this operator-only
script; focused executable SQL tests cover its changed behavior.

## Production Read-Only Acceptance

The exact reviewed SQL ran at `2026-10-02T19:48:01.717835Z` (22:48 MSK) on
`supabase/postgres:17.6.1.136`, PostgreSQL 17.6, trusted `supabase_admin`, database
`postgres`, explicit Unix socket `/var/run/postgresql:5432`. Container/cluster/
database identity was checked independently before and after the observation.
READ ONLY REPEATABLE READ ended in ROLLBACK. Observer elapsed 2508 ms includes
SSH and target rechecks; it is not a SQL performance benchmark.

| Aggregate | Observed |
| --- | ---: |
| Charged entries / bytes | 28 / 47,240 |
| Complete / reserved entries | 28 / 0 |
| Completed result message id / timestamp present | 28 / 28 |
| Selected nonempty URL rows | 386 |
| Literal / encoded chat-media URL rows | 0 / 0 |
| Parsed known-other-bucket URL rows | 381 |
| Unsupported URL rows | 5 |
| Observed references to these charged receipts | 0 |
| Associated open content-report holds / purge overlap | 0 / 0 |
| Unsupported chat-media purge path rows | 0 |

The historical v1 outside-literal count of 386 did not mean 386 encoded/broken
links. V2 distinguishes 381 parsed other-bucket identities from five unsupported
forms. Their values and tokens were neither emitted nor retained. This is not
proof those objects exist, of exhaustive URL/metadata coverage or that any
charged object is orphaned. No actual bytes/HTTP/Storage inventory was performed.
All charges remain; no production/schema/message/Storage mutation occurred.

## Next Boundary

Next: fresh live writer/trigger catalog followed by no-delete reference
admission for ingest-owned objects. D-103 must hold those objects until it
participates in the same seal/intent protocol; disabling a new reclaimer does
not disable the existing deleter. Then avatar and variant source/target fences,
generation-bound external-I/O recovery and exactly-once quota release.
Five unsupported URL forms remain blocking uncertainty; even zero would not
substitute for those fences. Keep cleanup disabled until the actual database
interleavings and exactly-once retained-charge release are accepted.
