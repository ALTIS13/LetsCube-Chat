# LETSCUBE Bot Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Telegram-like, LETSCUBE-native Bot API with separate bot identities, secure tokens, private/group chat integration, webhooks or long polling, user management UI, documentation and operational controls.

**Architecture:** Add bot identity and delivery tables through an additive Supabase migration, then run a separate `letscube-bot-gateway` entry point from `artifacts/api-server`. Human owners manage bots through authenticated control-plane endpoints; bot tokens call `/bot/v1/:method`. Chat messages remain the source of truth, while update queues and webhooks are at-least-once projections.

**Tech Stack:** Supabase/Postgres/RLS, Node.js 24, TypeScript, Express 5, Zod, React, Wouter, Realtime, Node test runner, Playwright, Docker/Coolify.

**Spec:** `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`

## Global Constraints

- Bots are separate identities and never rows in `auth.users` or `profiles`.
- `messages` has exactly one sender: `user_id` or `bot_id`.
- Bot tokens are shown once, sent only in `Authorization: Bot`, stored as HMAC hashes with a server-only pepper, and never logged.
- Creator requires verified email, verified phone, account age of 24 hours and no active ban.
- Default creator limit is three active bots.
- Group privacy defaults to commands, mentions, replies, callbacks and bot-membership events.
- Full group visibility requires bot-owner request and chat-admin approval.
- Webhook and `getUpdates` are mutually exclusive; update delivery is at least once.
- Bots cannot initiate arbitrary user conversations or read phones, email, support data or pre-join history.
- Preserve existing chat scroll, read sync, notification grouping, browser/native push and media behavior.
- No Bot API service secret or service-role key may enter frontend code.

---

### Task 1: Add bot identity, ownership and message-sender schema

**Files:**
- Create: `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`
- Create: `tests/unit/bot-platform-schema-contract.test.mjs`
- Create: `tests/server/bot-platform-db-smoke.sql`
- Modify: `scripts/check-database-type-drift.mjs`

**Interfaces:**
- Produces public tables: `bots`, `bot_owners`, `bot_commands`, `chat_bot_members`.
- Produces private tables: `bot_tokens`, `bot_updates`, `bot_webhooks`, `bot_delivery_attempts`, `bot_rate_limit_buckets`.
- Adds `messages.bot_id uuid null references public.bots(id)` and a one-sender check.
- Produces service-role-only transactional RPCs used by the gateway.

- [ ] **Step 1: Write the failing schema contract test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  ".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql",
  "utf8",
);

test("bot identities remain separate from auth users", () => {
  assert.match(sql, /create table public\.bots/i);
  assert.doesNotMatch(sql, /insert into auth\.users/i);
  assert.match(sql, /add column bot_id uuid/i);
  assert.match(sql, /check \(\(user_id is null\) <> \(bot_id is null\)\)/i);
});

