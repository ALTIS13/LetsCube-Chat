# LETSCUBE Registration Lifecycle, Bot Platform And Public Home Design

Date: 2026-08-30

Status: approved product architecture; written-spec review pending

## 1. Purpose

This design defines four related but independently deployable production stages:

1. safe cleanup of registrations that were never confirmed or used;
2. a Telegram-like LETSCUBE Bot API and user-facing bot management surface;
3. a lightweight public LETSCUBE home and download experience;
4. a shared motion and interaction-feedback contract for web, Windows, Android,
   macOS and iOS clients.

The stages share authentication, release, notification and chat contracts, but
must be implemented and rolled out independently. Failure or rollback of the Bot
API must not interrupt human messaging, authentication or release downloads.

## 2. Scope And Non-Goals

### 2.1 In scope

- public and invite registration lifecycle tracking;
- automatic deletion of eligible never-used registrations;
- separate bot identities that participate in private and group chats;
- bot creation, ownership, tokens, commands, buttons, updates and webhooks;
- bot-aware message rendering, search, notifications and audit;
- public app presentation and Stable downloads without authentication;
- release-scoped changelog entries;
- consistent motion, loading and success feedback;
- cross-platform contracts and a macOS/iOS implementation handoff.

### 2.2 Explicit non-goals for Bot API v1

- payments, games, Passport and Mini Apps;
- arbitrary inline mode across unrelated chats;
- bots initiating unsolicited conversations with arbitrary users;
- bots reading private phone numbers or internal profile fields;
- representing bots as fake `auth.users` rows;
- exact wire compatibility with Telegram token URLs;
- external app links or deep-link infrastructure changes.

### 2.3 Explicit public-home non-goals

- a broad marketing site;
- a separate editorial news portal or heavy news CMS;
- displaying downloads that do not have a valid Stable release manifest;
- using the base domain `letscube.ru`.

The iPhone/iPad PWA remains owned by the separate Apple execution stream. This
stage documents shared contracts for that agent but does not modify PWA-specific
or native Apple code.

## 3. Architecture And Deployment Boundaries

### 3.1 Recommended topology

The Bot API runs as a separate `letscube-bot-gateway` process built from the
existing `artifacts/api-server` workspace package. It has its own startup entry,
health check, environment and Coolify service, while reusing focused logging,
Supabase and worker utilities where those contracts already exist.

Public Bot API traffic is routed through:

```text
https://api.letscube.ru/bot/v1/<method>
```

Bot documentation is published under:

```text
https://api.letscube.ru/bots/docs
```

The existing release catalog remains independently available under
`https://api.letscube.ru/releases/v1/*`. Bot Gateway downtime must not affect
release manifests or `/api/healthz` for the existing worker service.

### 3.2 Source of truth

- the existing in-app chat and notification model remains the source of truth;
- a bot message is an ordinary chat message with a bot sender identity;
- webhook and long-poll updates are delivery projections, not duplicate message
  stores;
- the release catalog is the source of truth for downloadable Stable builds and
  their compact changelog entries;
- Supabase Auth remains the source of truth for human identities only.

### 3.3 Independent implementation tracks

The implementation must be split into at least four plans and reviewable release
units:

1. registration lifecycle and cleanup worker;
2. Bot API data model, gateway and chat integration;
3. public home, downloads and release changelog;
4. motion tokens and interaction feedback rollout.

No track may depend on incomplete UI from another track to remain secure.

## 4. Registration Lifecycle And Automatic Cleanup

### 4.1 Eligibility windows

- ordinary public registration: deletion eligibility after 72 hours;
- invite registration: deletion eligibility after 7 days;
- admin-created, service and bot identities: never eligible;
- existing unconfirmed registrations: at least 24 hours of grace after the
  cleanup feature is enabled.

A confirmation-email resend may extend the deadline once. The absolute maximum
age becomes 7 days for public registration and 14 days for invite registration.
Repeated resends do not extend the deadline further.

### 4.2 Required deletion conditions

An account is deleted only when all conditions remain true at execution time:

