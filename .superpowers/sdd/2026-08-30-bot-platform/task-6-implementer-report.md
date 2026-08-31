# Task 6 implementer report

## Scope

Integrated persisted bot senders into the shared LETSCUBE chat, search and
notification surfaces without applying production SQL or deploying services.
The implementation keeps users, bots, deleted bots, deleted users, system rows
and invalid projections distinct. Human-only controls remain unavailable for
bot and malformed rows.

## Changed surfaces

- Added shared actor, message-select and notification projection helpers.
- Added `bot_id`, public bot projections and `search_public_bots` compatibility
  types.
- Made message hydration, reply/pinned/forward/playback previews, grouping,
  optimistic reconciliation, unread targeting and chat summaries bot-aware.
- Added a separate `Боты` search section backed only by the bounded authenticated
  RPC. Phone search remains human-only and bot results do not synthesize a
  private-human chat.
- Preserved exact `chat_id`/`message_id` navigation and per-chat grouping across
  Notification Center, browser projection, Windows/Tauri, Android/FCM and WNS.
- Extended the migration proposal with restrictive bot visibility, bounded
  discovery, actor-aware chat summaries/search and notification fanout.
- Added unit, E2E, RLS, PostgreSQL smoke and delivery-adapter coverage.
- Fixed the disposable PostgreSQL smoke readiness probe to wait for the final
  TCP listener rather than the image's temporary init-only Unix socket.

## Verification evidence

- `node --test tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-message-projection.test.mts tests/unit/bot-notification-projection.test.mts tests/unit/bot-client-integration-contract.test.mjs tests/unit/message-history-anchoring.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/desktop-notification-adapter.test.mts tests/unit/fcm-delivery.test.mjs tests/unit/web-push-delivery.test.mjs tests/unit/wns-delivery.test.mjs`
  - exit `0`; 94/94 passed.
- all `bot-*.test.mjs|mts` files under `tests/unit` and `tests/security`
  - exit `0`; 145/145 passed across 14 files.
- `pnpm.cmd --filter @workspace/kub run typecheck`
  - exit `0`.
- `pnpm.cmd db:types:check`
  - exit `0`; 12 tables, 9 public RPCs and 54 private RPC names checked.
- `pnpm.cmd --filter @workspace/api-server run typecheck`
  - exit `0`.
- `pnpm.cmd --filter @workspace/api-server run build`
  - exit `0`.
- `pnpm.cmd --filter @workspace/kub run build` with local non-secret QA public
  configuration
  - exit `0`; existing sourcemap, mixed static/dynamic import and chunk-size
    warnings remain.
- `pnpm.cmd windows:tauri:test`
  - exit `0`; 14/14 passed.
- `cargo check --manifest-path windows-tauri/src-tauri/Cargo.toml`
  - exit `0`.
- `node tests/rls/bot-chat-search-notification-smoke.mjs`
  - first run exit `1`: readiness caught the official image's temporary
    init-only Unix-socket server;
  - readiness changed to TCP `127.0.0.1`;
  - authoritative rerun exit `0` on PostgreSQL 17.0: fresh proposal apply,
    rollback smoke, authenticated/service-role probes, delivery and management
    two-session concurrency probes passed; post-rollback bot count remained 0.
- `pnpm.cmd exec playwright test tests/e2e/bot-chat-integration.spec.ts`
  against the local Vite QA endpoint
  - exit `0`; 13 passed and 2 intentional mobile skips. Desktop 1440x900,
    1920x1080 and 3840x2160 plus mobile 390x844 and 412x915 were covered.
- A combined run with legacy `global-search`, `notification-center` and
  `realtime-messages` specs was stopped after the new self-contained bot tests
  passed but legacy tests attempted expired/production auth state against the
  isolated stub endpoint. Those mutation-backed regressions require the Task 7
  post-migration canary environment; their unit-level anchoring/read-sync
  regressions passed in this task.
- Impeccable detector ran once over all changed UI files. It reported three
  pre-existing `border-l-2` side-tab advisories in unchanged lines and no new
  changed-line finding.
- `git diff --check`
  - exit `0` before final report creation.

## Security and compatibility

- Raw bot tokens, credentials and service-role material are absent from the
  client projection and UI.
- The frontend never queries the bot table as a discovery fallback.
- Notification routes and grouping are reconstructed from validated identifiers
  rather than trusted payload routes.
- External/signed avatar URLs are excluded from OS notification payloads.
- No production SQL was applied, no Coolify deployment was changed and no branch
  was pushed.
- No Apple/iPhone/iPad-specific file was edited.

## Remaining gate

Task 6 still requires an independent diff review and controller rerun of any
checks affected by review fixes. Production backup, restore rehearsal, migration
apply and one-bot canary belong to Task 7.

## Review fix round 1

Implemented only the five accepted review findings:

- `search_chat_messages` now projects, searches and ranks missing/deleted bot
  senders exclusively as `Удалённый бот`; stale display names and usernames are
  excluded from both general and `from` matching.
