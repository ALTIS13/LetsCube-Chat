# Bot Viewer Interface V1: Design Contract

Status: design for item 48, not deployed. Owner direction: a bot may open a
temporary interface for one participant of a shared chat without showing it
to other members. This follows the completed shared inline-input stage; that
field still sends an ordinary, publicly visible reply in a group.

## Purpose and boundary

A person presses a bot's existing button in a group. The bot may answer with
a short private panel showing status, progress and actions. Only the person
who pressed sees or operates the panel. It survives navigation and short
disconnects for at most 15 minutes, can be edited or closed by its bot, and
disappears immediately when access is revoked. It does not create a chat
message, unread count, push notification, search result or export entry.

V1 intentionally does not collect private text. The shared inline input is
not a substitute: using it in a group sends to the group. Private text needs
its own update type and delivery checks in a later release.

## Authority and data

`private.bot_viewer_interfaces` is a non-Realtime, RLS-enabled table with no
direct `anon`, `authenticated` or `service_role` table grants. The row stores
an opaque UUID, bot ID, exact source callback UUID, source bot-message ID,
chat ID, viewer user ID, snapshots of human and bot membership epochs,
the creator bot-token ID,
bounded panel state, integer version, creation time, fixed expiry 15 minutes
later, and optional close time. The bot owner never supplies viewer, chat or
source-message IDs: the create writer derives them from a still-valid,
field-immutable `private.bot_callback_interface_grants` row. The grant is minted
inside the transaction that enqueues a validated `callback_query`, records
bot/token/actor/chat/source and expires after 10 minutes. It survives poll/webhook
ACK cleanup of the update itself; no client or bot token can insert or alter
it directly. A rotated or revoked token cannot pass its unused grant to a new
token. Hiding or removing the viewer, removing the bot, deleting the
source message, and suspending the bot revoke matching grants in the same
transaction as they close panels. A callback can create at most one panel.
Grant cleanup does not erase an already-created panel.

Panel state is plain text only: title 1-64 characters, body at most 512,
optional integer progress 0-100, and up to six action buttons in at most
three rows. Each button has display text 1-64, a stable key 1-32, and opaque
callback data 1-128 bytes. JSON is bounded and strictly shaped in API and
database; button keys are unique within a panel. No HTML, arbitrary URL,
media reference or executable payload.
The actor read returns labels and keys, never opaque callback data.

## Operations

Bot-token methods:

- `setViewerInterface(callback_query_id, state, idempotency_key)` creates the
  panel for the actor of that valid callback grant; a byte-identical retry returns
  the same ID and version, a divergent retry conflicts.
- `editViewerInterface(interface_id, expected_version, state,
  idempotency_key)` replaces state only for the same active bot and advances
  the version once. It cannot extend expiry or change viewer/source/chat.
- `closeViewerInterface(interface_id, expected_version, idempotency_key)`
  closes the panel. Repeated exact requests are idempotent. A stale version
  conflicts rather than overwriting another edit or close.

Each writer receives the token ID returned by gateway authentication and
rechecks that exact token's `bot_id` and `revoked_at` under a row lock within
the write transaction. A token rotation/revoke invalidates panels it created,
including pending actions; a new token cannot edit or close an old-token
panel. A request authenticated just before rotation is not grandfathered in.

Authenticated actor RPCs:

- `bot_viewer_interfaces_for_actor(chat_id)` returns at most eight active
  panels for `auth.uid()` in that chat. It rechecks membership, hidden state,
  bot active membership and epoch, source bot-message existence/deletion,
  closure and wall-clock expiry. Unknown, other-user and revoked panels are
  indistinguishable in the response.
- `bot_viewer_interface_press(interface_id, expected_version, button_key)`
  locks the row, repeats those checks, resolves callback data from stored
  state, and enqueues the existing `callback_query` update type. It returns
  only the new callback UUID. The actor cannot supply arbitrary bot data.
