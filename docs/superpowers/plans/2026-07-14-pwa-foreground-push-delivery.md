# PWA Foreground Push Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer every user's Web Push while any LETSCUBE client is foregrounded, permanently consume read active-chat events, and release coalesced unread events within the ten-second dispatcher cadence after the user leaves.

**Architecture:** Authenticated clients renew a twenty-second global user lease through two narrow RPCs. A service-role-only claim RPC suppresses read/coalesced rows, excludes users with active leases, and leases dispatchable outbox rows to one Edge invocation. The existing Edge Function sends only claimed rows and the existing Cron job changes from one minute to ten seconds.

**Tech Stack:** React 18, TypeScript, Zustand, Supabase Postgres 17/RLS/RPC, pg_cron 1.6.4, Supabase Edge Functions/Deno, Node test runner, Playwright.

## Global Constraints

- Work only with Supabase project `nhogbeojfnbjcfipitrh` and LETSCUBE-owned deployment surfaces.
- Never expose service-role, VAPID, Vault, auth token, endpoint key material, or notification payloads in frontend code, logs, tests, or documentation.
- Preserve existing application RLS policies and keep `push_foreground_sessions` inaccessible as a table to `PUBLIC`, `anon`, and `authenticated`.
- Client lease duration is server-fixed at 20 seconds; a visible client renews every 7 seconds.
- Dispatcher schedule is exactly `10 seconds`; alter only the existing `kub-send-push-notifications` schedule and preserve its command and Vault configuration.
- Use test-first development and observe every new regression test fail before production code is added.
- Do not push Git or trigger Coolify deployment without separate deployment authorization.

---

### Task 1: Lock the SQL security and queue contract with failing tests

**Files:**
- Create: `tests/unit/push-foreground-migration.test.mjs`
- Test: `.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql`

**Interfaces:**
- Consumes: the approved design in `docs/superpowers/specs/2026-07-14-pwa-foreground-push-delivery-design.md`.
- Produces: an executable source contract for table/RPC names, grants, fixed lease and atomic claim clauses.

- [ ] **Step 1: Write the failing migration contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql",
  import.meta.url,
);

