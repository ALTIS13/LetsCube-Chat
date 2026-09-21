# Android Call Delivery: Session/Outbox Rehearsal

Owner: Codex. Base `cc3b1c437eeff69a820fa1b684670959d748a2e7`, primary
`D:\CodexProjects\LetsCube-Chat` checkout, main. Tracker 32-D1 Task 2 is verified.
Task 1's pure payload builder is already committed and must not be rebuilt.

## Scope

- Preserve the old seven-argument push registration API, its defaults and its
  `void` return. New-capability registration returns the server-verified session
  binding through a separate explicit eight-argument form.
- A separate transient ring/cancel queue observes authoritative voice row
  changes inside the existing transaction. Existing call history, notification
  rows and generic message/task delivery stay unchanged.
- No production SQL apply, dispatcher activation, native signing, installation
  or real call delivery occurs in this rehearsal task.

## Verified Before-State

Read-only checks on `ms.letscube.ru`, container `supabase-db`, database `postgres`:

- PostgreSQL `17.6`, system identifier `7652726644035760163`.
- Device table/RPC and private schema owner `postgres` (not superuser, BYPASSRLS).
  Voice channel/session preferences owner `supabase_admin` (superuser, BYPASSRLS).
  Auth sessions belong to `supabase_auth_admin`.
- `postgres` has SELECT/REFERENCES on `auth.sessions`. RLS is enabled on all
  inspected public/auth tables. No device session binding and no voice outbox.
- Existing registration: seven text arguments, four defaults, returns `void`;
  `pg_get_functiondef` MD5 `1ec557fdad31f1c6bd4e436511ef40ac`.
- The live registration accepts Android/FCM only. The historical Windows/WNS
  proposal is not the current function definition. Its actual EXECUTE ACL is
  owner + `service_role` + `authenticated`; no PUBLIC/anon access. PostgreSQL's
  public-schema default function grants also include `service_role`, so a newly
  created overload must explicitly revoke it if not part of that overload's API.

Before-schema backup, created 2026-09-21 11:40:57 UTC:

- `/srv/letscube/backups/voice-session-preflight-20260921T114057Z/schema.dump`
- `1650017` bytes, mode `600`, directory mode `700`.
- SHA-256 `d91133b18e2ae0b347990005e040f672e95c92710356862511088046a8eaf2ab`.
- `pg_restore --list`: 2503 non-comment entries. Then the entire schema was
  restored successfully, not merely listed, into a disposable PostgreSQL 17.6.
- Role definitions were generated from catalog attributes without passwords.
  No customer rows or production Vault keys were copied.

## Isolated PostgreSQL

