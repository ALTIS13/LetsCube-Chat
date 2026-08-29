# Registration Lifecycle Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track public and invite registrations server-side, provide a safe resend experience, and automatically delete only never-confirmed, never-used accounts after the approved grace periods.

**Architecture:** The trusted `auth-yandex-gateway` records lifecycle state through service-role-only RPCs after Supabase Auth accepts a signup. An hourly API worker claims bounded candidates from a private table, rechecks eligibility, and deletes through Supabase Admin API. The worker launches in report-only mode before deletion is enabled.

**Tech Stack:** Supabase Auth/Postgres/RLS, Deno Edge Functions, Node.js/TypeScript, Express worker runtime, React, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`

## Global Constraints

- Public registrations become eligible after 72 hours; invite registrations after 7 days.
- One resend may extend the absolute deadline to at most 7 days for public or 14 days for invite signup.
- Existing unconfirmed rows receive at least 24 hours of grace after enablement.
- Delete only when email and phone are unconfirmed, no successful sign-in exists, no product activity exists, and no administrative hold exists.
- Service/admin identities and bots are never cleanup candidates.
- Run report-only before enabling deletion.
- Never expose `service_role`, user emails, phone numbers or Auth credentials to frontend code or logs.
- Use `pnpm.cmd`, PowerShell 7 and the existing self-hosted Supabase backup/apply workflow.

---

### Task 1: Add the private lifecycle schema and contract tests

**Files:**
- Create: `.migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql`
- Create: `tests/unit/registration-lifecycle-schema-contract.test.mjs`
- Modify: `scripts/check-database-type-drift.mjs`

**Interfaces:**
- Produces: `public.registration_lifecycle_register_internal(uuid,text,text) -> void`
- Produces: `public.registration_lifecycle_extend_by_email_internal(text) -> boolean`
- Produces: `public.registration_cleanup_claim(integer,uuid,timestamptz) -> table(user_id uuid, signup_kind text)`
- Produces: `public.registration_cleanup_recheck(uuid,uuid,timestamptz) -> boolean`
- Produces: `public.registration_cleanup_finish(uuid,uuid,text,text) -> void`
- Security: every lifecycle RPC is executable by `service_role` only.

- [ ] **Step 1: Write the failing migration contract test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  ".migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql",
  "utf8",
);

test("registration lifecycle stays private and service-role-only", () => {
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create table private\.registration_lifecycles/i);
  assert.match(sql, /revoke all on function public\.registration_cleanup_claim/i);
  assert.match(sql, /grant execute on function public\.registration_cleanup_claim[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to anon/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to authenticated/i);
});

test("cleanup requires an unconfirmed and unused auth account", () => {
  assert.match(sql, /email_confirmed_at is null/i);
  assert.match(sql, /phone_confirmed_at is null/i);
  assert.match(sql, /last_sign_in_at is null/i);
  assert.match(sql, /from public\.messages/i);
  assert.match(sql, /for update skip locked/i);
});
```

- [ ] **Step 2: Run the contract test and verify it fails because the migration is absent**

Run: `node --test tests/unit/registration-lifecycle-schema-contract.test.mjs`

Expected: FAIL with `ENOENT` for `20260830103000_registration_lifecycle_cleanup.sql`.

- [ ] **Step 3: Add the private lifecycle tables and indexes**

```sql
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.registration_lifecycles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signup_kind text not null check (signup_kind in ('public', 'invite')),
  invite_code_hash text null,
  created_at timestamptz not null default now(),
  eligible_at timestamptz not null,
  extension_used boolean not null default false,
  admin_hold_at timestamptz null,
  claim_token uuid null,
  claimed_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text null,
  updated_at timestamptz not null default now()
);

create table private.registration_cleanup_audit (
  id bigint generated always as identity primary key,
  user_reference uuid not null,
  action text not null check (action in ('reported', 'deleted', 'skipped', 'failed')),
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index registration_lifecycles_due_idx
  on private.registration_lifecycles (eligible_at, claimed_at)
  where admin_hold_at is null;
create index registration_cleanup_audit_retention_idx
  on private.registration_cleanup_audit (created_at);
```