test("token and delivery data stay private", () => {
  for (const table of ["bot_tokens", "bot_updates", "bot_webhooks", "bot_delivery_attempts"]) {
    assert.match(sql, new RegExp(`create table private\\.${table}`, "i"));
  }
  assert.doesNotMatch(sql, /grant select on private\./i);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test tests/unit/bot-platform-schema-contract.test.mjs`

Expected: FAIL with `ENOENT` for the migration.

- [ ] **Step 3: Add public bot identity and ownership tables**

```sql
create table public.bots (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{4,31}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 64),
  description text not null default '' check (length(description) <= 512),
  avatar_url text null,
  state text not null default 'active' check (state in ('active','paused','suspended','pending_delete','deleted')),
  delete_after timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bot_owners (
  bot_id uuid not null references public.bots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','developer')),
  created_at timestamptz not null default now(),
  primary key (bot_id, user_id)
);

create table public.chat_bot_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  privacy_mode text not null default 'restricted' check (privacy_mode in ('restricted','full')),
  full_visibility_requested_at timestamptz null,
  full_visibility_approved_by uuid null references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz null,
  primary key (chat_id, bot_id)
);
```

Enable RLS. Chat members may read active bot membership and bot public identity. Bot owners may read their ownership rows. Direct inserts, updates and deletes remain revoked; all writes go through checked functions.

- [ ] **Step 4: Add private token and delivery tables**

`private.bot_tokens` stores `id`, `bot_id`, `token_prefix`, `token_hash`, `created_at`, `last_used_at`, `revoked_at`. `private.bot_updates` stores `bot_id`, monotonic `update_id`, bounded JSON payload, `available_at`, `acknowledged_at`, `expires_at`. `private.bot_webhooks` stores encrypted/controlled URL metadata and state. Attempts store status/error codes only, never payloads.

Add a unique active token-prefix index, `(bot_id, update_id)` uniqueness, due-update indexes and a 24-hour `expires_at` check/default.

- [ ] **Step 5: Add the bot sender column without changing human rows**

```sql
alter table public.messages add column if not exists bot_id uuid null references public.bots(id) on delete set null;

alter table public.messages drop constraint if exists messages_exactly_one_sender_check;
alter table public.messages add constraint messages_exactly_one_sender_check
  check ((user_id is null) <> (bot_id is null)) not valid;

alter table public.messages validate constraint messages_exactly_one_sender_check;
create index if not exists messages_bot_created_idx on public.messages(bot_id, created_at desc) where bot_id is not null;
```

Before validation, add a transaction-rehearsal query that fails if any existing row has no human sender. Do not invent a bot sender for historical rows.

- [ ] **Step 6: Add service-role-only gateway RPCs**

Create and revoke/grant these exact functions:

```text
bot_create_internal(actor_id, username, display_name, description, token_prefix, token_hash)
bot_list_owned_internal(actor_id)
bot_rotate_token_internal(actor_id, bot_id, token_prefix, token_hash)
bot_token_lookup_internal(token_prefix)
bot_membership_authorize_internal(bot_id, chat_id, operation)
bot_send_message_internal(bot_id, chat_id, method, payload, idempotency_key)
bot_updates_poll_internal(bot_id, offset, limit, timeout_marker)
bot_updates_ack_internal(bot_id, through_update_id)
bot_webhook_set_internal(bot_id, url, secret_hash)
bot_webhook_delete_internal(bot_id)
bot_update_enqueue_internal(bot_id, update_type, payload)
bot_delivery_claim_internal(limit, claim_token)
bot_delivery_finish_internal(attempt_id, claim_token, status, error_code)
```

All use `security definer`, fixed `search_path`, caller-independent actor checks, bounded values and `grant execute ... to service_role` only.

- [ ] **Step 7: Adapt message notifications transactionally**

Replace the active `enqueue_message_notifications()` definition so sender data is selected from `profiles` for `user_id` or `bots` for `bot_id`. Notification payload contains `sender_kind`, `sender_id` or `bot_id`, `sender_name`, `chat_id`, `message_id`, safe preview and route. Existing human sender exclusion remains; bot messages notify eligible human members and continue respecting mutes/preferences.

- [ ] **Step 8: Add database smoke coverage**

Inside `BEGIN`/`ROLLBACK`, create a test bot through internal functions, assert token tables are unavailable to anon/authenticated, send one bot message, verify exactly one sender, one notification per eligible human, no pre-join update, and cleanup all test rows through rollback.

- [ ] **Step 9: Run schema checks and commit**

Run:

```powershell
node --test tests/unit/bot-platform-schema-contract.test.mjs
pnpm.cmd db:types:check
git diff --check
```

Then:

```powershell
git add .migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql tests/unit/bot-platform-schema-contract.test.mjs tests/server/bot-platform-db-smoke.sql scripts/check-database-type-drift.mjs
git commit -m "feat(bot): propose bot identity and delivery schema"
```

---

### Task 2: Build token authentication, request validation and error contracts

**Files:**
- Create: `artifacts/api-server/src/bot/errors.ts`
- Create: `artifacts/api-server/src/bot/schemas.ts`
- Create: `artifacts/api-server/src/bot/tokenAuth.ts`
- Create: `artifacts/api-server/src/bot/repository.ts`
- Create: `tests/unit/bot-token-auth.test.mts`
- Create: `tests/unit/bot-api-schemas.test.mts`
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `BotApiSuccess<T>` and `BotApiFailure` response types.
- Produces: `authenticateBotToken(header) -> AuthenticatedBot`.
- Produces: validated method inputs capped before database access.

- [ ] **Step 1: Add Zod as a direct API dependency**

Run: `pnpm.cmd --filter @workspace/api-server add zod`

Expected: only `artifacts/api-server/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 2: Write failing token tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createBotToken, hashBotToken, parseBotAuthorization } from "../../artifacts/api-server/src/bot/tokenAuth.ts";

