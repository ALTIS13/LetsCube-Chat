# One-to-one calls in a private chat, and the record each one leaves

Written 2026-09-18, after a feasibility measurement taken the same day. Nothing
in here is built. The owner sees this before code, the way the voice work itself
went.

## 1. What was asked for

> «в лс между людьми также учти немаловажную часть как уведомления о звонках в
> чате по аналогии с telegram/discord (с отображением того успешный ли это
> звонок или пропущенный, сколько он длился в случае если был успешный и т.п)»

A call between two people in a private chat, and the record it leaves in the
conversation: answered or missed, and how long it lasted.

**The record cannot come first, because the calls do not exist.** Voice today is
a room in a group that people walk into. A one-to-one call is somebody *ringing*
you, and nothing in this system tells the other person that somebody is calling.

## 2. What already exists, measured

Three things were checked against the code before anything here was designed.

**The interface refuses voice outside a group**, and only the interface:
`lib/voiceChannel.ts:230`, `voiceChannelRowOffer` answers `not_a_group` for every
other chat type.

**The gateway does not check the chat type at all.**
`voice-gateway/index.ts:264-268` selects `id, chat_id, max_participants,
speak_role, participant_count, archived` from `voice_channels` with no join to
`chats`, then reads `chat_members.role` (`:287-295`), then `is_muted` (`:311`). A
`voice_channels` row belonging to a private chat would mint a token happily. **So
the transport and the server are already type-agnostic**, and none of this
proposal is about them.

**The presence half already works for a private chat with no change at all.**
`useVoicePresenceReader` subscribes to `voice_channels` with `event: "*"` and no
filter — RLS decides the audience (`hooks/useVoicePresence.ts:136-140`) — and
`ChatListItem` draws the mark with no chat-type gate (`ChatListItem.tsx:118`,
`:362-372`). If a row existed on a private chat and A joined it, B's chat list
would already say somebody is in a call there. That is not a ring, but it is the
live signal a ring can be built on.

### The thing nobody had named

**In a private chat, one participant can create a call room and the other
cannot.** `voice_channels` INSERT is governed by «admins manage voice channels»
= `is_chat_admin(chat_id)` (`20260913150000_voice_channels.sql:168-172`), and
`is_chat_admin` is `role in ('owner','admin')`
(`20260504_chats_membership_hardening.sql:245-257`). Whoever *opened* the private
chat holds `owner`; the other side is `member`.

So this is a policy change as well as an interaction: either a narrow policy that
lets a member of a **private** chat create exactly one room in it, or a
`SECURITY DEFINER` RPC that does it on their behalf. The second is preferable —
it can refuse to make a second room, refuse for a non-private chat, and leave the
existing policy untouched.

## 3. The ring, which is the crux

| B's state | Ring possible? | Cancellable? |
|---|---|---|
| Application open, in front | **Yes, today** | **Yes, today** |
| Application open, backgrounded | **Yes, with a named change** | Yes on that route; **no** through push |
| Closed — **Android** | With four named changes | **No, not today** |
| Closed — **Windows** | **No** | — |
| Closed — **iOS installed app** | **No, not as a ring** | **No** |

**In front and backgrounded are the same mechanism**, and it already runs: the
unfiltered `voice_channels` subscription is mounted by `Sidebar`
(`Sidebar.tsx:69`), which `MainLayout` renders at `:183` and, on a phone with a
chat open, *hides with CSS rather than unmounting* (`:180`). So the channel is
live in every signed-in state of the web, Android and Windows shells, and a
second row change cancels a ring for free. What is missing is a handler: nothing
listens for a ring, and the current reader cannot even see one, because it
re-reads with `.gt("participant_count", 0)` (`useVoicePresence.ts:117-121`) and a
ringing room has nobody in it yet.

A backgrounded tab can also be made to sound and to raise an OS notification
without any new transport: `useNotifications` already raises a Windows toast from
a realtime INSERT (`useNotifications.ts:190-194`) and already retracts one
(`:243-247`).

### Push cannot carry a ring, and the number is now measured

Read live from `cron.job` on 2026-09-18:

    kub-send-push-notifications | * * * * * | true

**One minute**, not the ten seconds the plan of 2026-07-14 pins
(`docs/superpowers/plans/2026-07-14-pwa-foreground-push-delivery.md:331-336`) —
that document is stale and should be corrected separately.

On top of that, `usePushForegroundSession` releases the foreground lease the
moment the page is hidden (`:69`, `:93`, `:116-123`), and `push_outbox_claim`
refuses to hand out a Web Push row while a live lease exists, with a **20-second**
TTL (`20260714_push_foreground_sessions.sql:279-284`, `:98`, `:103`). So a ring
routed through push to a just-backgrounded tab is suppressed for up to twenty
seconds and then waits up to a minute for the cron.

