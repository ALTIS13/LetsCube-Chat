# D-331 / Item 75: Member Mentions Contract

Date: 2026-10-01. Owner: Codex coordinator; this document is the bounded
prerequisite sidecar for the already approved continuation.

## Resume And Authority

- Stage: implementation-ready source/reference contract, not a product fix.
- Evidence: main at `29176d72e6b1686a61bd91ef322d592f115e40e6`, current
  D-331 acceptance and tracker item 75, local source, and primary references
  actually read on 2026-10-01.
- Blocker: none for starting the source implementation. Live database parity,
  authenticated notification delivery and physical-client behavior are unknown.
- Next: coordinator completes item 74, then implements the first slice below
  against its resulting tree. Recheck changed source boundaries, not the whole
  reference investigation. No new design-approval round is requested.
- This task writes only this file. No code, database, deployment, native-device,
  commit or agent work was performed. Existing coordinator changes in HANDOVER,
  the defect register, tracker and takeover/implementation reports are untouched.

Read basis: [AGENTS](../../AGENTS.md), [HANDOVER](../HANDOVER.md),
[working lessons](working-lessons.md), [CLAUDE](../../CLAUDE.md),
[D-331](../INTERFACE_DEFECT_REGISTER.md),
[item 75](../PRODUCTION_PRIORITY_TRACKER.md),
[approved sequence](2026-10-01-implementation.md), and
[reference clients](reference-clients.md), especially sections 15.1, 17.7 and 19.

## First Implementation Slice

Keep the existing textarea and send machinery. Add one shared scoped picker and
one persisted identity-bearing metadata column. A selected person or bot is
inserted into text; selecting never sends. Text and media captions carry the same
entity representation through drafts, edits, optimistic rows, retries and reads.
Pressing a received selected mention opens the existing profile surface by UUID.
Human notification fanout remains one ordinary message notification per eligible
recipient, with a recipient-local mention marker, not a second ping.

Include group/micro-group conversations and their existing topic views. Reuse the
same rules wherever the existing composer is used in a private chat; its roster
is only that chat's members and installed bots. Do not invent channel-specific
permissions absent from the current schema. Validate that a supplied topic
belongs to the supplied chat and retain existing general-topic handling.

Exclude global user search, strangers, role/everyone/here mentions, no-@ name
prediction, a rich-editor replacement, new profile modals, mention-only inbox or
notification preference, bot API expansion, native releases and phone-lookup
changes. A hand-typed or pasted plain `@handle` remains legacy text: no handle
lookup, automatic identity conversion, historical backfill or extra targeted
notification. This is a deliberate identity-safe boundary, not Telegram parity.

## Dated Primary References

All links below were inspected on 2026-10-01. OFFICIAL means first-party docs or
published client source, not fresh physical measurement of a running client.

