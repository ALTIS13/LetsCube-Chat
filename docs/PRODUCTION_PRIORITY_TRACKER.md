# LETSCUBE Production Priority Tracker

Status: active production-hardening tracker, updated 2026-08-01.

This file is the working source of truth for the next production stages. Before starting any new production task, read this file first, then update the relevant checkboxes/status when work is completed, blocked, or intentionally deferred.

Execution ownership:

- This tracker/chat owns the shared backend and web interface plus Windows and Android applications.
- iPhone/iPad PWA implementation and physical QA are owned by a separate agent. Do not modify or repeat that work from this execution stream; only consume its committed `main` baseline after checking `git status` and `git log`.

Legend:

- `[x]` done and covered by regression checks.
- `[~]` active stage.
- `[ ]` pending.
- `[!]` blocked or deferred by an external dependency.

## Current Execution Order

1. `[x]` Priority 1 - Auth and anti-abuse baseline.
2. `[x]` Priority 2 - RLS and security audit baseline.
3. `[!]` Priority 3 - Backup and restore drill follow-ups.
4. `[x]` Priority 4 - Operator security observability.
5. `[~]` Priority 5 - Installed web/PWA production shell. iPhone/iPad-specific implementation and QA are externally owned.
6. `[!]` Priority 6 - Monitoring and self-hosted Sentry.
7. `[~]` Native/mobile packaging resumed: Windows Tauri secure startup and signed updater are complete; Android release signing and the remaining platform release gates stay active.

## Next Execution Queue

Use this queue before starting the next production-hardening turn. Do not repeat completed items unless a new bug report or regression test proves the old fix is insufficient.

1. `[x]` Fix Coolify worker auto-deploy gap so `letscube-worker` updates automatically when worker/backend code changes. Verified on 2026-06-23: push `56ac76e` created worker deployment `l9ca22g6e83fkn2psv6cc8lx` with `is_webhook=true` and status `finished`. Worker `watch_paths` now limit deploys to `artifacts/api-server`, Docker/deploy files and workspace dependency manifests so docs-only commits do not redeploy the worker. GitHub Actions are intentionally disabled and workflow files were removed; Coolify webhooks are the deployment path.
2. `[~]` Continue chat performance audit and synchronization hardening. Current known findings:
   - `[x]` Composer text is cleared immediately after optimistic send instead of waiting for delivery/read checks.
   - `[x]` Fully read chat opens anchored to latest messages.
   - `[x]` Chat with unread messages opens near the first unread boundary.
   - `[x]` Chat info media gallery uses generated variants instead of original media files for tiles.
   - `[x]` Reproduce and fix fast upward history scrolling bug: when the user quickly scrolls up through older messages, the message list no longer jumps back to the newest/bottom position during initial bottom settling.
   - `[x]` Prevent older-history auto-prepend from racing initial chat open anchoring: the top-of-list loader is disabled until the initial unread/bottom scroll has been applied, so read chats do not silently open on an older slice.
   - `[x]` Keep the sent message visible in the sidebar immediately through the optimistic store update and reconcile it with the realtime echo by `client_message_id` (`a458cd9`).
   - `[x]` Reopen a recently visited PWA chat from cached messages without an empty loading loop, then reconcile in the background (`f2c6673`).
   - `[x]` Hydrate chat/sender metadata before completing push navigation so a slow PWA resume does not stay on the generic `Чат` fallback (`f2c6673`).
   - `[x]` Add proposal-only batched sidebar summaries RPC and a frontend compatibility path. The RPC reduces last-message/unread loading from approximately `2 + 3N` requests to three batch requests while remaining `SECURITY INVOKER` and RLS-aware.
   - `[x]` Applied `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql` manually on 2026-07-09 after a verified full database backup. All 10 users with chat memberships matched the legacy unread/preview semantics, anonymous RPC access is denied, authenticated REST and production frontend calls return `200`, and `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` is active in the healthy web deployment.
   - `[x]` Measured the active batch RPC and large-history rendering in production on 2026-07-10 with `owner`, `tech_admin`, `location_staff` and `client` QA accounts at 1440x900 and 390x844. For the 246-message history, cold sidebar readiness was 505-564 ms, summary RPC was 47-55 ms, first 100 messages rendered in 452-467 ms, and warm reopen was 174-200 ms. Loading the remaining 146 messages took two 642-757 ms prepend pages without returning to the bottom; scroll-anchor error was 0 px desktop and at most 42 px mobile.
   - `[x]` Replaced the startup permission fan-out with one authenticated access snapshot. `.migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql` was applied manually on 2026-07-11 after verified backup `/srv/letscube/backups/pre-migrations/20260711-105607-before-access-snapshot.dump`. Full parity covered all 12 profiles with zero global-role, global-permission or location-permission mismatches. `anon` has no execute grant, `authenticated` does. `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1` is active in production; live Playwright observed exactly one `current_user_access_snapshot` request and zero legacy `has_permission`, `has_location_permission` or `has_global_role` requests.
