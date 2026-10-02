# Bot Media Upload Intents

Date: 2026-10-02. Owner: Codex coordinator.
Stage recorded here: reviewed non-destructive source/isolated-database rehearsal.
Current deployment and remaining work are in the
[rollout record](2026-10-02-bot-upload-intents-rollout.md); this source checkpoint
does not supersede its completed production gates.
Base: `ebb050a3101117dfdac07f23fdac3cf82338d521`.
Source candidate: `9b41605d` / `bb0bec42` was published first on
`codex/bot-inline-media-20261002`, with production publication held at that stage.
Plan, operational record and active resumes accompanied that candidate.
Plan: [implementation checklist](../superpowers/plans/2026-10-02-bot-media-upload-intents.md).
Contract: [media lifecycle](2026-10-02-bot-media-lifecycle.md).

## Change And Boundaries

The existing charged admission records whether a message was committed, but
cannot by itself prove the outcome of an external Storage PUT. A worker can lose
the provider response, crash or outlive its admission lease. An expired lease
does not mean that Storage stopped processing the old request.

The additive private attempt ledger records admission before external I/O and
the observed outcome afterwards. The real repository computes the byte count
and SHA256 from an owned Buffer snapshot, validates both RPC responses and
retains the original insert-only upload and streamed duplicate-byte check.
Message commit follows a verified upload and persisted acknowledgement only.
Completed receipt retries still return the original result without another PUT.

- `pending` is retained when the worker crashes or an outcome cannot be recorded.
- `unknown` is retained after a provider/download/transport failure. It cannot
  become acknowledged merely because a later attempt succeeds.
- `acknowledged` is a trusted runtime observation of this attempt, not proof
  that no other writer or reference exists.
- One lease admits one PUT; the attempt UUID is not a Storage object generation.
- The literal limit is 64 attempts per receipt, including acknowledged ones.
  The next attempt is refused; no unresolved history is pruned to make room.
- Late completion can record the old attempt after lease rotation or token
  revocation, but cannot commit a message under the stale/revoked admission.
- No objects, receipts or quota are removed or released. Existing reserve/commit
  functions and Storage policies remain unchanged.
- The rollback disables the two new RPCs while retaining the ledger, RLS and
  restricted ACL. Reapply over that retained table fails closed.

The mandatory new-RPC runtime must not reach `main` while the RPCs are unapplied.
There is no production migration, deployment, native build/install/publication,
device operation or cloud-device spending in this wave. A063 remains excluded;
Realme availability does not lift the Android release hold.

## Validation Checkpoint

The shipped repository failed all seven initial intent-envelope cases before
the patch. Additional red/green cases caught revoked-token error mapping and
Buffer mutation during the awaited admission RPC. The new envelope passes 9/9;
the final focused upload/photo/Storage run passes 28/28. Five executable source
mutants expose omitted begin, incorrect acknowledgement of failure, omitted
finish, wrong lease and wrong digest.

API and web typechecks and the actual API build pass. `git diff --check` passes.
Actual handler/repository/PostgreSQL integration passes 5/5: exact-once receipt,
uncertain old PUT followed by verified duplicate, lost begin, lost finish and
revocation after provider success. Runtime commit: `9b41605d`. The database
fixtures contain fictional rows and
captured function/catalog definitions; they are not a full production restore.

The first unrestricted unit run had a held Android Gradle configuration timeout
and a mounted-audio timeout/cancellation. No APK or signing was produced. The
next bounded run excluded that exact Android probe but failed the router test
file; its isolated rerun passed 17/17. The final retained-TAP bounded rerun passes
with 4,930 passes, zero failures/cancellations and 13 existing conditional skips
(12 opt-in mounted UI cases and one jq prerequisite). The held Android aggregate
Gradle probe is excluded separately by its exact test-name pattern. The earlier
router-file failure did not recur; its cause is not established and no unrelated
router fix is claimed. Failed runs are not counted as acceptance.

Read-only production container verification confirms all three old revisions
remain healthy: web `ebb050a3101117dfdac07f23fdac3cf82338d521`, Gateway and worker
`2900eeb71e76cb763fa5a4720c3e7cb49e162ef8`. No new runtime or SQL is deployed.