- [ ] **Step 4: Add service-role-only registration and extension RPCs**

```sql
create or replace function public.registration_lifecycle_register_internal(
  p_user_id uuid,
  p_signup_kind text,
  p_invite_code_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_created_at timestamptz;
  v_eligible_at timestamptz;
begin
  if p_signup_kind not in ('public', 'invite') then
    raise exception 'registration_kind_invalid' using errcode = '22023';
  end if;
  select created_at into strict v_created_at from auth.users where id = p_user_id;
  v_eligible_at := v_created_at + case when p_signup_kind = 'invite' then interval '7 days' else interval '72 hours' end;
  insert into private.registration_lifecycles(user_id, signup_kind, invite_code_hash, created_at, eligible_at)
  values (p_user_id, p_signup_kind, p_invite_code_hash, v_created_at, v_eligible_at)
  on conflict (user_id) do nothing;
end $$;

revoke all on function public.registration_lifecycle_register_internal(uuid,text,text) from public, anon, authenticated;
grant execute on function public.registration_lifecycle_register_internal(uuid,text,text) to service_role;
```

Implement `registration_lifecycle_extend_by_email_internal(text)` with the same grants. It normalizes the email inside the function, locates only an unconfirmed lifecycle row through `auth.users`, sets `extension_used = true`, and clamps `eligible_at` with:

```sql
least(
  case when l.signup_kind = 'invite' then l.created_at + interval '14 days'
       else l.created_at + interval '7 days' end,
  greatest(l.eligible_at, now() + interval '72 hours')
)
```

- [ ] **Step 5: Add atomic claim, recheck and finish RPCs**

The private eligibility predicate must require the three Auth timestamps to be null, no admin hold, and no rows in user-generated activity tables. Invite provisioning rows do not count as activity.

```sql
and not exists (select 1 from public.messages m where m.user_id = u.id)
and not exists (select 1 from public.tasks t where t.created_by = u.id or t.assignee_id = u.id)
and not exists (
  select 1 from public.profile_contacts pc
  where pc.user_id = u.id and pc.phone_verified
)
```

`registration_cleanup_claim` selects due rows in a bounded CTE with `for update skip locked`, sets `claim_token`, `claimed_at` and increments `attempt_count`. `registration_cleanup_recheck` repeats every eligibility condition and requires the same claim token. `registration_cleanup_finish` clears or records the claim and inserts only a PII-free audit reason.

- [ ] **Step 6: Add a bounded existing-row backfill function**

Create `registration_lifecycle_backfill_internal(p_limit integer, p_enabled_at timestamptz)` for `service_role`. It inserts only unconfirmed Auth users without a lifecycle row and uses `greatest(u.created_at + interval '72 hours', p_enabled_at + interval '24 hours')`. It excludes global `owner`/`tech_admin` roles and does not run automatically in the migration.

- [ ] **Step 7: Run contract and database-type checks**

Run:

```powershell
node --test tests/unit/registration-lifecycle-schema-contract.test.mjs
pnpm.cmd db:types:check
git diff --check
```

Expected: contract PASS; type drift either PASS or reports only the intentionally private tables/RPCs that were added to the allowlist.

- [ ] **Step 8: Commit the schema proposal**

```powershell
git add .migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql tests/unit/registration-lifecycle-schema-contract.test.mjs scripts/check-database-type-drift.mjs
git commit -m "feat(auth): propose registration lifecycle cleanup"
```

---

### Task 2: Record lifecycle and support confirmation resend in the auth gateway