3. `[x]` Add a bounded 720p video transcode worker path and upload/playback quality selection. The trusted worker now creates H.264/AAC MP4 variants at up to 1280x720 without upscaling, with two ffmpeg threads and a ten-minute timeout. A production-runtime benchmark converted a 10-second 1080p/9 MB sample to approximately 1 MB in 1.55 seconds; landscape, portrait, audio and no-upscale contracts passed. Compact/standard playback prefers the ready 720p derivative, high quality and explicit original-file opening keep the original. Existing originals are retained. Production backfill is complete for all 26 non-deleted videos with a valid Storage source; five older videos initially outside the newest 120 media rows were recovered after adding bounded pagination.
4. `[x]` Added hybrid media upload progress, retry and current-session resume. Files above 6 MiB use TUS with exact 6 MiB chunks and bounded retries; smaller files keep the standard Storage path. Cancellation terminates partial uploads, retry keeps a stable object path, and chat/composer scopes prevent delayed files, recordings, location results or failed captions from crossing into another chat. A disposable 7 MiB production object was uploaded, read back at the exact size and deleted.
5. `[!]` Keep iPhone/iPad Home Screen as the only PWA install target. Android browsers use the APK catalog and Windows browsers use the EXE catalog. Further iPhone/iPad PWA implementation and physical QA are owned by a separate agent and are out of scope for this execution stream.
6. `[!]` Keep monitoring/Sentry and backup restore rehearsal deferred until the user confirms the backup environment and restore-test window.
7. `[~]` Complete the Capacitor Android release candidate. LETSCUBE `0.1.0` production-configured debug APK is published through the self-hosted release catalog with verified size/SHA parity. Remaining: release signing/AAB, app links/recovery callback and broader signed-package QA.
8. `[x]` Replace the retired Electron spike with a clean-profile Tauri 2 Windows client. The one-window secure startup, tray/single-instance behavior, Stable/Test channels and signed Tauri updater are complete. Physical `0.2.0 -> 0.2.1`, `0.2.1 -> 0.2.2` and `0.2.2 -> 0.2.3` production-update rehearsals passed. A successful version change shows a compact four-second confirmation and then frees the top-right area for future call controls.
9. `[~]` Complete the external Windows release gates. LETSCUBE `0.2.7/11` replaces the failed generic notification plugin path with exact-origin native Windows toast/history/action commands. Physical QA confirms one stable Toast Header per chat, up to five unread message cards, exact per-message routing from both fresh and historical cards, independent routing for other chats, and chat-scoped history removal after reading. Sender duplication was removed by keeping the sender/chat name only in the native header. The physically tested immutable artifact was verified in Test and then promoted unchanged to Stable. A fail-closed Authenticode path, provider-isolated WNS sender, sanitized Windows matrix and native offline/long-session suite are prepared. A second fail-closed tool now validates Microsoft package metadata, requires the exact PFN in its generated client contract, reports all missing metadata in one pass, renders matching sparse-package/executable manifests and builds a local unsigned `MakeAppx` validation artifact without changing the internal NSIS path. The live Supabase schema was audited read-only and the `windows/wns` proposal passed a production-schema transaction rehearsal with full rollback; it remains unapplied until a real identified client can acquire a WNS channel. Remaining external work is the real Microsoft package identity/publisher/PFN/Entra mapping, production signing and SmartScreen reputation, Windows 10 and alternate WebView2 device runs, Windows App SDK channel/COM registration, proposal application, server secrets and true killed-process physical delivery.
10. `[x]` Harden direct-email support notifications. New inbound email tickets now create the same PII-free `ticket_created` event as web tickets, eligible pool operators receive one creation notification, and later requester replies notify the pool while the ticket remains unassigned. The first email message does not create a duplicate requester notification. The production migration was applied after a verified dump and passed a transactional live-DB fanout smoke.
11. `[x]` Improve global search for messages and people. The existing full-history message RPC remains active and measured an average 33.221 ms over 20 runs in the current largest 236-message chat. Exact verified-phone lookup now accepts only an explicit complete `+E.164` query, requires `users.view`, returns a profile-only projection, caps results at 10 and grants execution only to `authenticated`. It never returns the phone field or queries `profile_contacts` from the frontend. Migration `20260801112259_privacy_safe_phone_search.sql` was applied after backup `/srv/letscube/backups/pre-migrations/20260801-113105-before-privacy-safe-phone-search.dump` and passed production transaction rehearsal plus post-apply authorization smoke. Production currently has no verified phone contacts, so real phone results remain empty until SMS/OTP verification is configured and completed.

## Last Confirmed Deploy Baseline

