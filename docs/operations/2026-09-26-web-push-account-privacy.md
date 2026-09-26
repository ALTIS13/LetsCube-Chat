# Web Push account-change privacy, 2026-09-26

Owner: iOS/PWA stream. Status: source, database function and Edge module deployed.
Source commit: `a33e5eced5aff30451555b1a3c3251e084c519a4` on `main`.

## Cause and behavior

Browser Web Push subscriptions and provider-accepted requests can outlive the
account shown by one PWA installation. The existing global unique endpoint index
prevents two simultaneous rows using the same endpoint, but the old account's
active row remains after sign-out. A later provider delivery may still show its
card; WebKit's declarative fallback can show it without running the service
worker. The former payload carried sender, avatar and message preview.

The Edge Web Push payload now carries only `LETSCUBE` and `Новое уведомление` as
display text in both service-worker and declarative paths. It retains opaque
chat/message routing and card grouping. Browser sign-out or direct account
switch closes existing cards and unsubscribes that browser, best effort. The
delivery recheck rejects an outbox row whose subscription owner differs from
the outbox owner, before calling the provider. No FCM/WNS behavior changed.

## Verification and rollout

- Synthetic Web Push, service-worker and Edge tests: 27 passed. PGlite applies
  both migrations and suppresses a wrong-owner claim; the regression failed
  against the old function. Mobile WebKit and Chromium account-transition tests:
  4 passed. Kub typecheck passed after the final desktop guard. A production
  build passed before that one-line guard (`sw.js build 9267bcf0121866ce`,
  `built in 27.96s`); the exact committed web image was verified after deploy.
- Live prestate: database `postgres`, function MD5
  `6fad8374309b52d86c1fad9d41f26226`; `push_subscriptions` and outbox RLS
  enabled; only `service_role` may execute the RPC. No pending mismatched-owner
  rows. The migration source and recorded copy SHA-256 both equal
  `de4b68fb57512faac4f36b070784d97fe134076a04b95b671fbd1d0b89f4f6f6`.
- Fresh full backup `/srv/letscube/backups/automated/20260926-013641` passed
  its `SHA256SUMS` and PostgreSQL custom-dump catalog check before the change.
  The exact migration first passed a live-schema transaction ending in
  `ROLLBACK`; the prior function hash remained unchanged. The migration was
  then applied once with `BEGIN`, raising self-check and `COMMIT`. Poststate
  function MD5 is `b8a02ae640aac23f596433b5e3fcf000`; grants/RLS are
  unchanged, and a nonexistent claim returns `claim_lost`.
- The prior mounted `webpush.ts` is saved root-only at
  `/srv/letscube/backups/webpush-private-20260926T082421Z/webpush-before.ts`.
  Only that module was atomically replaced and only `supabase-edge-functions`
  restarted. Its new SHA-256 is
  `67f021988fbbe155764f05cc9868ab12e3206e4ba5b57b23df4fc4f48b5dd1ad`.
  The mounted `index.ts`, `fcm.ts`, `wns.ts` and `native-push-privacy.ts` hashes
  match the reviewed source both before and after. Edge returned healthy;
  unauthenticated POST returned 401; three post-restart cron runs succeeded,
  and four pg_net responses were HTTP 200 in the same window.
- The healthy web container image is tagged with the exact source commit.
  `https://app.letscube.ru/` returned 200 and its served entry asset contained
  the new notification-card cleanup logic.

## Limits and rollback

An old card already accepted by a push provider cannot be recalled. These
changes prevent old-account content exposure but cannot guarantee that a late
generic card never appears. Sign-out cleanup is best effort; old database
subscription rows remain until provider rejection or an explicit future
registration lifecycle. A reused browser endpoint can therefore still collide
with the global unique index when a different account enables push. No physical
iPhone notification delivery, card display or tap was tested here.

To roll back the Edge module, atomically restore `webpush-before.ts` to the
mounted `webpush.ts` path, restart only `supabase-edge-functions`, verify its
previous SHA-256
`53191dfe9c18a2d055d0b43c74242b17944aa6ed710497df4ac29e83d4613d3b`,
health and cron responses. If restoring the old rich Web payload, first ensure
the account-switch confidentiality risk is otherwise closed; rollback is not
privacy-neutral. To revert the database function after the old Edge dispatcher
is healthy, reapply the body from
`20260924095548_web_push_delivery_recheck.sql` as noted in the migration
header. The verified full backup is the pre-change state.