- it originated from a tracked public or invite registration flow;
- email and phone are both unconfirmed;
- `last_sign_in_at` and equivalent successful-login evidence are absent;
- the account is not an administrator, service identity or bot;
- the account has no user-generated messages, files, tasks, verified contacts or
  other product activity;
- no explicit administrative retention marker is present;
- the eligibility deadline has passed.

Invite roles, locations or club assignments created automatically during
provisional signup do not count as user activity. They are marked provisional
and are removed with an expired registration. A later explicit administrative
assignment or any successful login makes the account ineligible.

### 4.3 Lifecycle recording

Only the trusted auth gateway records registration kind, creation context,
eligibility deadline and resend extension. The browser cannot declare that an
account is privileged or exempt from cleanup.

The lifecycle worker runs hourly. It selects bounded batches with
`FOR UPDATE SKIP LOCKED`, rechecks every condition, and deletes through a trusted
service-role-only database RPC. That RPC locks the lifecycle, Auth user and
profile rows, sets a transaction-local claim context, and performs the Auth
delete in the same transaction; the Auth trigger rechecks the claim at the
delete statement. The operation is idempotent. Confirmation or login
during selection prevents deletion during the final recheck.

### 4.4 Safe rollout

The worker first runs in report-only mode. Operators verify the candidate count
and exclusion reasons before deletion is enabled. Deletion failures use bounded
retries and a dead-letter state. Audit records contain lifecycle reason codes and
internal references, not email addresses, phone numbers or credentials.

## 5. Bot Identity And Ownership

### 5.1 Identity model

A bot is a separate chat participant with:

- `bot_id`;
- display name;
- unique username;
- avatar;
- description;
- visible bot badge;
- active, paused, suspended, pending-delete or deleted lifecycle state.

A bot does not have a password, session or `auth.users` row. Human owners and
developers authenticate as themselves and receive bounded management rights.

### 5.2 Management roles

- owner: full bot configuration, token rotation, developer management and
  deletion;
- developer: commands, webhook, diagnostics and permitted configuration;
- platform administrator: suspend, inspect metadata and enforce limits without
  viewing the bot token or message payloads.

Creation is available through a `Мои боты` surface. A BotFather-like helper may
be added later, but is not the primary v1 management path.

The creator must have a verified email and phone, an account at least 24 hours
old, and no active ban. The default limit is three active bots per creator and
may be adjusted by an administrator.

### 5.3 Lifecycle

Owners may pause, rotate tokens, revoke tokens and request deletion. Deletion
enters a seven-day reversible state. During that period tokens are disabled and
the bot cannot send or receive updates. Final deletion preserves human chat
history with a deleted-bot label instead of corrupting message references.

## 6. Bot Chat Access And Privacy

### 6.1 Private chats

A user must explicitly start or accept a private bot chat. The bot can receive
all new messages sent in that chat after it joins. It cannot enumerate or start
conversations with unrelated users.

### 6.2 Groups

Group privacy is enabled by default. A bot receives only:

- commands addressed to it;
- explicit mentions;
- replies to its messages;
- callback events from its buttons;
- membership events relevant to the bot.

Full visibility of new group messages requires both a request by the bot owner
and approval from a group administrator. A bot never receives history from
before it joined. Removing a bot immediately stops new updates and invalidates
new file access.

### 6.3 Protected data

Bot projections exclude phone numbers, email addresses, internal roles, support
data, security metadata and unrelated profile fields. A bot may receive the
public display identity and message content available in its authorized chat.

## 7. Bot API Contract

### 7.1 Authentication and response shape

Requests use:

```http
Authorization: Bot <token>
```

Tokens are never accepted in URLs. Successful responses return `ok: true` and
`result`. Failed responses return `ok: false`, a stable error code, a safe
message and `request_id`; rate-limit responses additionally include
`retry_after`.

The contract is semantically familiar to Telegram developers but is explicitly
versioned and is not byte-for-byte Telegram compatibility.

### 7.2 Bot API v1 methods

Identity and diagnostics:

- `getMe`;
- `getWebhookInfo`.

Messages and media:

- `sendMessage`;
- `sendPhoto`;
- `sendVideo`;
- `sendDocument`;
- `sendVoice`;
- `sendChatAction`;
- `editMessageText`;
- `deleteMessage`;
- `getFile` for a bot-authorized attachment through a bounded signed URL.

