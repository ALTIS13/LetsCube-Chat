# PWA Foreground Push Delivery Design

## Context

LETSCUBE currently creates one `notifications_push_outbox` row per browser
subscription and drains the queue through the `send-push-notifications` Edge
Function. Production Supabase runs that function once per minute. The deployed
database has RLS on notification tables and a server-only Web Push outbox, but
it has no authoritative foreground state.

The production audit on 2026-07-14 confirmed:

- project ref `nhogbeojfnbjcfipitrh`, Postgres 17 and `pg_cron` 1.6.4;
- `kub-send-push-notifications` runs every minute and uses Vault-backed
  credentials;
- the Edge Function returns HTTP 200 and normally completes within a few
  seconds;
- `notifications_mark_chat_messages_read` is absent in production even though
  the frontend already calls it;
- internal `_enqueue_push_after_notification_insert`,
  `_notification_push_allowed`, and `_notification_push_payload` retain broad
  inherited `EXECUTE` grants;
- there is no active native push outbox in the production schema, so this
  design targets the currently deployed Web Push path.

## Required Behaviour

Foreground state is global per user, not per device.

1. If at least one authenticated LETSCUBE client is visible and renewing its
   lease, no system Web Push is sent to any of that user's subscriptions.
2. Message notifications from the currently visible chat are marked read by
   the existing chat-read flow and are never delivered later.
3. Unread notifications from other chats, tasks, and invites remain pending
   while the user is foregrounded.
4. When the final foreground lease closes or expires, pending unread events
   become deliverable on every active subscription.
5. Pending message events are coalesced per subscription and stable
   notification tag, so leaving the app produces at most one card per chat
   rather than a burst of old cards.
6. A notification read before dispatch is terminally suppressed.
7. Normal delivery should begin on the next ten-second dispatcher tick after
   the last session closes. A hard kill or network loss may wait for the
   twenty-second lease expiry plus the next dispatcher tick.

## Database Design

### `public.push_foreground_sessions`

The table contains one row per authenticated client runtime:

- `user_id uuid` references `public.profiles(id)` with cascade delete;
- `client_id uuid` identifies the browser runtime;
- `current_chat_id uuid null` references `public.chats(id)` with `ON DELETE
  SET NULL`;
- `last_seen_at timestamptz` and `expires_at timestamptz` use server time;
- primary key `(user_id, client_id)`;
- indexes on `expires_at` and `(user_id, expires_at)`.

RLS is enabled. `PUBLIC`, `anon`, and `authenticated` receive no table grants.
Authenticated clients can mutate only their own row through narrowly scoped
RPCs.

### Client RPCs

`push_foreground_session_touch(p_client_id uuid, p_current_chat_id uuid)`:

- requires `auth.uid()`;
- rejects a null client id;
- removes expired rows;
- upserts the caller's session with `last_seen_at = now()` and
  `expires_at = now() + interval '20 seconds'`;
- never accepts a caller-provided user id or expiry.

`push_foreground_session_close(p_client_id uuid)`:

- requires `auth.uid()`;
- deletes only `(auth.uid(), p_client_id)`.

Both functions are `SECURITY DEFINER`, have a fixed `search_path`, revoke
`EXECUTE` from `PUBLIC` and `anon`, and grant it only to `authenticated`.

### Outbox State

`notifications_push_outbox` gains:

- `suppressed_at timestamptz null`;
- `suppression_reason text null`, constrained to `read`, `coalesced`, or
  `subscription_inactive`;
- `claim_token uuid null`;
- `claimed_until timestamptz null`.

The pending index covers rows with no `sent_at`, no `suppressed_at`, and fewer
than five attempts.

### Atomic Claim RPC

`push_outbox_claim(p_limit integer, p_claim_token uuid)` is a
`SECURITY DEFINER` function executable only by `service_role`. It uses a fixed
search path and performs one transaction:

1. Delete expired foreground sessions.
2. Mark outbox rows whose notification is already read as `read`.
3. Mark older unread rows with the same `(subscription_id, payload.tag)` as
   `coalesced`, retaining the newest row.
