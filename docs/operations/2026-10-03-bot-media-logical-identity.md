# Bot Media Logical Identity

Owner: Codex coordinator; branch `codex/bot-inline-media-20261002`, base `3df67f1c`.
Stage: stage 1 is applied once and independently verified in production at
**01:07 MSK on 2026-10-03**. Final reviewed-source **42/42**, operator **12/12**
and full same-image PG17 proof pass. Source `0f2be27a` is published and its exact
healthy web deployment is verified. This is stage 1 of the
[admission foundation](2026-10-03-bot-media-admission-foundation.md), not message
admission, a physical Storage generation, sealing, deletion or refunds.

## Implementation

- Immutable private `(bucket,path)` logical UUID and original receipt snapshot,
  keyed independently by `(bot_id,idempotency_key)`. No receipt/charge/result rewrite.
- Existing and new PUT attempts bind the same UUID across token/lease takeover.
  Pending and unknown observations remain retained, with no age-based cleanup.
- Managed grants bind at issuance. Bindings survive normal expiry/pruning; there
  is deliberately no foreign key to the prunable grant row.
- Immutable path claims arbitrate grant-first/receipt-first races. Ordinary
  grants retain their lifecycle; ingestion cannot adopt their previously used path.
- Retained UUID claims arbitrate grant-ID reuse independently of MVCC visibility.
  An UPDATE with a snapshot older than bootstrap must retry, not infer unmanaged
  status from an invisible claim/binding. New client authority is not introduced.
- Original receipt/attempt snapshots cannot be updated/deleted/truncated. Lease
  changes, commit and pending outcome reporting remain allowed; terminal history
  cannot be rewritten. Registry/binding/claim rows are append-preserved.

## Evidence

The accepted base on actual local PostgreSQL 18.4 permits trusted receipt-path
and attempt-snapshot rewrites inside a rolled-back positive control. The two
refusal regressions both fail with `Missing expected rejection` on that base.
This is behavior RED, not a missing-table or mocked test.

Independent source review found and closed three MVCC issues: bootstrap session
isolation, retained-ID reuse from an old snapshot, and same-ID grant UPDATE from
a snapshot preceding bootstrap. Reviewed SQL SHA256:
`f771a7ca5b7c14a41824674469a68bacc4b2e585a0d63fe4f85f8be6056d15e6`;
rollback: `56af685e6833f6cb6271a01b5e4bff79380b1ffaed71786472e553e45aef39fa`.
The [migration](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql)
and [rollback](../../supabase/migrations/20261002212749_bot_media_logical_identity.rollback.sql)
each have a byte-identical `.migration-backup` copy.

Final source was rehearsed against a fresh full same-image PostgreSQL **17.6**
restore: **7 groups**, **15 actual role/table denials**, actual blocked legacy
writer inclusion with session-default Repeatable Read, pre-bootstrap same-ID
UPDATE refusal, and old-snapshot managed-issuance/prune/unmanaged-ID-reuse refusal.
All original row, policy, existing-function and effective-table-access fingerprints
match. Only fictional private fixtures were committed in the isolated copy;
role grants and ordinary matrix writes were rolled back. No Storage/provider I/O.
The final root-only receipt records both reviewed hashes and concrete race flags.

The coordinator's final frozen-source run passed **42/42**: 28 identity cases,
five existing upload runtime regressions and nine guarded-apply envelope cases.
There are no failures, cancellations, skips or TODOs. Test/fixture hashes were
checked before and after that same run. This is separate from the PG17 restore
proof and does not by itself establish production installation.

Independent test/operator review then found three P2 evidence gaps, not changes
to reviewed SQL. The old-snapshot UUID-reuse RED control now removes the later
UPDATE visibility guard as well, reaching the intended reuse assertion after
issuance, consumption and pruning. It fails there with `Missing expected rejection`
on the prior proposal. Operator approval now binds exact reviewed/executed/current
test manifests and exact operator-source hashes; **12/12** literal-manifest cases
pass. A real isolated-PG17 catalog mutant binds one trigger to a same-named public
function while leaving private bodies intact: the old observer incorrectly accepted
it; the corrected schema-qualified function-binding check refuses it. The probe
restored the original trigger and confirmed exact installation afterward. The final
42-case rerun passed with zero failures/cancellations/skips/TODOs and unchanged
test bytes. Independent source/test/operator re-review approves the exact hashes
without remaining P1/P2. None of these operator corrections changed reviewed SQL.

