# Android Call Delivery Operational Prerequisites

## Checkpoint

Owner Codex coordinator, shared main baseline `ae841b93`. Task 5 operational
source/proposal and isolated integration, not production activation. SQL and
capacity workers own disjoint files; a third agent independently reviews the
combined change. Source/proposal implementation and isolated verification are
complete; final review records no demonstrated source safety finding.
No native release, personal-device installation or real provider send occurred.

## Changes And Bounds

CLI-generated proposal `20260921153256_android_voice_push_operations.sql` and
matching rehearsal/rollback companions have byte-identical copies under
`supabase/migration-proposals/` and `.migration-backup/supabase/migrations/`.
The CLI-generated files were moved intact outside automatic migration discovery;
rollback and rehearsal must never be run by ordinary `supabase db push`. Task 2 and
Task 3 proposals remain unchanged. Apply as `supabase_admin` only after Task 3;
the installation requires the exact disabled baseline and raises on drift.

- `private.voice_push_tick()` coalesces statement wakes and recovery with a
  nonblocking advisory transaction lock. Four fixed slots bound outstanding
  voice HTTP requests; each request retains `{scope:"voice",limit:20}` and the
  existing exact endpoint allowlist. No backlog means no wake. SQL gate precedes
  Vault and net access.
- New recovery job runs every five seconds when explicitly enabled. New cleanup
  job runs each minute. Both are installed **inactive**, with `supabase_admin`
  ownership and no credentials in command text. Existing generic minute push
  scheduling is untouched.
- SQL claim admission caps all simultaneous unexpired target leases at 16.
  Existing Edge limits remain four concurrent sends per drain, 20 claims per
  drain, 20-second budget, three attempts and absolute 45-second event expiry.
  Busy admission returns without waiting. Non-READ-COMMITTED callers fail closed.
- Aggregate service-role-only health reports ready/live/expired target counts,
  oldest ready age, HTTP acknowledgement/failure/timeout counts and occupied
  slots. It exposes no token, payload, user/device/event identifier or raw error.
  HTTP acknowledgement is neither provider acceptance nor phone delivery.
- Retention removes at most 500 outcomes followed by at most 500 empty events
  whose expiry is strictly older than 24 hours. It skips locked rows, locks
  parents and rechecks their children in a fresh statement. It never deletes
  call history, messages, notification-center rows, auth data or generic push.
- Rollback requires dispatch disabled and slots reconciled, removes only new
  objects without CASCADE, and restores exact Task 3 definitions and permissions.

## Real-System Evidence

Production read-only preflight: pg_net `0.20.3`, pg_cron `1.6.4`; Task 2/3 call
schema absent; existing generic minute job active. Production was not altered.