test("foreground push migration isolates sessions and atomically claims the outbox", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.push_foreground_sessions/i);
  assert.match(sql, /alter table public\.push_foreground_sessions enable row level security/i);
  assert.match(sql, /revoke all on table public\.push_foreground_sessions from public, anon, authenticated/i);
  assert.match(sql, /expires_at\s*=\s*now\(\)\s*\+\s*interval '20 seconds'/i);
  assert.match(sql, /create or replace function public\.push_outbox_claim/i);
  assert.match(sql, /for update[\s\S]*skip locked/i);
  assert.match(sql, /grant execute on function public\.push_outbox_claim\(integer, uuid\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.push_outbox_claim[^;]+authenticated/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/unit/push-foreground-migration.test.mjs`

Expected: FAIL with `ENOENT` because the migration does not exist.

### Task 2: Implement the idempotent foreground/claim migration

**Files:**
- Create: `.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql`
- Modify: `artifacts/kub/src/types/database.ts:1189-1600`
- Modify after production apply: `artifacts/kub/src/types/database.generated.ts`
- Test: `tests/unit/push-foreground-migration.test.mjs`

**Interfaces:**
- Produces: `push_foreground_session_touch(uuid, uuid)`, `push_foreground_session_close(uuid)`, and `push_outbox_claim(integer, uuid)`.
- Produces outbox fields: `suppressed_at`, `suppression_reason`, `claim_token`, and `claimed_until`.

- [ ] **Step 1: Add the minimal idempotent SQL implementation**

The migration must:

```sql
create table if not exists public.push_foreground_sessions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null,
  current_chat_id uuid references public.chats(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, client_id)
);

alter table public.notifications_push_outbox
  add column if not exists suppressed_at timestamptz,
  add column if not exists suppression_reason text,
  add column if not exists claim_token uuid,
  add column if not exists claimed_until timestamptz;
```

Add the three functions exactly as specified in the design. The claim function must first suppress read rows, coalesce older rows by `(subscription_id, payload->>'tag')`, exclude any `user_id` with `expires_at > now()`, and claim with:

```sql
for update of o skip locked
```

All client functions revoke from `PUBLIC`, `anon`, and `authenticated`, then grant only to `authenticated`. The claim function grants only to `service_role`. Also add the missing `notifications_mark_chat_messages_read(uuid, timestamptz)` and revoke broad execution from the three internal push helpers.

- [ ] **Step 2: Run the migration contract and verify GREEN**

Run: `node --test tests/unit/push-foreground-migration.test.mjs`

Expected: PASS.

- [ ] **Step 3: Update manual database types**

Add these RPC signatures:

```ts
push_foreground_session_touch: {
  Args: { p_client_id: string; p_current_chat_id?: string | null };
  Returns: undefined;
};
push_foreground_session_close: {
  Args: { p_client_id: string };
  Returns: undefined;
};
```

Do not expose the server-only claim RPC through app-facing types.

- [ ] **Step 4: Re-run focused tests and typecheck**

Run: `node --test tests/unit/push-foreground-migration.test.mjs tests/unit/notification-read-sync.test.mjs`

Run: `pnpm --filter @workspace/kub run typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit the migration slice**

```powershell
git add -- .migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql tests/unit/push-foreground-migration.test.mjs artifacts/kub/src/types/database.ts
git commit -m "feat: add foreground push session schema"
```

### Task 3: Add the authenticated foreground lifecycle hook with TDD

**Files:**
- Create: `artifacts/kub/src/hooks/usePushForegroundSession.ts`
- Modify: `artifacts/kub/src/App.tsx:1-350`
- Create: `tests/unit/pwa-foreground-session.test.mjs`

**Interfaces:**
- Consumes: current user id and `selectedChatId` from Zustand.
- Calls: `push_foreground_session_touch` and `push_foreground_session_close`.
- Produces: one module-level session runner per authenticated runtime.

- [ ] **Step 1: Write the failing lifecycle source test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("foreground session follows visibility, network and active chat lifecycle", async () => {
  const source = await readFile(
    new URL("../../artifacts/kub/src/hooks/usePushForegroundSession.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /FOREGROUND_REFRESH_MS\s*=\s*7_000/);
  assert.match(source, /push_foreground_session_touch/);
  assert.match(source, /push_foreground_session_close/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.addEventListener\("online"/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /selectedChatId/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/unit/pwa-foreground-session.test.mjs`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Implement the hook**

Use `sessionStorage` key `kub:push-foreground-client-id`, generate with
`crypto.randomUUID()`, touch only when `document.visibilityState === "visible"`
and `navigator.onLine !== false`, and close on hidden/cleanup. Throttle warnings
to once per minute and log only a fixed category plus the safe database error
message.

- [ ] **Step 4: Mount the hook**

In `AppRoutes`, call `usePushForegroundSession()` beside `useHeartbeat()` so
all authenticated browser/PWA routes participate, not only the settings modal.

- [ ] **Step 5: Verify GREEN and compile**

Run: `node --test tests/unit/pwa-foreground-session.test.mjs`

Run: `pnpm --filter @workspace/kub run typecheck`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit the frontend slice**

```powershell
git add -- artifacts/kub/src/hooks/usePushForegroundSession.ts artifacts/kub/src/App.tsx tests/unit/pwa-foreground-session.test.mjs
git commit -m "feat: report foreground push sessions"
```

### Task 4: Replace direct Web outbox polling with atomic claim

**Files:**
- Modify: `supabase/functions/send-push-notifications/index.ts:1-440`
- Modify: `tests/unit/push-outbox-read-filter.test.mjs`
- Modify: `tests/e2e/push-phone-foundation.spec.ts:128-145`

**Interfaces:**
- Consumes: `push_outbox_claim(p_limit, p_claim_token)`.
- Produces: token-guarded Web outbox acknowledgements.
- Preserves: existing native outbox path and VAPID payload sanitisation.

- [ ] **Step 1: Change the unit contract first and verify RED**

Require the Edge source to contain:

```js
assert.match(source, /crypto\.randomUUID\(\)/);
assert.match(source, /\/rest\/v1\/rpc\/push_outbox_claim/);
assert.match(source, /claim_token/);
assert.match(source, /claimed_until/);
assert.doesNotMatch(source, /notifications!inner\(read_at\)/);
```

Run: `node --test tests/unit/push-outbox-read-filter.test.mjs`

Expected: FAIL because the Edge Function still selects the outbox directly.

- [ ] **Step 2: Implement claim and token-guarded patches**

Generate one `claimToken` per invocation, POST `{ p_limit, p_claim_token }` to
`/rest/v1/rpc/push_outbox_claim`, and include `claim_token=eq.<token>` in every
Web outbox PATCH. Success and failure patches set `claim_token: null` and
`claimed_until: null`. Inactive subscriptions set `suppressed_at` and
`suppression_reason: "subscription_inactive"` instead of pretending they were
sent.

- [ ] **Step 3: Update the E2E source contract and verify GREEN**

Run: `node --test tests/unit/push-outbox-read-filter.test.mjs tests/unit/pwa-service-worker-lifecycle.test.mjs`

Expected: PASS.

- [ ] **Step 4: Commit the Edge slice with the existing notification fixes**

Stage only the notification/Edge files already changed for this focused task,
then commit:

```powershell
git commit -m "fix: coordinate foreground push delivery"
```

### Task 5: Apply and transactionally verify the Supabase migration

**Files:**
- Source of truth: `.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql`

**Interfaces:**
- Applies to: Supabase project `nhogbeojfnbjcfipitrh`.
- Must preserve: existing notification, preference, subscription and chat RLS policies.

- [ ] **Step 1: Apply the exact reviewed migration through Supabase**

Use migration name `push_foreground_sessions` and the exact local SQL file.

- [ ] **Step 2: Verify catalog and security state**

Query `pg_policies`, `information_schema.role_table_grants`, `pg_proc`,
`pg_indexes`, and `information_schema.columns`. Assert that the session table
has RLS, no direct client grants, client RPCs are authenticated-only, and claim
is service-role-only.

- [ ] **Step 3: Run a rollback-only behavioural probe**

Inside one explicit transaction:

1. Select an existing active subscription owner without returning identifiers.
2. Insert a synthetic unread notification and let the existing trigger enqueue it.
3. Insert an unexpired foreground session for that owner.
4. Assert `push_outbox_claim` returns zero synthetic rows.
5. Delete the synthetic session.
6. Assert claim returns the synthetic row with the supplied token.
7. Mark the notification read and assert it becomes `suppressed_at` with reason `read`.
8. Roll back the transaction.

Expected: every assertion succeeds and production row counts are unchanged.

- [ ] **Step 4: Regenerate and check database types**

Run: `pnpm supabase:typegen`

Run: `pnpm db:types:check`

Expected: generated types include the new server schema and the drift checker
has no new unexplained app-facing drift.

### Task 6: Deploy Edge and accelerate the existing Cron job

**Files:**
- Deploy: `supabase/functions/send-push-notifications/index.ts`

**Interfaces:**
- Preserves Edge authentication: `verify_jwt=false` because the existing
  function validates the Vault-backed custom dispatch token.
- Alters only Cron job `kub-send-push-notifications`.

- [ ] **Step 1: Deploy the reviewed Edge Function**

Upload the single entrypoint with `verify_jwt=false`, preserving all existing
environment secrets without reading or printing them.

- [ ] **Step 2: Smoke invoke through the existing Cron path**

Confirm a new Edge version returns HTTP 200 while the outbox is empty. Do not
insert a committed synthetic notification.

- [ ] **Step 3: Alter the Cron schedule**

Execute:

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'kub-send-push-notifications'),
  schedule := '10 seconds'
);
```

- [ ] **Step 4: Verify cadence and non-overlap**

Observe at least three successful runs. Confirm schedule `10 seconds`, status
`succeeded`, HTTP 200 Edge logs, and no concurrent run buildup.

### Task 7: Full verification and handoff

**Files:**
- Update: `.codex-local/IOS_MACOS_CHAT_CONTEXT.md` (excluded from Git)

**Interfaces:**
- Produces: evidence-backed local and production verification report.

- [ ] **Step 1: Run relevant unit tests**

Run all notification, foreground, heartbeat and service-worker unit tests with
`node --test`.

Expected: zero failures.

- [ ] **Step 2: Run compile and build**

Run: `pnpm --filter @workspace/kub run typecheck`

Run: `$env:PORT=5173; $env:BASE_PATH='/'; pnpm --filter @workspace/kub run build`

Expected: both exit 0; existing Vite size/source-map warnings are non-failing.

- [ ] **Step 3: Run mobile E2E**

Run: `pnpm exec playwright test tests/e2e/pwa.spec.ts tests/e2e/push-phone-foundation.spec.ts --project=chromium-mobile-390`

Expected: all tests pass.

- [ ] **Step 4: Run Supabase advisors**

Fetch security and performance advisors. Report any pre-existing notices
separately from migration-introduced issues and fix any introduced issue before
completion.

- [ ] **Step 5: Verify final diff and context**

Run: `git diff --check`, inspect `git status --short`, confirm no test server is
listening on port 5173, and record the final design/rollout state in the local
iOS/macOS context file.

- [ ] **Step 6: Report deployment boundary**

State explicitly that SQL, Edge, and Cron are live, while the foreground lease
will begin working only after the normal GitHub/Coolify frontend deployment.