- A shared fail-closed SQL helper sanitizes human and bot avatar URLs before
  they enter `notifications.payload`. Only relative paths and LETSCUBE app/API
  HTTPS URLs survive; storage, signing, token, password and authorization
  patterns are rejected. PostgreSQL smoke assertions inspect the raw in-app
  notification payload as well as the delivery projection.
- The Windows desktop bridge retries once with the exact legacy payload only
  when a trusted icon-bearing call fails because the bridge rejects the unknown
  `icon` field. Iconless calls and unrelated errors remain single-attempt.
- The PostgreSQL runner strips only the proposal's outer `BEGIN`/`COMMIT`, runs
  the proposal inside a fresh rollback transaction, compares normalized
  deterministic schema-only dumps, and proceeds to committed apply/smoke/
  concurrency only after exact restoration.
- The bot E2E now proves last-message actor identity, preview and unread count
  in the chat list before opening a chat, including both mobile viewports.

TDD red evidence:

- The schema contract initially failed because deleted-bot masked search identity
  and raw avatar sanitization were absent.
- The PostgreSQL smoke initially failed on a malicious raw notification avatar.
- The desktop adapter tests initially failed because the legacy bridge retry was
  absent; a later near-match test (`iconography`) failed until the unknown-field
  matcher was made exact.
- The runner boundary test initially failed because no rollback rehearsal command
  was issued.
- The new chat-list E2E initially failed because the bot actor label was absent
  even though the preview and unread count were present.

Final fix-round verification:

- `node --test tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-message-projection.test.mts tests/unit/bot-notification-projection.test.mts tests/unit/bot-client-integration-contract.test.mjs tests/unit/bot-pg-smoke-runner.test.mjs tests/unit/message-history-anchoring.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/desktop-notification-adapter.test.mts tests/unit/fcm-delivery.test.mjs tests/unit/web-push-delivery.test.mjs tests/unit/wns-delivery.test.mjs`
  - exit `0`; 99/99 passed.
- all `bot-*.test.mjs|mts` files under `tests/unit` and `tests/security`
  - exit `0`; 147/147 passed.
- `pnpm.cmd --filter @workspace/kub run typecheck`
  - exit `0`.
- `pnpm.cmd db:types:check`
  - exit `0`; 12 tables, 9 public RPCs and 54 private RPC names checked.
- `node tests/rls/bot-chat-search-notification-smoke.mjs`
  - exit `0` on PostgreSQL 17.0; rollback rehearsal restored the schema before
    fresh committed apply, smoke and concurrency checks; final marker
    `bot_chat_search_notification_smoke_ok|170011|0`.
- `pnpm.cmd exec playwright test tests/e2e/bot-chat-integration.spec.ts`
  - exit `0`; 18 passed and 2 intentional mobile skips across desktop 1440,
    1920 and 3840 plus mobile 390 and 412 projects.
- `pnpm.cmd --filter @workspace/kub run build` with local non-secret QA public
  configuration
  - exit `0`; existing sourcemap, mixed static/dynamic import and chunk-size
    warnings remain.

No production SQL, deploy or push was performed. No PWA, service-worker or
Apple-specific file was edited. Legacy mutation-backed canary specs remain
unchanged for their authoritative Task 7 post-apply run.

## Review fix round 1

Implemented only the five accepted review findings:

- `search_chat_messages` now projects, searches and ranks missing/deleted bot
  senders exclusively as `Удалённый бот`; stale display names and usernames are
  excluded from both general and `from` matching.
- A shared fail-closed SQL helper sanitizes human and bot avatar URLs before
  they enter `notifications.payload`. Only relative paths and LETSCUBE app/API
  HTTPS URLs survive; storage, signing, token, password and authorization
  patterns are rejected. PostgreSQL smoke assertions inspect the raw in-app
  notification payload as well as the delivery projection.
- The Windows desktop bridge retries once with the exact legacy payload only
  when a trusted icon-bearing call fails because the bridge rejects the unknown
  `icon` field. Iconless calls and unrelated errors remain single-attempt.
- The PostgreSQL runner strips only the proposal's outer `BEGIN`/`COMMIT`, runs
  the proposal inside a fresh rollback transaction, compares normalized
  deterministic schema-only dumps, and proceeds to committed apply/smoke/
  concurrency only after exact restoration.
- The bot E2E now proves last-message actor identity, preview and unread count
  in the chat list before opening a chat, including both mobile viewports.

TDD red evidence:

- The schema contract initially failed because deleted-bot masked search identity
  and raw avatar sanitization were absent.
- The PostgreSQL smoke initially failed on a malicious raw notification avatar.
- The desktop adapter tests initially failed because the legacy bridge retry was
  absent; a later near-match test (`iconography`) failed until the unknown-field
  matcher was made exact.
- The runner boundary test initially failed because no rollback rehearsal command
  was issued.
- The new chat-list E2E initially failed because the bot actor label was absent
  even though the preview and unread count were present.

Final fix-round verification:

