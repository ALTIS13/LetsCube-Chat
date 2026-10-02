# Bot Media Purge Hold

Owner: Codex coordinator. Base: `2c14927a`. Approved continuation of the
[lifecycle contract](../../operations/2026-10-02-bot-media-lifecycle.md).

## Scope

Close the existing D-103 bypass before reference admission/generation work.
Its claim currently hands `chat-media` to an unfenced external DELETE. Exclude
the entire bucket from claim eligibility, before LIMIT, without retiring the
pending queue or altering its attempts. This deliberately retains non-ingest
objects in the same bucket too. Paths and receipts cannot safely narrow the
hold while URL/generation/writer coverage is incomplete.

No new cleanup, object removal, refund, API/runtime change or native release.
No claim that the ordinary `media` bucket's reference races are solved.
Admission/generation, avatar/variant and external-I/O fencing follow separately.

## Tasks

- [x] Reproduce shipped claim returning protected paths on actual PostgreSQL;
  prove independent literal expectations and unchanged ordinary-bucket controls.
- [x] Add one hash/owner/ACL/active-attempt guarded transaction and rollback,
  preserving the existing function identity, settings and all other D-103 logic.
  Mutate guards and eligibility rules, then obtain an independent review.
- [x] Fresh pinned production preflight and verified before-state backup;
  full isolated same-image PG17 restore, real-role positive/negative acceptance,
  rollback/reapply rehearsal. Apply once only after exact source/drift gates;
  verify catalog, rolled-back protected claim behavior and unchanged ledger.
  Applied once at 23:57 MSK; receipt and independent poststate are verified.
- [x] Publish owned reviewed changes, verify the running web revision and
  unchanged asset bytes, close workers and update the active resume.
  Source `c2c3e46d` is accepted; exact owned isolated restore container removed.

## Safety Gates

Outstanding or unresolved attempted `chat-media` queue entries block rollout:
a SQL replacement cannot cancel an already-issued provider DELETE. Do not clear
leases or mark these entries terminal to make the gate pass. No network call
is performed by the SQL or its tests. Completed historical `done`/`kept` rows
with a finish stamp and no lease stay intact. This is a forward claim barrier,
not proof that a past provider operation cannot return late. The rollback
reopens the unsafe old path
and is rehearsal-only unless a separate recovery decision requires it.

Public RLS, private queue's existing access model, grants and existing function
owner remain unchanged. The rollback and source must be byte-identical to their
archives; no command tags or extra top-level transaction statements.

## Live Preflight Ruling

23:40 MSK read-only observation found three historical `done` rows, each one
attempt, no leases and completed 2026-09-28; no raw paths were selected.
Ruling: preserve settled history and refuse only unresolved attempts/leases or
terminal rows lacking a finish stamp. Refusing all historical attempts would
require deleting evidence without making the future claim barrier safer.
Cost: this barrier cannot certify old provider terminality; that remains a
separate reclamation gate. The 28 retained ingest receipts are unchanged.
