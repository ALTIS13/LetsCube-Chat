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

## Release gates still open

1. Commit and push only reviewed bot-viewer files after checking the shared
   `main` index; preserve the iOS PWA owner's independent work.
2. Verify healthy web, Bot Gateway and worker images at the reviewed commit.
   The installed Android bundle remains a separate release and must retain its
   existing keyboard fallback.
3. Use an isolated QA bot and two QA accounts for a production canary: A sees
   and presses the panel, B cannot read it, and edit/close/expiry revoke it.
   Remove QA state afterwards. Until this passes, do not call the feature live.