- `node --test tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-message-projection.test.mts tests/unit/bot-notification-projection.test.mts tests/unit/bot-client-integration-contract.test.mjs tests/unit/bot-pg-smoke-runner.test.mjs tests/unit/message-history-anchoring.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/desktop-notification-adapter.test.mts tests/unit/fcm-delivery.test.mjs tests/unit/web-push-delivery.test.mjs tests/unit/wns-delivery.test.mjs`
  - exit `0`; 99/99 passed.
- all `bot-*.test.mjs|mts` files under `tests/unit` and `tests/security`
  - exit `0`; 147/147 passed.
- `pnpm.cmd --filter @workspace/kub run typecheck`
  - exit `0`.
- `pnpm.cmd db:types:check`
  - exit `0`; 12 tables, 9 public RPCs and 54 private RPC names checked.
- `node tests/rls/bot-chat-search-notification-smoke.mjs`
  - exit `0` on PostgreSQL 17.0; rollback rehearsal restored the schema before
    fresh committed apply, smoke and concurrency checks; final marker
    `bot_chat_search_notification_smoke_ok|170011|0`.
- `pnpm.cmd exec playwright test tests/e2e/bot-chat-integration.spec.ts`
  - exit `0`; 18 passed and 2 intentional mobile skips across desktop 1440,
    1920 and 3840 plus mobile 390 and 412 projects.
- `pnpm.cmd --filter @workspace/kub run build` with local non-secret QA public
  configuration
  - exit `0`; existing sourcemap, mixed static/dynamic import and chunk-size
    warnings remain.

No production SQL, deploy or push was performed. No PWA, service-worker or
Apple-specific file was edited. Legacy mutation-backed canary specs remain
unchanged for their authoritative Task 7 post-apply run.

## Review fix round 1

Implemented only the five accepted review findings:

- `search_chat_messages` now projects, searches and ranks missing/deleted bot
  senders exclusively as `Удалённый бот`; stale display names and usernames are
  excluded from both general and `from` matching.
- A shared fail-closed SQL helper sanitizes human and bot avatar URLs before
  they enter `notifications.payload`. Only relative paths and LETSCUBE app/API
  HTTPS URLs survive; storage, signing, token, password and authorization
  patterns are rejected. PostgreSQL smoke assertions inspect the raw in-app
  notification payload as well as the delivery projection.
- The Windows desktop bridge retries once with the exact legacy payload only
  when a trusted icon-bearing call fails because the bridge rejects the unknown
  `icon` field. Iconless calls and unrelated errors remain single-attempt.
- The PostgreSQL runner strips only the proposal's outer `BEGIN`/`COMMIT`, runs
  the proposal inside a fresh rollback transaction, compares normalized
  deterministic schema-only dumps, and proceeds to committed apply/smoke/
  concurrency only after exact restoration.
- The bot E2E now proves last-message actor identity, preview and unread count
  in the chat list before opening a chat, including both mobile viewports.

TDD red evidence:

- The schema contract initially failed because deleted-bot masked search identity
  and raw avatar sanitization were absent.
- The PostgreSQL smoke initially failed on a malicious raw notification avatar.
- The desktop adapter tests initially failed because the legacy bridge retry was
  absent; a later near-match test (`iconography`) failed until the unknown-field
  matcher was made exact.
- The runner boundary test initially failed because no rollback rehearsal command
  was issued.
- The new chat-list E2E initially failed because the bot actor label was absent
  even though the preview and unread count were present.

Final fix-round verification:

- `node --test tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-message-projection.test.mts tests/unit/bot-notification-projection.test.mts tests/unit/bot-client-integration-contract.test.mjs tests/unit/bot-pg-smoke-runner.test.mjs tests/unit/message-history-anchoring.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/desktop-notification-adapter.test.mts tests/unit/fcm-delivery.test.mjs tests/unit/web-push-delivery.test.mjs tests/unit/wns-delivery.test.mjs`
  - exit `0`; 99/99 passed.
- all `bot-*.test.mjs|mts` files under `tests/unit` and `tests/security`
  - exit `0`; 147/147 passed.
- `pnpm.cmd --filter @workspace/kub run typecheck`
  - exit `0`.
- `pnpm.cmd db:types:check`
  - exit `0`; 12 tables, 9 public RPCs and 54 private RPC names checked.
- `node tests/rls/bot-chat-search-notification-smoke.mjs`
  - exit `0` on PostgreSQL 17.0; rollback rehearsal restored the schema before
    fresh committed apply, smoke and concurrency checks; final marker
    `bot_chat_search_notification_smoke_ok|170011|0`.
- `pnpm.cmd exec playwright test tests/e2e/bot-chat-integration.spec.ts`
  - exit `0`; 18 passed and 2 intentional mobile skips across desktop 1440,
    1920 and 3840 plus mobile 390 and 412 projects.
- `pnpm.cmd --filter @workspace/kub run build` with local non-secret QA public
  configuration
  - exit `0`; existing sourcemap, mixed static/dynamic import and chunk-size
    warnings remain.

No production SQL, deploy or push was performed. No PWA, service-worker or
Apple-specific file was edited. Legacy mutation-backed canary specs remain
unchanged for their authoritative Task 7 post-apply run.