- Production web baseline: `d53e7f26b55782eef9c287d66b48aa88a6fde759` (privacy-safe verified-phone profile search over the native Windows foreground, toast grouping, pending action route and read-history lifecycle baseline). The stable startup geometry, transient update confirmation and cryptographically verified publisher remain included from their earlier baselines.
- Coolify app: `letscube-web`.
- Public app: `https://app.letscube.ru`.
- Auto deploy: GitHub webhook to Coolify is active for `letscube-web`; deployment `o5kpnw78lx42yefr3qxnkhvj` completed exact commit `d53e7f26b55782eef9c287d66b48aa88a6fde759` with `is_webhook=true`, passed its healthcheck and completed the rolling update. The chat-summary and access-snapshot RPC build flags remain enabled.
- Worker auto deploy: worker-specific GitHub webhook is verified. Deployment `hjlbhqir375ia6wzmqarhswq` completed exact commit `8d20b89645b9471b4477a8566a5d23ff5cfc9027` with `is_webhook=true`, status `finished` and a healthy `/api/healthz` check. Worker `watch_paths` remain limited to worker/build/runtime paths and shared package manifests. GitHub Actions are intentionally disabled and repo workflow files/secrets were removed to avoid billing-lock email noise.
- Self-host stack: Coolify proxy, self-hosted Supabase, Mailcow, app and worker deployment are already in place.
- Support mail bridge: MX/SPF/DKIM/DMARC passed on authoritative and public
  resolvers. The non-public `letscube-support-mail` worker is enabled and
  healthy after verified backup
  `/srv/letscube/backups/automated/20260729-134340`. A real outbox delivery was
  accepted by Gmail MX and external receipt was confirmed. Commit `8c1f5fa`
  fixed the IMAP fetch/flag deadlock found by the first reply; production is
  restart-free after the repair. The manually seeded QA contact HMAC was
  corrected. A second physical reply was attached to the same ticket exactly
  once, acknowledged in Mailcow and displayed in the production operator UI
  without console/network errors, completing bidirectional acceptance. A
  dedicated GitHub push webhook was added for this resource, passed its initial
  ping and has auto deploy enabled; the next matching support-mail source push
  still needs to prove a deployment with `is_webhook=true`.
- Support notification fanout: migration
  `.migration-backup/supabase/migrations/20260801100856_support_email_pool_notifications.sql`
  is active after verified backup
  `/srv/letscube/backups/pre-migrations/20260801-101035-before-support-email-pool-notifications.dump`.
  The production DB smoke covers creation fanout, first-message dedupe and
  later unassigned requester replies inside `BEGIN ... ROLLBACK`. Client roles
  cannot execute the internal trigger helper. No support-mail source changed in
  this stage, so a webhook deployment was intentionally not manufactured.
- Production domains verified on 2026-07-09: `app.letscube.ru`, `deploy.letscube.ru`, `core.letscube.ru`, `mailserver.letscube.ru`, `notify.letscube.ru`, and SSH host `ms.letscube.ru` resolve and expose their expected services with valid TLS where applicable.
- `api.letscube.ru` now serves the read-only native release catalog with valid TLS through Coolify application `letscube-releases`; `status.letscube.ru` and `monitor.letscube.ru` remain reserved future endpoints.
- The installed Supabase MCP connector still targets the legacy cloud project. Production self-host checks must use `core.letscube.ru`, the local secret-safe env file, or read-only SSH/database inspection.

## Completed Baseline - Do Not Rebuild Without A New Finding

- `[x]` Self-host migration foundation: app, Supabase, Storage/media, mail delivery, and Coolify deployment moved to the server.
- `[x]` Docker subnet conflict with hoster gateway identified and avoided by custom Docker address pools.
- `[x]` Mail delivery baseline: Mailcow DNS, DKIM, PTR, external smoke, Supabase recovery email delivery and branded recovery template.
- `[x]` Auth copy: signup and recovery messages are generic and do not reveal account existence.
- `[x]` Password recovery route and UI flow work with self-hosted mail.
- `[x]` Existing-account signup cannot be used to obtain access to an existing user account.
- `[x]` Yandex SmartCaptcha gateway protects signup and recovery.
- `[x]` Direct public signup/recovery bypass paths are blocked at the proxy layer.
- `[x]` Auth gateway has in-function rate limiting before CAPTCHA/Auth calls.
- `[x]` Login token endpoint HTTP 429 maps to friendly Russian UI copy.
- `[x]` Invite code/link flow exists, with invite-only mode controlled from the admin panel.
- `[x]` Invite code field is hidden when invite-only mode is off; preconfigured invite links apply role/club in the background.
- `[x]` Reserved admin-like usernames are blocked for non-admin users.
- `[x]` RLS smoke and anon REST probes exist and cover authenticated/anonymous boundaries.
- `[x]` Group invite non-member hardening proposal was applied manually after explicit approval.
- `[x]` Notification center tabs and grouping are in place.
- `[x]` Message notification read-sync/grouping baseline is in place.
- `[x]` Chat scroll anchoring baseline: no unread -> bottom, unread -> first unread, search/notification jumps preserved.
- `[x]` LETSCUBE visual cleanup: auth branding, duplicate sidebar logo, mascot placement, and visible KUB/KUB text cleanup are done.