test("bot token is URL-hostile and hash-stable", () => {
  const token = createBotToken(() => Buffer.alloc(32, 7));
  assert.match(token.raw, /^lc_bot_[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(hashBotToken(token.raw, "pepper"), hashBotToken(token.raw, "pepper"));
  assert.equal(parseBotAuthorization(`Bot ${token.raw}`), token.raw);
  assert.equal(parseBotAuthorization(`Bearer ${token.raw}`), null);
});
```

- [ ] **Step 3: Implement token generation and constant-time verification**

Use `randomBytes`, base64url encoding, `createHmac("sha256", pepper)` and `timingSafeEqual`. The parser accepts exactly one `Bot` authorization value, rejects tokens longer than 256 characters and never includes the token in thrown errors.

- [ ] **Step 4: Write and implement Zod method schemas**

Define method names as a closed union and cap fields:

```ts
const callbackButtonSchema = z.object({
  text: z.string().min(1).max(64),
  callback_data: z.string().min(1).max(128),
}).strict();

const inlineKeyboardSchema = z.object({
  inline_keyboard: z.array(
    z.array(callbackButtonSchema).min(1).max(8),
  ).min(1).max(8),
}).strict();

export const sendMessageSchema = z.object({
  chat_id: z.string().uuid(),
  text: z.string().min(1).max(4096),
  reply_to_message_id: z.string().uuid().optional(),
  idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  reply_markup: inlineKeyboardSchema.optional(),
}).strict();
```

Media methods accept existing Storage object references created through a bot-authorized upload path, not arbitrary remote URLs. Inline keyboards allow at most 8 rows, 8 buttons per row and bounded callback data.

- [ ] **Step 5: Implement the repository token lookup**

Extract the token prefix without hashing, call `bot_token_lookup_internal`, compute the expected HMAC using `BOT_TOKEN_PEPPER`, compare in constant time, and reject revoked/inactive/suspended bots. Update `last_used_at` through a bounded internal RPC no more than once every five minutes.

- [ ] **Step 6: Implement safe API errors**

```ts
export function botFailure(code: string, message: string, requestId: string, retryAfter?: number) {
  return {
    ok: false as const,
    error: { code, message, request_id: requestId, ...(retryAfter ? { retry_after: retryAfter } : {}) },
  };
}
```

Map validation to `400`, token failure to `401`, permission to `403`, not found to `404`, conflict to `409`, rate limit to `429`, and sanitized internal failure to `500`.

- [ ] **Step 7: Run tests, typecheck and commit**

```powershell
node --test tests/unit/bot-token-auth.test.mts tests/unit/bot-api-schemas.test.mts
pnpm.cmd --filter @workspace/api-server run typecheck
git add artifacts/api-server/src/bot artifacts/api-server/package.json pnpm-lock.yaml tests/unit/bot-token-auth.test.mts tests/unit/bot-api-schemas.test.mts
git commit -m "feat(bot): add secure Bot API authentication"
```

---

### Task 3: Add the separate Bot Gateway and core methods

**Files:**
- Create: `artifacts/api-server/src/botGatewayIndex.ts`
- Create: `artifacts/api-server/src/bot/app.ts`
- Create: `artifacts/api-server/src/bot/methodRouter.ts`
- Create: `artifacts/api-server/src/bot/methods/identity.ts`
- Create: `artifacts/api-server/src/bot/methods/messages.ts`
- Create: `artifacts/api-server/src/bot/methods/commands.ts`
- Create: `tests/unit/bot-method-router.test.mts`
- Create: `tests/unit/bot-gateway-packaging.test.mjs`
- Modify: `artifacts/api-server/build.mjs`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Produces: `POST /bot/v1/:method` and `GET /healthz` on a separate process.
- Methods: `getMe`, `sendMessage`, `sendPhoto`, `sendVideo`, `sendDocument`, `sendVoice`, `sendChatAction`, `editMessageText`, `deleteMessage`, `getFile`, `setMyCommands`, `getMyCommands`, `answerCallbackQuery`.

- [ ] **Step 1: Write a failing method-router test**

Use injected method handlers and assert unknown methods return `method_not_found`, JSON bodies over 256 KiB return `413`, query-token authentication is ignored, and `Authorization: Bot` reaches only the selected method.

- [ ] **Step 2: Implement the isolated Express app**

```ts
const app = express();
app.disable("x-powered-by");
app.use(pinoHttp({ logger, serializers: safeSerializers, redact: ["req.headers.authorization"] }));
app.use(express.json({ limit: "256kb", strict: true }));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "letscube-bot-gateway" }));
app.post("/bot/v1/:method", botMethodRouter);
```

Do not install permissive CORS on Bot API routes.

- [ ] **Step 3: Implement identity and command methods**

`getMe` returns public bot fields and capabilities. `setMyCommands` validates and replaces at most 100 commands in one transaction. `getMyCommands` returns the ordered command list. Commands use lowercase Latin names up to 32 characters and descriptions up to 256 characters.

- [ ] **Step 4: Implement message methods through one transactional RPC**

Every method normalizes into:

```ts
type BotMessageCommand = {
  botId: string;
  chatId: string;
  kind: "text" | "image" | "video" | "file" | "audio" | "chat_action" | "edit" | "delete";
  payload: Record<string, unknown>;
  idempotencyKey: string;
};
```

The database function validates active membership, operation permission, reply ownership and edit/delete ownership. It returns the existing result for a repeated idempotency key.

- [ ] **Step 5: Implement bounded file access**

`getFile` accepts only a message attachment visible to that bot after its join time. Return metadata plus a signed URL valid for at most 60 seconds. Never return raw Storage credentials or unrelated object paths.

- [ ] **Step 6: Add the dedicated build/start entry**

Add `src/botGatewayIndex.ts` to `build.mjs` and scripts:

```json
{
  "start:bot": "node --enable-source-maps ./dist/botGatewayIndex.mjs"
}
```

The entry requires `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `BOT_TOKEN_PEPPER`, fails closed when absent, and does not start media, push or cleanup workers.

