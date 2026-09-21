# Disabled Android Call Server Rollout

## Checkpoint

Owner Codex, source `0e2e053502d783c46a23cf4591d46a1374d1c13f`, primary main
checkout. Task 5 Step 1: all four reviewed SQL proposals applied to production;
reviewed Edge deployed separately. SQL dispatch remains false, Edge dispatch
remains disabled, recovery and cleanup jobs remain inactive. This is not call
delivery activation, an APK release or physical FCM proof.

## Backup And Rehearsal

Exact target: `ms.letscube.ru`, `supabase-db`, database `postgres`, system identifier
`7652726644035760163`; pinned PG image and pg_net 0.20.3/pg_cron 1.6.4 match the
[operational rehearsal](2026-09-21-android-call-operations.md). No image, extension,
network, firewall or Java configuration changed.

Fresh root-only artifacts:
`/srv/letscube/backups/voice-disabled-rollout-20260921/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Full database archive | 6404985 | `c099634b9c2b6aa51cf37c2bfb093aeec6d94a78dee8f8fec57266c7b537f55d` |
| Before-schema archive | 1650017 | `37bb61d5cadd6f6be736225e2573922f6ee7c6ed8b300ca866330b8faab34e19` |
| Original push Edge directory | 51200 | `d240e51fc46d6a7d118a1ef5b9db2b7b66f979739b2b9634d9b679f7d36f7ba6` |

The full custom archive was read completely by pg_restore and restored into the
exact production PG image, on network `none`, read-only container root, bounded
resources and `cron.launch_active_jobs=off`. Data remained on the server and was
not printed. Existing encrypted Vault rows were preserved, but the rehearsal used
a synthetic key: this proves SQL restoration, not decryption of real credentials
or a whole-host disaster recovery. Roles were backed up without passwords; existing
production key/config custody and media files were not changed.

All four exact proposals applied under their actual owner roles and rolled back
in reverse order. The catalog projection (function definitions/owners/ACLs,
tables/columns/RLS, triggers, indexes, policies and cron configuration) matched.
Additional checks cover affected constraints, defaults/generated/identity columns,
trigger enabled state including auth onboarding, schema ACLs and index validity.
The production after-state matches the isolated after-state in both projections.

Rehearsal corrections, not production failures: Vault requires a synthetic key
script in a read-only container; PG17 role grants require matching the original
bootstrap superuser (`supabase_admin`), not merely SET ROLE from a different one.
[PostgreSQL explanation](https://www.postgresql.org/message-id/afpHwTR1IJypF1md%40nathan).
pg_dump restores explicit default ACLs as NULL, so the comparison expands
`acldefault`. Three unrelated pre-existing CHECK expressions flatten equivalent
AND grouping on dump/restore; constraint comparison is scoped to the twelve
affected relations rather than misreporting those as rollout drift.

## Production Application

Each file ran once in its own transaction with its original raising checks,
5-second lock timeout and 30-second statement timeout. Preflight found no long
transaction or existing lock contention on the affected relations. No synthetic
accounts, notifications or calls were created in production.

1. `20260921114126_android_push_session_binding.sql` as `postgres`.
2. `20260921114127_android_voice_ring_outbox.sql` as `supabase_admin`.
3. `20260921122846_android_voice_push_dispatch.sql` as `supabase_admin`.
4. `20260921153256_android_voice_push_operations.sql` as `supabase_admin`.

Original proposal bytes and their rollback companions remain unchanged. No
automatic migration discovery or `supabase db push` was used. Existing devices
were not backfilled. The legacy registration signature/defaults/ACLs are preserved;
PostgREST schema cache was refreshed and exposes the new RPCs. All public tables
still have RLS. The new health endpoint returns HTTP200 to the server role and
denies the anonymous client (HTTP401).

## Edge And No-Send Evidence

Production mount:
`/srv/letscube/platform/supabase-docker/volumes/functions/send-push-notifications`.
Only the entrypoint and two new voice modules changed. Existing `fcm.ts`,
`webpush.ts`, `wns.ts`, and every unrelated function file remained byte-identical.
The existing Edge v1.74.0 container was restarted, with image and complete runtime
environment unchanged, at **2026-09-21 17:58:09 UTC**. It became healthy; all six
in-container source hashes match the reviewed checkout.

Only after verifying the new running bytes, an exact voice-scoped request was
sent: missing dispatcher authorization returned HTTP401; protected authorization
returned HTTP200 with `status: disabled` and all eight counters zero. No generic
drain was manually invoked: the old entrypoint ignores voice scope, and an empty
body or `limit: 0` is not a no-send probe.

SQL health remains disabled, zero occupied slots/live claims/HTTP wake counters.
Both new jobs are inactive. Existing generic minute cron retains its original
owner, schedule and command hash. Normal scheduler and generic HTTP responses are
observed passively; an idle HTTP200 is not evidence of provider or phone delivery.
At 18:06 UTC there were eight successful generic HTTP outcomes since the Edge
restart and four latest minute jobs succeeded. These are separate observations,
not a per-request scheduler-to-response correlation or a physical delivery test.
Successful registration and race evidence from the unchanged isolated Task 2/3
tests is reused; no production token was registered just to create QA evidence.

Focused current-source validation: 20/20 tests across voice entry, FCM delivery
and dispatcher ownership. No product-source change required a repeated frontend
visual/device matrix. Prior server 334/334 and unit 4035-pass evidence belongs to
the source/proposal batch, not a new run here.

## Recovery And Next Gate

Keep both gates off. For this never-enabled state, require empty slots and inactive
jobs before rollback; do not temporarily enable dispatch or clear queues. Restore
the verified original Edge bytes if needed, then reverse only committed SQL stages:
operations, dispatcher, outbox, binding, under their documented owners. Do not run
an authenticated voice probe against the restored old generic handler.

The coordinator's private runner and evidence are in the root-only backup area;
local sanitized harness/reviews are in ignored `output/voice-rollout-20260921/`.
They are exact-target one-shot evidence, not an unattended migration system.
The exact-owned offline restore container was removed after the final catalog
round trip; no rehearsal database or scheduler remains running.

Independent execution review found recovery-runner gaps after the successful
rollout. The retained runner now validates the archive before writes, handles only
verified exact-path partial staging, rejects optimized Python, binds the effective
mount/container, verifies rollback runtime and disallows credential-probe redirects
or inherited proxies. Twenty offline fault/guard tests pass; no production rollback
was exercised. Its stricter final postcheck passed with fourteen generic HTTP200
responses since restart, all idle, and four fresh successful minute runs. Idle
responses are not provider or phone delivery evidence.

Next: separately owner-authorized signed Android candidate, signer/version/data
continuity checks, authorized-device upgrade and the physical matrix in Task 5.
Nothing remains unavailable by the owner's instruction; Realme/microG and official
GMS proof must remain separate. Do not mark background/killed delivery ready or
activate the gates before those checks. iOS/PWA work is unchanged.
