# Message Media Observations And Fence Counterexample

Owner: Codex coordinator; existing branch `codex/bot-inline-media-20261002`,
base `8aa1243f`. Stage 3 of the approved
[foundation](2026-10-03-bot-media-admission-foundation.md).
Source verified; **applied once/independently verified** at 03:00 MSK on
2026-10-03 after backup `20261003-030013`. Source `1f26c356` is published with
exact healthy web revision/public-container parity verified.

## Ruling And Contract

Actual separate PostgreSQL sessions refute the sufficiency of sorted per-statement
shared object fences. The test-only closer takes sorted exclusive fences and no
message/membership/Storage row lock. Writer-first and closer-first controls refuse
with `55000`; reverse order across multiple statements, nested INSERT and mixed
`ON CONFLICT DO UPDATE` produce actual `40P01`, with their wait edges observed in
`pg_locks` and `pg_blocking_pids`. Writer changes fully roll back and original
accounting/bindings stay unchanged. The safety-expectation run goes RED.

Ruling: use the plan's **observations-only fallback**, not those admission locks.
This rejects that particular ordering, not every possible protocol. The cost is
deferring admission/reclamation until a different transaction-wide protocol has
actual acceptance. Do not claim closed-object refusal, after-wait authorization,
physical generation, deletion or refund from these observations.

The candidate stores private derived current references per message/source kind,
using the accepted [full-set resolver](2026-10-03-bot-message-media-references.md).
Canonical/URL/preview remain independent, including unknown/conflicting holds.
Separate AFTER STATEMENT INSERT/UPDATE/DELETE transition relations identify affected
OLD/NEW message IDs; UPDATE has no column list. Re-read final message rows to avoid
overwriting nested AFTER ROW changes with stale transition images. Deleted rows
with retained moderation pointers remain observed; actual final scrubbing removes
current observations, never authorizes Storage deletion. TRUNCATE clears derived
observations transactionally without adding TRUNCATE authority.

The private SECURITY DEFINER trigger has no client EXECUTE or table grant. It only
observes already permitted message writes; existing message RLS, ownership and RPCs
remain authoritative. No object fence, counter, quota/operation lock or provider
call is added. A single READ COMMITTED bootstrap drains writers with SHARE ROW
EXCLUSIVE, installs hooks/backfills atomically and checks original message hash
plus exact resolver/derived-row equality before committing.

## Verification Checkpoint

- Local PostgreSQL 18.4: five real-session fence experiment cases pass, zero skips.
  Safety mode deliberately fails the multistatement case with literal `40P01`.
- Feature-gap RED: accepted resolver resolves two known pointers and authenticated
  INSERT persists one fictional message; the absent persistence returns `[]`,
  failing the two-reference literal expectation. Initial candidate GREEN passes.
- Fresh checksum-verified backup fully restored into the exact production PG17.6
  image. Owned copy has no network, ports or mounts; cron is off. Original portable
  policy/accounting/access/function fingerprints match. No production SQL executed.
- Additional behavior/mutation, catalog, rollback and independent source review
  remain in progress. Exact accepted-source receipts will supersede initial runs.
- The first complete behavior run was 26/28. The two fixture defects were a
  pre-ingest rather than accepted post-ingest writer hash and missing actual
  media-variant columns. Both operation cases passed after fixture repair;
  neither failure demonstrated a product regression. Frozen final execution
  includes all 28 behavior cases, five fence cases and 32 operator/envelope/gate
  cases: final **65/65 GREEN**, zero failures/cancellations/skips/todo, with an
  unchanged executed/current SQL, test/dependency and operator manifest.
- A real NULL-reason insert exposed SQL CHECK's UNKNOWN loophole. Explicit
  nonnull reasons now reject both unresolved/ambiguous NULLs with `23514`.
  Source-compiled URL/preview omission, deleted-row filtering, stale transition
  image and missing raising self-check mutants have independent literal oracles.
- Independent review found three P2 gaps in the one-time application gates:
  CHECK counts accepted tautologies, current fingerprints did not bind the prior
  accepted resolver, and old-trigger fingerprints omitted enable-state. Actual
  regression controls went RED; exact constraint definitions, accepted helper
  body/catalog pins and `tgenabled` now pass targeted 3/3. The old 62-case run
  correctly refused source drift and is not acceptance. Frozen 65-case execution
  and independent delta review supersede it. No remaining P1/P2 was identified.