**Up to eighty seconds.** That is not a ring, and it settles the question:
**Realtime is the only transport in this system fast enough, and it exists only
while the application runs.**

Push also cannot cancel: the service worker's `push` handler always shows a
notification (`sw.js:215-226` → `:228-245`) — there is no silent branch — so a
«the caller hung up» push would draw a second card rather than close the first.

### Android, closed

Four named changes, each measured:

1. message pushes are `NORMAL` priority (`fcm.ts:77`; only `task` gets `HIGH`),
   so they are held through Doze;
2. the TTL is a day (`fcm.ts:78`) where a ring wants seconds;
3. there is no call-grade channel — importances are 3/4/3
   (`lib/platform/nativePush.ts:136-162`);
4. the manifest declares `POST_NOTIFICATIONS` only: **no
   `USE_FULL_SCREEN_INTENT`**, no service, no `foregroundServiceType`
   (`android/app/src/main/AndroidManifest.xml:43-55`).

And **cancellation is not possible at all today**: there is no
`FirebaseMessagingService` subclass and no cancel bridge anywhere in `android/`;
`pushNotificationReceived` is a deliberate no-op (`nativePush.ts:119-126`), and
`collapse_key` replaces an *undelivered* message rather than a shown card. A
ringing phone that cannot be stopped when the caller hangs up is worse than no
ring.

### Windows, closed — not possible

**No client ever registers a WNS channel.** The server half is fully built
(`send-push-notifications/wns.ts`, `index.ts:404-474`) and the schema accepts a
`windows`/`wns` device (`20260724_windows_wns_push_devices.sql:41-47`), but
`usePush.ts:623-630` hardcodes `p_platform: "android", p_provider: "fcm"` — and
the product already tells the user so, at `usePush.ts:130-133`: «Уведомления
Windows работают, пока LETSCUBE запущен.»

Worth noting for later: Windows is the **only** shell with a working retraction
primitive — `remove_windows_notification` calls `RemoveGroupedTagWithId`
(`windows-tauri/src-tauri/src/lib.rs:929-945`). A *running* Windows app can ring
and stop ringing today.

### iOS installed app — not possible as a ring

A card can arrive; a ring cannot. Four reasons, all measured: declarative Web
Push draws the card **without running the service worker** (`webpush.ts:20-37`,
sent at `index.ts:498-509`), so the SW's own close path never runs;
`showPushNotification` sets no `actions` (`sw.js:230-244`), so there are no
answer and decline buttons; there is no silent branch to cancel with; and WebKit
suspends the page in the background
(`2026-09-13-voice-channels.md:215-219`).

**The interface must say this rather than pretend**, exactly as slice 6 of the
voice proposal already commits to saying it for background audio (`:1177-1184`).

## 4. The record in the conversation

### Where it lives

One `type = 'system'` row per completed call, carrying a structured payload and
keeping the Russian sentence in `content`.

`messages.type` is plain `text` with **no enum and no CHECK on its values** — the
only constraint mentioning it is `messages_sender_shape_check`, which requires a
`'system'` row to have `user_id is null and bot_id is null`
(`20260831100000_bot_platform_foundation.sql:635-644`). And
`MESSAGE_SELECT_WITH_JOINS` begins with `*` (`lib/messageProjection.ts:7`), so a
new column or key reaches the client with no query change.

Three properties come free and are worth stating because they are the reason this
shape is right rather than merely possible:

- **no client can forge one** — the only permissive INSERT policy wants
  `auth.uid() = user_id`, which the shape check forbids for a system row;
- **it pushes nothing** — `enqueue_message_notifications` returns null on its
  first branch for `type = 'system'` (`:5698-5701`). A missed-call *notification*
  is therefore a separate decision, not a side effect;
- **its audience is already right** — «Chat members can view messages» plus the
  restrictive banned-reads guard.

`media_metadata` would technically accept the payload — its shape constraint
types only the keys it names (`20260913132000_message_media_metadata_shape.sql:41-67`)
— but hanging a call's record off a column named for media is a naming lie. A
column of its own is the honest shape.

### What it has to carry, and the one field that fights the schema

`outcome` ∈ {answered, missed, declined, cancelled}, and `duration_ms` when
answered. Both are straightforward.

**Direction is not.** «You called / they called» needs the caller's id, and
`messages_sender_shape_check` forbids `user_id` on a `'system'` row. Putting the
caller in the payload is the answer; making the row non-system is not, because
that would start it pushing and would make `resolveMessageActor` answer `invalid`
for a row with a `user_id` and no sender (`lib/messageActor.ts:28-33`).

### What the renderer needs