**Files:**
- Create: `supabase/functions/auth-yandex-gateway/registrationLifecycle.mjs`
- Create: `tests/security/auth-yandex-registration-lifecycle.test.mjs`
- Modify: `supabase/functions/auth-yandex-gateway/index.ts`
- Modify: `supabase/functions/auth-yandex-gateway/rateLimit.mjs`
- Modify: `artifacts/kub/src/lib/authGateway.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: gateway action `resend_signup` with `{ email, captchaToken, redirectTo }`.
- Consumes: service-role lifecycle RPCs from Task 1.
- Preserves: existing `signup` and `recovery` enumeration-safe responses.

- [ ] **Step 1: Write failing lifecycle helper tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleKind, lifecycleRpcBody, normalizeLifecycleUserId } from "../../supabase/functions/auth-yandex-gateway/registrationLifecycle.mjs";

test("invite presence selects invite lifecycle", () => {
  assert.equal(lifecycleKind("STAFF-2026"), "invite");
  assert.equal(lifecycleKind(null), "public");
});

test("only UUID auth response ids are accepted", () => {
  assert.equal(normalizeLifecycleUserId({ id: "5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8" }), "5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8");
  assert.equal(normalizeLifecycleUserId({ id: "not-a-user" }), null);
});

test("RPC body never carries plaintext email or invite code", () => {
  const body = lifecycleRpcBody("5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8", "invite", "ABCDEF");
  assert.equal("email" in body, false);
  assert.equal(JSON.stringify(body).includes("ABCDEF"), false);
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `node --test tests/security/auth-yandex-registration-lifecycle.test.mjs`

Expected: FAIL because `registrationLifecycle.mjs` does not exist.

- [ ] **Step 3: Implement the pure lifecycle helpers**

```js
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const lifecycleKind = (inviteCode) => inviteCode ? "invite" : "public";
export const normalizeLifecycleUserId = (user) =>
  user && typeof user.id === "string" && UUID.test(user.id) ? user.id : null;
export const lifecycleRpcBody = (userId, kind, inviteCode) => ({
  p_user_id: userId,
  p_signup_kind: kind,
  p_invite_code_hash: inviteCode
    ? createHash("sha256").update(inviteCode).digest("hex")
    : null,
});
```

- [ ] **Step 4: Extend the gateway action and Auth endpoint call**

Add `resend_signup` to `GatewayAction`, request parsing and rate-limit keys. Call `POST /auth/v1/resend` with:

```ts
{
  type: "signup",
  email,
  options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
}
```

The action still requires SmartCaptcha and returns `{ ok: true }` for enumeration safety. It must never log the email.

- [ ] **Step 5: Record lifecycle after a new signup**

Read `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function. After a successful new signup, parse the returned `user.id` and call `/rest/v1/rpc/registration_lifecycle_register_internal` with `lifecycleRpcBody`. Existing-account generic success has no lifecycle write. A lifecycle write failure logs only status and error code and leaves the new account undeleted rather than rolling back Auth.

- [ ] **Step 6: Extend lifecycle after a successful resend**

After Auth accepts the resend, call `registration_lifecycle_extend_by_email_internal` with the service-role header. The email is present only in the request body to the trusted RPC and must not be included in logs or responses.

- [ ] **Step 7: Extend the frontend gateway request type**

```ts
type AuthGatewayAction = "signup" | "recovery" | "resend_signup";

type ResendSignupPayload = {
  action: "resend_signup";
  email: string;
  captchaToken: string;
  redirectTo?: string;
};
```

- [ ] **Step 8: Run gateway tests and typecheck**

Run:

```powershell
pnpm.cmd auth:security:test
node --test tests/security/auth-yandex-registration-lifecycle.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
```

Expected: all PASS and no service-role reference appears under `artifacts/kub/src`.

- [ ] **Step 9: Commit the gateway lifecycle integration**

```powershell
git add supabase/functions/auth-yandex-gateway artifacts/kub/src/lib/authGateway.ts tests/security/auth-yandex-registration-lifecycle.test.mjs package.json
git commit -m "feat(auth): track pending registration lifecycle"
```

---

### Task 3: Add the report-only cleanup worker

