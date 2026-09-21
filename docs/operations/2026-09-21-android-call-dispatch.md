# Android Call Dispatcher: Disabled Foundation

Owner: Codex, primary checkout `D:\CodexProjects\LetsCube-Chat`, main, base
`b1d5349c9cc6148f83aff0fbff70e969a8c2a4f0`. Tracker 32-D1 Task 3.

## Scope And Checkpoint

Complete as independently reviewed disabled source: a trusted, immediate ring/cancel
dispatcher using Task 2's session-bound transient queue. The SQL and Edge gates stay disabled. No production
migration, Edge deployment, provider send or native installation in this batch.
Existing message/task/system Web Push, FCM and WNS are regression boundaries.

Task 2 artifacts remain byte-identical. The CLI generated the new
`20260921122846_android_voice_push_dispatch.sql` proposal instead of rewriting
already-reviewed migrations. Rollback order: dispatcher, outbox, session binding.
This costs one extra migration but preserves the earlier verification inputs.

## Devices

The owner explicitly marked Nothing unavailable, then authorized the second phone.
Read-only ADB inventory of Realme RMX3830 confirmed Android 15 / SDK 35,
LETSCUBE 0.1.3 / build 4 and WebView 137.0.7151.72. Its Google-compatible services
are microG 0.3.15.250932, not official Google Play Services. Future results on this
phone must be labelled microG compatibility, not official-GMS delivery proof.
No personal screen/content capture, account change, app launch or installation
was performed by this preflight. The installed app predates the planned handler.

Further read-only checks found `POST_NOTIFICATIONS` granted=false. The installed
APK was pulled without app data and inspected with SDK `aapt2`: none of the six
Firebase initialization resource names were present. Positive controls passed
(`app_name`, expected package, 1408 resource declarations), so this is not an empty
or mis-targeted probe. No resource values were printed. This installed build is
not suitable for an FCM delivery test even before considering microG; a correctly
configured candidate and permission flow are prerequisites.

## Verified Infrastructure Inputs

Read-only inspection of the production scheduler found the existing active
`kub-send-push-notifications` job at one-minute cadence. Its `net.http_post`
dispatch reads Vault secret **names** `kub_project_url` and
`kub_push_dispatch_token`, and uses `x-kub-push-token` with
`/functions/v1/send-push-notifications`. Presence and the approved endpoint origin
were verified as booleans; values and the raw job command were not printed.