Migration SHA256 at integration:
`4e03c822ebc9dc4d1ceca668c22af3bb138ea9637830ae1e064ecf289837510c`.
Rollback SHA256:
`849c835581f27531383d72da5018696dcd02e0ecd949ef2ba1160946a47bb16a`.
Both archive copies match byte-for-byte. SQL commit: `bb0bec42`.
The clean SQL-focused PG18.4 run passes 13/13, without skips. It covers actual
two-session advisory/row-lock waits, begin/finish and both lease-transfer orders,
late outcome/stale commit refusal, literal 64/65 cap, cross-receipt charge
isolation, direct table/column ACL denial, drift guards, rollback retention and
reapply refusal. Four executable behavior mutants and three self-check guard
mutants are exposed. The original missing-RPC baseline fails with SQLSTATE 42883.
An intermediate SQL run had four passes/nine failures due an ambiguous catalog
alias (42702); the alias was repaired and a separate clean 13/13 run is the
acceptance evidence.

Independent Task 1 SQL, Task 2 runtime and final whole-wave reviews approve both
specification and quality without actionable P1/P2. Final immutable review range:
`ebb050a3101117dfdac07f23fdac3cf82338d521..bb0bec4294e23a109b888b10567b087c8ec5d342`.
No source fix was required by those reviews. Table/index/constraint/column ACL
guards, service-only RPCs, operation-lock order, response validation, unknown
retention and rollback ordering were inspected. This is source-candidate
acceptance, not actual provider terminality, full production restore or cleanup
acceptance. Both delegated workers are closed; no task test sessions remain.

### Commands

The focused checks execute real repository code and isolated fictional DB rows,
not production accounts. Local PostgreSQL is selected per process, not by changing
global PATH. The 13-case SQL file also executes its behavior/guard mutants.

```powershell
$env:KUB_QA_ALLOW_MUTATIONS='0'
$env:BOT_INGEST_PG_BIN='C:/Users/maksi/scoop/apps/postgresql/current/bin'
node --test tests/server/bot-media-upload-intents.test.mjs
node --test tests/server/bot-media-upload-runtime.test.mjs
node --test tests/unit/bot-media-upload-intents.test.mts tests/unit/bot-inline-media-storage.test.mts tests/unit/bot-photo-upload.test.mts
```

The final bounded suite command (full TAP retained in ignored local scratch):

```powershell
node --test --test-reporter=tap --test-concurrency=2 --test-skip-pattern='^Android aggregate assemble fails closed without release signing inputs$' "tests/unit/**/*.test.{mjs,mts,js,ts}"
```

API/web typechecks, the real API build, both scoped/working-tree whitespace
checks and own-commit-tree alias validation are additional gates. No visual or
physical/native acceptance is inferred from these backend checks.

## Remaining Gates

Continuation status is maintained in the
[production rollout record](2026-10-02-bot-upload-intents-rollout.md): full PG17
restore and guarded additive SQL apply are now accepted. The list below records
the source candidate's original gates, not a request to repeat completed work.

1. Keep the reviewed candidate on its own branch. Before any production apply:
   fresh verified backup, full isolated production restore, exact migration and
   rollback rehearsal, drift guards, and independent post-apply verification.
2. Apply the additive SQL before deploying the mandatory-RPC runtime; verify a
   synthetic end-to-end provider canary separately. For rollback, pause new
   upload admissions and restore compatible old runtime before disabling the
   new RPCs. In-flight finalizers can leave retained pending holds; disabling
   RPCs does not make those attempts terminal or safe to delete. No re-enable
   path over the retained ledger is authorised by this install migration.
3. Fence all writers, object generations and D-103 purge; resolve legacy/encoded
   reference coverage and exactly-once retained-charge release before any
   destructive reconciliation. This ledger alone authorises no cleanup.

## Decisions

The bounded ledger precedes a complete reclaimer because other writers are not
yet fenced. Retained charges can therefore last longer. A 64-attempt ceiling
bounds metadata without deleting uncertain outcomes; pathological repeated
failure can exhaust the retry budget of that receipt. SQL and runtime have
disjoint owners, with independent integration review and no recursive delegation.
