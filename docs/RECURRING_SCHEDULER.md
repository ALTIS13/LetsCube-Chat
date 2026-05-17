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

## Applied-Flow QA

Before running mutation QA, make sure all of these are true:

- `KUB_QA_ALLOW_MUTATIONS=1` is present only in the local QA env file or process env.
- `KUB_QA_TEST_LOCATION_ID` or `KUB_QA_TEST_LOCATION_NAME` points to the safe QA location.
- The owner/tech-admin, location-admin, location-staff and client QA accounts are assigned exactly
  as intended for the test fixture.
- The recurring template task can be safely soft-deleted after the run.

Manual applied-flow checklist:

1. Confirm scheduler infrastructure:

   ```sql
   select jobid, jobname, schedule, active
     from cron.job
    where jobname = 'kub-recurring-tasks-run-due';

   select id, status_code, created
     from net._http_response
    order by created desc
    limit 5;
   ```

2. Sign in as owner/tech_admin and create a QA recurring task in the QA location.
3. Use the recurring task UI to set a safe short recurrence. If a due timestamp must be forced,
   update only the QA recurrence fixture.
4. Wait for the 5-minute cron window, or call the scheduler function with the local scheduler token
   if it is present outside the repo.
5. Verify one occurrence was created and the original scheduled timestamp did not create a duplicate
   on the next run.
6. Verify the occurrence copied routing/security fields:
   `location_id`, `target_role`, `route_admin_id`, `created_for_admin`, `visibility`,
   `assignment_scope`, `assignee_id`, `chat_id` and `priority`.
7. Verify role visibility:
   location staff sees staff-visible occurrences, client does not see task UI or task rows, staff
   does not see admin-only occurrences, and owner/tech_admin sees all QA tasks.
8. Verify notifications only if the QA recurrence is explicitly safe for notification delivery.
9. Soft-delete the QA template and generated occurrences after the run.

2026-05-17 read-only deployed check:

- Edge Function `recurring-tasks-run-due` is `ACTIVE`.
- Cron job `kub-recurring-tasks-run-due` is active with schedule `*/5 * * * *`.
- Latest `net._http_response` rows included HTTP `200` responses at `2026-05-17 18:25`,
  `18:30` and `18:35` UTC.
- `due_count` was `0`, so there was no due recurrence to generate during the read-only check.
- Local `KUB_QA_ALLOW_MUTATIONS` was not enabled, so occurrence creation, duplicate prevention,
  notification delivery and cleanup were not executed in this pass.
