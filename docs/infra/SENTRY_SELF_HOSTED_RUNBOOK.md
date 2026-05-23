# Sentry Self-Hosted Runbook

Status: postponed until pre-packaging monitoring review.

KUB already has a frontend monitoring foundation that initializes only when a
DSN is configured. Self-hosted Sentry can be introduced later, but it is a
separate operational load.

Reference:

- https://develop.sentry.dev/self-hosted/

## Resource note

On a node with 8 CPU cores, 12 GB RAM, and 120 GB storage, running KUB,
self-hosted Supabase, and self-hosted Sentry together can create memory and
storage pressure. Prefer a separate node for Sentry if production event volume
is meaningful.

## Future setup

1. Deploy Sentry at `https://sentry.example.com`.
2. Create KUB frontend project.
3. Store browser DSN in Coolify env as `VITE_SENTRY_DSN`.
4. Set:
   - `VITE_APP_ENV`
   - `VITE_APP_VERSION`
   - `VITE_APP_COMMIT`
5. Verify redaction before enabling broad production traffic.

## Data policy

Monitoring must not send:

- passwords;
- tokens;
- Supabase keys;
- emails;
- raw message content;
- media URLs;
- signed URLs;
- QA credentials.

## QA

- App works with no DSN.
- App works with DSN.
- Test event reaches Sentry.
- Event contains release metadata.
- Event does not contain secrets or user message content.