**Files:**
- Create: `artifacts/api-server/src/workers/registrationCleanupRules.ts`
- Create: `artifacts/api-server/src/workers/registrationCleanupRepository.ts`
- Create: `artifacts/api-server/src/workers/registrationCleanupWorker.ts`
- Create: `tests/unit/registration-cleanup-rules.test.mts`
- Create: `tests/unit/registration-cleanup-worker-contract.test.mjs`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/build.mjs`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Produces: `readRegistrationCleanupConfig(env) -> RegistrationCleanupConfig`.
- Produces: `runRegistrationCleanupBatch(config, repository) -> CleanupBatchResult`.
- Defaults: disabled and report-only; batch 50; interval 3,600,000 ms.

- [ ] **Step 1: Write failing configuration tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readRegistrationCleanupConfig } from "../../artifacts/api-server/src/workers/registrationCleanupRules.ts";

test("cleanup is disabled and report-only by default", () => {
  const config = readRegistrationCleanupConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.reportOnly, true);
  assert.equal(config.batchSize, 50);
  assert.equal(config.intervalMs, 3_600_000);
});

test("batch and interval stay bounded", () => {
  const config = readRegistrationCleanupConfig({
    REGISTRATION_CLEANUP_ENABLED: "true",
    REGISTRATION_CLEANUP_REPORT_ONLY: "false",
    REGISTRATION_CLEANUP_BATCH_SIZE: "5000",
    REGISTRATION_CLEANUP_INTERVAL_SECONDS: "1",
  });
  assert.equal(config.batchSize, 100);
  assert.equal(config.intervalMs, 60_000);
});
```

- [ ] **Step 2: Run the configuration test and verify it fails**

Run: `node --test tests/unit/registration-cleanup-rules.test.mts`

Expected: FAIL because the rules module is absent.

- [ ] **Step 3: Implement bounded configuration parsing**

```ts
export type RegistrationCleanupConfig = {
  enabled: boolean;
  reportOnly: boolean;
  batchSize: number;
  intervalMs: number;
};

export function readRegistrationCleanupConfig(env: NodeJS.ProcessEnv): RegistrationCleanupConfig {
  const batch = Number(env.REGISTRATION_CLEANUP_BATCH_SIZE ?? 50);
  const seconds = Number(env.REGISTRATION_CLEANUP_INTERVAL_SECONDS ?? 3600);
  return {
    enabled: env.REGISTRATION_CLEANUP_ENABLED === "true",
    reportOnly: env.REGISTRATION_CLEANUP_REPORT_ONLY !== "false",
    batchSize: Math.min(100, Math.max(1, Number.isFinite(batch) ? Math.floor(batch) : 50)),
    intervalMs: Math.min(86_400_000, Math.max(60_000, Number.isFinite(seconds) ? Math.floor(seconds * 1000) : 3_600_000)),
  };
}
```

- [ ] **Step 4: Implement the repository with service-role-only access**

`registrationCleanupRepository.ts` creates a non-persisted Supabase client from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It exposes:

```ts
export type CleanupCandidate = { user_id: string; signup_kind: "public" | "invite" };
export interface RegistrationCleanupRepository {
  claim(limit: number, claimToken: string, now: string): Promise<CleanupCandidate[]>;
  recheck(userId: string, claimToken: string, now: string): Promise<boolean>;
  report(userId: string, claimToken: string, reason: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  finish(userId: string, claimToken: string, action: "deleted" | "skipped" | "failed", reason: string): Promise<void>;
}
```

Errors are converted to bounded reason codes. Raw Supabase payloads and user identifiers are not logged at info level.

- [ ] **Step 5: Write and implement batch behavior tests**

Test a fake repository for these exact outcomes: report-only never calls `deleteAuthUser`; active mode rechecks before delete; failed recheck records `skipped`; delete failure records `failed`; one candidate failure does not stop the batch.

Core implementation:

```ts
for (const candidate of await repository.claim(config.batchSize, claimToken, now)) {
  if (!(await repository.recheck(candidate.user_id, claimToken, now))) {
    await repository.finish(candidate.user_id, claimToken, "skipped", "eligibility_changed");
    continue;
  }
  if (config.reportOnly) {
    await repository.report(candidate.user_id, claimToken, "report_only");
    continue;
  }
  try {
    await repository.deleteAuthUser(candidate.user_id);
    await repository.finish(candidate.user_id, claimToken, "deleted", "expired_unconfirmed");
  } catch {
    await repository.finish(candidate.user_id, claimToken, "failed", "delete_failed");
  }
}
```

- [ ] **Step 6: Start the worker only when explicitly enabled**

Import `startRegistrationCleanupWorker` from `index.ts`. The starter schedules the next run after the previous promise settles, uses `unref()`, and never overlaps runs. Add a build contract test asserting the entry is bundled and the default remains disabled.

- [ ] **Step 7: Run worker tests and API build**

Run:

```powershell
node --test tests/unit/registration-cleanup-rules.test.mts tests/unit/registration-cleanup-worker-contract.test.mjs
pnpm.cmd --filter @workspace/api-server run typecheck
pnpm.cmd --filter @workspace/api-server run build
```

Expected: all PASS.

- [ ] **Step 8: Commit the worker**

```powershell
git add artifacts/api-server tests/unit/registration-cleanup-rules.test.mts tests/unit/registration-cleanup-worker-contract.test.mjs
git commit -m "feat(auth): add report-only registration cleanup worker"
```

---

### Task 4: Build the registration confirmation and resend UI

**Files:**
- Create: `artifacts/kub/src/lib/registrationConfirmation.ts`
- Create: `tests/unit/registration-confirmation.test.mts`
- Modify: `artifacts/kub/src/components/auth/RegisterForm.tsx`
- Modify: `tests/e2e/letscube-brand-auth-layout.spec.ts`
- Create: `tests/e2e/registration-confirmation.spec.ts`

**Interfaces:**
- Produces: `maskRegistrationEmail(email: string) -> string`.
- Produces: 60-second resend countdown and the approved enumeration-safe copy.
- Consumes: `requestAuthGateway({ action: "resend_signup", ... })`.

- [ ] **Step 1: Write failing email-mask tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { maskRegistrationEmail } from "../../artifacts/kub/src/lib/registrationConfirmation.ts";

test("registration email mask keeps enough context without echoing the full address", () => {
  assert.equal(maskRegistrationEmail("seraltis13@gmail.com"), "s***3@gmail.com");
  assert.equal(maskRegistrationEmail("a@x.ru"), "a***@x.ru");
  assert.equal(maskRegistrationEmail("invalid"), "");
});
```

- [ ] **Step 2: Run the unit test and verify it fails**

Run: `node --test tests/unit/registration-confirmation.test.mts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the bounded mask helper**

```ts
export function maskRegistrationEmail(value: string): string {
  const [local, domain, extra] = value.trim().toLowerCase().split("@");
  if (!local || !domain || extra) return "";
  const visible = local.length === 1 ? local : `${local[0]}***${local.at(-1)}`;
  return `${visible}${local.length === 1 ? "***" : ""}@${domain}`;
}
```

- [ ] **Step 4: Replace the success copy and preserve the submitted email**

Store the normalized submitted email before setting success. Render the exact approved text from section 12 of the spec, the masked address, `Ко входу`, `Указать другой email`, and a resend button. Do not render the recovery warning or suggest recovery as the correction path.

- [ ] **Step 5: Add a 60-second resend flow**

The resend button is disabled while the countdown is above zero or the request is active. A resend requires a fresh CAPTCHA token, calls `resend_signup`, resets the CAPTCHA, starts a new 60-second countdown, and displays a short success confirmation. Failure uses `mapPgError` and never exposes Auth payloads.

- [ ] **Step 6: Add browser layout and copy tests**

The Playwright test must assert:

```ts
await expect(page.getByText("Неподтверждённая учётная запись будет удалена автоматически.")).toBeVisible();
await expect(page.getByText("Восстановить пароль")).toHaveCount(0);
await expect(page.getByRole("button", { name: /Отправить письмо повторно/ })).toBeDisabled();
```