- [ ] **Step 7: Run gateway tests and commit**

```powershell
node --test tests/unit/bot-method-router.test.mts tests/unit/bot-gateway-packaging.test.mjs
pnpm.cmd --filter @workspace/api-server run typecheck
pnpm.cmd --filter @workspace/api-server run build
git add artifacts/api-server tests/unit/bot-method-router.test.mts tests/unit/bot-gateway-packaging.test.mjs
git commit -m "feat(bot): add isolated Bot API gateway"
```

---

### Task 4: Implement long polling, webhooks and SSRF protection

**Files:**
- Create: `artifacts/api-server/src/bot/updateDelivery.ts`
- Create: `artifacts/api-server/src/bot/webhookSecurity.ts`
- Create: `artifacts/api-server/src/bot/webhookWorker.ts`
- Create: `tests/unit/bot-update-delivery.test.mts`
- Create: `tests/security/bot-webhook-ssrf.test.mts`
- Modify: `artifacts/api-server/src/bot/methodRouter.ts`
- Modify: `artifacts/api-server/src/botGatewayIndex.ts`

**Interfaces:**
- Produces: `setWebhook`, `deleteWebhook`, `getWebhookInfo`, `getUpdates`.
- Produces: `validateWebhookTarget(url, resolver) -> ValidatedWebhookTarget`.
- Preserves: at-least-once update ordering by per-bot `update_id`.

- [ ] **Step 1: Write failing SSRF tests**

Cover `localhost`, `127.0.0.1`, `[::1]`, RFC1918, CGNAT, link-local, multicast, `169.254.169.254`, credentials in URL, non-HTTPS, private DNS answers, mixed public/private answers and redirects to private addresses. A normal public HTTPS target must pass.

- [ ] **Step 2: Implement URL and DNS validation**

Use `node:dns/promises` with `{ all: true, verbatim: true }`; reject if any answer is blocked. Connect with redirects disabled, re-resolve before each attempt, permit at most two same-policy redirects, cap response to 64 KiB and timeout at 10 seconds.

- [ ] **Step 3: Write failing update-delivery tests**

Assert `getUpdates` acknowledges only IDs below the requested offset, returns at most 100 ordered updates, waits no more than 30 seconds, and conflicts when a webhook is active. Assert `setWebhook` conflicts while long polling has an active lease.

