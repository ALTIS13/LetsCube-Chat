# Message Authority Repair Candidate

Date: 2026-10-03. Owner: this Codex chat. Branch:
`codex/bot-inline-media-20261002`; starting source `f12514e6`.
Stage: local test-only repair of D-336/D-337. No runtime migration, production
write/deployment, Storage operation, native build/install or release is included.
All data are fictional in disposable loopback PostgreSQL 18.4 fixtures.

## Why Continuation Stopped

The previous checkpoint ended with an ordinary diagnostic closeout rather than
continuing the approved next implementation stage. It was not a failed release
or production outage. Continue an approved checkpoint after diagnostic evidence;
do not turn that evidence into a new approval requirement. Tool safety controls
remain binding; neither retrying a blocked agent nor disguising its request is an
acceptable continuation method. This slice used only owned local fixture data,
no accounts, paid device minutes, new components or credentials.

One local review test subsequently waited indefinitely: its `afterEpoch` helper
held a membership UPDATE in one session, then tried another UPDATE of the same
row in a third session before releasing the first. The mutation now executes in
the already-owning blocker transaction. The verified idle backend of that one
loopback fixture was terminated to release the abandoned run; no shared service
or broad process termination was used. That failed/hung trial is not RED proof
of the application defect.

## Observed Cause And Scope

[The prior measured waits](2026-10-03-bot-media-authority-waits.md) establish that
the captured bot file-id and human-forward implementations read authority before
an existing epoch wait. Their old decision can survive a committed revocation.
The candidate changes their actual compiled fixture bodies, after literal
accepted-source SHA checks, instead of substituting a mock writer.

The new SQL lives only in
[`tests/server/fixtures/bot-media-authority-candidate.sql`](../../tests/server/fixtures/bot-media-authority-candidate.sql).
It is not an entry in `supabase/migrations`, has no production mapping and must
not be copied into runtime without the remaining acceptance work.

## Candidate Contract

- After the existing INSERT/epoch prefix, bot file-id sends retain the bot,
  target chat, bot membership, source and relevant reply/topic rows with try-only
  SHARE locks, then invoke the exact visibility predicates in fresh commands.
  Current source kind and actual payload reply are checked independently.
- Cached send and gateway returns recheck and retain current target authority.
  They do not require re-admitting a source that an earlier committed result used.
  A direct cached result retains the saved message and requires its chat/bot to
  match the request. Gateway results that carry a chat must match it too;
  mismatched targets refuse `23505`, not return data from a different old chat.
  Boolean chat-action results retain the existing fingerprint contract; no
  exhaustive no-message-operation authority claim is made.
- Forward retains the source and both actor memberships, then rechecks current
  visibility/type and target access. The normal guard is outside the INSERT's
  exception block; cached and unique-conflict return paths are guarded too.
- A missing required row during acquisition refuses immediately. A later rejoin
  cannot supply a new, unretained row to the authorization decision.
- A fixture-only hidden-entry INSERT/UPDATE hook takes source SHARE and the
  hiding actor's membership UPDATE lock with NOWAIT. Another actor uses a
  different member row and may hide the same source; readers are not globally
  serialized through an exclusive source lock.
- The exact supported mode is READ COMMITTED; unsupported modes refuse `0A000`.
  Busy late acquisition refuses `55P03`, without creating an inverse waiting edge
  behind the earlier epoch prefix. A refused operation leaves no current message,
  result, grant or accounting effects. Earlier committed reservations/PUTs remain.
- These locks protect against other transactions until transaction end. They do
  not prohibit the same backend from upgrading its own locks or changing rows.
  Helpers are private postgres-owned VOLATILE definers with empty search_path;
  no client EXECUTE or schema access is added.

## Verification

