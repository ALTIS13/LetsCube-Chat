# Recurring Task Scheduler

KUB recurring task generation is executed by `task_recurrence_run_due(p_limit)`. The
production scheduler is a Supabase Edge Function invoked by Supabase Cron.

## Strategy

- Edge Function: `supabase/functions/recurring-tasks-run-due/index.ts`
- Manual SQL proposal: `.migration-backup/supabase/migrations/20260524_recurring_scheduler_edge_function.sql`
- Scheduler interval: every 5 minutes by default.
- Function auth: required `KUB_RECURRING_SCHEDULER_TOKEN` header.
- Database access: backend-only Supabase secret key from Edge Function runtime. This key must never be
  added to frontend env, Vite env, docs, tests, or screenshots.

Supabase references:

- Edge Function environment variables and default secret keys:
  `https://supabase.com/docs/guides/functions/secrets`
- Scheduling Edge Functions with `pg_cron`, `pg_net`, and Vault:
  `https://supabase.com/docs/guides/functions/schedule-functions`

## Manual Deployment

Run from the repo root after logging in to Supabase CLI. Do not paste real tokens into docs or shell
logs.

```powershell
supabase functions deploy recurring-tasks-run-due --project-ref nhogbeojfnbjcfipitrh --no-verify-jwt
```

Create a random scheduler token locally and store it only as a Supabase secret:

```powershell
$env:KUB_RECURRING_SCHEDULER_TOKEN = "<random long token>"
supabase secrets set KUB_RECURRING_SCHEDULER_TOKEN="$env:KUB_RECURRING_SCHEDULER_TOKEN" --project-ref nhogbeojfnbjcfipitrh
```

The hosted Edge runtime provides `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` by default. If an
environment does not provide `SUPABASE_SECRET_KEYS`, set a backend-only `SUPABASE_SECRET_KEY`
secret for this function.

## Schedule Setup

Before applying the scheduler SQL proposal, create these Supabase Vault secrets:

- `kub_project_url`: `https://<project-ref>.supabase.co`
- `kub_recurring_scheduler_token`: the same token as `KUB_RECURRING_SCHEDULER_TOKEN`

Then review and manually apply:

```text
.migration-backup/supabase/migrations/20260524_recurring_scheduler_edge_function.sql
```

The proposal enables `pg_cron` / `pg_net`, schedules a POST to the Edge Function every 5 minutes,
and sends the scheduler token from Vault in `x-kub-scheduler-token`.

## Verification

Non-mutating default:

```powershell
pnpm.cmd rls:smoke
```

The smoke checks:

- `task_recurrence_run_due` is denied for `location_admin`, `location_staff`, and `client`.
- owner/tech_admin run-due execution is skipped unless mutations are explicitly enabled.
- lifecycle fake-ID probes still use fake IDs only.

Fixture-backed mutation mode, only after dedicated QA recurring fixtures exist:

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = "1"
pnpm.cmd rls:smoke
```

That mode may call `task_recurrence_run_due`, so use it only against explicit QA fixtures.
