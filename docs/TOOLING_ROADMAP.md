# Tooling Roadmap

## Now

- Supabase typegen script: `pnpm.cmd supabase:typegen`.
- Playwright config and smoke suite: `pnpm.cmd e2e:smoke`.
- RLS/RPC smoke foundation: `pnpm.cmd rls:smoke`.
- Biome staged rollout over tooling files: `pnpm.cmd lint`, `pnpm.cmd format:check`.

## Next

- Wire `artifacts/kub/src/types/database.generated.ts` into the app behind a small compatibility layer.
- Add CI job for `pnpm.cmd e2e:smoke` against a deployed preview or a seeded test environment.
- Add `@axe-core/playwright` for accessibility checks on chat, notifications, tasks, admin users, roles, and mobile composer.
- Add deterministic test fixtures for client, location_staff, location_admin, owner, and tech_admin.

## Backend / Data Quality

- Add RLS/RPC smoke scenarios with safe fixtures.
- Add pgTAP or equivalent DB tests if the Supabase workflow supports it.
- Add recurring-task scheduler test harness before changing production scheduling.

## Later

- Storybook or Ladle after the main UI surfaces stabilize.
- MSW only if frontend component tests need API mocks.
- Sentry or equivalent frontend error monitoring after privacy/error taxonomy review.
- Electron/Tauri/Capacitor packaging only after the web app stabilizes.

## Not Now

- No service-role usage in frontend or browser tests.
- No automatic SQL application from Codex.
- No system-level installers without explicit user confirmation.
- No storage of credentials, tokens, or passwords in project memory/docs.
