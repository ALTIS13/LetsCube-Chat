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

### Windows, closed — correct as it is, and the answer is autostart

**No client ever registers a WNS channel.** The server half is fully built
(`send-push-notifications/wns.ts`, `index.ts:404-474`) and the schema accepts a
`windows`/`wns` device (`20260724_windows_wns_push_devices.sql:41-47`), but
`usePush.ts:623-630` hardcodes `p_platform: "android", p_provider: "fcm"` — and
the product already tells the user so, at `usePush.ts:130-133`: «Уведомления
Windows работают, пока LETSCUBE запущен.»

**The owner's decision, 2026-09-18: this is not a defect and is not to be
closed.** A closed desktop client should not ring, and Telegram's does not
either. Chasing WNS delivery for a call would be building the wrong thing.

**The answer is to let the application be running.** Windows is the **only**
shell in this product with a working retraction primitive —
`remove_windows_notification` calls `RemoveGroupedTagWithId`
(`windows-tauri/src-tauri/src/lib.rs:929-945`) — so a *running* Windows app can
both ring and stop ringing, which nothing else here can do. What is missing is
not delivery to a closed application but a way for it not to be closed:
**start at sign-in, and start minimised to the tray**, as two separate choices.

Measured on 2026-09-18: Tauri 2.11.5 with the `tray-icon` feature already on
(`windows-tauri/src-tauri/Cargo.toml:25`), plugins `deep-link`, `opener`,
`single-instance` and `updater` — **and no autostart plugin**. `src/startup.rs`
is the application's own startup *stages* and has nothing to do with starting
at login; the two must not be conflated.

That work is slice D2 below and is in flight as of this writing.

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

## 4a. Many devices, one person

Asked for by the owner the same day: «звонка на разные устройства и возможности
отключить принятие звонков на определённое авторизированное в аккаунт
устройство». Telegram rings every device you are signed in on, stops the rest
the moment one answers, and lets you turn a device off for calls.

### Ringing every device is free, and stopping them is free too

Each signed-in client holds **its own** Realtime subscription — the unfiltered
`voice_channels` channel from §3 is opened per application instance, not per
account — so a ring row reaches every device that is running, with no fan-out
to build and no list of devices to keep. The same property cancels it: whichever
device answers writes to the row, every other subscription sees that write, and
they stop. **This is the one part of the feature that costs nothing**, and it is
the reason the ring belongs on a row rather than on a message.

Two traps that come with it, and both have to be handled in the rule rather than
in the interface:

- **The same person may answer twice.** Two of B's devices can press «ответить»
  within the same second. The row has to record *which device* answered and
  refuse the second, or both join and B hears themselves. The answer is a
  conditional write — the first write wins, and a device whose write did not
  land stops ringing and says the call was answered elsewhere, which is what
  Telegram shows.
- **A device that was asleep must not ring late.** A laptop woken ten minutes
  after the call was missed will receive the row's history on resubscribe. The
  ring's own expiry — the same timestamp slice C is about — is what keeps it
  from ringing at a call that is long over, and it has to be evaluated on
  arrival rather than trusted.

### «Do not accept calls on this device» needs a device, and there are three

Measured on production on 2026-09-18, and this is the part that does not fall
out for free. The schema has **three different notions of a device**, and none of
them is «this installation of the application»:

| what | identity | live state |
|---|---|---|
| `public.user_push_devices` | the FCM token; `device_id` is nullable | **9 rows, 5 users, platform `android` only, and `device_id` is NULL in all 9** |
| `public.push_subscriptions` | the Web Push `endpoint`, with a `user_agent` beside it | the browser/PWA half |
| `public.push_foreground_sessions` | `client_id`, a uuid **per tab**, with a 20-second lease | not a device at all |

`user_push_devices` already carries an **`enabled boolean not null`** — which is
exactly the shape a per-device switch wants, for push rather than for calls. But
`device_id` being null in every live row (matching `usePush.ts:628`, which
passes `p_device_id: null`) means the interface has nothing stable to name a
device by, and `platform` being `android` in all nine means the Windows and
browser halves are not in that table at all.

So there are two honest shapes, and they are not the same size:

**A — a switch that lives on the device it governs.** Stored locally, per
installation: «не принимать звонки на этом устройстве». It works immediately, it
needs no schema, and it is truthful — the device that is told is the device that
obeys. What it cannot do is be seen or changed from another device, and it is
lost when somebody clears site data. Telegram's own per-device call setting is
*not* this, so it would be the smaller thing wearing the larger thing's name
unless the interface says where the setting lives.

**B — a device registry, which is Telegram's «Активные сеансы».** A stable id per
installation, stored server-side with a label the person recognises, listed
anywhere and toggleable from anywhere. This is the real answer, and it is a stage
of its own: it overlaps `user_push_devices` (which half-is it already, with
`enabled`, `device_model`, `app_version` and `last_seen_at` all present and a
`device_id` column sitting unused), and it would want to cover the browser and
Windows halves that table does not.

**Recommended:** A in the first version, with the interface saying plainly that
the setting belongs to this device; B as its own stage, built on
`user_push_devices` by finally giving `device_id` a value rather than by adding
a fourth notion of a device. **The owner decides whether the first version ships
with A or waits for B** — that is question 6 below.

### What a per-device switch must not become

A device that refuses calls must still be told that a call happened, or the
person picks up their laptop and has no idea somebody rang. The refusal is about
**ringing**, not about the record: the missed-call row in the conversation is the
same for every device, because it is a fact about the call rather than about the
phone.

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

**Slice D2 — Windows autostart, to the tray and normally.** Two separate
choices, read from the real state rather than from what the application last
wrote, and drawn only on the shell that can do it. It is what turns «a closed
client cannot ring» from a limitation into a setting, and it needs no device:
the registry key is the mechanism and can be read back, though whether the
application truly starts at the next sign-in cannot be proved without signing
out and in.

**Slice E — what the product says on the iPhone.** One shell, not two: the
installed iPhone app cannot ring in the background and no setting changes that,
so the interface says so plainly, exactly as slice 6 of the voice proposal
already commits to for background audio. Windows is no longer in this slice —
see the decision above.

**Slice F — «do not accept calls on this device».** Shape A, local to the
installation, with the interface saying where the setting lives; or shape B,
the device registry, if the owner wants Telegram's «Активные сеансы» first.
Ringing every device and stopping the rest is **not** in this slice — it falls
out of the ring itself and is built in slice A.

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
5. ~~**Windows closed is a stage of its own.**~~ **Answered by the owner on
   2026-09-18:** a closed client should not ring, as Telegram's does not.
   Autostart — to the tray and normally — is the requirement instead, and it is
   slice D2. WNS delivery to a closed application stays unbuilt and unwanted.
6. **Does the first version ship the per-device switch as A or wait for B?**
   A is local to the installation and works at once; B is the device registry
   and is a stage. §4a has the measurement behind both.
7. **When a device refuses calls, does it still show the incoming call
   silently, or nothing at all?** Telegram shows nothing on a device you have
   turned off. Either is defensible; the record in the conversation is the same
   for every device regardless.

## 7. What this proposal will not claim

It will not claim a ring on a backgrounded iPhone, because that is not possible
here and it was measured rather than assumed. It will not claim one on a closed
Windows application either — but for a different reason, and the difference
matters: that one is **correct behaviour** rather than a missing feature, and
the setting that makes the application run is the answer to it.

It will not route a ring through push, because the measured floor is up to
eighty seconds. And it will not reuse the group call's occupancy trigger for
«missed», because that mechanism announces calls that never happened.