- `bot_viewer_interface_dismiss(interface_id, expected_version)` lets the
  viewer close their own panel without changing a message or another viewer.

Creation is limited to three active panels from one bot to one viewer in one
chat, and eight active panels for that viewer/chat across bots. The writer
serializes the viewer/chat capacity check and rejects a ninth rather than
silently hiding a stored panel from the reader.

The new callback update carries an internal `viewer_interface_id` marker.
The existing poll and webhook delivery guard must drop this marked update if
the panel has since closed, expired or lost membership/source validity. The
action keeps its press-time provenance, but a later ordinary edit of the
panel does not invalidate an already-queued press. The
bot may answer the callback through existing `answerCallbackQuery`. A webhook
is checked again after preparation, immediately before HTTP dispatch. An HTTP
request already begun cannot be recalled, so close is a guarantee for future
delivery attempts, not a retraction of bytes already received by the bot. A
stale delivery claim is retried, not classified as a panel revocation.

## Client and compatibility

Only a supported client calls the actor RPC. After a button press, it checks
for a private panel tied to that callback and shows it as an unframed chat
overlay, separate from message history. It refreshes while visible, on chat
re-entry and on reconnect, and removes it locally on close/expiry/account
change. A failed or slow bot response never displays an optimistic panel.
Actions expose pending state and do not retry automatically. Reduced-motion,
keyboard and mobile touch behavior follow existing dialog conventions.

Installed clients without this feature keep the original shared keyboard;
no new key is inserted into `messages.bot_reply_markup`. Bot documentation
must tell developers to send a short `answerCallbackQuery` fallback for those
clients. A new client prioritizes the panel over that fallback. This is a
compatibility path, not a claim that an old APK can render the panel.

## Revocation and retention

Read and press must deny immediately after viewer leave/hide, bot removal,
bot membership-epoch change, source-message deletion, bot suspension, close
or expiry. Revocation triggers permanently close panels on a viewer hide or
membership deletion, source-message deletion and bot suspension; a later
unhide, rejoin or resume cannot revive one. Expiry is checked with
wall-clock time in every reader and action; a background job may hard-delete
expired rows. The existing hourly worker attempts bounded cleanup, with a
24-hour backlog monitor; delayed physical cleanup cannot make rows visible.
Token revoke/rotation is also a permanent revocation; readers and delivery
guards recheck the creator token even before physical panel cleanup.
Queued marked actions are filtered again at poll/webhook preparation and at the
worker's pre-dispatch boundary. Direct
table reads and calls to internal writers remain denied to clients.

## Acceptance gates

1. A sees only A's panel; B, anon, another bot and direct table reads cannot
   retrieve it. Forged callback IDs and button keys are rejected. Creating
   after the source update's ACK/cleanup succeeds only while the separate
   grant remains valid; an expired grant never does.
2. Identical idempotent retry returns one panel; divergent retry, stale
   version and edit-versus-close race cannot overwrite current state.
3. Leave/hide/rejoin, bot privacy epoch/removal, source deletion, suspension,
   token revoke/rotation, close and TTL revoke read, press and queued future
   delivery. A token revoked between gateway auth and the writer is denied.
4. A panel creates no `public.messages` row, unread count, search item or
   notification. Existing callback and inline-input tests remain green.
5. Desktop/mobile, light/dark, keyboard and reconnect checks show a stable
   private overlay without leaking content to another signed-in account.
   An older installed Android client must retain its shared buttons and
   receive the documented fallback, not a broken keyboard.

Production migration requires a verified backup, exact prestate checks,
transactional rehearsal, self-check, byte-identical archive copy and rollback
script. No private panel is enabled in production until all actor-isolation,
delivery and compatibility checks pass.

The decision to avoid a `public.messages` visibility flag is also supported
by [Supabase's Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes):
DELETE filtering and old-row visibility differ from INSERT/UPDATE, making the
shared message stream a poor privacy boundary for a one-person panel.
