# Item 37: server-side Do Not Disturb

Owner: Codex coordinator. Starting revision: `910b21ba`. Approved continuation
of the existing presence/AFK/DND queue. No Android or Windows release, install,
cloud-device session, personal-data capture or media-bucket change.

## Cause And Contract

The live database's `_notification_push_allowed` reads notification and chat
preferences but not `privacy_preferences.manual_status`. Ordinary Web/native
and album rechecks already call that filter; the already-deployed Edge parser
understands their `not_eligible` response. `private.voice_push_eligible` likewise
does not consult the chosen status. Client sound suppression alone cannot stop
an OS notification from a background/killed client.

Two client paths also bypass the intention: `ownStatus` correctly returns
`invisible` when presence is hidden, but notification/ring sound incorrectly
uses that public dot as the private DND choice. Windows Realtime/reconnect
presentation does not consult DND at all. The client patch uses an account-owned
private `wait | quiet | allow` decision, evaluates the current deadline at the
callback boundary and subscribes an active ring to the deadline. The public
dot and existing picker/layout are unchanged. Unknown privacy is not an allow.

The reference distinction is recorded in `reference-clients.md` section 25.
For LETSCUBE, DND pauses **external alert pushes** across devices, including
message/task/invite alerts and incoming-ring pushes. Notification records,
unread counts and conversations remain available inside the application.
Nothing is marked read to achieve silence. A suppressed alert is not replayed
as a burst when DND ends; new eligible notifications resume then.

- Use the private manual choice, not the public presence dot or online time.
  Hiding presence does not disable the person's chosen DND.
- `manual_status = 'dnd'` with no end or an end strictly after the server's
  check time pauses alerts. At equality or after expiry it does not.
- Idle, invisible, online and an absent preference do not pause alerts.
- Voice cancellation remains eligible: it must dismiss a ring already on a
  device even if DND was chosen after that ring.
- Existing mutes, blocks, membership/read checks and claim ownership remain.
- An alert already accepted by a provider cannot be recalled. A status change
  between the last eligibility check and provider acceptance is not atomic
  across PostgreSQL and an external service; do not claim otherwise.

## Plan

1. [x] Inspect current functions, owner/ACL/security/search-path metadata and
   dated reference behavior. Create the CLI migration scaffold.
2. [x] Fresh backup `20261002-003342`: 15/15 checksums OK, custom archive list
   readable with 162 table-data entries. No dump copied into source/output.
3. [x] Real RED cases against a full restored backup, with positive controls;
   investigate the alleged heartbeat/status race using two connections.
4. [x] Four-function patch and private client gates, with omission/expiry/
   cancellation mutation checks,
   actual Web/native/album/voice boundaries and exact rollback/catalog parity.
5. [x] Independent review, scoped/full server regression gates, byte-identical
   migration-backup copies, rollback-only live rehearsal, guarded single apply
   and independently read poststate. Keep native holds unchanged.
6. [~] Commit/push reviewed owned paths and verify the resulting web image and
   executable private-alert marker in new/retained entries, not the webhook.

## RED And Race Evidence

The coordinator independently ran `rehearse.mjs --red` against the fresh full
backup in an exact UUID-labelled PG17.6 container with no network, published
ports or host mounts. Ordinary Web/FCM rechecks returned `deliver` under DND
and the real captured ring remained eligible: two expected assertion failures,
preceded by two actual message/ring positive controls. The owned container was
removed. No provider calls or live messages.

The alleged cross-device heartbeat race was **not live**. Two real connections
prove `pg_blocking_pids` in both status-writer/old-heartbeat orderings, including
an UPSERT whose `WHERE` refuses the old activity timestamp. Final status is
hidden in both orders. Its existing tuple lock already serializes the writes;
`presence_beat` is deliberately unchanged, not given a redundant `FOR UPDATE`.

The first coordinator GREEN run passed ordinary enqueue, hidden presence,
expiry equality, idle/invisible/absent/caller controls, all alert kinds and
terminal Web/FCM delivery rechecks. Its album test referenced a nonexistent
outbox `user_id`; that harness error is being corrected to join the group,
not excused as a product failure or a green result.

The review-requested **actual terminal** cycle then found two further RED cases
in the two-function candidate. Complete album and already-claimed ring controls
pass. Partial album refusal leaves two targets nonterminal and both reclaim;
a ring refused before claim leaves one nonterminal target and reclaims it
while the original event is still live. Provider sends remain zero.

The bounded fix therefore also changes `album_push_recheck` and
`voice_push_claim`: claimed DND albums settle even while incomplete, and a
claim wave terminalizes lockable pending/expired-claim ring targets for active
recipient DND. It does not steal active leases or touch CANCEL. Existing
advisory admission, ordered `SKIP LOCKED`, permissions and status names stay.
Later members of a suppressed album must not resurrect its external targets.

The final claim review and timing-only two-connection probes found three
additional RED boundaries before apply: DND can commit before cursor admission
or before the loop's repeated eligibility check, and an unbounded sweep under
the global admission lock can delay ordinary/CANCEL work. Simply replacing
`CONTINUE` does not cover the first race because eligibility removes the row
before the loop sees it.

The candidate carries an observed private refusal from the admission snapshot
and admits quiet RINGs for terminal settlement, not delivery. Repeated
eligibility and the current private refusal share one statement/snapshot;
turning DND off afterwards cannot revive the captured refusal. The sweep uses
the existing 1..20 request clamp, while the unchanged admission cap is 16:
at most 36 terminal updates, not an unbounded scan/update cohort. CANCEL stays
first in admission order; live claim leases cannot be stolen. Restored final
acceptance is complete. The exact candidate is applied as recorded below.

