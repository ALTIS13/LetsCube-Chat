# Task 4 Implementer Report

Date: 2026-08-31

Branch: `codex/bot-platform`

Base: `b9fcaf774546c790c754c2b68f91baff4ced1396`

Commit: `feat(bot): add secure webhook and update delivery` (this report is
part of that commit; the resulting hash is reported by the controller/final
handoff).

## Scope Delivered

- Added `getUpdates`, `setWebhook`, `deleteWebhook` and bounded
  `getWebhookInfo` handlers without changing Task 1-3 message/token contracts.
- Added one-active-poll-per-bot database leases, ACK strictly below `offset`,
  SQL-side `allowed_updates` filtering before `LIMIT`, 100-update and 30-second
  bounds, abortable 250 ms waits and exact-token lease release.
- Added absolute HTTPS target validation with no credentials, fragments or IP
  literals; comprehensive IPv4/IPv6 special-range blocking; all-answer DNS
  rejection; fresh resolution per attempt/hop; pinned TLS lookup preserving
  hostname/SNI/certificate verification; two same-origin redirects; 10-second
  per-hop timeout; and 64 KiB response cap without body retention.
- Added required 16-256 character `secret_token`, canonical base64url 32-byte
  `BOT_WEBHOOK_ENCRYPTION_KEY`, AES-256-GCM with a fresh 12-byte nonce,
  versioned ciphertext and SHA-256 fingerprint. Plaintext is used only in the
  fixed `X-Letscube-Bot-Webhook-Secret` request header.
- Added bounded worker claim/prepare/finish flow. Claims use `SKIP LOCKED`, an
  epoch and `dispatching` gate. Only the oldest active update per bot can be
  claimed. Replacement/deletion invalidates `claimed` rows; a mutation
  conflicts while a request is already `dispatching`, so no successful
  mutation can race a stale outbound request.
- Added transient/permanent HTTP classification, metadata-only retries and
  dead letters, exponential SQL backoff capped at one hour, attempt ceiling,
  stale-claim recovery, hourly bounded cleanup, and independent 24-hour
  payload / 14-day attempt / 90-day private audit retention.
- Extended the existing unapplied foundation proposal only. No second
  migration was created.

## TDD Evidence

RED evidence observed before implementation:

- `bot-api-schemas.test.mts`: failed because `secret_token` was an
  unrecognized key.
- New SSRF and update-delivery suites: failed with `ERR_MODULE_NOT_FOUND` for
  `webhookSecurity.ts` and `updateDelivery.ts`.
- SQL contract suite: six expected failures for missing `allowed_updates`,
  poll release, webhook epoch/prepare, per-bot claim serialization,
  drop/status retention signatures and new service-role RPC contracts.
- Gateway packaging test: failed because encryption-key resolution and worker
  wiring were absent.
- IPv6 special-range mutation test: `fec0::1` passed before the site-local
  range was blocked, then passed after the fix.
- Local TLS response-cap test initially resolved a 200 response after an
  oversized chunk; it passed after cap rejection became terminal before stream
  destruction.

GREEN evidence:

- Focused Task 4 plus Task 1-3 regressions: `80/80` tests passed.
- SSRF suite includes deterministic fake DNS and an ephemeral local HTTPS
  endpoint for pinned lookup, SNI/certificate hostname, fixed secret header,
  timeout and chunked response-cap behavior. It does not contact public
  networks.
- PostgreSQL smoke exercises filter-before-limit, ACK boundary, poll/set
  conflict, exact lease release, one claim per bot, prepare/dispatch mutation
  conflict, replace-before-prepare invalidation, transactional drop, private
  webhook info and independent retention.

## Validation

- `node --test tests/unit/bot-update-delivery.test.mts tests/security/bot-webhook-ssrf.test.mts tests/unit/bot-api-schemas.test.mts tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-method-router.test.mts tests/unit/bot-token-auth.test.mts tests/unit/bot-gateway-packaging.test.mjs` -> 80 passed, 0 failed.
- `pnpm.cmd --filter @workspace/api-server run typecheck` -> exit 0.
- `pnpm.cmd --filter @workspace/api-server run build` -> exit 0; dedicated
  `dist/botGatewayIndex.mjs` produced.
- `pnpm.cmd run db:types:check` -> exit 0; 36 private RPC names checked.
- `git diff --check` -> exit 0 before report/commit.
- Fresh disposable `postgres:17-alpine`, server `17.11`:
  compatibility fixture applied; foundation migration committed; full
  `bot-platform-db-smoke.sql` returned `bot_platform_db_smoke_ok`; smoke
  transaction rolled back; post-rollback probe returned
  `17.11|0|0|0|0|0|0`; container was removed.

## Changed Files

- `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`
- `artifacts/api-server/src/bot/app.ts`
- `artifacts/api-server/src/bot/methodRouter.ts`
- `artifacts/api-server/src/bot/schemas.ts`
- `artifacts/api-server/src/bot/updateDelivery.ts`
- `artifacts/api-server/src/bot/webhookSecurity.ts`
- `artifacts/api-server/src/bot/webhookWorker.ts`
- `artifacts/api-server/src/botGatewayIndex.ts`
- `scripts/check-database-type-drift.mjs`
- `tests/security/bot-webhook-ssrf.test.mts`
- `tests/server/bot-platform-db-smoke.sql`
- `tests/unit/bot-api-schemas.test.mts`
- `tests/unit/bot-gateway-packaging.test.mjs`
- `tests/unit/bot-platform-schema-contract.test.mjs`
- `tests/unit/bot-update-delivery.test.mts`
- `.superpowers/sdd/2026-08-30-bot-platform/task-4-implementer-report.md`

## Self-Review

- Preserved authoritative `bot_message_command_internal` and update enqueue
  functions; Task 2-3 router/token/schema tests remain green.
- Removed an initially added delivery-attempt FK because cascading ACK payload
  cleanup would have violated 14-day metadata retention. Transactional drop
  now explicitly removes matching attempts before payloads.
- Isolated IPv4/IPv6 block lists after detecting Node `BlockList` mapped-address
  interaction, removed settled poll abort listeners, made response-cap failure
  terminal, prevented payload fields from overriding authoritative
  `update_id`, and prevented cleanup failure from starving delivery ticks.
- Reviewed logs and DTOs: no authorization token, secret plaintext,
  ciphertext, fingerprint, target query, payload/body or claim token is logged
  or exposed by webhook info/dead-letter metadata.
- Production, `main`, browser/PWA and iOS code were untouched. No deployment,
  production database call or external webhook call was made.

## Unresolved Limitations

- The test suite proves concurrency rules through PostgreSQL locking/race
  probes but does not include a sustained multi-process load/soak run.
- Local TLS tests intentionally use an injected connection factory to route a
  validated public-looking address to an ephemeral loopback server; this keeps
  tests offline while exercising the production lookup/SNI/timeout/cap path.
- A webhook replace/delete request returns conflict while an outbound request
  is already in `dispatching`; callers must retry after the bounded request or
  stale-claim window. This is the fail-closed behavior that prevents a
  successful mutation from overtaking an in-flight dispatch.
- Operational rollout still requires provisioning a canonical base64url
  32-byte `BOT_WEBHOOK_ENCRYPTION_KEY` in the isolated Bot Gateway environment.
  No key was generated, stored or printed by this task.
