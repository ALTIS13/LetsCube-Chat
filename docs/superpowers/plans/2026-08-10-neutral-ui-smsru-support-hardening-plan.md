# Neutral UI, SMS.RU Foundation And Support Hardening Plan

**Status:** stages 1-3 complete; stage 4 pending an official LANGAME transport decision

**Design source:** `docs/superpowers/specs/2026-08-10-neutral-ui-smsru-phone-onboarding-design.md`

## Stage 1 - Neutral product terminology

**Status:** complete.

- Add a source-level regression test for visible Russian product wording.
- Replace visible references to a computer club/cyber arena with neutral
  LETSCUBE, organization and location terminology.
- Keep database, route, environment, package and migration identifiers intact.
- Verify auth, admin, tasks, invites, roles, support, privacy and PWA metadata.

## Stage 2 - Provider-disabled SMS.RU foundation

**Status:** complete as a disabled source/schema foundation. No SMS was sent,
the Edge Functions were not deployed, and the SQL proposal was not applied.

- Add a pure SMS contract with the exact 46-character OTP template and a hard
  65-character maximum.
- Add a server-only SMS.RU adapter that is fail-closed unless
  `SMS_DELIVERY_ENABLED=true`; this stage must make no provider request.
- Add a signed Supabase Send SMS Hook scaffold with safe error categories and
  no raw OTP, phone, provider body or credential logging.
- Add a schema proposal for pending phone claims, idempotency, disabled rollout
  policy and opt-in phone discoverability. Do not apply it in this stage.
- Document the later provider approval, secret, Auth hook and physical QA gates.

## Stage 3 - Existing support conversation hardening

**Status:** complete.

- Replace unconditional operator scroll-to-bottom behavior with a shared
  bottom-anchor policy.
- Open a conversation at the latest message, follow new messages only while the
  reader remains near the bottom, and preserve manual history reading.
- Show a compact new-message affordance when updates arrive above the current
  position.
- Apply the same behavior to the guest chat and remove rigid mobile height
  assumptions that create nested or unstable scrolling.
- Add unit and Playwright coverage for initial position, retained position,
  responsive bounds and no horizontal overflow.

## Stage 4 - LANGAME support channel

**Status:** pending. Do not implement portal automation without an official
integration contract.

- Keep LETSCUBE user support and vendor support as separate queues in one
  operator workspace.
- Add separate permissions and notification preferences for the LANGAME
  channel.
- Use an official LANGAME API/SSO transport when LANGAME supplies its partner
  contract. Do not automate or scrape their authenticated support portal.
- If no API is available, implement an explicitly labelled email transport as
  a separate follow-up; do not present it as their individual `Чат ТП`.

## Validation

- Focused Node unit tests for terminology, SMS contract and scroll policy.
- `git diff --check`.
- `pnpm.cmd --filter @workspace/kub run typecheck`.
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`.
- Targeted support Playwright specs on desktop and mobile.
- `pnpm.cmd e2e:smoke`, `pnpm.cmd db:types:check`, and RLS contract checks for
  touched database proposals.
- Browser QA with console/network inspection for the rendered support surfaces.

## Completion evidence

- Focused Node contracts: 12/12 passed.
- Support Playwright matrix: 30/30 passed at 3840x2160, 1920x1080,
  1440x900, 390x844 and 412x915.
- Authenticated application smoke: 5/5 passed on the same viewport matrix.
- Typecheck, production build, database type drift, RLS smoke and
  `git diff --check` passed. The build retains the known sourcemap and
  large-chunk warnings.
- Rendered guest support QA found no horizontal overflow, console errors or
  unexpected failed requests. The public page resets its own scroll root when
  a newly created/restored ticket opens, while message polling does not reset
  the reader.
