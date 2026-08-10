# LETSCUBE Neutral UI And SMS.RU Phone Onboarding Design

**Status:** accepted product design; implementation and provider activation are separate gates.

**Date:** 2026-08-10

## Goal

Remove visible computer-club positioning from LETSCUBE and prepare a secure,
provider-disabled SMS.RU integration for mandatory phone verification of new
accounts. Supabase Auth remains the authority that generates and verifies OTP
codes. SMS delivery must not be activated until the sender and production
delivery terms are approved by the provider.

## Scope

This design covers:

- neutral user-facing terminology across the web, Android and Windows clients;
- a server-only SMS.RU Send SMS Hook adapter;
- post-email phone onboarding for accounts created after a controlled cutoff;
- duplicate pending-phone protection;
- privacy-safe exact phone discovery;
- rollout, rollback, observability and QA.

The external LANGAME operator-support channel is an independent subsystem and
will have a separate design and implementation plan.

## Current Baseline

- Email/password registration already uses CAPTCHA, invite-mode and the
  `auth-yandex-gateway` protection path.
- The Settings phone section already normalizes explicit `+E.164`, calls
  `auth.updateUser({ phone })`, verifies a six-digit `phone_change` OTP and
  invokes `profile_phone_mark_verified()`.
- `profile_phone_mark_verified()` re-checks Supabase Auth state before writing
  `profile_contacts.phone_verified` and `phone_verified_at`.
- Exact staff-only phone search is deployed as
  `search_profiles_by_phone(text, integer)`. It requires `users.view`, searches
  verified numbers only and never returns the number itself.
- The self-hosted Auth runtime has phone delivery and SMS autoconfirm disabled.
- SMS.RU credentials live in ignored local private storage. `api_id`
  authentication, account limits and a positive balance were verified without
  sending an SMS or printing credential values.

## Product Terminology

All visible positioning must present LETSCUBE as a standalone communication
product. Internal database and code contracts remain unchanged.

Required user-facing replacements:

| Existing wording | New wording |
| --- | --- |
| `Кибер-арена`, `киберарена` | `LETSCUBE` or no descriptor |
| `Панель связи киберарены` | `Защищённое пространство общения` |
| `клуб` | `локация` |
| `роль клуба` | `роль в локации` |
| `администратор клуба` | `администратор локации` |
| `задачи клуба` | `задачи локации` |
| legal references to clubs | `организации и их локации` |

Context-sensitive Russian grammar must be preserved. Internal names including
`locations`, `location_members`, `location_*`, package ID
`com.kub.messenger`, environment names and migration history are intentionally
unchanged.

The visible-text audit includes auth screens, the app shell, admin and ops
pages, roles, invites, tasks, support, Privacy Policy, document metadata and the
PWA manifest. Internal comments and historical documentation do not need
mechanical renaming unless they are rendered to users.

## Registration And Phone Onboarding

The registration sequence for a new account is:

1. The user completes the existing name, email, password, CAPTCHA and optional
   invite flow.
2. The user confirms their email through the existing self-hosted mail path.
3. On first authenticated launch, LETSCUBE asks the server whether phone
   onboarding is required.
4. Accounts created before the rollout cutoff remain legacy-exempt. Accounts
   created at or after the cutoff must verify a phone before entering the main
   messenger.
5. A required user can access only phone onboarding, Privacy Policy, Support
   and sign-out until verification succeeds.
6. The client begins a unique phone claim through the trusted backend and then
   calls `auth.updateUser({ phone })`.
7. Supabase Auth generates the OTP and invokes the configured Send SMS Hook.
8. The user submits the six-digit code through
   `verifyOtp({ type: "phone_change" })`.
9. `profile_phone_mark_verified()` verifies Auth state and finalizes the profile
   contact and pending claim.
10. Changing a verified number always starts a new claim and requires a new
    OTP.

The requirement is controlled by a server-side policy containing at least:

- `enabled`;
- `required_for_created_at_or_after`;
- `enforce_data_access`;
- `updated_at` and `updated_by` for auditability.

The UI gate prevents unnecessary messenger requests, but it is not treated as
the security boundary. Once physical delivery QA passes, restrictive RLS
policies enforce the same rule for new required accounts. Profile onboarding,
privacy, support and sign-out dependencies remain allowlisted. Enforcement is
activated separately from schema deployment and can be disabled without
removing verified data.

## Pending Phone Claim

Supabase documents an ambiguous `phone_change` lookup when more than one Auth
user has the same pending number. LETSCUBE prevents that before enabling SMS.

- A trusted backend endpoint creates a short-lived claim for the authenticated
  user.
- The claim stores a server-keyed HMAC of the normalized phone, the user ID,
  creation/expiry timestamps and status. It stores no OTP.
- A unique active-claim constraint prevents a second account from claiming the
  same phone hash.
- The SMS hook sends only when the event user and destination match a live
  claim.
- A direct Auth phone update without a matching claim causes the hook to reject
  delivery.
- Successful verification closes the claim. Explicit cancel and scheduled
  expiry clear abandoned claims.
- Raw phone values and OTPs are absent from claim/audit tables and logs.

The HMAC secret belongs to backend secrets. A plain unsalted phone hash is not
sufficient because the phone-number space is enumerable.

## SMS.RU Adapter

The preferred architecture is:

```text
Supabase Auth -> signed HTTP Send SMS Hook -> LETSCUBE Edge Function -> SMS.RU
```

Supabase Auth owns OTP generation, expiry, resend semantics and verification.
The adapter only validates and delivers the generated message.

### Message Contract

The exact message template is:

```text
LETSCUBE: код 123456. Никому его не сообщайте.
```