4. Select only users with no unexpired foreground session.
5. Lock eligible rows with `FOR UPDATE SKIP LOCKED`, cap the limit to 1-200,
   and assign the supplied claim token for 60 seconds.
6. Return only the fields required by the Edge Function.

An Edge worker updates an outbox row only when both its id and claim token
match. Success sets `sent_at`; a handled inactive subscription sets
`suppressed_at`; a delivery failure increments `attempt_count` and releases
the claim. If the worker terminates, the row is eligible after `claimed_until`.

## Frontend Design

A new authenticated hook is mounted beside `useHeartbeat`.

- A runtime `client_id` is generated with `crypto.randomUUID()` and stored in
  `sessionStorage` so React remounts do not create duplicate sessions.
- The hook touches immediately, every seven seconds while visible and online,
  on chat changes, on focus, and on the browser `online` event.
- It closes on `visibilitychange` to hidden and during authenticated cleanup.
- Failed calls use throttled warnings and retry on the next lifecycle event;
  they never log tokens, user ids, chat ids, or payloads.
- The server expiry is authoritative. If a close request is interrupted by
  iOS suspension, the lease fails open to push delivery after twenty seconds.

The existing message/read lifecycle remains the authority for whether an
active-chat notification was actually consumed. A stale or offline client
therefore cannot permanently suppress a message merely by retaining an old
chat id.

## Edge Function Design

`send-push-notifications` replaces its direct Web outbox `SELECT` with the
claim RPC. Every invocation creates one UUID claim token. All Web outbox
patches include that token and clear claim fields when reaching a terminal or
retry state.

The existing Web Push encryption, VAPID configuration, payload sanitisation,
subscription pruning, and optional native path remain unchanged. The database
read-state filter added in the current working tree is subsumed by the atomic
claim RPC.

## Failure Behaviour

- **Normal hide:** the close RPC removes the final lease; delivery starts on
  the next ten-second tick.
- **Hard kill or network loss:** the lease expires within twenty seconds;
  delivery starts on the following tick.
- **Foreground touch failure:** delivery eventually resumes rather than
  silently losing notifications.
- **Edge crash before send:** the claim expires after sixty seconds.
- **Edge crash after external send but before acknowledgement:** Web Push is
  at-least-once; a duplicate retry is possible, but the stable per-chat tag
  replaces the previous OS card.
- **Read/foreground race:** the claim transaction checks `read_at` and active
  sessions immediately before returning rows. Exact atomicity with an external
  push service is impossible, so the remaining race is limited to the network
  send window.
- **No foreground sessions table during rollout:** SQL is applied before the
  Edge deployment; the old Edge Function remains compatible with additive
  columns.

## Security

- No service-role or Vault secret enters frontend code, SQL files, logs, or
  documentation.
- The session table is server-write-only through authenticated RPCs.
- `auth.uid()` determines ownership; user-supplied ownership and lease duration
  are not accepted.
- Internal claim and trigger helpers revoke broad inherited `EXECUTE` grants.
- Existing application RLS policies are preserved.
- The migration does not expose the session table through Realtime.

## Testing and Rollout

1. Add failing unit/source-contract tests for the migration, frontend
   lifecycle, and Edge claim path.
2. Implement the idempotent SQL migration and make the tests pass.
3. Apply the migration to project `nhogbeojfnbjcfipitrh`.
4. Verify catalog state, grants, RLS, indexes, and RPC signatures.
5. Run a transaction-scoped database probe that rolls back all test rows.
6. Deploy the updated `send-push-notifications` Edge Function with its existing
   custom-token authentication mode.
7. Change only the existing `kub-send-push-notifications` schedule to
   `10 seconds`, preserving its command, database, username, and Vault usage.
8. Verify Cron history, Edge logs, security/performance advisors, unit tests,
   typecheck, production build, and mobile E2E.

Frontend source changes remain backward compatible but require the normal
GitHub/Coolify deployment before real clients begin renewing leases. No GitHub
push or Coolify deployment is implied by the database/Edge rollout.