## Priority 1 - Auth And Anti-Abuse

Status: `[x]` baseline complete. Keep as regression guard.

Goal: public auth endpoints must not allow bot signup, password guessing, recovery abuse, or CAPTCHA bypass.

Definition of done:

- `[x]` Signup and recovery go through the Yandex SmartCaptcha auth gateway in the public app.
- `[x]` Direct public bypass paths to sensitive Supabase Auth endpoints are blocked or rate limited at the proxy layer.
- `[x]` Login, signup, recovery, verify, resend and token endpoints have server-side throttling or gateway protections.
- `[x]` User-facing auth errors do not reveal whether an account exists.
- `[x]` Existing users cannot obtain a session through the registration screen.
- `[x]` 429/rate-limit errors map to friendly Russian UI copy.
- `[x]` Auth abuse checks have repeatable smoke tests and operational verification commands.

Keep checking:

- `[ ]` Run gateway/no-direct-auth Playwright checks when CAPTCHA env is enabled.
- `[ ]` Add an operator-facing auth anti-abuse smoke script if repeated manual curl checks become noisy.
- `[ ]` Revisit stronger account creation controls only if abuse continues despite CAPTCHA/rate limits/invite mode.

## Priority 2 - RLS And Security Audit

Status: `[x]` baseline complete. Keep as regression guard.

Goal: authenticated users can only read/write rows, objects and RPC effects allowed by membership, role, location and task permissions.

Definition of done:

- `[x]` All inspected exposed public tables have RLS enabled.
- `[x]` Public views are absent or use `security_invoker` / restricted grants.
- `[x]` Anonymous REST exposure checks exist.
- `[x]` Authenticated role boundary checks exist.
- `[x]` Storage policies for media, avatars and task attachments are path-scoped and role-aware.
- `[x]` SECURITY DEFINER function hardening is tracked through proposals when needed.

Keep checking:

- `[ ]` Run `pnpm.cmd rls:anon-rest` in security-stage validation.
- `[ ]` Run `pnpm.cmd rls:smoke` in security-stage validation.
- `[ ]` Run `KUB_QA_ALLOW_MUTATIONS=1 pnpm.cmd rls:smoke` only when mutation fixture validation is needed.
- `[ ]` Create new SQL proposals only for concrete drift or a verified gap.

## Priority 3 - Backup And Restore Drill

Status: `[!]` follow-ups deferred by user on 2026-06-22.

Goal: a full LETSCUBE production restore must be executable from backups without relying on memory or ad hoc commands.

Guardrails:

- No SQL changes in this stage unless explicitly requested.
- No restore into production.
- No destructive remote cleanup during inventory.
- No env, token, database password, SMTP password, or secret contents in repo/docs/logs.
- Restore rehearsal must use an isolated temporary target.

Definition of done:

- `[x]` P3.1 Read current backup status and runbooks before making changes.
- `[x]` P3.2 Record read-only live inventory: backup directories, scripts, timers, cron, Docker volumes, Supabase/Mailcow/Coolify config locations.
- `[x]` P3.3 Confirm Postgres logical backup command and retention policy.
- `[x]` P3.4 Confirm Supabase Storage/media backup command and retention policy.
- `[x]` P3.5 Confirm Coolify, Mailcow, Caddy, Supabase compose/env/config, and ops docs are backed up without exposing secret values.
- `[x]` P3.6 Add or update backup scripts only if missing, idempotent, and secret-safe. Existing scripts are present; no script update was needed during this inventory pass.
- `[x]` P3.7 Run non-destructive backup verification: archive listing, metadata checks, row/object counts where safe.
- `[!]` P3.8 Prepare isolated restore target plan and get explicit approval before any restore. Deferred.
- `[!]` P3.9 Rehearse restore into isolated target. Deferred.
- `[!]` P3.10 Verify restore: row counts, key tables, Storage object counts, basic app smoke. Deferred.
- `[x]` P3.11 Decide and document temporary off-server/offsite backup destination. Temporary target is a private GitHub repository with client-side encrypted chunks; permanent backup storage remains a later replacement.

Current baseline:

- Infrastructure docs describe backup/restore expectations.
- Self-host migration placed operational files under `/srv/letscube`.
- Server backup inventory and non-destructive verification are recorded in `docs/infra/BACKUP_RESTORE_STATUS_20260622.md`.
- Latest verified local backup set: `/srv/letscube/backups/automated/20260622-034450`.
- Latest backup checksum verification: passed.
- Temporary GitHub offsite backup is configured and encrypted before upload.
- GitHub offsite target: private repository `ALTIS13/letscube-encrypted-backups`.
- Server upload script: `/srv/letscube/scripts/letscube-github-offsite-backup.sh`.
- Server timer: `letscube-github-offsite-backup.timer`.
- Latest controlled GitHub offsite sync: completed for `/srv/letscube/backups/automated/20260622-034450`.

