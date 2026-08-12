# P1SMS Phone Verification Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled SMS.RU transport scaffold with a secure, still-disabled p1sms OTP adapter without affecting other LETSCUBE services that share the provider account.

**Status:** complete in source and local validation; production delivery remains disabled and no real SMS was sent.

**Architecture:** Supabase Auth remains responsible for OTP generation and verification. The signed Send SMS Hook authorizes an active HMAC phone claim, then invokes one narrow p1sms adapter which can only send one immediate `digit` message through `POST /apiSms/create`; it never calls account, sender, history, reject, scheduling or balance APIs.

**Tech Stack:** Supabase Auth HTTP hooks, Supabase Edge Functions/Deno, Standard Webhooks, Node test runner, p1sms JSON API.

## Global Constraints

- Never expose or log the p1sms API key, full phone, OTP, provider body or provider response.
- Keep `SMS_DELIVERY_ENABLED=false` until a separately approved physical smoke test.
- Keep each OTP SMS at 65 characters or fewer.
- Do not automatically retry an ambiguous provider timeout.
- Do not send a real SMS, deploy Edge Functions, apply SQL or enable phone Auth in this implementation stage.
- Do not call any p1sms endpoint except `https://admin.p1sms.ru/apiSms/create` from runtime code.
- Preserve the existing HMAC claim, webhook idempotency and server-side rate-limit proposal.

---

### Task 1: Lock the p1sms transport contract

**Files:**
- Create: `tests/unit/p1sms-adapter.test.mjs`
- Create: `tests/unit/p1sms-phone-foundation-contract.test.mjs`

**Interfaces:**
- Produces: `renderSmsOtp(otp)`, `buildP1SmsRequest(input)`, `sendP1Sms(input, fetchImpl)`.

- [x] Write tests for the exact 46-character OTP text and 65-character ceiling.
- [x] Write tests proving the credential is absent from the URL, the body contains one `digit` SMS, the phone is converted from `+7` E.164 to 11 digits and the tag is `letscube-otp`.
- [x] Write tests for disabled no-network behavior, malformed inputs, accepted/rejected provider responses and an ambiguous timeout with exactly one network attempt.
- [x] Run the focused suite in its red state before implementing the adapter.

### Task 2: Implement the narrow provider adapter

**Files:**
- Create: `supabase/functions/auth-send-sms/p1sms.mjs`
- Modify: `supabase/functions/auth-send-sms/index.ts`
- Delete: `supabase/functions/auth-send-sms/smsRu.mjs`

**Interfaces:**
- Consumes: server-only `P1SMS_API_KEY`, E.164 phone and six-digit OTP.
- Produces: `{ ok: boolean, category: string }` with safe categories only.

- [x] Implement strict input validation and the single allowed endpoint constant.
- [x] Build a JSON request containing one immediate `digit` message and no webhook, sender, schedule, randomizer, links or cascade configuration.
- [x] Parse only the minimal p1sms success envelope and map all failures to bounded safe categories.
- [x] Replace SMS.RU imports/env names in the Send SMS Hook with p1sms equivalents while retaining the disabled gate before provider configuration access.
- [x] Run the focused tests and verify they pass.

### Task 3: Update security contracts and operations documentation

**Files:**
- Rename: `tests/unit/smsru-phone-foundation-contract.test.mjs` to `tests/unit/p1sms-phone-foundation-contract.test.mjs`
- Modify: `docs/PHONE_VERIFICATION.md`
- Modify: `docs/PRODUCTION_GAP_CHECKLIST.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/infra/PHONE_VERIFICATION_RUNBOOK.md`
- Modify: `docs/superpowers/specs/2026-08-10-neutral-ui-smsru-phone-onboarding-design.md`
- Modify: `docs/superpowers/plans/2026-08-10-neutral-ui-smsru-support-hardening-plan.md`

**Interfaces:**
- Documents secret `P1SMS_API_KEY` by name only and the disabled activation sequence.

- [x] Replace current provider references with p1sms while preserving historical migration filenames where renaming would create migration ambiguity.
- [x] Document that the shared LETSCUBE account must not be modified by runtime code and that the key must be injected only as an Edge Function/Coolify secret.
- [x] Document controlled activation and rollback without including credential values.

### Task 4: Verify without contacting the SMS provider

**Files:**
- No additional source files.

- [x] Run focused Node tests.
- [x] Run `git diff --check`.
- [x] Run `pnpm.cmd --filter @workspace/kub run typecheck`.
- [x] Run `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`.
- [x] Run relevant smoke, DB type and RLS checks.
- [x] Scan source, docs and Git history for secret values, frontend service-role usage and stale active SMS.RU runtime references.
- [x] Confirm `.ops-private` remains ignored, its NTFS ACL is restricted and no p1sms credential is tracked.
