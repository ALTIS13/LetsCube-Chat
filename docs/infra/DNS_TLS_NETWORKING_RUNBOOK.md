# DNS, TLS, And Networking Runbook

Use placeholders in documentation:

- `kub.example.com`
- `sentry.example.com`

## DNS

- Lower TTL before cutover.
- Point `kub.example.com` to the new node only after rehearsal QA.
- Keep old target documented for rollback outside git.

## TLS

- Use Coolify-managed certificates or host reverse proxy certificates.
- Renewals must be automatic.
- Auth callbacks must use HTTPS in production.

## Reverse proxy

The proxy must support:

- SPA fallback to `index.html`;
- static asset caching;
- service worker delivery with correct cache behavior;
- websocket upgrade for Supabase Realtime;
- media upload size limits;
- Edge Function routes if proxied through the same domain.

## Supabase endpoints

Self-hosted Supabase includes Auth, Realtime, Storage, RPC/PostgREST, and Edge
Functions as one backend platform. Confirm all endpoints are reachable from the
KUB frontend domain.

## QA

- Direct refresh `/tasks`.
- Direct refresh `/admin`.
- `/auth/callback` with query/hash parameters.
- Realtime websocket connects.
- Storage upload succeeds.
- Service worker registers.
- Push notification click opens/focuses KUB.