Next action:

- `[!]` Monitor the first scheduled GitHub offsite timer run on 2026-06-23. Deferred by user.
- `[!]` Replace temporary GitHub storage with a dedicated backup target (`rclone`, `restic`, or `borg`) when available. Deferred until backup environment is ready.
- `[!]` Prepare an isolated restore target plan and get explicit approval before any restore. Deferred.

## Priority 4 - Operator Security Observability

Status: `[x]` baseline complete. Keep as regression guard.

Goal: make auth abuse, invite-code abuse, and suspicious registration/login patterns visible to operators without leaking sensitive data.

Candidate work:

- `[x]` Add or document an operator smoke command for auth gateway rate limits and direct-auth bypass checks.
- `[x]` Add an admin-facing or ops-facing view/report for recent auth/invite security aggregates if product-safe.
- `[x]` Ensure reports do not show raw secrets, passwords, CAPTCHA tokens, recovery tokens, or full IP data unless explicitly approved.
- `[x]` Keep this separate from CAPTCHA/rate-limit implementation unless new gaps are found.

Current baseline:

- Operator smoke script: `scripts/auth-anti-abuse-smoke.mjs`.
- Package command: `pnpm.cmd auth:anti-abuse:smoke`.
- Runbook: `docs/security/AUTH_OPERATOR_SMOKE.md`.
- Default smoke checks direct `/auth/v1/signup` and `/auth/v1/recover` protection without creating users.
- Default smoke checks `auth-yandex-gateway` signup/recovery no-CAPTCHA handling.
- Repeated gateway rate-limit stress is opt-in through `--stress-rate-limit` or `KUB_AUTH_SMOKE_STRESS_RATE_LIMIT=1`.
- 2026-06-22 live smoke result: direct signup/recovery returned 403, gateway no-CAPTCHA returned `captcha_required`, opt-in stress observed 429 `rate_limited` on repeated gateway attempts.
- Admin/Ops report UI: `/admin/ops`.
- Admin/Ops report runbook: `docs/security/ADMIN_OPS_REPORT.md`.
- Admin/Ops report SQL proposal: `.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql`.
- SQL was not applied automatically. Until the RPC is applied, `/admin/ops` shows a friendly migration warning and still displays frontend protection status.
- The report intentionally returns aggregate counts and sanitized invite/auth event labels only; it does not show email, IP, password, CAPTCHA/recovery/push tokens, actor IDs, or target IDs.

## Priority 5 - Installed Web/PWA Production Shell

Status: `[~]` active. The iOS-only install policy and Android/Windows release catalogs are deployed. iPhone/iPad-specific implementation and physical QA are owned by a separate agent and must not be duplicated here.

Goal: retain the full browser client on every platform, expose PWA installation only on iPhone/iPad, and direct Android/Windows users to dedicated native packages.

Scope:

- `[x]` Refresh PWA shell identity: document title, Apple app title, manifest name/short name and install metadata use `LETSCUBE`.
- `[x]` Add platform-aware Settings distribution state: iPhone/iPad PWA, Android APK and Windows EXE. Android/Windows no longer render a PWA CTA or receive a manifest link.
- `[x]` Add a five-second, six-hour cached release check with stale fallback, strict manifest/SemVer/SHA validation and honest system download handoff without fake byte progress.
- `[x]` Deploy read-only `https://api.letscube.ru/releases/` through non-root Nginx/Coolify with SSH-only atomic publishing, CORS, no-cache manifests and immutable artifacts.
- `[x]` Verify PWA manifest, service worker registration, offline/reconnect banner and direct app-shell routes across desktop/mobile Playwright viewports.
- `[x]` Verify browser/PWA push contract: stable notification tags, same-tag close behavior, click routing, and no raw media/token fields in SW payload handling.
- `[x]` Harden browser/PWA push lifecycle: reconcile subscriptions on startup/focus/reconnect, detect stale VAPID keys, close read same-tag cards on active clients, update the installed-app badge, and preserve DB `read_at` as the cross-device source of truth.
- `[x]` Add Web Push `Topic` isolation and a backward-compatible Declarative Web Push fallback for iOS/iPadOS 18.4+ without changing Browser/PWA subscription semantics.
- `[x]` Remove the dual-dispatcher race: Supabase Cron/`send-push-notifications` owns production Web/FCM delivery; the legacy API push loop is off by default and cannot consume the same outbox unless explicitly enabled for isolated local testing.
- `[ ]` Verify the installed iPhone/iPad Home Screen window without browser chrome.
- `[ ]` Verify real browser/PWA push delivery and notification click routing against a live installed client.
- `[x]` Verify automated iOS manifest injection and confirm Android/Windows browsers are not offered PWA installation across all five Playwright viewports.
- `[ ]` Preserve full messenger functionality: auth, chats, media, camera, voice, video-circle, tasks, search, notifications.
- `[x]` Keep release signing material out of Git; the published `0.1.0` APK is explicitly internal/debug until signed release packaging is completed.