A verified schema-only backup restored into the exact production PG image
`f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.
The three prerequisite proposals ran under their actual owner roles. The
disposable cluster uses network `none`, a distinct system identifier, synthetic
users/sessions/tokens/Vault entries, read-only root and explicit resource limits.
PostgREST and Edge share only its isolated network namespace. The actual Edge
v1.74.0 image executes the unchanged production dispatcher and payload builder;
only the provider is a loopback synthetic endpoint. No production data rows or
credentials were restored. No network path to FCM exists.

Measured RED/GREEN:

| Check | Before / after |
| --- | --- |
| Eight simultaneous real SQL claims | Task 3 reserves 80 targets; Task 5 caps the same case at 16 |
| First immediate HTTP request fails | Task 3: actual pg_net HTTP503, zero of four accepted after eight seconds, no recovery wake; Task 5: four accepted after 8.335s, two HTTP requests, one failed |
| 80-target backlog | 80 accepted in 38.504s on the constrained rehearsal; four occupied slots, no duplicate accepted provider calls |
| Failure exceeds ring lifetime | Nine failed wakes, zero sends/accepts after 49.348s; recovery after expiry still sends nothing |
| Admission/tick/cleanup advisory lock held elsewhere | Returns in 0.14-0.17s instead of waiting for the holder |
| Retention child/parent locks | Locked outcome survives and its parent is not cascaded; locked empty parent is skipped and removed after release |
| Child commits between selection and parent locking | Forced ORDER BY barrier: final cleanup preserves both rows; removing only the fresh DELETE recheck cascades the child and kills the mutant |
| Uncommitted child holds parent KEY SHARE | Cleanup skips the parent in 0.192s; both rows survive the child's later commit |
| Stale pg_net queue row locked elsewhere | Request keeps its slot; after release the stale request is replaced without exceeding capacity |
| HTTP enqueue transaction commits 31 seconds late | Four real HTTP requests are held for 12s; a recovery tick retains their four slots, with observed HTTP peak four rather than eight |
| Exact catalog rollback | Function definitions/owners/ACLs, columns, triggers, indexes including net, RLS policies and cron job configuration match the before-state |

Actual cron job-run records confirm successful scheduler executions. Provider
peak was four in this constrained runtime, not a claim of saturated 16-send
throughput; SQL 16-admission saturation is separately proven. The 80-target
timing is one measured workload, not a universal delivery deadline or SLA.

The 30-second value is a **reclamation threshold**, not a guaranteed maximum
slot lifetime. Reconciliation runs on the next successful five-second tick.
An outstanding queued request that cannot be locked keeps its slot longer;
capacity safety takes priority over replacement under worker/transaction stalls.
Absolute 45-second ring expiry remains unchanged. The original working contract's
unqualified 30-second maximum was corrected following independent review.

This behavior was verified against pinned pg_net 0.20.3: its worker holds one
transaction from queue deletion through the HTTP batch and response writes, then
commits. A concurrent tick still sees the locked queued row until that commit.
The delayed-commit concern was tested, not assumed to be a defect. An extension
or image upgrade must requalify that transaction boundary before voice activation.
[Pinned worker source](https://raw.githubusercontent.com/supabase/pg_net/v0.20.3/src/worker.c),
[queue deletion source](https://raw.githubusercontent.com/supabase/pg_net/v0.20.3/src/core.c).

The real PG companion proves disabled-gate behavior, authorization, 40 targets,
the exact 24-hour boundary, 603 outcomes removed as 500 then 103, 503 empty events
removed as 500 then three, fresh-data preservation and transactional rollback.
The worker's PGlite extension doubles alone do not establish any cron/net timing.

Final apply/rollback/rehearsal SHA-256 values respectively:

```text
ca11571b2d8d9a3d2c48e42399efdf9ce71d2da661fdda7dee197d6c3bf10a52
6f233a30eb138e1549a168e14a0dcb79d3baf5f3ffe0ed3529bef9bc2419e222
8ef8268ad0db8f9f67fcb0e11ffda75bc25238eb4aeca86ebf6a6b51e9f1def3
```

The final runtime matrix used these exact remote/local bytes. Dispatcher hash
`0fd241c5ac6fb4152e1b22e8fc8bb45a299dc2a2a374b3041d6e7094cb5f5c60`
and payload hash
`d6e100e6c104e0c17a3fe4de972b254c5d85cf75478b5aa3326639e905d174c0`
matched the unchanged production source files in this checkout.

## Source Verification

- SQL focused: 43/43 including 16 killed behavioral mutations; full server
  suite 334/334, no skips, rerun by coordinator after the API-server build and
  manual-proposal path change. Exact-source cleanup race adds one real-PG mutant.
- Capacity tests: 15/15 including five killed mutations. Actual Edge source with
  shared fake SQL and one shared manual clock covers 53/93-target backlogs,
  overlapping drains, retry/backoff/expiry, completion uncertainty and bounds.
  Disabling synthetic global admission allows 24 sends: fake admission is not
  passed off as proof of the SQL lock.
- Focused push suite: 85/85, no skips. Full unit: 4035 passed, zero failures,
  one existing skip requiring production jq 1.7.1 (4036 total).
- No web/native product source changed, so Task 4's valid UI/native evidence is
  reused rather than claiming a fresh browser/device matrix for SQL-only work.

Intermediate harness failures are retained locally: a role-switched ACL probe
resolved a private function name too late; it now resolves the OID as owner
without widening permissions. The isolated cron launcher's command-line `off`
overrode reloadable configuration; the owned containers were recreated with a
reloadable default-off config. The initial invented 35s capacity cutoff observed
72 targets before the final eight completed; the corrected probe retains the
contract's strict elapsed `<45s` assertion. A pg_net worker-name mismatch was
corrected against actual `pg_stat_activity`, before any process was signalled.
The first concurrency harness omitted a semicolon after `pg_get_functiondef`;
no product function replacement committed. Its exact leftover QA helper was
removed after verifying the original function hash and empty fixtures. The
corrected run restored the full function definition/owner/ACL after all probes.

Final catalog rollback passed after the mutation probe. All three exact-owned
isolated containers were removed; no QA proxy remains. A final production
read-only check still found call-dispatch schema absent and the original generic
minute job active. Production was not used for synthetic fixtures.

## Verification Commands

All final commands exited zero; RED controls above intentionally failed. Commands
ran in PowerShell with existing runtimes, no dependency or Java/PATH changes.

```powershell
pnpm.cmd --filter @workspace/api-server run build
node --test "tests/server/*.test.mjs"
node --test "tests/unit/**/*.test.{mjs,mts,js,ts}"
node --test tests/unit/voice-push-capacity.test.mts tests/unit/voice-push-dispatch.test.mts tests/unit/voice-push-payload.test.mts tests/unit/voice-push-entry.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --target es2022 --skipLibCheck tests/unit/voice-push-capacity.test.mts
git diff --check
```

API build reported `Done in 301ms`. Existing module-type/experimental TypeScript
warnings remain; no metadata churn was added to suppress them. The independent
review repeated the focused SQL/Edge, mutation and TypeScript checks. Native
instrumentation and web visual suites were not rerun for this backend-only batch.

## Activation Is Separate

1. Fresh verified production backup and schema drift check; apply session binding
   as `postgres`, then outbox, dispatcher and operations as `supabase_admin`.
   Keep both dispatch gates false and both new cron jobs inactive.
2. Deploy the reviewed Edge code explicitly. A web Git push is not an Edge deploy.
   Verify running bytes, RPC roles and disabled gates.
3. Build/install a separately owner-authorized signed candidate with signer,
   version and data continuity checks. Nothing is unavailable; Realme's prior
   microG inventory is not official-GMS or current-release evidence.
4. Complete the plan's real delivery/permission/session/cancel/tap matrix, then
   make the explicit narrow activation decision. Do not mark calls ready earlier.
5. For rollback, disable the Edge send gate first, deactivate new jobs, drain or
   reconcile occupied HTTP slots, disable SQL dispatch, then roll back operations,
   dispatcher, outbox and binding in reverse owner-specific order. Do not manually
   clear occupied slots or delete production queues to bypass the rollback guard.

Local ignored evidence: `output/voice-delivery-task5/`; disposable remote working
area: `/srv/letscube/backups/voice-ops-rehearsal-20260921`. These are QA artifacts,
not instructions to repeat production operations or reuse synthetic credentials.

References: [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[pg_net 0.20.3 SQL](https://raw.githubusercontent.com/supabase/pg_net/v0.20.3/sql/pg_net.sql),
[pg_cron 1.6.4](https://github.com/citusdata/pg_cron/blob/v1.6.4/README.md).