Cover `1440x900`, `390x844` and `412x915`, with no horizontal scroll and all controls reachable.

- [ ] **Step 7: Run frontend validation**

Run:

```powershell
node --test tests/unit/registration-confirmation.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/registration-confirmation.spec.ts tests/e2e/letscube-brand-auth-layout.spec.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit the UI**

```powershell
git add artifacts/kub/src/components/auth/RegisterForm.tsx artifacts/kub/src/lib/registrationConfirmation.ts tests/unit/registration-confirmation.test.mts tests/e2e/registration-confirmation.spec.ts tests/e2e/letscube-brand-auth-layout.spec.ts
git commit -m "feat(auth): add pending registration confirmation flow"
```

---

### Task 5: Rehearse, apply and canary the cleanup safely

**Files:**
- Create: `scripts/registration-cleanup-smoke.mjs`
- Create: `docs/operations/registration-lifecycle-cleanup.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`

**Interfaces:**
- Consumes: migration, gateway and worker from Tasks 1-4.
- Produces: repeatable read-only/report-only production evidence before deletion is enabled.

- [ ] **Step 1: Write a failing smoke-script contract test**

Create `tests/unit/registration-cleanup-smoke-contract.test.mjs` asserting the script requires explicit `REGISTRATION_CLEANUP_SMOKE=1`, never prints email/phone fields, and supports `--report-only`.

- [ ] **Step 2: Implement the smoke script**

The script loads the existing ignored production env, calls only lifecycle count/report RPCs, prints aggregate counts by `signup_kind` and reason, and exits non-zero if a candidate has confirmation, sign-in or activity evidence.

- [ ] **Step 3: Verify a fresh server backup and transaction rehearsal**

Use the existing self-hosted backup workflow. Record only the backup path and timestamp, not credentials. Run the migration inside `BEGIN`/`ROLLBACK`, check tables, functions, grants and query plans, then apply only after the rehearsal passes.

- [ ] **Step 4: Deploy gateway and worker in report-only mode**

Set these Coolify values without printing them:

```text
REGISTRATION_CLEANUP_ENABLED=true
REGISTRATION_CLEANUP_REPORT_ONLY=true
REGISTRATION_CLEANUP_BATCH_SIZE=50
REGISTRATION_CLEANUP_INTERVAL_SECONDS=3600
```

Deploy the gateway and worker, then verify health checks and one report-only interval.

- [ ] **Step 5: Backfill and inspect existing unconfirmed registrations**

Call the service-role backfill with the recorded enablement timestamp. Confirm every inserted row has at least 24 hours of grace and that known owner/admin accounts are absent.

- [ ] **Step 6: Run complete validation**

Run:

```powershell
git diff --check
pnpm.cmd typecheck
pnpm.cmd e2e:smoke
pnpm.cmd db:types:check
pnpm.cmd rls:smoke
pnpm.cmd auth:security:test
node --test tests/unit/registration-lifecycle-schema-contract.test.mjs tests/security/auth-yandex-registration-lifecycle.test.mjs tests/unit/registration-cleanup-rules.test.mts tests/unit/registration-cleanup-worker-contract.test.mjs tests/unit/registration-confirmation.test.mts tests/unit/registration-cleanup-smoke-contract.test.mjs
```

Expected: all PASS. Record warnings and deliberate private-schema type exclusions.

- [ ] **Step 7: Enable deletion only after report approval**

Change only `REGISTRATION_CLEANUP_REPORT_ONLY=false`, redeploy, and observe one bounded batch. Confirm deleted candidates were still unconfirmed and unused at final recheck. Keep the feature flag available for immediate rollback.

- [ ] **Step 8: Update the tracker and commit operational evidence**

```powershell
git add scripts/registration-cleanup-smoke.mjs tests/unit/registration-cleanup-smoke-contract.test.mjs docs/operations/registration-lifecycle-cleanup.md docs/PRODUCTION_PRIORITY_TRACKER.md
git commit -m "docs(auth): record registration cleanup rollout"
```