Commands and interactions:

- `setMyCommands`;
- `getMyCommands`;
- `answerCallbackQuery`.

Update delivery:

- `setWebhook`;
- `deleteWebhook`;
- `getUpdates`.

Updates use a monotonically increasing `update_id` per bot and cover authorized
messages, edited messages, callback queries and relevant membership events.

### 7.3 Webhook and long polling

Webhook and `getUpdates` are mutually exclusive. Long polling is bounded to 30
seconds. Delivery is at least once, so consumers must deduplicate by
`update_id`.

Webhook destinations must use HTTPS. Validation rejects credentials in URLs,
IP literals, loopback, private, link-local and metadata networks. DNS is checked
again at connection time, redirects are bounded and cannot cross into a blocked
network, and response size and duration are capped.

### 7.4 Tokens

The full token is shown once at creation or rotation. Storage contains only a
token prefix for operator identification and a cryptographic hash protected by
a server-only pepper. Raw tokens are excluded from logs, analytics, browser
storage and admin views.

## 8. Bot Data Model

The migration is additive and uses the following logical entities:

- `bots`: public chat identity and lifecycle state;
- `bot_owners`: owner/developer relationship;
- `bot_tokens`: private token prefix, hash and revocation metadata;
- `bot_commands`: validated command definitions;
- `chat_bot_members`: membership, group privacy and approved permissions;
- `bot_updates`: pending update delivery with monotonic `update_id`;
- `bot_webhooks`: private destination and delivery configuration;
- `bot_delivery_attempts`: metadata-only retry and dead-letter history.

`messages` gains nullable `bot_id`. A database check enforces exactly one
sender: the existing human sender column or `bot_id`, never both and never
neither. Existing human messages remain unchanged.

Chat lists, message rendering, search, notifications, read sync and audit must
recognize bot identities without inserting bot rows into human profile tables.
Bot-created messages follow the same realtime and scroll anchoring contracts as
human messages.

Private token, webhook and delivery tables are not exposed through the public
Supabase Data API. Public bot metadata and ownership projections use RLS and
narrow server/RPC operations. Anonymous and ordinary authenticated users cannot
read another owner's management metadata.

## 9. Delivery, Ordering And Limits

Bot message creation, chat summary updates, in-app notification creation and
outbox enqueue occur in one trusted database transaction. The outbox uses
bounded batches and `SKIP LOCKED`. Idempotency keys prevent duplicate sends
after client retries.

Limits apply per token, method, chat and recipient. They protect human users
from bursts even when the global bot limit is not reached. Administrators may
suspend a bot without accessing its token.

Webhook retries use bounded exponential backoff. Exhausted work enters a
dead-letter state visible as aggregate operational status. Gateway failure does
not block human messaging; queued bot work resumes after recovery.

## 10. Public Home, Downloads And Changelog

### 10.1 Route behavior

- unauthenticated browser `/`: public LETSCUBE home;
- authenticated browser `/`: messenger;
- Windows and Android native shells: authentication or messenger, never the
  public home;
- `/download`: public platform downloads;
- `/privacy` and `/support`: remain public;
- `/news` is not introduced for this design.

The platform detection contract must also allow future native macOS and iOS
shells to bypass the public home without changing server routing.

### 10.2 Visual structure

The page presents LETSCUBE as a standalone messenger. It does not mention a
computer club or venue. The first viewport establishes the product and shows a
clear Open or Download action while leaving a visible hint of the next section.

Windows, Android, macOS and iOS are presented through polished platform-specific
visual sections using sanitized demo-account interface captures. Real user
messages, contacts, phones, avatars and operational data are forbidden in public
assets. Assets are delivered in optimized formats and responsive sizes.

A platform download action is enabled only when a valid Stable manifest reports
`available: true` and contains a verified artifact. Platforms without a release
may be marked as in development but must not expose a non-working download.

### 10.3 Theme

The saved theme takes priority; otherwise the system preference is used. A
small pre-render theme bootstrap applies the correct color scheme before the
React application paints, preventing a white flash for dark-theme users.

