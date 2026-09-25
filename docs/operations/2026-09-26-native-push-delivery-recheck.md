# Native push delivery recheck, 2026-09-26

Owner: shared backend/Windows/Android stream. Status: deployed. This change does
not update the installed Android APK or establish physical-device receipt.

## Behavior

- `native_push_outbox_delivery_recheck(uuid, uuid)` checks the exact claimed
  outbox row immediately before FCM/WNS delivery. A read notification or an
  inactive/rebound device is terminalized without contacting the provider.
  Lost/expired claims and RPC failures cannot reach the provider. An expired
  claim that became read is terminalized, not left as an unreadable queue tail.
- Native rows are claimed after the sequential Web Push drain, so that drain
  cannot consume most of their five-minute lease before native dispatch starts.
- The function is `SECURITY DEFINER` with `search_path=pg_catalog` and EXECUTE
  only for `service_role`. Notification payloads, device tokens, cards and
  client routing are unchanged.

## Verification and rollout

- Reviewed commit: `c3a3147218b2278d38aa28992cd3192febe5660b`.
  Migration source and `.migration-backup` copy SHA-256:
  `92edb0ff7209282da9a7bbfb3142b587630c1e5658ae571bc6996c0b0142bbb8`.
  Edge entrypoint SHA-256:
  `5a479552c16c62dc936dcdddd9f419e94a552e0f12ba7b3183dc729e16453c89`.
- Focused native/Web/voice push tests: 54 passed, including real PGlite claim,
  read, disabled/revoked/rebound device, expired lease and mutation checks.
  Deno 2.5.2 check and workspace typecheck passed. Independent source review
  found no remaining new regression after the expired-lease correction.
- The live schema and old mounted Edge entrypoint matched the reviewed baseline.
  Fresh full backup `/srv/letscube/backups/automated/20260926-003838` was
  produced by the installed backup script. Its `SHA256SUMS` passed, the custom
  PostgreSQL catalogs parsed with `pg_restore --list`, and the backup directory
  and Supabase dump have modes 700 and 600. No dump was copied to the PC.
- Rollout files and the previous Edge entrypoint are root-only at
  `/srv/letscube/backups/native-push-recheck-20260925T214841Z`. The migration
  file and replacement entrypoint matched the reviewed local hashes. The SQL
  first passed a live-schema transaction that ended in `ROLLBACK`, leaving no
  function; it was then applied once in a transaction with its raising
  self-check. Live `pg_proc` reports a definer with the pinned search path and
  only `postgres`/`service_role` EXECUTE. PostgREST returned HTTP 200 and the
  expected `claim_lost` scalar for a nonexistent outbox ID.
- Only the Edge entrypoint was atomically replaced and only
  `supabase-edge-functions` restarted. It returned healthy; an unauthorized
  POST returned 401. The push cron continued every ten seconds, with several
  HTTP 200 responses and native `idle` afterward. The Coolify web image for the
  commit was healthy. At the final read-only count, pending unread native rows
  and live leases were zero; 87 historical already-read unsent rows remain.

## Limits and next work

- A device token can still be rebound to another account between the database
  recheck and the external provider request. That pre-existing confidentiality
  race needs a registration/delivery contract, not another unlocked read. Do
  not describe this patch as a complete device-rebind fence.
- An HTTP 500 from native claim may now follow already acknowledged Web Push
  sends. Operational diagnostics must treat the result as potentially partial.
- Provider acceptance is not OS-card receipt or exact-message tap proof. No
  physical Android or live WNS send was performed for this change.
- Album messages still create individual notification rows. Durable album-level
  push aggregation requires a separate design and migration that preserves
  each message ID and its read/navigation behavior. The 87 historical read
  outbox rows need a reviewed retention/cleanup policy, not ad hoc deletion.

## Rollback

Restore `index-before.ts` from the root-only rollout directory to the mounted
`send-push-notifications/index.ts` path atomically, verify the prior SHA-256
`e762fbb34d6fff3c2a1b0380d42f771cc9971231cc1e527254ffb2547e521d48`,
restart only `supabase-edge-functions`, and verify health plus cron HTTP 200.
The SQL function is additive; leave it unused until the old dispatcher is
confirmed healthy. Then it may be dropped using the migration header if a full
schema rollback is necessary. The fresh backup above is the pre-change state.