The production job is not modified. The proposal queues a separate immediate
voice-scoped wake in the authoritative transaction. Supabase documents that
[pg_net requests execute after commit](https://supabase.com/docs/guides/database/extensions/pg_net),
so a rolled-back call must not leave a wake request. Disabled SQL must avoid even
the Vault lookup and HTTP enqueue.

[FCM error guidance](https://firebase.google.com/docs/cloud-messaging/error-codes)
requires respecting Retry-After and exponential backoff. A provider delay beyond
the 45-second ring lifetime is not shortened to fit: the attempt ends instead.
A provider acknowledgement is acceptance only, never proof that a phone rang.

## Rehearsal Environment

Reused the verified Task 2 before-schema backup and identical PostgreSQL 17.6
image, not customer rows or production secrets. Details and checksum:
[Task 2 evidence](2026-09-21-android-call-delivery.md).

The disposable database has network `none`, a read-only root, memory/CPU limits,
tmpfs data and cron execution disabled. Both Task 2 proposals and companions were
reapplied under their real owners. Actual PostgREST retained all 12 prior
registration/authorization checks. Synthetic roles/tokens are local to this
isolated copy, and fixture cleanup was verified.

One invocation used a PowerShell multiline pipeline whose trailing CR became part
of the Python mode argument; the HTTP helper ran before its disposable listener
existed and failed with connection refused. Fixture cleanup still ran. A direct
SSH command with an exact argument started the listener, and the 12 checks passed.
No production connectivity or service settings were changed.

## Remaining Gates

- Next is Task 4 native handler and binding source. Task 3 implementation, tests,
  independent spec/quality review, integration and exact rollback are complete.
- Controlled production schema/Edge rollout is a later step, with a fresh
  verified backup; these rehearsals do not activate it.
- Implement the native protocol-1 handler/binding before any device advertises
  call capability. Then obtain explicit native release authorization and verify
  real foreground/background/closed-process ring, cancel, tap and expiry.
- Official-GMS and microG results remain separate. Nothing availability is not
  assumed. This task does not prove killed-process delivery.

## Implementation And Verification

The proposal installs three service-only RPCs: `voice_push_claim`,
`voice_push_prepare`, `voice_push_complete`. They share the eligibility predicate,
use bounded leases and three-attempt exponential retry, prioritize cancellation,
and perform compare-and-set completion. Preparation and completion serialize with
registration in channel/outcome/device lock order. A stale response cannot revoke
a rebound account or a rotated token. Client roles cannot call these RPCs or edit
the gate. The prior direct service outcome UPDATE grants are replaced by RPCs and
restored exactly on rollback.

The Edge route `scope: voice` requires a configured dispatcher secret and valid
authorization even when the feature is disabled; no generic fail-open fallback.
The separate SQL and `VOICE_PUSH_DISPATCH_ENABLED=1` gates are both required.
Voice requests do not access ordinary outboxes or require VAPID. Provider failures
yield bounded aggregate statuses, not payloads, token values or raw errors.

Verified on the reviewed snapshot:

- SQL RED against Task 2, followed by 56 focused tests and 291/291 complete server
  tests, no skips. Eleven targeted SQL mutations killed, including gate, session
  capability, expiry, claim/hash comparison, grants, device lock, backoff and wake
  timeout changes.
- Actual PG17 full-schema apply and companion under `supabase_admin`, followed
  by actual PostgREST claim/prepare/complete for four devices and duplicate-ack
  rejection. Anonymous/authenticated execution was denied; service claims returned
  empty while disabled.
- Forced overlap held one device claim uncommitted: another connection claimed
  only the other three with a 500ms lock timeout. It did not wait for the held row.
- Forced registration rebind held the device row: both prepare and invalid-token
  completion waited, then rejected the old account. The new binding remained
  enabled and unrevoked.
- Real Vault/pg_net transaction checks: enabled queues one expected voice request,
  disabled and foreign origins queue none. Rollback removes request, synthetic
  secrets and call rows; no request is committed or sent externally.
- Exact deployed Edge image `supabase/edge-runtime:v1.74.0`, digest
  `sha256:2781daf92394db91f7e94129cc3d04ec474ad16a8fe64b3fbeef6e7d557ab120`,
  ran the dispatcher against real PostgREST in the isolated database network
  namespace. Four simulated provider acceptances took 1442ms. A simulated
  UNREGISTERED response after account rebind yielded three acceptances and preserved
  all four enabled registrations, 1261ms. These are harness timings, not phone
  delivery latency.
- Task 3 rollback matched the pre-Task-3 catalog fingerprint of all public/private
  function definitions/owners/grants, tables/RLS, column grants and triggers.
  Twelve registration HTTP checks still passed after rollback; fixtures were empty.
- Frontend `pnpm.cmd --filter @workspace/kub run typecheck`: exit 0.
- Frontend build with `PORT=5173`, `BASE_PATH=/`: exit 0, `sw.js build
  cc5ad7397bebc83c`, built in 14.41s. Existing sourcemap, mixed-import and large-chunk
  warnings remain; no frontend source was changed.
- `pnpm.cmd dlx deno@2.5.2 check --no-lock --node-modules-dir=none
  supabase/functions/send-push-notifications/index.ts`: exit 0. No tracked dependency
  or lockfile change. A transient auto-mode check relinked ignored dependencies;
  `pnpm.cmd install --offline --frozen-lockfile --ignore-scripts` restored pnpm
  junctions at the locked versions before verification continued.

The initial local Node integration bridge used an SSH process per RPC. Parallel
bridges exceeded the production 2-second RPC budget, so that harness was replaced
by the actual Edge runtime and direct loopback HTTP, not by loosening timeouts.
An earlier harness assertion also matched the harmless aggregate field name
`invalid_token`; it was narrowed to fixture values. Neither failed harness run is
counted as a passing product test. Fixture collision guards prevented a concurrent
bootstrap and cleanup completed after the attempts.

The three SQL artifact SHA-256 values are respectively
`5c9a354b3f86d6ac01eb5741aee30698e9f95433fd83c2e5ffbdf6b9497ba95e`,
`4fe7a8a092590c9916529f6d8febf4362c12db13cc36505978153c7d51174e55`,
`5395b3097096b6cf6b11edf7705209140cfe263d5f0ddae645c7192cf37afc8b`.

Stored expired/exhausted outcome rows cannot send again but are not automatically
deleted by the passage of time. Queue retention/cleanup must be included in the
controlled activation checklist. The minute fallback alone cannot guarantee a
45-second ring. Neither source tests nor provider acceptance prove receipt.

## Review, Bounds And Handoff

Independent review returned spec PASS and quality PASS, no actionable findings.
It compared all nine changed source/test/proposal files against the review package
and stable SHA-256 values, including the exact runtime-tested dispatcher hash
`0fd241c5ac6fb4152e1b22e8fc8bb45a299dc2a2a374b3041d6e7094cb5f5c60`.
The 89-test Edge/entry/payload/Web/FCM/WNS regression run passed with nine killed
mutations; combined with eleven SQL mutations, twenty deliberate defects were
detected. Expected Node module-type/TS-strip warnings are not failures.

The initial brief's "four per wave" was clarified as four **rows** per batch,
not four batches in total: 20 fresh targets require five batches. Total claims
(including retries) remain <=20, concurrency <=4, drain budget <=20s, and each
provider send is capped at 4s and the remaining lease/expiry. A failing test caught
the earlier cutoff; SQL-timed tests require retries at 0, 2 and 6 seconds. This
decision permits one more fresh batch without widening any per-drain bound.

Two implementers had disjoint SQL and Edge write scopes under the user's parallel
work authorization; the coordinator owned integration/docs/commits, and a separate
reviewer owned review only. No recursive delegation or unreviewed worker commit.

Review boundaries are retained as activation gates: rebind/cancel after prepare
commits can still occur while a provider request is in flight; native exact binding,
generation/expiry and tombstones are mandatory. Concurrent drain capacity,
immediate-wake failure/recovery and queue retention are not established by the
single-drain tests. Accepted means acknowledged provider acceptance only.

After the Task 3 rollback, both Task 2 rollbacks also passed and the original
five-case registration HTTP contract passed. All synthetic fixture counts were
zero. All three owned rehearsal containers were removed only after matching their
exact IDs/labels/network isolation; the verified before-schema backup remains.
No production container, schema, credentials, firewall or routes were modified.