- [ ] **Step 4: Implement polling and webhook mutual exclusion**

Acquire a short database lease per bot and delivery mode. `getUpdates` polls the internal RPC with an abortable 250 ms backoff until data or deadline. `setWebhook` validates the target first, then atomically disables polling and stores the webhook.

- [ ] **Step 5: Implement webhook retry processing**

The worker claims due deliveries using `SKIP LOCKED`, signs requests with a per-webhook secret header, treats 2xx as acknowledgment, classifies 4xx and 5xx, and schedules exponential delays capped at one hour. After the bounded attempt limit it records dead-letter metadata without payload content.

- [ ] **Step 6: Add retention cleanup**

Add a service-role RPC called hourly to delete acknowledged payloads and payloads older than 24 hours, webhook attempt metadata older than 14 days, and bot audit metadata older than 90 days.

- [ ] **Step 7: Run security and delivery tests, then commit**

```powershell
node --test tests/unit/bot-update-delivery.test.mts tests/security/bot-webhook-ssrf.test.mts
pnpm.cmd --filter @workspace/api-server run typecheck
git add artifacts/api-server/src/bot tests/unit/bot-update-delivery.test.mts tests/security/bot-webhook-ssrf.test.mts
git commit -m "feat(bot): add secure webhook and update delivery"
```

---

### Task 5: Add authenticated bot management for ordinary users

**Files:**
- Create: `artifacts/api-server/src/bot/managementAuth.ts`
- Create: `artifacts/api-server/src/bot/managementRoutes.ts`
- Create: `artifacts/kub/src/lib/botManagement.ts`
- Create: `artifacts/kub/src/hooks/useBots.ts`
- Create: `artifacts/kub/src/pages/bots/BotsPage.tsx`
- Create: `artifacts/kub/src/components/bots/BotCreateModal.tsx`
- Create: `artifacts/kub/src/components/bots/BotTokenDialog.tsx`
- Create: `artifacts/kub/src/components/bots/BotSettingsPanel.tsx`
- Create: `tests/unit/bot-management-auth.test.mts`
- Create: `tests/e2e/bot-management.spec.ts`
- Modify: `artifacts/kub/src/App.tsx`
- Modify: `artifacts/kub/src/components/sidebar/SidebarHeader.tsx`

**Interfaces:**
- Produces authenticated control plane under `/bot/manage/v1/*` using a Supabase user bearer token, never a bot token.
- Produces `/bots` authenticated UI.
- Token dialog displays a raw token once and does not persist it.

- [ ] **Step 1: Write failing management-auth tests**

Test missing/expired user JWT, verified email requirement, verified phone requirement, 24-hour account age, active ban, three-bot limit, owner/developer permissions and administrator suspension without token access.

- [ ] **Step 2: Implement management authentication**

Validate the bearer token with Supabase Auth `getUser`. Pass only the verified user ID to service-role RPCs. Return generic `403 bot_creation_not_allowed` for failed eligibility and never disclose which unrelated account condition failed outside the current user's own UI.

- [ ] **Step 3: Implement bot CRUD and token lifecycle routes**

Routes create/list/update/pause/resume, add/remove developer, rotate/revoke token and request/cancel seven-day deletion. Creation and rotation generate token material inside the gateway and return it once. List/detail responses include only token prefix and timestamps.

- [ ] **Step 4: Write the frontend management client**

`botManagement.ts` gets the current Supabase access token, sends it in `Authorization: Bearer`, validates response shapes and maps safe errors. It never writes raw bot tokens to localStorage, sessionStorage, Zustand or logs.

- [ ] **Step 5: Build `Мои боты` UI**

The page includes bot list, create flow, profile/commands/webhook/privacy settings, owner/developer management, pause and delete controls, and aggregated diagnostics. The token dialog has copy feedback, a warning that the token is shown once, and clears its React state on close/unmount.

- [ ] **Step 6: Add route/navigation and Playwright coverage**

Add `/bots` inside the authenticated router and one sidebar/menu entry available to ordinary eligible users. Test creation, one-time token, rotation, developer restrictions, pause and pending deletion. Assert no token remains in storage or DOM after closing.

- [ ] **Step 7: Run frontend/API validation and commit**

