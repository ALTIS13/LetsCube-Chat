# Tooling Roadmap

## Now

- Supabase typegen script: `pnpm.cmd supabase:typegen`.
- Windows-safe typegen command:
  - PowerShell: `$env:SUPABASE_PROJECT_REF = "<project-ref>"; pnpm.cmd supabase:typegen`
  - cmd: `cmd /c "set SUPABASE_PROJECT_REF=<project-ref>&& pnpm.cmd supabase:typegen"`
- Advisory database type drift check: `pnpm.cmd db:types:check`.
- Playwright config and smoke suite: `pnpm.cmd e2e:smoke`.
- RLS/RPC smoke foundation: `pnpm.cmd rls:smoke`.
- Biome staged rollout over tooling files: `pnpm.cmd lint`, `pnpm.cmd format:check`.
- PWA baseline: manifest, conservative service worker, install prompt, offline/reconnect banner and update UX are documented in `docs/PWA_NATIVE_READINESS.md`.
- Production frontend monitoring foundation: optional Sentry browser reporting is documented in `docs/PRODUCTION_MONITORING.md`.
- Push notification setup is documented in `docs/PUSH_NOTIFICATIONS.md`; real delivery requires manual DB migration, VAPID secrets and Edge Function/scheduler deployment.
- Phone verification setup is documented in `docs/PHONE_VERIFICATION.md`; real OTP requires Supabase Auth SMS provider configuration.

## Next

- Review `pnpm.cmd db:types:check` output after each Supabase migration and decide which app-facing aliases move through `database.app.ts`.
- Wire generated app-facing types into the app behind a small compatibility layer. Do not replace the manual file in one broad rewrite.
- Avoid importing internal/helper RPC types into app code unless there is a concrete frontend use.
- Add CI job for `pnpm.cmd e2e:smoke` against a deployed preview or a seeded test environment.
- Add `@axe-core/playwright` for accessibility checks on chat, notifications, tasks, admin users, roles, and mobile composer.
- Add deterministic test fixtures for client, location_staff, location_admin, owner, and tech_admin.

## Backend / Data Quality

- Add RLS/RPC smoke scenarios with safe fixtures.
- Add pgTAP or equivalent DB tests if the Supabase workflow supports it.
- Add fixture-backed recurring-task mutation QA after production scheduler is deployed. Default
  `rls:smoke` now verifies run-due permissions without mutating production data.

## Later

- Storybook or Ladle after the main UI surfaces stabilize.
- MSW only if frontend component tests need API mocks.
- Sentry/self-hosted monitoring rollout remains optional and can wait until pre-packaging privacy review.
- Electron/Tauri/Capacitor packaging only after the web PWA baseline and permission/deep-link checks stabilize.

## Not Now

- No service-role usage in frontend or browser tests.
- No automatic SQL application from Codex.
- No system-level installers without explicit user confirmation.
- No storage of credentials, tokens, or passwords in project memory/docs.