### 10.4 Compact changelog

The home contains a small `Что нового` module, not a news portal. Stable release
manifests expose bounded structured notes containing version, build, platform,
publication date and concise highlights. Full notes may expand in place or open
a focused release-notes view.

The release-platform contract supports `windows`, `android`, `macos`, `ios` and
`web`. Adding a platform is backward compatible: clients ignore unknown values,
and an absent manifest means unavailable rather than broken.

## 11. Shared Motion And Interaction Feedback

Motion is a product system rather than isolated decoration. Shared semantic
states are `idle`, `pressed`, `loading`, `success`, `warning`, `error`, `enter`
and `exit`.

Recommended timing tokens are:

- instant response: 90 ms;
- fast control transition: 140 ms;
- standard panel transition: 220 ms;
- emphasized but non-blocking transition: 320 ms;
- transient success confirmation: approximately 2.4 seconds.

Animations prefer opacity and transform and must not change layout geometry.
Loading uses dimensionally stable skeletons. Route and panel transitions remain
interruptible. No essential action waits for a decorative animation.

Copying an invitation link provides a canonical interaction example:

1. the control reacts immediately;
2. the copy icon transitions to a check without changing button width;
3. a compact `Ссылка скопирована` confirmation appears;
4. the temporary state clears without layout shift.

The same feedback vocabulary applies to sending messages, saving settings,
creating invites, enabling notifications, uploading files and Bot API settings.

When `prefers-reduced-motion: reduce` or the native accessibility equivalent is
active, decorative movement is removed, durations are minimized and success is
still communicated through text, icon and color.

## 12. Registration Confirmation Experience

After a registration submission, the response remains enumeration-safe and
shows:

> Если к этому адресу электронной почты ещё не привязан аккаунт, мы отправим
> письмо для подтверждения регистрации.
>
> Если письмо не пришло, проверьте папку «Спам» и правильность указанного
> адреса. При ошибке вернитесь и зарегистрируйтесь с корректным email.
> Неподтверждённая учётная запись будет удалена автоматически.

The view shows a masked form of the submitted email, a resend control with a
60-second countdown, a return-to-registration action and a route back to login.
An existing-account signup receives the same visible result.

The resend extension follows the single-extension limits in section 4. The UI
does not promise that every resend extends account lifetime.

Password recovery keeps its separate generic response:

> Если такой email зарегистрирован, мы отправили ссылку для сброса пароля.

Recovery does not show the incorrect-address or automatic-deletion warning.
Confirmation callbacks produce a clear confirmed, expired or already-used
state without raw Auth or database errors.

## 13. Security And RLS

- `service_role`, token pepper and webhook credentials exist only in trusted
  server environments;
- frontend code never receives privileged Supabase credentials;
- Bot API has no browser CORS requirement by default;
- request bodies, media references, method names and identifiers are validated
  against bounded schemas;
- token, method, chat and recipient rate limits are independent;
- audit and application logs redact authorization, email, phone and webhook
  headers;
- all bot management operations verify both authenticated actor and ownership
  role server-side;
- file URLs are short-lived and scoped to attachments the bot is authorized to
  receive;
- malformed updates or payloads cannot reach raw SQL execution;
- migration proposals are rehearsed transactionally against the current schema
  and applied only after an up-to-date backup is verified.

## 14. Retention And Observability

- undelivered `getUpdates` payloads: 24 hours;
- acknowledged update payloads: removed after confirmation;
- webhook attempt metadata without payloads: 14 days;
- bot-management and cleanup audit metadata: 90 days;
- bot messages: existing chat-message retention policy;
- pending bot deletion: 7 days before finalization.

Operational metrics include request rate and latency, `429` rate, queue depth,
webhook failures, dead-letter count, cleanup candidates and outcomes, worker
health and release-catalog health. The admin/ops surface shows aggregate status
and safe identifiers, never message payloads or raw credentials.

The public release client may use its last valid cached Stable manifest during
a temporary API failure. It hides broken actions when neither a valid network
manifest nor a valid cache exists.

## 15. Testing And Rollout

### 15.1 Database and security

