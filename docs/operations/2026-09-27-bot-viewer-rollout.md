# Bot viewer interface V1: release evidence

Owner: shared web/backend. The private panel is scoped to one viewer after a
bot callback in a group; it is not a message and is not published through
Realtime. The prior [pause checkpoint](2026-09-26-bot-viewer-pause.md) and
[design](../superpowers/specs/2026-09-26-bot-viewer-interface-design.md) give
the contract. This report records evidence separately from release status.

## Pre-release checks, 2026-09-27

- The SQL migration and its `.migration-backup` copy are byte-identical. A
  restored, network-isolated PostgreSQL database (`rehearsal` in the dedicated
  `letscube-bot-viewer-rehearsal-20260926` container) passed apply, rollback,
  reapply, the rollback-only actor/delivery smoke, and final rollback. The
  container has network mode `none` and no published ports. The smoke covers
  old-token callback grants after rotation and a panel closed between webhook
  preparation and the worker's final delivery check.
- The worker checks a marked private callback again just before HTTP dispatch.
  A regression test first reproduced revocation during DNS resolution: the
  worker's earlier check passed, then the webhook still started. Delivery now
  rechecks after DNS validation on every hop, immediately before starting the
  HTTP transport. A revoked panel is not sent; a stale claim or temporary
  check failure retries rather than being mistaken for revocation. Once an
  HTTP request has begun, database revocation cannot recall it.
- Bot unit tests passed 303/303. One older source-contract test expected
  sender identity in FCM after the account-neutral push change; its assertion
  now checks exact routing without permitting sender fields, and the existing
  account-rebind privacy tests also pass. API and web typechecks, API build and a Vite
  production build passed (the latter with source-map and chunk-size warnings).
  Bot-panel fixture tests passed 39/39 on desktop/mobile
  Chromium and mobile WebKit; chat glass geometry passed another 21/21. These
  are synthetic browser checks, not authenticated production or physical iOS
  evidence. The browser connector did not permit an authenticated production
  visual check in this run; it was not bypassed.
- The full unit run selected 4,190 tests and exposed ten failures. A preexisting
  white-on-cyan class in the touched bot keyboard was corrected, leaving nine
  failures in untouched files: iOS CSS layering/safe-area/tokens, an attachment
  disabled style, border count, message-row memoization, Web Push recheck,
  chat-profile hover count and chat-header touch target. These are not counted
  as bot-panel acceptance; their owners need separate repairs. All 352 server
  tests passed. Do not describe the whole repository suite as green.
- Production schema initially matched the migration's expected absent objects
  and existing delivery guard. A fresh full backup is
  `/srv/letscube/backups/automated/20260927-001359`; its `SHA256SUMS`,
  PostgreSQL custom-dump catalog and Storage archive listing passed. The base
  migration was applied to production as `supabase_admin`, but its first
  rollback-only smoke exposed a production-only ACL gap: the existing
  `postgres`-owned SECURITY DEFINER delivery guard could not execute the new
  `supabase_admin`-owned private validator. The smoke rolled back; no client
  code had been deployed. A narrow follow-up migration grants EXECUTE only to
  `postgres`, with guarded pre/poststate and a separate rollback. Both files
  were rehearsed on the isolated restore, including revoke/reapply, and their
  source, backup and server copies were hash-matched. The follow-up was then
  applied to production as `supabase_admin`. Updated production smoke explicitly
  checked the ACL and completed `bot_viewer_interface_smoke_ok` followed by
  `ROLLBACK`. Neither `anon`, `authenticated` nor `service_role` can execute
  the validator. The base and follow-up schema are live; app release is pending.
- The existing Windows Test updater channel is not a staging environment for
  this feature: its shell still loads the production web origin; Android embeds
  a separately built web bundle, and iPhone PWA uses the same production site.
  There is no isolated web/backend Test deployment. The owner chose to continue
  the existing guarded rollout rather than introduce a misleading Test label;
  see [release channels](release-channels.md).

## Production release, 2026-09-27

- The reviewed two-commit range `869469f7..229a65e2` was pushed to the review
  branch and then `main`; the shared working tree was clean. The iOS PWA owner
  continued in a separate worktree. Bot tests passed 303/303 again and server
  tests passed 352/352 after the ACL correction.
- Running web, worker and Bot Gateway containers each reported the full image
  tag `229a65e251e288a0bbdc5ddb32f141dd82b0e409` and `healthy` after the
  old replicas left service. The Bot Gateway required an explicit Coolify
  deploy because its auto-deploy is disabled. The web entry asset
  `/assets/index-BRoeOUjy.js` returned 200 from both the workstation and
  server and contained the actor-panel RPC marker. Container tags and the
  public asset are separate checks; a queued webhook alone proves neither.
- An isolated production canary used a temporary group with two QA accounts
  and the existing QA bot. The bot received the member's callback through
  `getUpdates`, created a panel through the public Bot API, and only the member
  who pressed could read it. The other group member read zero panels. Press,
  edit and close succeeded through their real HTTP/RPC paths; the closed panel
  disappeared. The QA message and group were deleted, and the bot token was
  revoked with deletion requested. Expiry and stale delivery were covered by
  the production rollback-only SQL smoke, not by waiting 15 minutes in this
  HTTP canary.

The shared web/backend feature is live. Android embeds its own web bundle and
was not rebuilt here; its existing keyboard fallback remains. Physical iPhone
PWA appearance and the nine unrelated full-unit failures remain separate QA
work, not evidence that this canary covered those platforms.
