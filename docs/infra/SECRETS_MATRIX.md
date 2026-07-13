# Secrets Matrix

This file lists secret names and storage locations only. It must never contain
real values.

| Secret/config | Used by | Store in | Commit? | Notes |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Frontend build | Coolify env | No values | Public endpoint, still deployment config |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend build | Coolify env | No values | Public/publishable key only |
| `SUPABASE_SECRET_KEY` | Edge Functions/server-side jobs | Supabase/Coolify secrets | No | Backend only |
| `SUPABASE_SERVICE_ROLE_KEY` | Avoid unless required server-side | Secret store only | Never | Never in frontend or docs values |
| `JWT_SECRET` | Self-hosted Supabase | Supabase runtime env | No | Rotate through controlled backend process |
| `ANON_KEY` | Supabase public client | Supabase runtime/Coolify env | No values | Public app-facing key |
| `VAPID_PUBLIC_KEY` | Push web client/server | Coolify/Supabase env | No values | Public key |
| `VAPID_PRIVATE_KEY` | Push dispatcher | Supabase secret | Never | Backend only |
| `KUB_PUSH_DISPATCH_TOKEN` | Push scheduler/function | Supabase secret/Vault | Never | Scheduler auth |
| `KUB_RECURRING_SCHEDULER_TOKEN` | Recurring scheduler | Supabase secret/Vault | Never | Scheduler auth |
| `SMTP_PASS` | Auth email | Supabase runtime env | Never | Transactional email |
| `SMS_PROVIDER_SECRET` | Phone OTP | Supabase runtime env | Never | Provider-specific |
| `VITE_SENTRY_DSN` | Frontend monitoring | Coolify env | No values | Optional, postponed |
| Code signing keys | Native release | Password manager/CI secret | Never | Android/iOS/Windows |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri Windows updater artifact signing | Local encrypted release host or dedicated secret manager | Never | Private updater identity; never available to publisher, frontend or Coolify public env |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Unlock Tauri updater signing key | Password manager or protected release-host process environment | Never | Inject only for the bounded signing process; never pass as a publisher argument |

## Rules

- `VITE_*` values are bundled into frontend code. Never put private keys there.
- Service-role or secret keys are backend-only.
- Store real values in Coolify, Supabase secrets, a password manager, or a
  dedicated secret manager.
- Rotate secrets after any suspected exposure.
- Do not paste secrets into tickets, docs, screenshots, or logs.
- The release catalog publisher consumes only the already-signed updater bundle
  and public `.sig` sidecar. It must not receive signing key/password values.