Current baseline:

- `artifacts/kub/index.html` title and Apple web app title are `LETSCUBE`.
- `artifacts/kub/public/manifest.json` uses `LETSCUBE`, `display: standalone`, and `display_override` fallbacks.
- The iPhone home-screen icon uses a dedicated 180x180 LETSCUBE club asset; 192/512/maskable PWA icons use the same official mark, and the service worker precaches the complete icon set.
- Settings distribution block shows `iPhone/iPad / iOS PWA`, `Android APK`, `Windows EXE` or web-only status. Native manifests refresh on Settings open/resume without blocking app startup.
- The Windows stable download catalog and both Tauri updater channels now offer LETSCUBE `0.2.7` build `11`. Test was verified first, then the exact same immutable 2,318,468-byte installer and adjacent updater signature were promoted to Stable. Public manifests and fresh artifact downloads agree on SHA-256 `408c238d0eae67471c6fb9b8ae95a1c9bb54640912883d86d7ae390a414d65e1`; manifests are non-cacheable and versioned artifacts are immutable. The production handoff keeps one fixed scene across navigation, remains readable for at least 2.2 seconds and holds the confirmed state for at least 0.9 seconds before fading. Explicit client/server ports bound the two rail halves outside both device bodies, and font loading or the connected state cannot change endpoint geometry.
- `letscube-releases` deployment `x11jjzh6qbcnszndx5av5paj` finished exact commit `491e172`; TLS/health, 404 listing denial, POST denial, CORS/cache headers and Android artifact size/SHA parity passed.
- `tests/e2e/pwa.spec.ts` covers PWA shell metadata, service worker safety, offline/reconnect banner, and SPA direct routes on 1440, 1920, 3840, 390 and 412 viewports.
- `tests/e2e/pwa-install-settings.spec.ts` covers desktop install variant and iPhone Safari home-screen guidance from the Settings install button.
- `tests/e2e/push-phone-foundation.spec.ts` covers push settings layout, phone fallback, SW push grouping/click-routing, native push adapter token hygiene and Android channels on the same viewport matrix.
- 2026-07-12 production audit found one Apple subscription stale since 2026-06-22 and historical HTTP 403 delivery failures. A live probe proved two consumers were racing one outbox: the legacy five-second API worker failed with sanitized Apple `BadJwtToken`, while the canonical Edge cron subsequently delivered the same row. The API loop is now opt-in only; current web/Edge VAPID fingerprints match and the VAPID keypair is valid.
- A post-deploy Apple Web Push probe completed through the canonical Edge cron with `attempt_count=0` and no delivery error. The QA notification and outbox rows were removed afterward; physical iPhone background/card/tap confirmation remains the release gate.
- Same-chat OS push replacement is intentional: the latest card represents that chat. Different chats/tasks remain isolated by tag and hashed Web Push Topic; the in-app Notification Center retains grouped semantic rows and unread counts.
- Client-side chat media optimization baseline is in place: new image attachments and avatars are bounded before upload when possible; new image/video messages carry dimensions/size metadata for stable bubble layout.
- The trusted media worker now produces bounded `video_720p` MP4 derivatives. Frontend quality metadata is explicit for new image/video messages; compact/standard video playback uses a ready derivative and safely falls back to the original while high quality always uses the original.

Next media/performance action:

- `[~]` Media variants pipeline:
  - `[x]` Applied `.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql` to self-host Postgres after a schema backup.
  - `[x]` Added optional server-side `kub-worker` runtime target/service for trusted media processing; frontend still receives no service-role secrets.
  - `[x]` Added image message variants (`image_thumb`, `image_preview`) and user avatar variants (`avatar_128`, `avatar_256`) generation through `artifacts/api-server`.
  - `[x]` Wired frontend read path to prefer ready message image variants and user avatar variants over original media where available. Avatar variants for chat peers need manual application of `.migration-backup/supabase/migrations/20260623_avatar_variants_read_policy.sql`.
  - `[x]` Raised self-host Supabase Storage upload size for `supabase-storage` to 250 MB and verified a 60 MB object upload/delete through the Storage API.
  - `[x]` Added server-side video poster generation (`video_poster`) through the trusted worker and wired chat video bubbles to use ready posters.
  - `[x]` Wired chat info media gallery to use ready image/video variants for tiles instead of loading original media files.
  - `[x]` Reproduced and fixed fast upward scroll jump in long chat history: user wheel/touch/pointer input now cancels initial bottom settling so quick upward scrolling is preserved.
  - `[x]` Added bounded `video_720p` transcoding and upload/playback quality selection. The worker uses H.264/AAC MP4, maximum 1280x720, preserved aspect ratio, no upscaling, even dimensions, `yuv420p`, fast-start, two ffmpeg threads, and a ten-minute timeout. The frontend polls only chats containing video, coalesces focus/visibility refreshes, bounds its chat cache, and falls back once to the original if a derivative cannot load. The candidate scan now paginates through a bounded 1,200-row window instead of starving media older than the newest 120 rows. Production contains 26 ready DB rows and 26 matching Storage objects (32,522,253 bytes), with zero invalid ready dimensions/MIME/size; two legacy video rows have no Storage source and cannot be derived.
  - `[x]` Added a hybrid Storage upload path: standard uploads through 6 MiB and TUS above 6 MiB with exact 6 MiB chunks, retry delays `0/3/5/10/20s`, previous-upload resume in the current staged session, determinate progress, stable object paths and remote partial termination on cancel. Cross-chat scopes now cover picker/image preparation, upload/send, drafts, geolocation and voice/video recorder completion. Browser QA exercised progress/cancel on all five configured viewports, and production TUS uploaded/read/deleted a 7 MiB disposable object.

