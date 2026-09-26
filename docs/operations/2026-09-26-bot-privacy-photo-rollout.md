# Bot privacy and photo rollout, 2026-09-26

Owner: backend and shared web. Source: `d846d4c7` on `main`.

## Scope

- A group administrator can switch a bot between restricted and full access to
  **new** group messages in the group member panel. The panel refreshes while
  open; the bot owner's settings show the current per-group state.
- A privacy change starts a new delivery epoch: pending message and edited
  message updates for that bot/group are removed, polling and webhook preparation
  recheck visibility, and message insertion serializes against the change.
- `sendPhoto` accepts one of inline JPEG/PNG/WebP/GIF bytes (at most 6 MiB), an
  authorized `chat-media` object, or a `file_id` readable in the destination
  chat. Inline bytes are authenticated before the larger JSON body is parsed.
  URL fetches and cross-chat `file_id` reuse remain forbidden.
- The bot management screen reports a safe load error and offers retry instead
  of only a generic failure.

## Evidence

- Verified PostgreSQL custom dump:
  `/srv/letscube/backups/automated/20260926-143829/db/supabase-postgres.custom`
  (`sha256sum -c SHA256SUMS`: OK).
- Migration: `supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql`.
  The `.migration-backup` copy is byte-identical, SHA-256
  `B28FCAA8FBA7B9BDCCE1FB40EBB397CF75C8C8620A6265281F9A51493F9EAA84`.
  Prestate function hashes were checked immediately before apply. The combined
  migration and SQL smoke passed inside a rolled-back transaction; the migration
  then applied, and the standalone smoke passed again inside a rollback.
  Poststate: helper and both message triggers present, authenticated user cannot
  execute the private helper, and no smoke messages remain.
- API: 48 focused unit tests, typecheck and build passed. Web: typecheck/build,
  36 bot-management and 36 bot-documentation/group-membership browser cases
  passed across desktop and mobile Chromium. The Vite browser fixture used
  `VITE_BOT_MANAGEMENT_URL=http://127.0.0.1:54322`; an earlier run without it
  had incorrectly called the production origin and was not counted.
- Production `chat-media` allows the four image MIME types and has a 100 MiB
  bucket limit. Public `/bots/docs`, the new web bundle, and the web container
  were checked after deploy.
- Coolify deployment 601 finished for the gateway. Both the web and gateway
  containers run healthy images tagged `d846d4c7`. The public bot management
  preflight returns 204 and allows `https://app.letscube.ru`; an unauthenticated
  `sendPhoto` request returns 401. The new gateway reported no error events
  in its initial startup logs.

## Boundaries

- The SQL smoke exercises real database functions, queue removal, polling and
  webhook preparation, but no real bot token sent an inline photo through the
  public gateway and Storage. This requires a controlled bot/chat fixture.
  Bot settings passed the mocked authenticated browser flow on desktop and
  mobile; a live authenticated owner session was not exercised in this rollout.
- An update already returned to a polling client or handed to a webhook worker
  before a privacy change cannot be recalled from that client. New delivery
  attempts and pending updates are guarded.
- An Android APK embeds its web bundle; this web deploy does not update Android.
  iPhone PWA layout belongs to the separate iOS/MacOS owner.

## Recovery

- If the gateway photo path fails, redeploy the previously healthy gateway
  commit `bca668b1` while keeping the DB migration; the schema remains
  backward-compatible. Verify the old image and public health before declaring
  recovery.
- If privacy exposure is suspected, first prevent new full grants by revoking
  `authenticated` EXECUTE on `public.chat_bot_set_privacy(uuid,uuid,boolean)`.
  Under a reviewed transaction, set active full memberships to restricted with
  a fresh boundary and remove their pending message/edited-message delivery
  attempts and updates. The database guards remain active. Do not restore the
  whole dump blindly: doing so would discard messages created after the backup.
  A structural rollback needs its own rehearsed SQL against that verified dump.