No replay means an **observed** DND refusal is terminal. There is no new status
history authority: a DND interval during which no worker checks the event is
not retrospectively detectable. This and already-accepted provider delivery
are explicit limits, not proof of an atomic cross-service status transition.

## Client Gates And Review

Mounted actual sound/desktop-bridge cases were RED 5/5 before the patch, with
two additional deadline/generation failures before their fixes. GREEN 9/9;
13/13 in-memory omissions are caught by runtime assertions. The finite deadline
re-arms safely and an old account response cannot overwrite a returned account.
In-app rows remain visible and quiet IDs are handled, not replayed on reconnect.

The coordinator changed one old source-shape assertion to require the captured
account-owned handled set rather than a literal `.current.delete`. Final full
unit gate before the next disjoint roles edit: **4841/4841**, zero failures or
skips. Server gate after the completed API build: **357/357**, zero skips.
Typecheck and actual production web build pass (`sw.js build ba0d840e3ebf1c27`,
`built in 14.77s`). The earlier server invocation overlapped its build and
missed four emitted worker files; the ordered rerun is the acceptance evidence.
The first full unit invocation used an unsupported fixture port; the final run
uses the existing tests' fixed 5218 fixture contract, without altering them.

Independent SQL review found no initial body/rollback issue. Its two P2s were
acted on: terminal-cycle coverage above, and the runner now invalidates a prior
rehearsal receipt at start and writes a hash-bound receipt only **after** JSON
and catalog-parity assertions succeed. No receipt is an apply substitute.

## Disjoint Roles Read Ordering

D-334: an outstanding roles query could overwrite a newer read, restore a
disabled panel or act on a missing-table error after unmount. The hook now
rejects stale completions using a per-consumer load generation. Four added
lines; no query, server role rule or assignment mutation changed.

Actual mounted RED: 10 failures in 11 cases, with the independent-consumer
positive control passing. GREEN: 11/11; omission/shared-generation mutations
4/4 caught (10, 6, 1 and 1 failures respectively). Focused roles/realtime:
59/59 without skips. Final combined DND/roles unit gate: **4852/4852**, zero
failures/skips. Production web build: `sw.js build 8390c08cb81b8e57`,
`built in 13.13s`. API/server evidence above remains valid: no server JS changed.

## Frozen SQL Acceptance

Final claim source SHA256:
`5af34854c7fd96923baf85191db2af06333a6f932600c93974e0e9dcb1af5f9c`.
Migration raw SHA256:
`9bb6f9fdc0917f33b7ba97b4c2d35927ef3dc28b2c6e2d9bc6c3e6242b182d97`;
rollback raw SHA256:
`2eff120ce0ab0399ebb7c7929efc69f321b9f15ae49d7c1bf659131594046466`.
Both backup copies are byte-identical. Five claim replacements reverse to the
exact original body; independent final static review found no further P1/P2.
The limit bounds updates, not a latency SLA. Rollback restores code, not already
terminal/suppressed delivery records.

The coordinator's final `--mutations` run passes **39 groups, 34 mutant kills,
261 SQL calls**, zero skips/provider sends. Complete/partial album and live/
pending/expired RING terminal cycles pass; new eligible events still deliver.
CANCEL, active lease ownership, RLS and expiry/caller controls pass. Actual
rollback restores exact bodies/owners/ACL/RLS/triggers/indexes; reapplication
repeats the literal behavior checks. The exact owned container is removed.
This full run is not the separate focused admission/interleaving proof.

Live rollback-only rehearsal passes: configured QA positive control, DND,
hidden presence, expiry equality and invisible. No messages or queued provider
delivery were created. A second connection finds exact pre/post catalog parity.
The hash-bound receipt is written only after those assertions, and exact SQL/
rollback archives are present root-only under
`/srv/letscube/backups/presence-quiet-20261002`.

The coordinator's separate `--claim-mutations` run passes **6 groups, 6 mutant
kills, 173 SQL calls**, zero skips/provider sends. Real backends prove DND
before admission/recheck and DND ending after either observed refusal. Mixed
quiet/CANCEL waves settle 20 then 40 quiet targets while CANCEL progresses;
quiet-only waves settle 36 then 40. All six semantic omissions reach their
specified wrong outcomes; timing hooks and mutant definitions are removed and
the exact owned container is deleted.

The exact four-function migration was then applied **once** through the
hash-bound guard and verified backup. An independent new connection confirms
all four expected source hashes, owners, ACLs, security/volatility/search-path
metadata and zero public tables without RLS. There is no schema, grant, user
preference or dispatcher configuration change. The SQL archives and apply
receipt remain root-only in the directory above. Do not reapply this migration
or enable voice dispatch as a supposed follow-up acceptance step.

## Resume

Owner: coordinator. Stage: reviewed web integration/publication after accepted
SQL apply. Goodall and Carson are closed; Hilbert's runner is frozen. Full
client/server and restored SQL gates have passed, including the live rolled-back
control and independent committed poststate. Next: publish only the owned
commits, verify exact image/new-and-retained content, then read-only web smoke.

Archive SHA256:
`fbb7b3ad00150d66b6a76b9e4ac0e530475b031b3d9f26ffd78036630b321b16`.
Current PostgreSQL is 17.6; restored test containers must have no network,
host mounts or published ports, and must not run restored cron/network jobs.