| Check | Observed result | Meaning |
| --- | --- | --- |
| Original strict file-id/forward cases, repair disabled | 10 pass / 10 fail, 20 cases | All ten waited-authority refusal assertions fail for the real gap; controls pass. |
| Retention without repair | 1 pass / 6 fail, seven cases | Six required retained-authority assertions fail; unrelated actor control passes. |
| Busy-source contention without repair | 0/2 | Both literal atomic refusal assertions fail after reaching the real epoch wait. |
| First corrected candidate aggregate | 45/45, 385.3 s | Actual send/command/forward/ingest plus retention/contention and initial review cases. |
| Expanded review cases | 14/14, 199.8 s | ACL/isolation, successful cache retention, cached denials, reply/type, missing/rejoined members, hiding INSERT/UPDATE and concurrent unique conflict. |
| Prior frozen aggregate, before cached-target correction | 48/48, 277.0 s | Passing bounded tests did not reveal the additional P2 found by the second review. |
| Changed cached target, before correction | 0/2, 18.6 s | Direct and gateway returns both lacked the expected literal conflict despite a positive allowed-new-chat control. |
| Frozen final aggregate | 50/50, 319.1 s; no failures/cancellations/skips | Eight final source inputs below, checked unchanged after execution/review. |
| Executable mutations | Final 13 variants / 21 expected failures, no skips/cancellations/setup errors | Actual compiled guards/call sites are changed; literal or blocking-edge assertions detect the changes. |
| Prior coverage protocol | Reused 33/33 | All five earlier input hashes were rechecked unchanged; no redundant rerun. |
| Syntax / whitespace | Seven `node --check` inputs and `git diff --check` pass | No application bundle change is implied. |

The first schema-install trial failed because `postgres` in this fixture lacks
database CREATE. Installation now uses the existing fixture bootstrap executor,
then installs postgres ownership and revoked ACLs; no role grant was broadened.
An initial mutation CLI trial selected no named tests due to PowerShell argument
expansion. It was rejected, not counted. Corrected scalar arguments selected all
19 expected cases. The abandoned eight-case review trial had one harness failure
and is not an all-clean RED comparison.

| Mutation | Selected literal failures |
| --- | --- |
| Remove late file-id guard | 1 |
| Remove late forward guard | 1 |
| Drop hidden-entry hook | 2 |
| Remove hidden-member NOWAIT | 2, actual waiting edges with lock_timeout=0 |
| Remove source NOWAIT | 2, actual inverse waiting edges |
| Remove cached target guards | 2 |
| Remove forward early-return guards | 1, actual concurrent unique-conflict path |
| Remove acquired-member checks | 3 |
| Remove payload reply/kind guard call | 2 |
| Remove current forward system-type check | 1 |
| Remove exact isolation checks | 1 |
| Add client EXECUTE to a helper | 1, actual catalog ACL mismatch |
| Remove saved-target bindings | 2, direct and gateway cached results |

### Frozen Inputs

SHA-256, before the final run; compare again after review and before commit:

```text
3425b2aaa962b67df0db2d7ac0524f39dbe15b528cf4b6249183bc4e0b34134c tests/server/fixtures/bot-media-authority-candidate.sql
370e7ea7702cccc73b323d1697503e0fc5c2d5770459b8dc332409b88a852dc4 tests/server/bot-media-authority-repair.fixture.mjs
7229ef04bb24ffb30504e42c08b8530ee65b2c16f27131769846e13140bcaae1 tests/server/bot-media-authority-retention.test.mjs
4eb86d190a57c5a52c0c6a58c191f81480534535caa5414cff4fc7777cce95d1 tests/server/bot-media-authority-contention.test.mjs
ed05c2495d7a29247121c9b600c46e44ad4abda940a74017464208a030b8be16 tests/server/bot-media-authority-review.test.mjs
eaf46551115b54935076162853db13010caa89ac55670b8d7f5014314c25f682 tests/server/bot-media-coverage-file-id-waits.test.mjs
95ce54faa80b830a1cd2942163278be4d89d603923767e697706cbe90aad3a8b tests/server/bot-media-coverage-forward-waits.test.mjs
aa4cfb4e02ca545bad26625f455f9036e014b7eb4066808606eb4f32fbd8c4f5 tests/server/bot-media-coverage-ingest-waits.test.mjs
```