| Reference and date | Actual evidence | Adopted mechanic / limit |
| --- | --- | --- |
| Telegram, [Edit Messages, New Mentions and More](https://telegram.org/blog/edit?setln=en), published 2016-05-15; OFFICIAL historical documentation | Typing @ and selecting can address a group member without a username. The article also describes notifying through a muted group. | Select a scoped member without requiring a handle. Do **not** adopt the mute bypass. |
| Telegram, [styled text entities](https://core.telegram.org/api/entities), read 2026-10-01; OFFICIAL API | Mention-name entities identify a user; offsets and lengths use UTF-16 code units. Username entities are a separate mechanism. | Persist identity and source-text ranges; do not reconstruct identity from a mutable handle. |
| Telegram, [Bot API MessageEntity](https://core.telegram.org/bots/api#messageentity) and [Message](https://core.telegram.org/bots/api#message), read 2026-10-01; OFFICIAL API | `text_mention` carries a user, and messages distinguish text entities from caption entities. | Cover both text and captions. LETSCUBE stores both against its existing `messages.content`, rather than importing Telegram's wire schema. |
| Telegram Web A, [mention extension](https://github.com/Ajaxy/telegram-tt/blob/28ffcf710b15571e5a2f7bb3bdce3fc90fc8ec80/src/components/common/tooltips/extensions/richEditorTooltips/mention.ts) and [tooltip](https://github.com/Ajaxy/telegram-tt/blob/28ffcf710b15571e5a2f7bb3bdce3fc90fc8ec80/src/components/common/tooltips/MentionTooltip.tsx), commit `28ffcf710b15571e5a2f7bb3bdce3fc90fc8ec80`, committed 2026-09-29 14:17:24 UTC; OFFICIAL SOURCE READ | The extension finds @ at the caret after a text boundary, filters member IDs plus separate bot lists, and inserts a mention node carrying `userId`, display text and optional username. The tooltip shows identity rows and selection inserts, not sends. | Adopt caret-local replacement, identity rows and explicit selection. Do not import its Tiptap editor or unrelated inline/guest-bot candidates. This is not proof of the current served bundle or native keyboard behavior. |
| Discord, [Mention Suggestions FAQ](https://support.discord.com/hc/en-us/articles/35692242798743-Mention-Suggestions-FAQ), updated 2025-11-03; OFFICIAL | The documented experiment matches names locally among people able to view the conversation; Tab inserts. It is limited to some users and desktop, with no @ required. | Adopt scoped local name matching and desktop Tab. Do not claim universal Discord mobile/browser behavior or adopt the no-@ experiment. |
| Discord, [Message / Allowed Mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object), read 2026-10-01; OFFICIAL API | Explicit user IDs are checked against message content and permissions; allowed mentions do not guarantee push delivery. | Validate visible entities server-side and respect recipient eligibility. Do not equate a colored token or successful insert with provider delivery. |
| Discord, [Notifications Settings 101](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101), updated 2025-07-17; OFFICIAL | Channel overrides distinguish all messages, mentions, nothing and mute; mute also silences mentions. | Keep existing LETSCUBE mute/push preferences authoritative. No new preference or mention override in this slice. |

Existing `reference-clients.md` records dated Discord profile activation and
two-tier profile mechanics. Those historical observations support reusing the
already implemented profile opener; they were not remeasured on a device here.
No new reference was added to that read-only file.

## Current Source Evidence

These are source observations, not runtime measurements or live schema claims.

| Boundary | Observed behavior and consequence |
| --- | --- |
| `artifacts/kub/src/components/chat/MessageInput.tsx` | `onSend` / `onEdit` and textarea state carry strings. The draft key is chat-only plain text. The bot-command picker, composition handling, Enter rule, held attachment text and send-scope restoration already exist. Add metadata to these paths, not a second send implementation. |
| `artifacts/kub/src/components/chat/ChatWindow.tsx` | Attachment sending trims a caption and assigns it to one caption carrier; voice/round-video captions can be separate text messages. Target chat/topic and retry state are captured before async completion. Preserve this ownership. |
| `artifacts/kub/src/hooks/useMessages.ts` | `SendMessageInput`, optimistic construction, retry, edit and explicit realtime projection do not carry mentions. Edits update `content` and `edited_at` directly; legacy installed clients can still do that. |
| `artifacts/kub/src/lib/outbox/{outboxRules,outboxStorage,appOutbox,outboxRunner}.ts` | Text entries have account identity and content, but no mention metadata. Inserts use an explicit payload; retry/idempotence uses `client_message_id`. Runner async start/send completion needs account-generation tests, not an assumption that consumer guards suffice. |
| `artifacts/kub/src/lib/formatText.tsx` | ASCII @handles become colored spans, not UUID-backed actions. Tokenization protects inline code and processes lines separately; a naive entity split would lose absolute offsets or break surrounding markdown. |
| `artifacts/kub/src/components/chat/MessageBubble.tsx` / `MessageAlbumTile.tsx` | Text and visible media captions have different render paths; album captions currently use plain text. Caption visibility can trim/hide filename-like text. Entity offsets must correspond to the actual displayed slice. |
| `artifacts/kub/src/hooks/useChats.ts` / `lib/chatBotMembership.ts` | Human roster comes from `chat_members` with profiles; active bots come from `chat_bot_members` with `removed_at IS NULL`. `useBotChat` is not a complete bot roster. |
| `artifacts/kub/src/store/app.store.ts` / `components/profile/UserProfileOverlay.tsx` | `openUserProfile` changes overlay state; author activation already supplies chat context, trigger and row bounds. Bot profiles have a separate opener. Reuse them; do not enter a chat to view a profile. |
| `supabase/migrations/20260930150000_micro_groups.sql:507` | `enqueue_message_notifications()` fans out ordinary `kind=message` rows to chat members except the author, honoring hidden/cleared/message-hidden conditions. No mention entity processing appears in this definition. |
| `.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql:197` | `_notification_push_allowed` checks push preferences, chat mute and author exclusion, but does not establish current source access or personal-block eligibility. |
| `.migration-backup/supabase/migrations/20260504_notifications.sql` | Notification SELECT is owner-scoped; this alone does not revalidate current chat access to a stored preview. |
| `.migration-backup/supabase/migrations/20260914120000_personal_blocks_and_reports.sql` | Blocks are private and directional. The write restriction is for private chats, not group-history visibility. A new notification rule must not silently rewrite message-history RLS. |
| `supabase/migrations/20260925222612_web_push_subscription_owner_recheck.sql` / `20260925212424_native_push_outbox_delivery_recheck.sql` | Delivery rechecks validate subscription/device ownership and claim/read state, but these definitions do not provide all source-access/block/preference checks. Album recheck in `20260926085544_album_push_outbox.sql` additionally checks membership and preferences. |

`types/database.ts` is the app schema boundary, via `types/database.app.ts`;
`types/database.generated.ts` is not justification for a broad regeneration.
Messages already store both text and captions in `content`. Local membership
policies in `20260504_chats_membership_hardening.sql` are chat-based; no separate
topic-view ACL was established by this inspection.

## Identity And Persistence

Add `public.messages.mention_entities jsonb NOT NULL` with this empty default:
`{"version":1,"revision":null,"items":[]}`. No new table or global lookup RPC.
The proposed client model is:

```ts
type MentionEntity =
  | { kind: "user"; user_id: string; offset: number; length: number; label: string }
  | { kind: "bot"; bot_id: string; offset: number; length: number; label: string };

type MessageMentionsV1 = {
  version: 1;
  revision: string | null;
  items: MentionEntity[];
};

type MentionText = { content: string; mentionEntities: MessageMentionsV1 };
```

`user_id` is `profiles.id`, not username, phone or email. `bot_id` is `bots.id`,
not its owner's profile ID. The discriminator is mandatory even if UUID strings
coincide. `label` is the selected visible text snapshot, including @; it is not
identity authority. Renames and reused handles never retarget historical text.

Use UTF-16 code-unit offsets into the **exact persisted content**. Require
integer offset >= 0, positive length, complete Unicode boundaries, sorted
non-overlapping ranges, exact substring equality with `label`, and a visible
label beginning with @. Limit to **32 entities** and **128 UTF-16 units per
label**; reject control/newline labels. Repeated references to one UUID are valid
at distinct ranges but never duplicate its notification. Unknown versions,
unknown keys, invalid UUIDs or malformed ranges fail with `22023`, not silent
identity loss. Client assertions and server fixtures use these literal limits.

`revision` is a snapshot UUID, not authentication, ordering or message identity.
An entity-aware content save creates a new revision, even if the ranges happen
to stay identical. An outbox retry retains the same content, entities, revision
and `client_message_id`. This one-column envelope solves the legacy edit case:
if an UPDATE changes content but leaves metadata identical to OLD, the BEFORE
trigger clears metadata. Old clients cannot leave an old UUID attached to newly
typed text. Explicit entity updates require a fresh revision; unrelated updates
with unchanged content/metadata preserve existing entities.

Server admission is independent of sender-visible preferences. On INSERT or a
new/replaced entity in an edit, require the target to be a current member of
that chat, or an active installed bot in it. A structurally valid target that
has left is stripped to plain text, and the canonical returned row carries the
empty/reduced metadata. Do not delete or rewrite the person's text. Recipient
mute, hidden state and private blocks must not change that canonicalization or
expose a sender-visible delivery verdict. Existing unchanged entities in a
historical message remain stable when a member subsequently leaves; edits do
not generate fresh notifications. Serialize admission against membership removal
where needed, then recheck delivery after commit.

Inline/fenced code, URL/email ranges and `/command@bot` addressing are not active
member-mention contexts. A selected entity wrapped into a masked context becomes
plain text. Bold/italic surrounding a mention remain supported. Use shared
client fixtures and matching server validation for these exclusions; do not
trust a client-supplied entity to create a phantom ping in hidden/non-actionable
text. This does not add a new markdown dialect.

## Picker And Composer Rules

- Scope every roster/request/result by authenticated user, chat, topic and
  generation. Use the loaded human roster and a scoped active-bot read, never a
  global profile query. Loading, confirmed empty, denied/error and ready are
  different states; a failed roster read cannot reuse another chat's candidates.
- Candidates contain only public display identity: kind, UUID, name, handle,
  avatar and existing member/bot role. No phone, email, recipient preferences,
  presence ranking or indication that somebody blocked the sender. Omit self
  from suggestions; forged self entities still never notify self server-side.
- Search display-name word starts and handle prefixes locally, case-insensitively
  with existing locale conventions. Normalize only the search key, not content.
  With bare @ show the scoped roster. Use stable display-name / kind / UUID
  ordering, no private recent-activity ranking. Show eight rows at a time with
  scroll for remaining matches. Same names show avatar and handle; where no
  handle distinguishes duplicates, show a UUID suffix long enough to distinguish
  them. Bots have the existing bot badge and separate identity.
- Open only for collapsed caret selection after @ at a text boundary, outside
  masked contexts. The query ends at the caret. Choosing replaces that exact
  query range, preserves the suffix, inserts the entity and a separating space
  only if needed, and places the caret after insertion. Human display uses
  `@full_name` with `@username` fallback; bots use `@username`. Spaces and Unicode
  in selected display names are valid. Snapshot scope/query/caret before choice.
- Desktop Up/Down move selection; Tab or Enter chooses once and consumes that
  event, never sends. A subsequent ordinary Enter retains the established send
  behavior. Escape closes only this picker first and does not reopen until the
  query/context changes. With no picker, retain all existing key priorities.
- Phone Enter always inserts a newline, even with the picker open; it does not
  choose or send. Touch chooses; the existing send arrow sends. Preserve
  `composerEnter.ts`, orientation handling and native/state composition guards,
  including keyCode 229. During IME composition do not select, send or rebase a
  partial composition as a completed edit.
- Keep textarea focus/keyboard on pointer selection. Use combobox/listbox
  semantics, active descendant, accessible identity labels and >= 44 px touch
  rows. Position within the composer/attachment viewport above the keyboard;
  do not cover the send control. Only one emoji/attachment/bot-command/member
  suggestion menu may own the same input at a time.
- Rebase entities through text edits. An edit strictly before a range shifts
  it; an edit inside/overlapping its label drops that entity, keeping text.
  Insertion at its start shifts it; insertion at its end stays outside. Paste
  creates plain text unless it is an internal already-owned snapshot. Final
  trimming and typed-bot-command rewriting must transform content and offsets
  together. Never apply metadata to a differently trimmed string.

Drafts store the complete snapshot under an account-owned versioned key, proposed
`kub:draft:v2:<userId>:<chatId>`, with its owner and version in the value. Preserve
the current chat-level draft behavior rather than invent topic-specific drafts;
topic changes still invalidate pending picker/send callbacks. Do not automatically
attribute old unowned `kub:draft:<chatId>` strings to the next signed-in account.
Leave those legacy values intact; only transfer an already loaded legacy draft
when its current-session owner is known. This preserves stored data without
guessing ownership. Account changes clear in-memory entities, held captions,
candidate caches and requests; late account-A callbacks cannot enter account B.

## Send, Caption, Edit And Render Paths

The smallest reviewable path scopes below are **future implementation**, not
files edited by this task. Names under "new" are proposed additions.

| Scope | Exact paths / contract |
| --- | --- |
| Shared model and completion (new) | `artifacts/kub/src/lib/memberMentions.ts`: pure snapshot, range-rebase, trim and context rules. `hooks/useMemberMentions.ts`: account/chat roster and request generation. `components/chat/MemberMentionMenu.tsx`: shared keyboard/touch picker, no send ownership. |
| Composer/send adapter | `components/chat/MessageInput.tsx`, `ChatWindow.tsx`, `hooks/useMessages.ts`, `lib/composerSendScope.ts`: pass content plus entities; extend restoration ownership with account/topic generation without changing phone Enter mechanics. Send-time DOM content must match the metadata snapshot. |
| Caption handoff | `lib/attachSheet.ts`, `attachCaptionHandoff.ts`, `components/chat/attach/AttachSheet.tsx`, `AttachSendBar.tsx`: caption and held composer text become snapshots. The same picker works in caption textarea. Cancel restores the original snapshot and shifts any text typed meanwhile; choosing does not submit the sheet. |
| Attachment queue | `lib/stagedAttachments.ts`, `attachmentSendQueue.ts`, `outgoingMedia.ts`, `lib/outbox/outgoingMediaStorage.ts`, `appOutgoingMedia.ts`, `appBackgroundUploads.ts`, `hooks/useOutbox.ts`: persist entities with caption on the existing caption carrier only. Separate voice/round-video caption text carries its own entities; the media row does not duplicate them. Filename fallback never manufactures a mention. |
| Text queue and acknowledgement | `lib/outbox/outboxRules.ts`, `outboxStorage.ts`, `appOutbox.ts`, `outboxRunner.ts`, `lib/optimisticMessage.ts`, `hooks/useMessages.ts`: snapshot entities on enqueue, offline persistence, retry and restore; install canonical acknowledged entities. Missing legacy metadata reads as empty. IndexedDB's existing record store can accept the optional field without a version bump. Guard runner start, send completion and projection by account epoch. |
| DB typing/projections | `types/database.ts`, `types/database.app.ts`, `lib/messageProjection.ts`, `hooks/useMessages.ts`: Row/Insert/Update and explicit realtime/optimistic projections carry the column. Existing top-level `*` reads already admit new columns; explicit embedded reply fields need a conscious choice. Keep reply/search/clipboard previews plain and noninteractive in this slice. |
| Formatting and activation | `lib/formatText.tsx`, `components/chat/MessageBubble.tsx`, `MessageAlbumTile.tsx`: tokenize with absolute source positions, preserving newline and markdown offsets. Valid entity tokens take priority over the legacy handle span and render an accessible inline action. Media-caption trimming supplies a correctly rebased snapshot. Do not nest mention buttons inside a media-opening button. |
| Existing profile surfaces | Reuse `store/app.store.ts` openers, `lib/profileTier.ts`, `profileCache.ts`, `components/profile/UserProfileOverlay.tsx`. Human mention calls `openUserProfile(uuid, "glance", chatId, anchor, rowBounds)`; bot mention uses the existing bot opener. Stop row/media propagation. Loading/denied/deleted identity is not a forged profile. No mark-read/delivered call, chat navigation, automatic contact addition or duplicate overlay. |
| Forward/delete compatibility | `lib/messageForward.ts` and the server forwarding function originating in `.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql`: forwarded content remains readable but entities are empty; no source UUIDs or re-pings copied into the destination. `supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql`: scrub entities wherever content is scrubbed and disable all activation/delivery for deleted rows, including report-retained content. |

The current `MediaViewer.tsx` item interface has no caption field; do not invent
a new viewer caption surface for this task. Existing text/caption surfaces are
the required renderer boundary. Historical/invalid metadata renders harmless
plain text, never a render-time username lookup.

Edits write content and entities atomically with a new revision through the
existing update path. Cancel restores the pre-edit snapshot. Edits may remove or
change the marker on an existing notification but must not insert another
notification, reset `read_at`, or enqueue a new push. Forwarding drops identity
metadata deliberately; a separately authored forward comment uses normal send.
No entity-bearing send may copy `appOutbox`'s missing-media-column fallback:
missing mention schema must retain a failed/retryable snapshot, not silently
strip UUIDs and claim success.

## Server Schema And Notification Privacy

Implement in a new timestamped migration under `supabase/migrations/`, with its
rollback and byte-identical migration-backup copy at integration time. This task
does not create or run it. The migration owns the column, UTF-16 validation,
legacy-edit normalization, notification annotation/access and bot predicate
extension. Cover direct table/PostgREST writes as well as RPC/internal inserts;
do not put the only guard in a client or a new RPC that old clients bypass.
Keep existing messages INSERT/UPDATE authorization and restrictive bans/mutes.

UTF-16 server slicing must count non-BMP characters as two code units and reject
half-surrogate boundaries; PostgreSQL `char_length`/`substring` positions are not
interchangeable with JavaScript indices. Validate and canonicalize in a BEFORE
trigger, before the existing AFTER notification/bot fanout. Content-preserving
pin/delivery updates must not strip historical entities because a target left.

Preserve `kind=message`,
`notifications_message_user_once_idx(user_id, payload->>'message_id')` and the
existing route/tag/read/album aggregation. Compute `payload.mentioned` separately
for each recipient as existence of a valid user entity with that UUID. Omitted
means false for old rows. Do not copy entity arrays, target IDs, labels or private
preference decisions into every recipient's payload. Bot entities never notify
the bot owner as a person. Server author identity controls self exclusion.

Use an internal locked-search-path definer predicate, proposed
`private.message_notification_visible_to(message_id, recipient_id)`, to evaluate
trusted recipient eligibility rather than impersonating `auth.uid()`:

- Current human membership and readable source/chat/topic; banned recipients
  excluded. Respect existing hidden chat, cleared-before-message and per-user
  hidden-message conditions. Membership epoch must exclude pending delivery
  from before a leave/rejoin. The topic belongs to the source chat, not the UI's
  current topic. No new topic ACL is presumed.
- For human-authored messages, the recipient's private block of that author
  suppresses their notification. Do not disclose the block to the sender or
  remove readable group history. Private-chat write rejection stays unchanged;
  do not repurpose it as group-history authorization. Bot-owner blocks are not
  an invented substitute for a bot-specific rule.
- Source deletion forbids delivery. Any retained tombstone notification must
  have already been scrubbed by the deletion contract, including mention marker.
  A notification is never a back door to a source preview after access loss.

Apply the predicate to ordinary message enqueue and notification read access,
not just to an extra "mention" route. Keep the existing owner SELECT condition
and add a restrictive message-source condition. An authenticated wrapper, if
needed for RLS, accepts only a message ID and derives recipient from `auth.uid()`;
never expose a caller-selected recipient probe. Revoke default PUBLIC/anon
execution on new helpers, explicitly grant only the wrapper to authenticated,
and keep internal recipient-taking helpers private to trusted server callers.
Task/system notifications and bot visibility are not routed through this helper.

Mute/preference rules are an additional **delivery** condition, not a membership
oracle. Preserve existing muted-row persistence/display behavior, but never
sound, badge through a suppressed path or push because `mentioned=true`.
Extend `_notification_push_allowed` and each web/native/album pre-dispatch recheck
with current source eligibility and current preferences; retain their independent
subscription/device owner, foreground, read and claim checks. A block, mute,
leave, ban, deletion or account rebind after enqueue must stop pending delivery.
Do not rely on enqueue-time checks alone. A sent external card cannot be recalled;
retain existing generic push title/body and sanitized route/tag without mention
text or recipient lists. No service-role secret enters the client.

Client annotation scope is `hooks/useNotifications.ts`,
`lib/messageNotificationProjection.ts`, `notificationRows.ts` and existing
presentation consumers only if displaying the marker. Preserve one sound and
one badge transition per existing row. Guard initial refresh and late callbacks
by account epoch as well as realtime filters. This does not claim to finish the
separate DND/AFK task or prove delivery on an installed shell.

Before integration, inspect the live catalog's column/trigger/function/policy/
grant/index owners and definitions against this source contract. Apply the
repository's verified backup, rollback, transaction and raising self-check
procedure; do not infer live parity from local migration files. Schema first
keeps old clients compatible with the empty default and legacy-edit clearing;
entity-producing web code follows. Rollback disables the producer first and
retains stored metadata until a deliberate compatibility/data-retention decision,
rather than dropping historical identities as an automatic recovery action.

## Bot Routing Must Remain Full-Read

The existing predicate is `private.bot_can_receive_message(bot_id, message_id)`
in `.migration-backup/supabase/migrations/20260920120000_bot_full_visibility_request_removal.sql`.
It admits the bot's own messages, private-chat traffic, and full-mode group
traffic independently of @ text; restricted mode also admits addressed commands,
legacy raw bot mentions and replies to that bot. Live membership, removal and
`message.created_at >= joined_at` remain prerequisites.

If a selected bot entity is supported, add only an OR branch inside the existing
restricted-mode addressing branch for a validated `kind=bot` / `bot_id` match.
Do not replace legacy command/raw-mention/reply branches. Never require entities,
human notification eligibility, a human block predicate or targeted text for
`privacy_mode='full'`. Human UUIDs and bot owner UUIDs are not bot addressing.

Preserve privacy-mode epoch reset, pending-update purge and poll/webhook delivery
recheck from `20260926144000_bot_privacy_delivery_epoch.sql` and the subsequent
`20260926193000_bot_viewer_interface.sql` definition. Preserve existing admin
full-mode opt-in in `20260926110234_chat_bot_privacy_control.sql`.
The Bot Gateway's `schemas.ts`, `repository.ts`, `methods/messages.ts`,
`updateDelivery.ts` and `webhookWorker.ts` under
`artifacts/api-server/src/bot/` were inspected: no text/caption entity wire
contract is established there. Do not add one in this first slice. Keep existing
gateway payload text and full-read routing; a future bot API entity feature is
separate work, not a hidden requirement for member completion.

## Regression And Acceptance Matrix

New test paths below are proposed; none were created or run by this task.
Start with a mounted composer/received-message case that fails against
`29176d72` because there is no scoped picker or UUID-backed profile action.

| Layer / proposed path | Required cases and literal assertions |
| --- | --- |
| `tests/unit/member-mentions.test.mts` | Caret in middle preserves suffix; same-name members and human/bot namespaces; Cyrillic/spaces; leading non-BMP emoji costs 2 units; multiline and trim offsets; insertion at both boundaries; deletion inside label; paste/undo/redo; code/URL/email/command masking; bold around selected mention; 32 allowed/33 rejected; 128-unit label bound; rename/reused handle never changes UUID. |
| Existing unit suites | Extend `composer-enter.test.mts`, `attach-caption-handoff.test.mts`, `staged-attachment-caption.test.mjs`, `attachment-send-queue.test.mts`, `outbox.test.mts`, `outgoing-media.test.mts`, `outgoing-media-persistence.test.mts`, `message-author-profile.test.mts`, `profile-tier.test.mts`, `profile-cache.test.mts`, `notification-rows.test.mts`, `notification-read-sync.test.mjs`, `bot-notification-projection.test.mts`, `chat-bots.test.mts` only for changed contracts. |
| `tests/server/member-mentions-db.test.mjs` | Default/shape/UTF-16 validation; direct insert and legacy/entity-aware edit; unchanged pin update; inactive target canonicalizes to plain text without block/mute oracle; foreign chat/topic/outsider cannot create a ping; self yields 0 rows; two ranges to one user yield 1 ordinary row; retry yields 1 row; edits/forward/delete do not re-ping; caption carrier only; owner/source RLS with successful positive controls; private block direction; leave/rejoin/ban/hidden/clear changes; server-only grants. Local SQL emulation is not authenticated production proof. |
| Existing server privacy suites | Extend `web-push-delivery-recheck-db.test.mjs`, `native-push-delivery-recheck-db.test.mjs`, `album-push-outbox-db.test.mjs`, `chat-bot-privacy-smoke.sql`, `chat-bot-privacy-epoch-smoke.sql`. Change block/mute/membership/source access after enqueue and before dispatch; rebind device/subscription to another account. Assert no pending delivery and no raw mention content in external payload. Assert full-mode bot receives an ordinary message with empty entities; restricted branches and epoch revocation remain effective. |
| `tests/e2e/member-mentions.spec.ts` | Local synthetic roster/storage/API; desktop keyboard, touch, Escape, denied/loading/empty, stale lookup after chat/account/topic switch, IME, phone Enter with picker open in both orientations; selection performs 0 sends. Draft/edit cancel, caption hold/cancel/send, offline/retry/account switch preserve UUIDs. Received text/file/album caption actions open correct existing human/bot profile with 0 read/delivered writes, 0 chat navigation and 0 command/media activation. |
| Existing e2e boundaries | Reuse changed-case evidence from `composer-enter.spec.ts`, `offline-outbox.spec.ts`, `profile-without-entering-chat.spec.ts`, `profile-two-tier.spec.ts`, `bot-command-and-profile.spec.ts`, `bot-group-membership.spec.ts`. Do not rerun unchanged phone-stage gates just to duplicate coordinator evidence. |

Render and inspect exact picker, mention text/caption and profile activation at
**1440 and 390**, light and dark; verify long names, scrolling, keyboard viewport,
focus and no overlap. Use fully synthetic local data, not a QA server silently
connected to production. Every Playwright run sets `KUB_QA_ALLOW_MUTATIONS=0`;
any later signed-in verification disables screenshots, traces and video.

Mutation cases must go red when UUID transport is removed from an outbox/caption
path, code-point offsets replace UTF-16, identity is resolved by current handle,
account-generation checks disappear, phone Enter selects/sends, recipient block/
mute/member checks are removed, self or duplicate notification is allowed, or
full-mode bot routing requires a mention. Expected IDs, limits and row/write
counts are literal fixture assertions, not values imported from the mutated rule.

After source/schema integration, use controlled authenticated accounts to prove
the sender cannot see recipient-private decisions, a real eligible recipient
receives exactly the existing ordinary notification, and ineligible recipients
do not. Validate PostgREST/RLS and actual function owners/grants on real PostgreSQL,
with positive controls proving the probe works. A source test, colored mention,
mock push success or local UI screenshot cannot close those requirements.

## Unknowns And Completion Boundary

- No current production catalog, container/bundle, push-provider or physical
  Telegram/Discord/LETSCUBE client was inspected. Exact live schema parity and
  provider/device behavior remain unestablished, not assumed successful.
- Local source exposes notification access/recheck gaps described above; this is
  not a claim that every deployed function has those exact definitions. Refresh
  the affected live objects before applying the bounded migration.
- Existing public-profile RLS may limit what a departed/deleted target reveals.
  Activation must honor the current denial/limited profile state, not broaden
  access or redirect to whoever now owns the old handle.
- The limits, ordering, legacy-draft ownership rule and no-edit-reping policy
  above are explicit LETSCUBE design decisions, not measured reference behavior.
- D-331 stays open until implementation, visual acceptance and authenticated
  identity/notification boundaries pass. This document completes the prerequisite
  contract only; it does not mark the defect fixed or overlap item 74 delivery.