- migration transaction rehearsal against the current production-compatible
  schema;
- RLS tests for bot owner, developer, ordinary user, administrator and anon;
- execute-grant checks for every new RPC;
- exactly-one-sender constraint tests;
- token and private-table Data API denial tests;
- cleanup boundary, grace, resend, activity and race tests.

### 15.2 Bot Gateway

- authentication, rotation and revocation;
- idempotency and duplicate-delivery tests;
- per-scope rate limiting;
- webhook SSRF, redirect and DNS-rebinding tests;
- webhook/long-poll mutual exclusion;
- 30-second polling boundary and 24-hour retention;
- group privacy, membership and removal behavior;
- no-history and protected-profile projection checks;
- retry and dead-letter recovery.

### 15.3 Public UI and registration

- unauthenticated, authenticated and native-shell root routing;
- Stable download validation for every available platform;
- unavailable-platform state without dead links;
- light/dark initial paint without theme flash;
- desktop `1920x1080` and `1440x900`;
- mobile `390x844` and `412x915`;
- no horizontal scroll, clipping or layout shift;
- reduced-motion behavior;
- new, duplicate, invited, malformed and unconfirmed registration flows;
- recovery-copy isolation.

### 15.4 Existing regression contracts

The rollout must preserve chat initial anchoring, fast upward history scroll,
search and notification jumps, notification grouping/read sync, browser push,
media variants, support workflows, Windows updater behavior and Android native
media/geolocation/push behavior.

### 15.5 Deployment sequence

1. verify backup and apply additive lifecycle schema;
2. run cleanup in report-only mode;
3. deploy Bot Gateway behind a disabled feature flag;
4. test an internal bot and operator metrics;
5. enable a bounded canary group;
6. publish bot creation after canary acceptance;
7. enable cleanup deletion after report verification;
8. publish the public home and motion changes independently.

Each step has an independent rollback. Rollback disables new behavior without
deleting existing human messages, users or release manifests.

## 16. macOS And iOS Handoff Contract

This section is mandatory reading for the Apple implementation agent.

### 16.1 What the Apple agent consumes

- platform identifiers: `macos` and `ios` in the shared release/changelog
  contract;
- Stable availability semantics: no download action until a valid manifest with
  `available: true` exists;
- the same public-home bypass rule for a native authenticated shell;
- the registration result and recovery copy in section 12;
- bot identity fields, badge semantics and exactly-one-sender message model;
- the same bot notification/read-sync behavior as human messages;
- semantic motion states and native reduced-motion mapping;
- safe internal navigation targets from bot and human notifications.

### 16.2 What the Apple agent must not duplicate

- no parallel bot-token store or Apple-only bot backend;
- no Apple-specific registration cleanup job;
- no second changelog service;
- no fake human profile for a bot;
- no client-side privileged Supabase key or direct token-table access;
- no public download claim before an Apple Stable artifact exists.

### 16.3 Compatibility rules

Server DTO and schema changes are additive and versioned. Older Apple builds
must ignore unknown bot/update/changelog fields. A bot message without locally
recognized optional metadata still renders as a bounded generic bot message,
not as a human profile and not as a fatal error.

The Apple agent records any required contract change in this spec or a linked
successor before implementing it. It consumes the committed main baseline and
must not overwrite concurrent Windows, Android, backend or shared-web changes.

### 16.4 Apple QA evidence to return later

- macOS and iOS platform-detection result;
- initial theme with no light flash;
- reduced-motion behavior;
- registration confirmation and recovery copy;
- Stable/unavailable release presentation;
- bot sender rendering and notification navigation once the backend contract is
  deployed;
- confirmation that no privileged server secret is bundled.

## 17. Documentation

Bot documentation includes:

- token creation, rotation and revocation;
- cURL, JavaScript and Python examples;
- method and update schemas;
- group privacy and permission explanation;
- webhook verification and retry behavior;
- idempotency and rate-limit guidance;
- migration guidance from Telegram-style concepts without claiming protocol
  compatibility.

The public changelog describes user-visible Stable changes only. Internal test
branches, credentials, infrastructure details and unresolved security findings
are excluded.
