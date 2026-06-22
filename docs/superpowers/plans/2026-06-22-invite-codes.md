# Invite Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed registration invite codes/links with usage limits and pre-assigned global role/location membership.

**Architecture:** Store invite definitions server-side and consume them through `auth-yandex-gateway` during signup. Admin UI manages invites through RPCs; public registration only sends an invite code to the gateway and never receives role/location internals beyond safe validation copy.

**Tech Stack:** React/Vite, Supabase Edge Functions, Postgres/RLS/RPC migration proposal, Playwright, Node test runner.

---

### Task 1: Gateway Invite Payload Contract

**Files:**
- Modify: `supabase/functions/auth-yandex-gateway/index.ts`
- Modify: `artifacts/kub/src/lib/authGateway.ts`
- Test: `tests/security/auth-yandex-gateway-payload.test.mjs`

- [ ] **Step 1:** Write failing tests proving signup payload may include `inviteCode`, recovery payload may not, and unsafe overlong codes are normalized away.
- [ ] **Step 2:** Run `node --test tests/security/auth-yandex-gateway-payload.test.mjs`; expected failure because helper exports do not exist.
- [ ] **Step 3:** Extract small pure payload helpers from frontend/backend so tests can exercise normalization without Deno runtime.
- [ ] **Step 4:** Run the test until it passes.

### Task 2: Database Proposal

**Files:**
- Create: `.migration-backup/supabase/migrations/20260622_registration_invite_codes.sql`
- Modify: `artifacts/kub/src/types/database.ts`

- [ ] **Step 1:** Create proposal only; do not apply SQL automatically.
- [ ] **Step 2:** Define `registration_invites` with RLS, generated public code, usage limit, expiry, revoked state, optional `global_role_id`, optional `location_id`, optional `location_role_id`, optional `primary_admin_id`.
- [ ] **Step 3:** Add admin RPCs: `registration_invite_create`, `registration_invite_revoke`, `registration_invites_list`.
- [ ] **Step 4:** Add signup RPC: `registration_invite_consume(p_code text, p_user_id uuid)` for gateway/backend use after successful signup/profile creation.
- [ ] **Step 5:** Add manual apply/checklist comments in the migration.

### Task 3: Admin Invite UI

**Files:**
- Create: `artifacts/kub/src/pages/admin/InvitesTab.tsx`
- Modify: `artifacts/kub/src/pages/admin/AdminLayout.tsx`

- [ ] **Step 1:** Add tab "Инвайты" for admins only.
- [ ] **Step 2:** Load locations and dynamic roles from existing hooks.
- [ ] **Step 3:** Let admin create invite with label, max uses, expiry days, global role, club, club role and primary admin.
- [ ] **Step 4:** Show active/revoked/expired/used invite rows with copyable link/code.
- [ ] **Step 5:** Gracefully show "требуется обновление базы" when RPC/table is missing.

### Task 4: Registration Form

**Files:**
- Modify: `artifacts/kub/src/components/auth/RegisterForm.tsx`
- Modify: `artifacts/kub/src/lib/authGateway.ts`

- [ ] **Step 1:** Read invite code from query params (`invite` or `code`) and show a field.
- [ ] **Step 2:** Include invite code only for signup gateway payload.
- [ ] **Step 3:** Map `invite_required`, `invite_invalid`, `invite_expired`, `invite_used` to friendly Russian copy.
- [ ] **Step 4:** Keep existing generic success copy and existing account safety behavior.

### Task 5: QA And Validation

**Files:**
- Create or modify: `tests/e2e/auth-yandex-captcha.spec.ts`
- Create or modify: `tests/e2e/roles-visibility.spec.ts`

- [ ] **Step 1:** Add Playwright check that `/register?invite=ABC123` keeps the invite code field populated and sends it through the gateway.
- [ ] **Step 2:** Add admin tab smoke if auth state exists; otherwise skip honestly.
- [ ] **Step 3:** Run `git diff --check`, unit tests, `pnpm.cmd --filter @workspace/kub run typecheck`, production build and targeted Playwright.
- [ ] **Step 4:** Run guard scans for secrets/service_role.