- Final frozen same-image PG17.6 rehearsal now passes: exact catalog/backfill,
  accepted stage-2 prerequisite, nine actual role denials, four copied-row/nested
  behavior groups and four actual catalog mutants. Original rows, trigger
  enable-state, policies, accounting and authority fingerprints match through
  full rollback. Receipt binds the exact full-restore container, SQL pair,
  19 test/dependency paths and 12 operator paths. Their hashes exactly match the
  final execution receipt. The rehearsal itself made no production SQL change.

Source pair:
[migration](../../supabase/migrations/20261002232331_bot_message_media_observations.sql),
[rollback](../../supabase/migrations/20261002232331_bot_message_media_observations.rollback.sql).
Byte-identical archive copies are under `.migration-backup/supabase/migrations/`.
Frozen pair SHA-256:
`033f059c4e73f7dafa292a79964fe8763cde6eb074c6a12077a0c9e05ef98654`
(forward), `af1e0d18cf46cf27b28320d5277a37034e24674e171e6fb4266827b7e23030ac`
(rollback).
Behavior fixtures use permitted fictional writes with actual captured forward,
bot-send, path guards, moderation scrub and self-FK hooks. They are not a claim
that every production policy or a physical client was exercised.

## Application And Postcheck

Fresh automated backup passed every checksum and `pg_restore --list`; a separate
root-owned 0600 pinned custom dump and both reviewed SQL bytes are retained. A
durable prepared/verified envelope binds target cluster/container identity and
does not blindly retry after a lost acknowledgement. Applied exactly once at
`2026-10-03T00:00:57.283Z` (03:00 MSK); final stage `verified`.

Separate read-only postcheck confirms exact private table/function/four trigger
bindings, constraints and ACL, accepted stage-2 helpers, complete current set,
unchanged old trigger enable-state/policies/access/functions/accounting and
whole-chat-media hold. At this snapshot: 3,952 messages, **740 held observations,
zero registered**, 28 logical identities / 7 attempt bindings. Holds include
unmanaged/unknown sources; this is not a count of broken or deletable files.
Original receipts remain 28 complete / 47,240 bytes / zero reserved.

No production client/conversation write, provider call, cleanup, refund or native
release. Only derived references were backfilled. The exact verified isolated
restore container was removed; backups and root-owned receipts are retained.
All bounded workers are closed. Never reapply accepted stage-1/2/3 SQL.

Next: design and prove a different transaction-wide admission/coverage protocol,
including existing writer lock prefixes and after-wait authorization. Physical
Storage incarnation, late PUT, avatar/variant participation and generation-bound
close/removal/charge release remain separate gates. No closer/deletion entrypoint
or shared reference counter is introduced by this fallback.

## Publication

Reviewed outgoing `origin/main..HEAD` independently and resolved aliases against
their own commit tree: one owned source commit, zero alias imports. Source
`1f26c356e1d5f7d0a47c906c296b59a5f83a314f` reached candidate/main. The first
Coolify build failed on Docker Registry's `502` for the Node base image, not
application source; old healthy web stayed available. One deliberate retry of
the same revision succeeded without config changes or SQL replay. Disk had 66 GB
free. The retry emitted a real production build marker before acceptance.

Sole healthy web container carries that exact source tag. Public/container entry
`/assets/index-CWBgVg3u.js` and service worker hashes match and are unchanged from
the accepted prior revision; retained Cnz/4fv entries match too. New/old markers
pass, candidate notice remains removed; captures zero. Gateway/worker remain two
healthy `856e03e4` replicas with no `artifacts/api-server` watched-path delta.
Documentation-only closeout may advance the web tag; verify its exact image and
content parity separately. No native build/install/publication was performed.

## Boundaries

The whole-`chat-media` purge hold remains. Stage 1/2 are already applied once;
never reapply them or resend accepted canaries. No frontend/API/native changes,
personal capture, Storage/provider I/O or cloud-device minutes belong to this slice.
Android build/install/publication remains held; A063 belongs to Apollo.RGA.

## Reference

PostgreSQL 17 documents separate transition relations per event and forbids an
UPDATE column list with transition relations:
[CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html).
An AFTER trigger sees earlier trigger effects, but nested statements still need
the final-row behavior test:
[visibility](https://www.postgresql.org/docs/17/trigger-datachanges.html).
Advisory locks remain transaction/session resources, not a proof of this protocol:
[locking](https://www.postgresql.org/docs/17/explicit-locking.html).