## Priority 6 - Monitoring And Self-Hosted Sentry

Status: `[!]` deferred until backup/restore baseline is safe.

Goal: add production monitoring without relying on foreign unstable SaaS paths.

Candidate work:

- `[ ]` Deploy self-hosted Sentry or a lighter local monitoring alternative.
- `[ ]` Verify error capture from frontend and Edge Functions without secrets/message content/media URLs.
- `[ ]` Add uptime and synthetic checks for app, Supabase, mail, and Coolify.
- `[ ]` Add backup job failure alerts.

## Native And Desktop Packaging

Status: `[~]` active. Android and Windows Tauri internal candidates are available; production signing and update gates remain open.

- `[x]` Production debug APK connection and physical launch: the public build allowlist, LETSCUBE adaptive icons/dark splash, Android `0.1.0` versioning, install and first launch were verified on a Nothing/Spacewar A063 running Android 15.
- `[x]` Native Android FCM foundation: local ignored Firebase client config, Capacitor permission/registration/channels, live auth-scoped device RPCs, RLS-protected device/outbox schema, trusted HTTP v1 delivery and one physical background notification/tap smoke are complete.
- `[x]` Self-hosted native release catalog: Android `0.1.0` internal APK and immutable Windows Tauri `0.2.0` build `4` NSIS are available at `api.letscube.ru`; public size/SHA and cache/CORS headers were verified.
- `[~]` Native push release QA: real owner-to-client message delivery, sender exclusion, category preference suppression, same-chat collapse, server-backed chat read-sync, cold-start tap routing, killed-process delivery, separate task delivery, location-staff task routing, restart registration recovery and Android 16 Google Play emulator coverage pass. A second Android 15 Realme device passes APK/portrait UI QA, but its custom-ROM microG cannot complete Google Check-in (`AccountDisabled`); broader FCM coverage still needs another device with official Google Play Services.
- `[ ]` Release signing/AAB with secrets outside Git.
- `[ ]` Android deep links/app links and recovery callback.
- `[x]` Retire the Electron spike after QA profile leakage and excessive package weight were confirmed. Electron source, installed package and shared QA profile were removed before publishing Tauri.
- `[x]` Tauri 2 internal candidate: isolated WebView2 profile, 1.19 MiB NSIS installer, tray/close-to-hide, branded startup, single instance, minimum exact-origin capabilities, clean-profile login and hidden-window foreground notifications.
- `[x]` Tauri rollout: frontend adapter deployed, clean installed-client QA repeated, and immutable Windows stable `0.2.0` build `4` published at 1,242,693 bytes with verified SHA-256.
- `[~]` Windows public release gate: repeatable isolated Tauri/WebView2 QA, same-version repair, silent uninstall, clean reinstall and real signed cross-version updater application pass. `0.2.7/11` passes physical hidden-window message/task isolation, five-card per-chat retention, exact fresh/history notification-card routing and chat-scoped read cleanup. Its immutable signed updater artifact was verified in Test and promoted unchanged to Stable. Sparse identity tooling now renders aligned package/executable metadata and passes `MakeAppx` validation locally. The live native-device schema is still Android/FCM-only; `.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql` is a contract-tested, unapplied delta for authenticated Windows/WNS registration and shared native outbox enqueue. Real Microsoft identity/PFN onboarding, signed NSIS integration, Authenticode/SmartScreen, broader Windows 10/11 hardware QA and killed-process WNS delivery remain open.
- `[~]` SMS provider rollout is in controlled pilot preparation. Global availability, cutoff and data-access enforcement remain disabled; one explicit server-side allowlist account is used for physical OTP QA.
- `[x]` Harden the existing LETSCUBE support conversations before adding another support transport: deterministic initial bottom position, preserved history reading, new-message affordance, responsive height cleanup and Playwright coverage. The shared anchor observes both content and viewport resizes; the final matrix passed 30/30 across all five desktop/mobile viewports.
- `[ ]` Add a separate staff-only LANGAME support workspace after the current support UX is stable. Their official documentation exposes the authenticated individual `Чат ТП` but no public integration API; require an official API/SSO contract or use a clearly separate email bridge rather than scraping the portal.