For a six-digit code the text is 46 Unicode characters. Implementation must
define `SMS_MAX_LENGTH = 65`, test the rendered length and reject the request
before provider contact if the rendered text is longer than 65 characters. No
user name, URL or dynamic prose may be appended.

### Hook Security

- Accept `POST` only and enforce a small request-body limit.
- Verify the Standard Webhooks signature, timestamp tolerance and webhook ID.
- Validate the documented Supabase event schema and the authenticated user's
  active phone claim.
- Use the webhook ID as an idempotency key so one Auth event cannot create two
  SMS sends.
- Call SMS.RU with HTTPS POST form data. Do not place `api_id`, phone or message
  data in a query string.
- Use `SMS_RU_API_ID` from server secrets. Runtime does not use the account
  login/password pair.
- Set `from` only after `LETSCUBE` is approved by SMS.RU. Until then the adapter
  omits the field and the production hook remains disabled.
- Never log the API ID, OTP, full phone, request body or raw provider response.
- Persist only safe event IDs, phone HMAC, user ID, normalized result category
  and timestamps required for idempotency, rate limiting and operator health.

An accepted SMS.RU API response means provider acceptance, not handset
delivery. Ambiguous network timeouts are not retried automatically because a
retry could duplicate an SMS. The user can request another code after the
cooldown.

## Provider-Disabled Foundation Gate

The current stage implements support but sends no SMS.

Allowed now:

- adapter source and unit/security tests;
- schema and RLS with rollout/enforcement flags disabled;
- onboarding and settings UI behind a disabled server capability;
- SMS.RU error mapping and provider-health contracts;
- deployment documentation and secret names without values;
- a local mocked or fully offline adapter test.

Forbidden until provider approval:

- invoking `sms/send`, including a real destination;
- configuring the Auth Send SMS Hook URI;
- enabling phone delivery in GoTrue;
- enabling the new-account cutoff or RLS enforcement;
- setting an unapproved sender name;
- claiming production phone verification is available.

The existing friendly unavailable state remains visible while the capability
is disabled.

## Rate Limits And Abuse Protection

The activation configuration uses layered controls:

- at least 60 seconds between sends to the same destination;
- bounded attempts per authenticated user and phone HMAC;
- a daily provider-cost guard and operator alert threshold;
- existing registration CAPTCHA, gateway rate limits and invite mode;
- exact OTP verification and expiry enforced by Supabase Auth;
- no automatic send retry after an ambiguous provider timeout.

Rate-limit storage is private and inaccessible to `anon` and `authenticated`.
UI errors are generic enough to avoid account and phone enumeration.

## Phone Discoverability

`profile_contacts` gains a `phone_discoverable` preference with a default of
`false`.

- During successful phone onboarding the user explicitly chooses whether other
  users may find the profile by number.
- The preference is independently editable later in Settings.
- Ordinary authenticated users may search only a complete normalized `+E.164`
  value.
- Ordinary search returns a profile only when its phone is verified and
  discoverability is enabled.
- The result may contain the profile ID, display name, username and avatar. It
  never contains the phone number.
- Partial matches and bulk result sets are not supported.
- Ordinary discovery is limited to 10 requests per minute and 100 per day per
  authenticated account; query values are not retained in the rate-limit log.
- The existing `users.view` staff RPC remains a separate exact-search path and
  may find verified contacts regardless of ordinary discoverability.
- Unverified phone values never participate in either search path.

## Error Mapping

The frontend uses fixed Russian messages:

- invalid format: `Введите номер в международном формате, например +79991234567.`
- invalid OTP: `Неверный код.`
- expired OTP: `Срок действия кода истёк. Запросите новый.`
- rate limited: `Слишком много попыток. Попробуйте позже.`
- duplicate phone: `Этот номер уже используется другим аккаунтом.`
- provider failure: `Не удалось отправить код. Попробуйте позже.`
- disabled foundation: `Подтверждение телефона временно недоступно.`

Provider status text, raw JSON, stack traces and database errors are never
shown to users.

## Rollout

Activation is a separate future operation after provider approval:

1. Verify a current database/config backup.
2. Deploy schema and adapter with all enforcement and delivery flags off.
3. Run unit, integration, RLS and browser tests using mocks only.
4. Confirm an approved SMS.RU sender and production terms.
5. Add backend secrets without exposing them in Git, docs or frontend bundles.
6. Configure the signed Send SMS Hook and keep SMS autoconfirm disabled.
7. Run one controlled real-number send and correct/wrong/expired/resend QA.
8. Enable the onboarding cutoff for newly created accounts.
9. Verify onboarding in production before enabling restrictive data access.
10. Enable RLS enforcement and verify legacy-account exemption.
11. Verify ordinary discoverability and staff search separately.

Rollback disables hook/provider/onboarding/enforcement flags. It does not clear
confirmed phones or modify legacy accounts.

## Validation

Automated coverage includes:

- SMS template length and exact content;
- Standard Webhooks signature, timestamp, replay and malformed payload cases;
- no-send provider-disabled behavior;
- claim ownership, uniqueness, expiry and cleanup;
- correct, wrong, expired and resend UI states with mocked Auth responses;
- legacy exemption and new-account onboarding requirement;
- restrictive RLS before and after verification;
- discoverability opt-in, exact-match-only behavior and rate limits;
- staff `users.view` search regression;
- visible terminology scan and responsive auth/onboarding/settings QA;
- email registration, recovery, CAPTCHA, invite mode, chats, tasks, push,
  Android and Windows regression guards;
- secret scans and verification that frontend code contains no service-role or
  SMS.RU credential.

Physical SMS delivery QA is explicitly pending until provider approval.
