# LETSCUBE Production Priority Tracker

Status: approved execution order, 2026-06-22.

This file is the working tracker for the production-hardening sequence. It is intentionally narrow: APK/native packaging is postponed, and the next work focuses on web/PWA production safety.

## Priority 1 - Auth And Anti-Abuse

Goal: public auth endpoints must not allow bot signup, password guessing, recovery abuse, or CAPTCHA bypass.

Definition of done:

- Signup and recovery go through the Yandex SmartCaptcha auth gateway in the public app.
- Direct public bypass paths to sensitive Supabase Auth endpoints are blocked or rate limited at the proxy layer.
- Login, signup, recovery, verify, resend and token endpoints have server-side throttling.
- User-facing auth errors do not reveal whether an account exists.
- Existing users cannot obtain a session through the registration screen.
- 429/rate-limit errors map to friendly Russian UI copy.
- Auth abuse checks have repeatable smoke tests and operational verification commands.

Current baseline:

- Yandex SmartCaptcha gateway is deployed for signup and recovery.
- Direct external signup/recovery bypass is blocked at the proxy layer.
- Generic signup/recovery copy is in place.
- Self-hosted GoTrue email throttles and Traefik auth endpoint throttling are documented in `docs/security/AUTH_RLS_ANTI_ABUSE_PLAN.md`.
- Auth gateway redirect targets are restricted to explicit `KUB_AUTH_ALLOWED_REDIRECT_ORIGINS`; request `Origin` is not treated as an implicit redirect allowlist.

Next checks:

- Verify live proxy rules still block direct `/auth/v1/signup` and `/auth/v1/recover`.
- Verify login brute-force throttling behavior and friendly UI for 429.
- Verify no frontend code calls direct signup/recovery when the gateway is configured.
- Add or update tests for closed direct-auth behavior.

## Priority 2 - RLS And Security Audit

Goal: authenticated users can only read/write rows, objects and RPC effects allowed by their membership, role, location and task permissions.

Definition of done:

- All exposed public tables have RLS enabled.
- Public views are absent or use `security_invoker` / restricted grants.
- `anon` cannot execute app RPCs unless a function is intentionally public and documented.
- `SECURITY DEFINER` functions pin `search_path` and validate `auth.uid()` / permissions internally.
- Storage policies for media, avatars and task attachments are path-scoped and role-aware.
- Policies do not depend on user-editable `raw_user_meta_data`.
- RLS/RPC smoke tests cover chat, media, tasks, notifications, roles and admin boundaries.

Current baseline:

- Existing docs report all inspected public tables with RLS enabled.
- Existing proposals harden function `search_path` and revoke anonymous function execute.
- Local `pnpm.cmd rls:smoke` exists, but depends on configured target env.
- Live read-only metadata/REST probe is recorded in `docs/security/RLS_SECURITY_AUDIT_20260622.md`.

Next checks:

- Add a repeatable anon REST probe script that does not print keys or row contents.
- Run two-account authenticated boundary tests for chats, messages, tasks, notifications, profiles and storage.
- Create new proposal only if drift or a concrete gap is found.

## Priority 3 - Backup And Restore Drill

Goal: a full LETSCUBE production restore must be executable from backups without relying on memory or ad hoc commands.

Definition of done:

- Postgres logical backup is scheduled and retained.
- Supabase Storage/media backup is scheduled and retained.
- Coolify, mail, Supabase compose/env/config and ops docs are backed up.
- A restore rehearsal runs into a separate temporary restore target.
- Restore verification checks row counts, key tables, Storage object counts and a basic app smoke.
- The runbook explains exact backup, restore, validation and rollback commands.

Current baseline:

- Infrastructure docs describe backup/restore expectations.
- Self-host migration placed operational files under `/srv/letscube`.

Next checks:

- Inspect server-side backup directories, cron/systemd timers and existing scripts.
- Add missing scripts/runbooks without printing secrets.
- Perform a non-destructive restore rehearsal only after confirming target isolation.

## Deferred

- APK/native app packaging.
- Native FCM push.
- Release signing/AAB.
- Deep links/app links.
- SMS provider rollout.

Standalone web/PWA remains the production app path for now. The app should behave like an installed messenger tab without browser chrome where the platform supports installed PWAs.