Temporary container: `letscube-voice-rehearsal-20260921`, label
`letscube.qa=voice-session-20260921`, image identical to the running database:
`sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.

Network `none`, no published ports, read-only root filesystem, 768 MiB memory,
one CPU, temporary data under tmpfs. Cron execution is off. Counts after restore:
users/sessions/devices/messages are all zero. This is a schema rehearsal, not
a data-backup restore exercise.

Preparation failures were resolved only in this disposable environment: Vault
requires an independent test key; the image has `od`/`tr`, not `openssl` in PATH;
the role selector needed literal `pg_` prefix matching rather than SQL LIKE's
underscore wildcard, which had excluded `pgbouncer`. The final complete restore
exited zero. No production service, key, network or role was modified.

## Decisions

- Use a narrow row-change trigger for queue insertion instead of copying all
  existing ring/answer/stop/sweep implementations. Its behavioral tests must
  exercise real RPCs and terminal paths, not just fabricated row updates.
- Preserve legacy ordinary push with no call capability when a legacy session
  cannot be validated. New capability registration requires a live matching
  session. Unsupported or unbound devices must never receive a call event.
- Session identity comes from verified JWT claims and is checked against the
  session table, including explicit expiry. It is never supplied as a client
  registration parameter. This follows the [Supabase session contract](https://supabase.com/docs/guides/auth/sessions).
- Keep the per-session event and per-device delivery result distinct: one
  provider acknowledgement is not proof of delivery and must not suppress
  another device's attempt.

## Checkpoint

Task 2 is complete as a reviewed, rehearsed proposal, NOT a production install.
Two workers owned disjoint registration/outbox changes; a third independently
reviewed the combined contract and ran 41 focused tests with no open findings.
The coordinator completed two real-owner PG17 apply/rehearse/rollback cycles.
Next: Task 3, immediate trusted dispatcher behind a disabled gate. No native
candidate, provider send or production SQL apply is authorized by these results.

## Implementation

- `20260921114126_android_push_session_binding.sql`: nullable session FK with
  SET NULL and protocol-1 capability; existing seven-argument registration
  remains `void` with four defaults. The explicit eight-argument overload has
  no defaults and returns the verified user/session pair. One private core
  derives the session from JWT claims and checks ownership and hard expiry.
- `20260921114127_android_voice_ring_outbox.sql`: `voice_ring_push_events`
  contains one recipient/session/generation/event, and `voice_ring_push_devices`
  contains captured device ids and attempt leases. These two tables implement
  the plan's logical outbox. Narrow private triggers observe the existing call
  transactions; none of the ring/answer/stop/sweep RPCs are replaced.
- Ring capture requires matching live session, membership, moderation checks,
  session call preference and enabled Android/FCM protocol-1 registration.
  Cancel copies the original recipient/device set, preserves its 45-second
  deadline, terminalizes old rings and clears leases. Deleted rooms/chats leave
  no sendable queue rows. RLS and private-function ACLs deny clients access.
- Each proposal has standalone rollback-only rehearsal and rollback companions.
  Roll back the outbox first, then the session binding. No CASCADE into existing
  features and no backfill of existing device rows.

## Verification

| Check | Observed result |
| --- | --- |
| Registration absent-capability RED | Two catalog assertions failed for the intended missing columns/overload |
| Outbox RED | Real ring RPC succeeded, then the missing-queue assertion failed |
| `node --test "tests/server/*.test.mjs"` | 235/235 passed, 0 skipped, exit 0, 49.55 s |
| Voice payload + FCM + dispatcher ownership unit files | 18/18 passed, exit 0; existing Node module-type warning only |
| Mutations | 9 registration + 9 outbox mutations killed for their named mechanisms |
| Independent review | Spec/maintainability PASS; 41 focused tests passed |
| PG17.6 full-schema apply | Binding as non-superuser `postgres`; outbox as `supabase_admin`; both passed |
| Both standalone SQL rehearsals | Passed under real roles and copied production triggers; fixtures rolled back |
| Real PostgREST v14.12 before change | 5/5 HTTP cases passed |
| Real PostgREST after change | 12/12 HTTP cases passed |
| Forced concurrent RPC transactions | 4/4 scenarios passed |
| Combined registration-to-ring/rebind | Verified new RPC binding admits recipient, then excludes old recipient/self after rebind |
| Two combined rollback cycles | Passed; original registration definition and ACL restored, new objects absent, no fixture rows |
| Original function parity | Definitions, owners and ACLs of 6 functions match production after rollback |
| PostgREST after rollback | 5/5 legacy HTTP cases passed again |

The first PG17 apply failed before DDL because the local fixture had omitted
the legacy service-role grant. The corrected fixture now reproduces live
public-schema function default privileges. Legacy rights are preserved exactly;
the new overload explicitly removes the inherited service-role grant. Two new
mutations prove these distinct obligations. This was an integration finding,
not a production failure. All six reviewed SQL file hashes matched the files
copied into the isolated environment.

PostgREST ran in the database clone's isolated network namespace with no
published ports, using a newly generated test JWT key, never a production key.
Old named calls (three required or all seven arguments) returned 204. New
eight-argument calls returned the verified pair with 200. Foreign, missing and
malformed sessions and unsupported capability returned 400; direct device-table
access returned 403; anonymous and invalid-signature calls returned 401.

Concurrency was forced with a held transaction and a waiting second connection,
not hoped for through repetition: competing rings produced one generation;
answer versus stop produced one cancel and one history record; concurrent stops
were idempotent; a rolled-back ring left no phantom queue event for its waiter.
The combined test registered through the real new RPC, not a trusted table write.
Fixtures use fictional identities only and are removed or rolled back. Both
temporary QA containers were removed after checking their exact names, labels,
network namespace and read-only root. The protected before-schema backup and
bounded rehearsal logs remain available; production containers were untouched.

## Evidence Boundaries

- This schema-only restore is not a full data-backup restore rehearsal. A fresh
  verified production backup and controlled apply remain required at rollout.
- No dispatcher, wake-up, cron, frontend, native code or generic push path was
  changed. SQL proposals are not automatically applied by the web deployment.
- Time expiry is authoritative even when a pending label has not been swept.
  Task 3 must revalidate session/device/member/preference/current ring immediately
  before sending and reject stale claim completion. Provider acceptance is not
  delivery. Physical Android latency/cancel/Doze/closed-process proof is pending.
- Existing visual/web evidence remains applicable: this batch changes no rendered
  code. It does not claim additional browser, phone or audio QA.