Independent first review found five P2: cached/exception exits, absent membership,
payload reply, current source type and timeout-ambiguous hiding proof. Each has a
separate regression and candidate correction. The second exact-source review
closed those five but found another P2: accepted direct-send idempotency binds
bot/key/method, not target chat. Supplying an allowed new chat could return the
saved result from a revoked old chat. Both direct and gateway cases were proven
RED and corrected with saved-target checks; removing those checks is an executed
mutation. Third exact-source review approves the five frozen candidate inputs
above with no remaining P1/P2 in this bounded scope; the reviewer executed no
tests or SQL. Its worker is closed. Final 50/50 and source hashes are confirmed;
source approval is not PG17/full-schema or production acceptance.
All eight executed/current input hashes match the report; five candidate inputs
also match the independent review. All workers and finite test sessions are
closed/completed. The foreign bot-platform deletion remains untouched.

### Reproduce The Final Gate

PowerShell, with the already installed local PostgreSQL directory (no global PATH
or JDK changes):

```powershell
$env:BOT_INGEST_PG_BIN='C:/Users/maksi/scoop/apps/postgresql/current/bin'
$env:BOT_MEDIA_AUTHORITY_REPAIR='1'
$env:BOT_MEDIA_AUTH_REQUIRE_FRESH='1'
Remove-Item Env:BOT_MEDIA_AUTHORITY_REPAIR_MUTANT -ErrorAction SilentlyContinue
$tests=@('tests/server/bot-media-coverage-file-id-waits.test.mjs','tests/server/bot-media-coverage-forward-waits.test.mjs','tests/server/bot-media-coverage-ingest-waits.test.mjs','tests/server/bot-media-authority-retention.test.mjs','tests/server/bot-media-authority-contention.test.mjs','tests/server/bot-media-authority-review.test.mjs')
node --test --test-concurrency=3 @tests
```

For a bounded mutation, set `BOT_MEDIA_AUTHORITY_REPAIR_MUTANT` to a name from
`installAuthorityRepair`, and select the corresponding literal cases above.
For example, `cache-binding` with
`--test-name-pattern='cached send refuses a changed target'` selects exactly two
review tests. Both must fail their literal conflict assertions (exit 1), not
fixture/setup errors. Reset that environment variable before a GREEN run.

## Remaining Gates / Next Action

D-336/D-337 and tracker item 78 remain open for runtime. This fixture deliberately
uses reduced membership policies and ban/mute stubs; it does not accept full RLS,
ban/mute/topic semantics or the direct authenticated forward fallback. No claim
of exhaustive mutator lock-order or enclosing-wrapper acceptance follows.

Next: exact PG17/full-schema bootstrap/catalog/ACL/rollback and authority cases,
including real privacy mutator prefixes and source-reply/topic changes; effective
API isolation/commit policy; gateway/outbox `55P03` retries with unchanged identity
and fresh authority. Use the
[caller/isolation inventory](2026-10-03-bot-media-caller-isolation-inventory.md).
Then every non-message holder, physical-generation and external-I/O gate remains.
The whole-chat-media purge hold is unchanged; no close/delete/refund is authorized.
Previously accepted production SQL stays applied once, never replayed. Android/
native HOLD, A063 exclusion and preservation of Happ connectivity remain.

## Primary References

PostgreSQL's [row-lock semantics](https://www.postgresql.org/docs/17/explicit-locking.html)
describe conflicting row locks and their lifetime; its
[SELECT locking clause](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE)
describes NOWAIT rather than waiting for a conflicting row lock. These support
the mechanics, not application correctness or live acceptance.
