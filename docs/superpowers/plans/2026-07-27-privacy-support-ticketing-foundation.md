# Privacy and Support Ticketing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a complete LETSCUBE privacy policy and deliver a secure, DNS-independent support ticket/chat foundation for guests, users, and authorized operators.

**Architecture:** Public `/privacy` and `/support` routes render before the authenticated application gate. Anonymous support traffic goes only through a new `support-gateway` Edge Function that validates Yandex SmartCaptcha, rate limits requests, and uses trusted server credentials; browsers never insert support rows directly. A proposal-only Supabase migration provides ticket, guest-session, message, event, policy-acceptance, operator-preference, and settings storage with permission-aware RPCs and RLS. Authorized operators work from `/admin/support`; Notification Center receives support events without exposing private contact data.

**Tech Stack:** React 19, TypeScript, Wouter, Tailwind/KUB components, Supabase Postgres/Auth/Realtime/Edge Functions, Yandex SmartCaptcha, Node test runner, Playwright.

## Global Constraints

- SQL may be applied under the user's standing approval only after a read-only live-schema audit, confirmation of a current backup/restore point, source/RLS tests, and a transactional safety review.
- Do not deploy an Edge Function before its required schema has passed post-apply smoke checks.
- Do not use `service_role` in frontend code. Trusted keys remain in Edge Function secrets.
- Do not log guest secrets, contact data, CAPTCHA tokens, message bodies, or raw provider errors.
- Do not add SMTP/IMAP integration in this plan. Mailcow delivery follows after DNS validation.
- Do not enable guest attachments until MIME/signature validation and malware scanning exist.
- Preserve browser/PWA, Android, Windows, notification grouping/read-sync, and chat scroll behavior.
- Public legal/support routes must remain usable without a Supabase session.

---

## Task 1: Public Route Contract

**Files:**
- Create: `artifacts/kub/src/lib/publicRoutes.ts`
- Modify: `artifacts/kub/src/App.tsx`
- Test: `tests/unit/public-routes.test.mjs`

- [ ] Write a failing Node contract test asserting `/privacy` and `/support` are public while `/`, `/admin`, and `/tasks` remain protected.
- [ ] Run `node --test tests/unit/public-routes.test.mjs` and confirm the missing-module failure.
- [ ] Implement `isPublicRoute()` and `isAuthRoute()` as exact/prefix-safe route predicates.
- [ ] Render public routes before the unauthenticated redirect without bypassing auth callback/recovery behavior.
- [ ] Run the unit test and KUB typecheck.
- [ ] Commit: `Add public legal and support route contract`.

## Task 2: Privacy Policy Content and UI

**Files:**
- Create: `artifacts/kub/src/content/privacyPolicy.ts`
- Create: `artifacts/kub/src/pages/public/PublicPageShell.tsx`
- Create: `artifacts/kub/src/pages/public/PrivacyPage.tsx`
- Modify: `artifacts/kub/src/App.tsx`
- Modify: `artifacts/kub/src/components/auth/LoginForm.tsx`
- Modify: `artifacts/kub/src/components/auth/RegisterForm.tsx`
- Test: `tests/unit/privacy-policy-contract.test.mjs`
- Test: `tests/e2e/privacy-support-public.spec.ts`

- [ ] Write a failing policy contract test for operator identity, address, contacts, effective/version dates, data categories, recipients, retention, rights, minors, geolocation, push, and deletion sections.
- [ ] Write a failing Playwright test proving `/privacy` loads without auth, has one H1, a table of contents, print action, and no horizontal overflow at desktop/mobile widths.
- [ ] Implement versioned Russian policy content using structured sections rather than one uneditable HTML blob.
- [ ] Implement the public LETSCUBE shell with bounded header, accessible navigation, print styling, and links to `/support`, `/login`, and the main application.
- [ ] Add concise privacy links to login, registration, and recovery surfaces.
- [ ] Run unit, Playwright, typecheck, and build checks.
- [ ] Commit: `Publish LETSCUBE privacy policy`.

## Task 3: Support Domain Model and Client Safety

**Files:**
- Create: `artifacts/kub/src/lib/support/types.ts`
- Create: `artifacts/kub/src/lib/support/validation.ts`
- Create: `artifacts/kub/src/lib/support/errors.ts`
- Create: `artifacts/kub/src/lib/support/guestSessionStore.ts`
- Create: `artifacts/kub/src/lib/support/supportGateway.ts`
- Test: `tests/unit/support-validation.test.mjs`
- Test: `tests/unit/support-guest-session.test.mjs`

- [ ] Write failing tests for required name/email/E.164 phone/category/subject/message/privacy version fields and bounded lengths.
- [ ] Write failing tests for gateway error sanitization and guest secret persistence rules.
- [ ] Implement pure validators and Russian-friendly error mapping.
- [ ] Implement an IndexedDB guest-session store that never places the raw secret in URL, logs, or localStorage.
- [ ] Implement a typed gateway client that sends the guest secret only in a dedicated header and handles unavailable backend gracefully.
- [ ] Run unit tests and typecheck.
- [ ] Commit: `Add secure support client foundation`.