```powershell
node --test tests/unit/bot-management-auth.test.mts
pnpm.cmd --filter @workspace/api-server run typecheck
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/bot-management.spec.ts
git add artifacts/api-server/src/bot artifacts/kub/src tests/unit/bot-management-auth.test.mts tests/e2e/bot-management.spec.ts
git commit -m "feat(bot): add user bot management"
```

---

### Task 6: Integrate bot senders into chats, search and notifications

**Files:**
- Modify: `artifacts/kub/src/types/database.ts`
- Modify: `artifacts/kub/src/types/database.generated.ts`
- Modify: `artifacts/kub/src/hooks/useMessages.ts`
- Modify: `artifacts/kub/src/hooks/useChats.ts`
- Modify: `artifacts/kub/src/components/chat/MessageBubble.tsx`
- Modify: `artifacts/kub/src/components/ui/ChatAvatar.tsx`
- Modify: `artifacts/kub/src/lib/chatDisplay.ts`
- Modify: `artifacts/kub/src/hooks/useGlobalSearch.ts`
- Modify: `artifacts/kub/src/components/search/SearchShared.tsx`
- Modify: `artifacts/kub/src/hooks/useNotifications.ts`
- Modify: `artifacts/kub/src/lib/platform/desktopNotifications.ts`
- Create: `tests/unit/bot-message-projection.test.mts`
- Create: `tests/e2e/bot-chat-integration.spec.ts`

**Interfaces:**
- Produces: `BotProfile` and `MessageActor` discriminated unions.
- Message query joins both `sender:profiles!user_id` and `bot:bots!bot_id`.
- Bot results appear in a separate `Боты` search group.

- [ ] **Step 1: Write failing projection tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveMessageActor } from "../../artifacts/kub/src/lib/messageActor.ts";

test("bot sender never masquerades as a human profile", () => {
  assert.deepEqual(resolveMessageActor({ user_id: null, bot_id: "bot-1", bot: { id: "bot-1", display_name: "Helper", username: "helper_bot" } }), {
    kind: "bot",
    id: "bot-1",
    name: "Helper",
    username: "helper_bot",
  });
});
```

- [ ] **Step 2: Add bot-aware database and application types**

Create `BotProfile`, add `bot_id` to `Message`, and define:

```ts
export type MessageActor =
  | { kind: "user"; profile: Profile }
  | { kind: "bot"; bot: BotProfile }
  | { kind: "deleted_bot"; id: string };
```

`MessageWithSender` keeps `sender?: Profile` for compatibility and adds `bot?: BotProfile` plus derived actor helpers.

- [ ] **Step 3: Update every message join consistently**

Replace the shared selection with:

```ts
const MESSAGE_SELECT_WITH_JOINS =
  "*, sender:profiles!user_id(*), bot:bots!bot_id(*), reply_to:messages!reply_to_id(id, content, type, media_url, deleted_at, user_id, bot_id, sender:profiles(id, full_name), bot:bots(id, display_name, username, avatar_url, state)), reactions(*)";
```

Update sidebar summaries and `safeOpenChat` projections to include bot fields without changing pagination, optimistic reconciliation or scroll behavior.

- [ ] **Step 4: Render bot identity and deleted state**

Message bubbles and avatars display the bot name/avatar and a compact `БОТ` badge. A deleted bot renders `Удалённый бот`. Human-only actions such as profile opening are disabled for bots; reply, copy and authorized message actions remain.

- [ ] **Step 5: Add bot search grouping**

Extend `GlobalSearchResultType` with `bot`, return only public active bot metadata through an RLS-safe RPC, and render a separate `Боты` section instead of mixing bots with people. Phone search remains human-only.

- [ ] **Step 6: Adapt notification presentation**

Parse `sender_kind` and `bot_id`. Use bot display name/avatar for in-app, browser, Windows and Android projections while preserving `chat_id`, `message_id`, grouping and exact navigation. Bot messages never create a self-notification because a bot has no human recipient identity.

- [ ] **Step 7: Run chat regression and commit**

```powershell
node --test tests/unit/bot-message-projection.test.mts tests/unit/message-history-anchoring.test.mjs tests/unit/notification-read-sync.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/bot-chat-integration.spec.ts tests/e2e/realtime-messages.spec.ts tests/e2e/notification-center.spec.ts
git add artifacts/kub/src tests/unit/bot-message-projection.test.mts tests/e2e/bot-chat-integration.spec.ts
git commit -m "feat(bot): render bot messages across clients"
```

---

### Task 7: Package, document and deploy the Bot Gateway behind a flag

**Files:**
- Modify: `docs/deploy/Dockerfile`
- Modify: `docs/deploy/docker-compose.coolify.yml`
- Create: `docs/operations/bot-gateway.md`
- Create: `artifacts/kub/src/pages/public/BotDocsPage.tsx`
- Create: `artifacts/kub/src/content/botApiDocs.ts`
- Create: `tests/unit/bot-gateway-deploy-contract.test.mjs`
- Create: `tests/e2e/bot-api-docs.spec.ts`
- Modify: `artifacts/kub/src/lib/publicRoutes.ts`
- Modify: `artifacts/kub/src/App.tsx`

**Interfaces:**
- Produces Docker target `bot-gateway-runtime` and Coolify service `letscube-bot-gateway`.
- Produces public documentation route `/bots/docs` and API URL `https://api.letscube.ru/bot/v1/*`.