Earlier candidate rehearsal is not final-byte evidence. Its prestate alias error
rolled back before installation; later fixture prerequisites were corrected because
retained historical receipts need not refer to a still-existing chat. Portable
restore fingerprints require qualified names, role names, `C` ordering and
normalization of equivalent default/owner-only table ACLs. Raw OIDs/catalog array
ordering were not treated as authority drift. Neither recovery reapplied SQL to
production; the final source got a separate fresh full restore and complete run.

## Production Application

Applied exactly once at 01:07 MSK after fresh verified automatic backup
`20261003-010706` and an additional target-pinned custom database dump. Both were
validated with archive listing and SHA256; database/runtime identity was rechecked
before execution. SQL was captured as reviewed bytes and applied in its single
transaction. The durable root-only apply envelope finished `verified`, not an
assumed successful SSH acknowledgement. An independent later connection confirms:

- Five private RLS/owner-only tables, six exact function bodies/metadata and 18
  exact schema-qualified trigger bindings; no receipt/attempt/grant mismatches.
- **28** logical identities and **7** attempt bindings. Current managed-grant
  bindings and retained grant-UUID claims are both zero because source grants
  are absent; issuance/pruning/reuse behavior is established by the real fixtures.
- All original receipts, attempts, grants, policies, effective table access and
  original function fingerprints unchanged. Ledger: **28 complete / 47,240 bytes**,
  **zero reserved**. The whole-`chat-media` D-103 hold is unchanged.
- Actual service-role reserve/begin/unknown reporting and owner mutation/deletion
  refusals pass in a rolled-back transaction. No provider, Storage or message I/O;
  no synthetic production row survives the check.

Both exact labelled, network-isolated owned PG17 containers were removed by their
verified container IDs. Backups, dump manifests and root-only restore/rehearsal/
apply receipts are retained. All bounded workers are closed. Never reapply this
migration or old accepted SQL; use independent observation after an uncertain ACK.

This SQL/test/documentation slice changes no client bundle or shell. Existing
upload runtime regressions, old-function/authority fingerprints and actual PG17
proof are the affected-boundary checks; a frontend/native build would not establish
the new database behavior.

## Publication

Implementation `0f2be27ae07e20dd55c81dd7c10bb1080a3a9222` is pushed to the existing
candidate branch and `main`. The separate outgoing-commit review contains only
the ten owned SQL/archive/test/documentation files. Own-tree import resolution,
committed-vs-reviewed SQL bytes, whitespace and local documentation links pass;
the foreign `bot-platform` dirty deletion remains untouched.

The first verification correctly refused the temporary two-container rolling
overlap. After it settled, the sole healthy web image is the exact implementation
revision. Public/container entry and service-worker hashes match, new/old content
markers pass, both retained older entries remain byte-identical. Accepted current
entry `/assets/index-CWBgVg3u.js` and service-worker bytes are unchanged; no
production capture or signed-in UI mutation was used. Documentation-only closeout
pushes may advance this image tag without changing accepted application bytes.

Gateway and worker are independently observed healthy at `856e03e4`. Their actual
Coolify watch paths have zero commits since that revision, so no backend rebuild
is required or claimed. The database hooks are already installed/verified.

## Rollback And Next Step

Rollback is a **prospective permission pause** for reserve/commit/begin, retaining
all hooks, identities, history, charge rows and outcome reporting. It does not
cancel in-flight calls or PUTs. Reapply over retained tables refuses loudly.
The [whole-chat-media D-103 hold](2026-10-02-bot-media-purge-hold.md) stays installed.

Next after identity acceptance: implement the complete canonical/legacy-URL/preview
reference set resolver, then table-level message observation/admission with actual
multi-session authorization and lock interleavings. No closer, path rotation,
physical-generation claim, automatic cleanup or refund is authorized by this slice.
Android build/install/publication remains held; no native/client/UI changes.