## Task 4: Shared Human Verification and Public Support UI

**Files:**
- Create: `artifacts/kub/src/components/security/HumanVerificationCaptcha.tsx`
- Modify: `artifacts/kub/src/components/auth/AuthCaptcha.tsx`
- Create: `artifacts/kub/src/pages/public/SupportPage.tsx`
- Create: `artifacts/kub/src/pages/public/SupportRequestForm.tsx`
- Create: `artifacts/kub/src/pages/public/GuestSupportChat.tsx`
- Modify: `artifacts/kub/src/App.tsx`
- Test: `tests/e2e/privacy-support-public.spec.ts`

- [ ] Extend the Playwright test with a mocked Yandex widget and mocked support-gateway.
- [ ] Assert all required fields, privacy acceptance, honeypot behavior, CAPTCHA enforcement, immediate chat opening, message sending, reload recovery, responsive layout, and no raw technical errors.
- [ ] Extract the existing theme-aware CAPTCHA runtime into a shared component while retaining `AuthCaptcha` compatibility.
- [ ] Implement the support form and immediate guest chat state.
- [ ] Keep initial support messages text-only and clearly label email/phone as unverified contact data.
- [ ] Add idle/absolute session-expiry UI and an explicit “forget this request on this device” action.
- [ ] Run targeted Playwright, auth CAPTCHA regression, typecheck, and build.
- [ ] Commit: `Add public support request and guest chat UI`.

## Task 5: Supabase Migration Proposal

**Files:**
- Create: `.migration-backup/supabase/migrations/20260727_privacy_support_ticketing_foundation.sql`
- Create: `tests/unit/support-schema-contract.test.mjs`
- Create: `tests/rls/support-ticketing-smoke.mjs`
- Modify: `tests/rls/README.md`

- [ ] Write a failing source contract test for every required table, enum/status constraint, permission, RPC, RLS policy, revocation, realtime publication, audit event, and notification trigger.
- [ ] Create proposal tables: `privacy_policy_versions`, `privacy_acceptances`, `support_settings`, `support_tickets`, `support_ticket_contacts`, `support_guest_sessions`, `support_ticket_messages`, `support_ticket_events`, `support_operator_preferences`, `support_rate_limit_signals`, and `support_email_messages`.
- [ ] Store contact data and guest secrets separately; store only a server-side digest of guest secrets.
- [ ] Seed support permissions and grant all of them to owner/tech_admin roles without broadening legacy roles.
- [ ] Add authenticated self-service policies, permission-scoped operator policies, and deny direct anonymous table access.
- [ ] Add atomic RPCs for claim, transfer, return, escalate, waiting states, resolve, close, reopen, customer lookup, and settings update.
- [ ] Add support notifications that contain ticket metadata but no contact values or message bodies.
- [ ] Add indexes for pool/status/assignee/activity/session expiry and bounded retention helpers.
- [ ] Add RLS smoke scenarios for guest denial, user ownership, operator pool visibility, contact masking, claim race, and unauthorized transitions.
- [ ] Run source contract test and `git diff --check`.
- [ ] Before apply, verify the latest usable backup/restore point and record its timestamp without exposing credentials.
- [ ] Inspect live schema/migration history read-only, review the proposal for destructive statements and lock risk, then apply transactionally under the user's standing approval.
- [ ] Run post-apply schema, RPC, RLS, and existing auth/chat/push smoke checks; stop and rollback on regression.
- [ ] Commit: `Propose privacy and support ticket schema`.

## Task 6: Support Gateway Edge Function

**Files:**
- Create: `supabase/functions/support-gateway/index.ts`
- Create: `supabase/functions/support-gateway/rateLimit.mjs`
- Create: `supabase/functions/support-gateway/validation.mjs`
- Create: `tests/security/support-gateway-rate-limit.test.mjs`
- Create: `tests/security/support-gateway-validation.test.mjs`
- Test: `tests/unit/support-gateway-contract.test.mjs`

- [ ] Write failing tests for normalized email/phone, field bounds, minimum form-fill time, honeypot, per-IP/email/phone/session limits, and safe error codes.
- [ ] Write a source contract test for server-side SmartCaptcha validation, HMAC guest-secret hashing, no permissive CORS wildcard, no raw secret logging, and required environment variables.
- [ ] Implement `POST /tickets`, `GET /tickets/:id`, `POST /tickets/:id/messages`, session revocation, and recovery request endpoints.
- [ ] Enforce 3 new tickets per 15 minutes and 10 per day using persistent database signals, with an in-process limiter only as an additional guard.
- [ ] Generate guest secrets with Web Crypto, persist only HMAC digests, and return the raw value exactly once.
- [ ] Use a trusted server client only inside the Edge Function.
- [ ] Return bounded public ticket/message projections with no internal IDs beyond ticket/message IDs needed by the client.
- [ ] Run security/unit tests.
- [ ] Deploy only after the migration is safely applied and post-apply checks pass.
- [ ] Commit: `Add support gateway edge function`.

## Task 7: Operator Workspace and Permissions