- [ ] **Step 1: Write failing deploy contract tests**

Assert the Docker target runs only `dist/botGatewayIndex.mjs`, uses an unprivileged user, exposes its health path, receives no Vite build secrets, and requires `BOT_TOKEN_PEPPER` only at runtime.

- [ ] **Step 2: Add the dedicated runtime image**

```dockerfile
FROM base AS bot-gateway-runtime
ENV NODE_ENV=production PORT=8098
COPY --chown=node:node --from=build /app/ ./
USER node
EXPOSE 8098
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/botGatewayIndex.mjs"]
```

- [ ] **Step 3: Add Coolify service configuration**

Add a service using the new target, healthcheck `http://127.0.0.1:8098/healthz`, runtime-only Supabase/pepper values and route labels for `/bot/v1`. Do not route release catalog paths through this container.

- [ ] **Step 4: Publish developer documentation**

Document token safety, cURL/JavaScript/Python `getMe` and `sendMessage`, commands, callback buttons, group privacy, webhook verification, retries, idempotency, rate limits and update deduplication. State clearly that Telegram concepts are familiar but protocol compatibility is not claimed.

- [ ] **Step 5: Run full local validation**

```powershell
git diff --check
pnpm.cmd typecheck
pnpm.cmd --filter @workspace/api-server run build
pnpm.cmd e2e:smoke
pnpm.cmd db:types:check
pnpm.cmd rls:smoke
node --test tests/unit/bot-platform-schema-contract.test.mjs tests/unit/bot-token-auth.test.mts tests/unit/bot-api-schemas.test.mts tests/unit/bot-method-router.test.mts tests/unit/bot-gateway-packaging.test.mjs tests/unit/bot-update-delivery.test.mts tests/security/bot-webhook-ssrf.test.mts tests/unit/bot-management-auth.test.mts tests/unit/bot-message-projection.test.mts tests/unit/bot-gateway-deploy-contract.test.mjs
pnpm.cmd exec playwright test tests/e2e/bot-api-docs.spec.ts tests/e2e/bot-management.spec.ts tests/e2e/bot-chat-integration.spec.ts
```

- [ ] **Step 6: Rehearse and apply the migration after backup**

Verify a fresh production backup, run `tests/server/bot-platform-db-smoke.sql` in a rolled-back transaction, inspect grants and query plans, then apply the migration. Regenerate database types and rerun RLS smoke.

- [ ] **Step 7: Canary with one internal bot**

Deploy with public bot creation disabled. Verify token creation/rotation, private and restricted-group updates, webhook/getUpdates exclusion, one bot message, notification grouping/read sync, and no raw token in logs. Then enable creation only for a bounded canary cohort.

- [ ] **Step 8: Update tracker and commit rollout evidence**

```powershell
git add docs/deploy docs/operations/bot-gateway.md artifacts/kub/src/pages/public/BotDocsPage.tsx artifacts/kub/src/content/botApiDocs.ts artifacts/kub/src/lib/publicRoutes.ts artifacts/kub/src/App.tsx tests/unit/bot-gateway-deploy-contract.test.mjs tests/e2e/bot-api-docs.spec.ts docs/PRODUCTION_PRIORITY_TRACKER.md
git commit -m "docs(bot): record Bot API canary rollout"
```