## Next Phone Verification Rollout

Status: `[~]` production search is complete; SMS-first p1sms delivery and physical OTP QA are next.

- Keep the current no-fake-verification fallback and never mark a number verified before a real OTP succeeds.
- `[x]` Privacy-safe exact phone search is deployed through `search_profiles_by_phone(text, integer)`. It accepts only normalized `+E.164`, requires `users.view`, returns profile fields without the phone number, and includes only `phone_verified = true` contacts.
- `[x]` The profile flow already uses `auth.updateUser({ phone })`, `verifyOtp(..., type: "phone_change")`, and `profile_phone_mark_verified()`. The database RPC re-checks `auth.users.phone_confirmed_at`, so the client cannot mark a number verified directly.
- `[x]` 2026-08-01 production audit: Supabase Auth `v2.189.0`, phone provider disabled, SMS autoconfirm disabled, Send SMS Hook not configured, zero verified phone contacts, and zero pending/duplicate/stale `phone_change` rows.
- `[x]` Delivery architecture selected: Supabase Auth HTTP Send SMS Hook -> server-side LETSCUBE adapter -> p1sms. Supabase Auth remains responsible for OTP generation and verification.
- `[x]` p1sms source foundation: strict 46-character template, hard 65-character guard, one immediate `digit` message per request, provider-managed `not_delivered` fallback to Telegram, `letscube-otp` tag, redirect blocking, Standard Webhooks verification, deployed GoTrue digits-only `sms.phone` normalization with guarded legacy fallback, HMAC claim checks, concurrent-retry idempotency, per-user/per-phone server ceilings and safe result categories. LETSCUBE neither manages cascade schemes nor retries the provider request. It is deployed for an explicit expiring pilot allowlist; automated validation makes no real delivery request.
- `[~]` Provider activation: deploy only `P1SMS_API_KEY` and hook/HMAC secrets to trusted server storage for the allowlisted physical test. Keep the shared LETSCUBE account isolated by never calling p1sms account, sender, history, scheduling, reject, phone-base or blacklist APIs.
- `[~]` Review, rehearse and apply `.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql` after a current backup. Global policy, cutoff and enforcement defaults remain off; pilot access is a separate live data row and is not committed.
- `[x]` Configure `GOTRUE_EXTERNAL_PHONE_ENABLED`, `GOTRUE_HOOK_SEND_SMS_ENABLED`, hook URI and hook secret in the self-hosted Auth runtime; SMS autoconfirm remains disabled.
- `[~]` Use the dedicated `auth.resend({ type: "phone_change" })` path for resend, preserve the 60-second UI/Auth cooldown and server-side per-user/per-phone limits. Broader CAPTCHA/cost alerting remains a global-rollout gate.
- `[ ]` Guard the Supabase `phone_change` ambiguity documented in July 2026: reject concurrent pending claims for the same normalized phone and clear stale abandoned `phone_change` values on a bounded schedule before enabling production OTP.
- Decide separately where verified phone is required: profile contact, account recovery, sensitive admin actions, or optional MFA. Do not silently require phone verification for existing users without a migration and rollout plan.
- `[ ]` Complete real-device delivery QA for correct/wrong/expired/resend codes, provider outage, duplicate-number attempts, number changes, audit events, privacy-safe phone search, and recovery/MFA decisions before enabling enforcement.

The browser client remains the universal fallback and iPhone/iPad PWA remains the only web-installed target until Android and Windows release gates pass. Packaging must reuse the same validated frontend and may not weaken browser behavior.

## Default Validation Commands

Run only the commands relevant to the touched area, but prefer this baseline before commit/push:

- `git diff --check`
- `pnpm.cmd --filter @workspace/kub run typecheck`
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`
- `pnpm.cmd e2e:smoke` when frontend behavior changed.
- `pnpm.cmd db:types:check` when schema/types/database code changed.
- `pnpm.cmd rls:anon-rest` and `pnpm.cmd rls:smoke` during RLS/security stages.

Known validation notes:

- Vite sourcemap/chunk-size warnings may exist and are not automatically blocking unless new.
- `db:types:check` may report known advisory drift around message media fields/search RPCs/notification outbox until those are separately resolved.

## Security Guardrails For Every Stage

- No credentials, env values, access tokens, DB passwords, SMTP passwords, Firebase keys, CAPTCHA server keys, or service-role keys in git/docs/output.
- No `service_role` in frontend/public/mobile bundles.
- No `google-services.json`, keystores, or signing secrets in git.
- No SQL apply without explicit user approval.
- No production restore, destructive cleanup, or broad firewall/network changes without explicit user approval.
- Use focused diffs and record validation results.