**Files:**
- Create: `artifacts/kub/src/lib/support/operatorApi.ts`
- Create: `artifacts/kub/src/pages/admin/SupportTab.tsx`
- Create: `artifacts/kub/src/pages/admin/support/SupportQueue.tsx`
- Create: `artifacts/kub/src/pages/admin/support/SupportConversation.tsx`
- Create: `artifacts/kub/src/pages/admin/support/SupportTicketDetails.tsx`
- Modify: `artifacts/kub/src/pages/admin/AdminLayout.tsx`
- Modify: `artifacts/kub/src/lib/rolePermissions.ts`
- Test: `tests/e2e/support-operator.spec.ts`

- [ ] Write a failing multi-role Playwright test for hidden unauthorized tab, operator pool, atomic claim conflict, assigned conversation, transfer/return/escalate reasons, resolve/close/reopen, and settings gating.
- [ ] Add Russian labels/descriptions for all support permission keys and the support permission category.
- [ ] Gate `/admin/support` by `support.view`, actions by their specific permissions, and settings by `support.settings`.
- [ ] Implement pool/mine/urgent/waiting/resolved/spam tabs with bounded internal scrolling and mobile-safe layout.
- [ ] Display masked contacts in the pool and full contacts only after claim or `support.manage`.
- [ ] Implement ticket chat, immutable event timeline, close summary, and safe customer lookup with visible audit notice.
- [ ] Run targeted Playwright and role visibility regression tests.
- [ ] Commit: `Add support operator workspace`.

## Task 8: Notification Center Integration

**Files:**
- Modify: `artifacts/kub/src/components/sidebar/NotificationBell.tsx`
- Modify: `artifacts/kub/src/hooks/useNotifications.ts`
- Modify: `artifacts/kub/src/lib/platform/desktopNotifications.ts`
- Test: `tests/unit/support-notification-routing.test.mjs`
- Test: `tests/e2e/notification-center.spec.ts`
- Test: `tests/e2e/support-operator.spec.ts`

- [ ] Write failing tests for support category visibility, ticket route parsing, permission gating, no private preview data, and pool notification removal after claim.
- [ ] Add a “Поддержка” category for authorized operators only.
- [ ] Route support notifications to `/admin/support?ticket=<id>` and preserve malformed-payload safety.
- [ ] Keep message grouping, task visibility, read-sync, desktop native notifications, and browser push behavior unchanged.
- [ ] Add operator preference controls for new-pool, assigned, transfer, escalation, and reply events.
- [ ] Run notification, push, and support tests.
- [ ] Commit: `Integrate support notifications`.

## Task 9: Documentation, Validation, and Release Gate

**Files:**
- Create: `docs/SUPPORT_OPERATIONS.md`
- Modify: `docs/QA_RESULTS.md`
- Modify: `docs/PRODUCTION_GAP_CHECKLIST.md`
- Modify: `docs/PROJECT_COMPLETION_STATUS.md`

- [ ] Document support roles, queue workflow, guest recovery, abuse controls, retention, incident handling, and the no-attachment limitation.
- [ ] Document manual migration review/apply/rollback steps, Edge Function secrets, and deploy order.
- [ ] Record deferred Mailcow DNS/SMTP/IMAP, malware scanning, retention scheduler, and legal review.
- [ ] Run:
  - `git diff --check`
  - `pnpm.cmd --filter @workspace/kub run typecheck`
  - `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`
  - `pnpm.cmd e2e:smoke`
  - `pnpm.cmd db:types:check`
  - `pnpm.cmd rls:smoke`
  - all new unit/security tests
  - `pnpm.cmd exec playwright test tests/e2e/privacy-support-public.spec.ts`
  - `pnpm.cmd exec playwright test tests/e2e/support-operator.spec.ts`
  - `pnpm.cmd exec playwright test tests/e2e/notification-center.spec.ts`
  - `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`
- [ ] Run secret/service-role/raw-error guard scans and confirm `service_role` appears only in trusted backend/docs contexts.
- [ ] Use Playwright at 3840x2160, 1920x1080, 1440x900, 390x844, and 412x915 for public pages and the operator workspace.
- [ ] Record the migration safety review and backup checkpoint, apply under the user's standing approval, generate DB types, deploy `support-gateway`, set secrets, and rerun RLS/multi-account/production QA.
- [ ] Commit: `Document privacy and support operations`.
- [ ] Push `main` only when the current DNS-independent stage passes validation.

## Deferred Plans

- **Mailcow support mail integration:** provision `support@app.letscube.ru`, `privacy@app.letscube.ru`, `postmaster@app.letscube.ru`, and `dmarc@app.letscube.ru`; validate MX/SPF/DKIM/DMARC; implement sanitized SMTP/IMAP worker and Message-ID deduplication.
- **Support attachments and malware scanning:** isolated quarantine bucket, MIME/signature verification, size limits, antivirus scan, safe promotion, and download authorization.
- **Retention automation and restore rehearsal:** scheduled deletion/anonymization, backup interaction, evidence log, and audited restore drill.
- **Legal release gate:** qualified Russian legal review of the published policy, consent wording, minors flow, data-localization disclosures, and Microsoft Store metadata before certification.
