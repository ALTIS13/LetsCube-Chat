# Bot media HTTP boundaries and retry gaps, 2026-10-03

Owner: this Codex chat. Starting source `6b818392`, branch
`codex/bot-inline-media-20261002`. This is the next test-only checkpoint after
[combined coverage](2026-10-03-bot-media-combined-coverage.md), not installation
of the retained-authority or coverage prototypes.

## Boundary

A fresh verified backup `20261003-171555` was restored, including roles and the
full schema, into an owned PostgreSQL 17.6 container using the deployed database
image. Backup database SHA256:
`c17cecc4b2397ccd62079a52555678bc3593b847ac54bbe50ddb4087df948425`.
Isolation: network `none`, no published ports or mounts, 1 CPU / 1 GB, inactive
restored cron jobs and disabled cron launch. Only fictional `e507...` records
were addressed. No production rows, credentials, messages or media were returned
to a report, and no production SQL write occurred.

The exact deployed PostgREST **14.12** executable was copied read-only into that
container. Its image was
`sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c`,
binary SHA256
`3b452073d38d5cb9ffb1cace1ef261afe4fa443a447d74062baf041474a1ec02`.
It listened only on owned loopback, connected as the restored `authenticator`
over the local socket, and used a newly generated QA JWT key, never a production
key. Transaction configuration matched the previously measured RC/commit,
schemas, anonymous role, database config and hoisted isolation settings.
Real JWT impersonation, RLS, compiled RPCs and message triggers were exercised.
This does not test the production reverse proxy, Auth issuance or live accounts.

## Final Gate

**18/18** positive cases, zero skips:

| Boundary | Cases | Observable result |
| --- | ---: | --- |
| PostgREST transactions | 7 | Real actor/RC; durable REST text commit and released barrier; complete permission/busy/isolation rollback; forward commit/deduplication/current mute; bot command refusal without either idempotency ledger |
| Actual gateway handlers/repository | 4 | File-id retry preserves one delivery and accounting; cached target binding; concurrent membership refusal; completed membership revocation refusal |
| Actual outbox runner with separate HTTP adapter | 7 | Lost reply; serialized restart; new text/media denied after mute; ACK of prior delivery; actual busy-policy gap; unsupported-isolation refusal |

Two strict gateway oracles first failed against the old preflight:

- Same key/fingerprint rebound to another allowed chat: **200 instead of 409**.
- Cached request during another session's membership change: **200 instead of
  500/55P03**.

The loaded fixture-only preflight repair binds the cached target and retains
current target authority before the early return. It changes that preflight from
STABLE to VOLATILE: otherwise PostgREST makes its transaction read-only and the
retained row locks are forbidden. This is not a production function change.
The first counterexample is a direct internal RPC defensive-contract test with
an identical fingerprint, not a claim of an exploitable public bot API attack.

The standalone compiled STABLE mutant produces literal **405/25006**. Its exact
original definition and full application row/function/trigger digest are
restored, including an assertion fault immediately after the mutation commits.

## Verified Gaps

The current outbox classifies the actual **500/55P03** coverage-busy response as
`refused`: its persisted entry is removed and `retryNow` has nothing to retry.
Explicitly re-enqueuing the same identity succeeds after contention ends, but is
not automatic recovery. A real mute between attempts still refuses a new send.
Do not enable the coverage prototype before a narrow, tested client busy policy
retains the entry without retrying unrelated HTTP 500 failures.

The gateway repository maps the same unmapped database error to `internal_error`;
it does not expose a specific retry contract. Both caller policies remain open.
Unsupported isolation is independently observed as **400/0A000**, not a temporary
busy condition.

A mute revokes new delivery, not reading an already committed message. The
runner's adapter therefore ACKs a prior delivery after a refused duplicate INSERT
if the exact authenticated readback still returns that same row. That is not a
new send or a bypass of revoked send authority.

The outbox fixture loads the real runner, rules and memory storage, but uses a
separate send adapter. It does **not** load private `appOutbox.sendEntry`, prove
browser IndexedDB/process durability, upload bytes, or establish physical media
availability. The gateway file-id path invokes actual handlers/repository/RPCs
without Storage/provider I/O. Inline-ingest retries remain a separate gate.

## Verification Integrity

Bootstrap was installed and rolled back first; its prestate digest matched. HTTP
successes then committed only in the disposable copy. Refusal/deduplication
cases compare complete application row/function/trigger digests, not only counts.
Original copied row-hash multiplicities remain exact. Verification iterates the
saved relation inventory, including empty tables; a vanished controlled baseline
table is refused with **P0001:copied_relation_missing**.

The final **46-source** manifest is captured before application imports and
matches final bytes. An AST-parsed local import/re-export graph includes both
previously omitted reference/observation helpers. Type-only imports are excluded;
the existing package lock records external dependency versions.

One whole-stage review found five P2 evidence/cleanup gaps. They were corrected
and the final fresh-copy gate rerun: transitive source coverage, baseline relation
existence, startup-exception listener cleanup, both literal RED reasons, and a
truthful bootstrap-rollback flag on resume. The SQL sessions close even if
listener cleanup fails. An injected exception after real detached startup proves
the owned listener is removed before `startHttp` rejects. Earlier failed JWT
setup runs are not counted as acceptance: BusyBox process matching missed an old
QA listener; cleanup now verifies its exact executable inside the owned container.

Public executed fixtures:

| File | SHA256 |
| --- | --- |
| `tests/server/bot-media-http.fixture.mjs` | `7927bffe0b9cfe95fc8c248600a1b421986e60b58adf38fc41f8ce4705d32eef` |
| `tests/server/bot-media-outbox-http.fixture.mjs` | `2848cb27cdb4a47c6d32f831906e33d5adf56132cede7c97a77ff34fdef6b4f0` |

Final private HTTP receipt SHA256:
`f8422fc568b1fbdf87e84c70dd5f0ec11c3d33d634bb98c409dd6e7391f69115`.
Separate 47-source compiled-mutant/restoration receipt SHA256:
`6233dd688905a51f519b03112015cd150076418e54f01155178e41aecc7ff8fd`.
Private receipts and backup are retained; they are not committed. Prior authority
and coverage inputs are unchanged and their completed suites are reused, not
relabelled as HTTP evidence. Focused existing outbox unit suite: **10/10**.
Both workers and all finite SQL/HTTP sessions are closed. All three exact owned
HTTP copies were removed after ownership/ID/isolation checks; absence and unchanged
production runtime were verified. Backups remain. Server disk was measured at
45% used with about 62 GiB available during the final rehearsal.

## Next

1. Prove narrowly scoped busy recovery through the actual application send/ACK
   path and gateway error envelope, preserving actor, request fingerprint,
   client identity and accounting. Do not retry every server error or replay PUT.
2. Finish inline-ingest and remaining lifecycle/caller proof, then review a
   production migration and rollback separately.
3. Continue physical-generation, avatar/variant and external-I/O acceptance;
   admission/seal/delete/refund remain unapproved.

D-336/D-337 and tracker item 78 remain **open for runtime**. Previously installed
identity/resolver/observations/hold SQL must not be replayed. Whole-chat-media
purge hold, Android/native HOLD and A063 exclusion remain. No native/device,
paid-device session, UI capture, main push or production deployment occurred.

Primary version-specific references:
[PostgREST transactions](https://docs.postgrest.org/en/v14/references/transactions.html)
and [error mapping](https://docs.postgrest.org/en/v14/references/errors.html).
They guided the probes; the literal results above come from actual isolated HTTP.