Today `SystemMessageNotice` draws exactly one thing: a string, centred in a pill
(`MessageList.tsx:182-191`). Telegram draws an icon, a direction and a duration,
and makes the row tappable to call back. That is **one new branch** in
`MessageList` reading the payload — no new table, no new push path, no change to
read marks, no change to RLS.

### «Missed» cannot come from the SFU, and the group mechanism must not be reused

Four events are handled and only four (`webhookEvents.mjs:16-21`).
`room_started` fires on the **token request** — before anybody connects
(`docs/operations/voice.md:163-167`) — so it fires when A presses «call» for a
call nobody answered. `room_finished` can be lost to a restart, which is why
`voice_channel_recount` clears a stale flag after a grace window.

**Occupancy reaching 2 is the only positive signal of an answer in the system.**
And the absence of an event is not an event: «missed» is a **timeout**, and
nothing here runs a timer — the reconciler's 30-second tick
(`voiceReconciler.ts:38`) is the only periodic process, which is coarse for
«ringing for forty-five seconds, then missed».

So the group-call trigger's mechanism **does not transfer**. It keys on
`participant_count` crossing zero
(`20260918200000_a_call_says_so_in_the_conversation.sql:540-546`), and a missed
one-to-one call is: A joins (0→1, writes «started»), nobody comes, A gives up
(1→0, writes «ended»). **It would announce a call that never happened** — which
is precisely the failure that migration's own header spends its first section
ruling out for the token-press case (`:19-25`).

What *does* transfer, and should: keying on a **transition** rather than an
event, so redelivery is harmless; the **latch** as one nullable timestamp meaning
«the conversation has been told», released in the same statement that writes the
line (`:308`, `:321-331`, `:466`); **snapshotting the name into the text**,
because the message outlives the room (`:454-456`); and the **pure-function
boundary** so the rule is testable without an SFU (`:340-349`).

**The outcome must therefore be written by whatever owns the ring's lifecycle** —
a row A creates and A or B resolves — and not by a trigger on occupancy. The SFU
can confirm «answered»; it cannot produce «missed», and it cannot produce
«declined» at all.

## 5. The slices

**Slice A — a call room a member can make, and the ring between two open
applications.** The definer RPC that creates exactly one room in a private chat
for either participant; the ring state on that row; a handler on the existing
`voice_channels` subscription; accept, decline and cancel; the incoming-call
surface. Gate: A rings, B's screen says so within a second with the application
in front and in a background tab, and B's ring stops when A hangs up.

**Slice B — the record.** The outcome and duration written by the lifecycle
owner; the payload column; the call card in `MessageList`; the chat-list preview.
Gate: four calls — answered, missed, declined, cancelled by the caller — leave
four distinguishable records, each once, and a missed call leaves exactly one row
rather than a start and an end.

**Slice C — the missed-call timeout.** Somebody has to decide that a ring has
expired. Options are the reconciler (coarse at 30 s), a per-ring client timer
resolved by whichever side is still there, or a database timestamp resolved
lazily on the next read. Gate: a caller who closes their laptop mid-ring still
produces exactly one «missed» record.

**Slice D — Android, closed.** HIGH priority, a short TTL, an importance-4 call
channel, `USE_FULL_SCREEN_INTENT`, and a cancel path — which needs Kotlin, a
signed release and a device QA pass. **Not startable without a device.**

**Slice E — what the product says on the shells that cannot ring.** Windows
closed and the iOS installed app. A plain line, in place of pretending.

## 6. Open questions, which are the owner's

1. **Does a missed call notify?** A system row pushes nothing by design. Telegram
   sends a missed-call notification. Making it do so is a deliberate addition,
   and it inherits the existing gates — `_notification_push_allowed` requires an
   explicit `push_enabled` row and honours per-chat mutes — so a person who muted
   a chat would not learn they were called. Correct for messages; a decision for
   calls.
2. **How long does it ring before it is missed?** Telegram rings about 45
   seconds; Discord until cancelled.
3. **Is a call offered in every private chat, or only between people who are
   already in contact?** Anything that can ring a stranger is an abuse surface,
   and the existing block list is the obvious gate.
4. **Video, or audio only, in the first version?** The token already permits
   video, and the answer changes the incoming-call surface.
5. **Windows closed is a stage of its own.** Closing it means a migration, an
   authenticated channel-registration path and Rust work — worth doing, but not
   inside a call proposal.

## 7. What this proposal will not claim

It will not claim a ring on a closed Windows application or on a backgrounded
iPhone, because neither is possible here today and both were measured rather than
assumed. It will not route a ring through push, because the measured floor is up
to eighty seconds. And it will not reuse the group call's occupancy trigger for
«missed», because that mechanism announces calls that never happened.
