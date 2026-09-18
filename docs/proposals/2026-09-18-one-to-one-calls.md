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


### A hidden window has to stay awake, and nobody has checked that it does

**This is the risk the whole «let it be running» answer rests on, and it is
pre-existing rather than introduced by autostart** — close-to-tray already hides
the window today.

Chromium throttles timers in a hidden or occluded page, and this shell passes
`additional_browser_args` carrying **only** `--disk-cache-size` — there is no
`--disable-background-timer-throttling`, no `--disable-renderer-backgrounding`,
no `--disable-backgrounding-occluded-windows` (`windows-tauri/src-tauri/src/lib.rs:1329-1351`).

What that does and does not threaten is worth separating, because the two
halves of a ring behave differently:

- **the arrival** of a ring is a WebSocket message, and a socket delivers to a
  hidden page. That half is probably fine;
- **everything with a clock** is not. The ring's own expiry, the «missed» cut-off
  of slice C, and any re-read on resubscribe all run on timers, and a throttled
  timer turns «ringing for forty-five seconds» into something else.

Adding those three flags would settle it, and they were **deliberately not
added** with the autostart work: they affect every launch, they cost battery and
CPU whenever the window is hidden, and that is a product decision rather than a
side effect of a settings row. It is question 8.

**And it must be measured rather than reasoned about.** The honest experiment is
a hidden window with a timer and a socket, observed over several minutes — not a
reading of Chromium's documented policy, which is a statement about a browser
rather than about this shell at this version with these arguments.
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

### A fourth notion of a device, measured on 2026-09-18 — and it may be the right one

The recommendation above was to build B on `user_push_devices` «by finally
giving `device_id` a value rather than by adding a fourth notion of a device».
Two things measured while starting that work argue against it, and a third
argues for something else entirely.

**`user_push_devices` has no client grants at all.** `authenticated` and `anon`
hold nothing on it — every write goes through an RPC — so a «list my devices»
surface needs a read function written for it. That is a small cost and worth
naming: the table holds `token` and `token_hash`, and a listing RPC must return
neither.

**The bigger objection: it is keyed on a push token.** No push, no row. A
browser tab signed in without notification permission still rings while it is
open, and its owner still needs to be able to silence it from their phone — and
it would not be in the list at all. Nine rows, five users, `platform = android`
in all nine: today that table is one shell's push registry, not an inventory of
where somebody is signed in.

**`auth.sessions` is the inventory, and it already exists.** GoTrue keeps a row
per authorisation with `user_agent`, `ip`, `created_at`, `updated_at` and
`refreshed_at` — which is what «Активные сеансы» *is*, in Telegram and here. It
needs no registration code in any shell, it covers every platform equally, and
«авторизированное в аккаунт устройство» is a description of a row in it.

Two facts about it that a design has to answer, both measured:

- **342 sessions across 15 users, and `not_after` is null on every one.** A raw
  listing would show somebody twenty-odd entries, most of them long dead. So the
  list needs a freshness rule — `refreshed_at` within some window — and that rule
  is a product decision about what «active» means, not a detail.
- **A session is not an installation.** Signing out and in again on the same
  laptop makes a new row, so a per-session switch resets when somebody
  re-authenticates. Telegram behaves the same way, which makes it defensible —
  but it should be chosen rather than discovered.

**The assumption this rests on, stated as one.** For a device to read *its own*
row it must know which session it is, and the natural answer is the `session_id`
claim in the access token (`auth.jwt() ->> 'session_id'`). Nothing in this
repository reads it today, so it was measured against the deployed binary
instead — `supabase/gotrue:v2.189.0`, counting struct tags:

    session_id: 2    user_metadata: 2    app_metadata: 3
    aal: 2           amr: 2              is_anonymous: 2

`session_id` appears with the same multiplicity as four claims that are
certainly in `AccessTokenClaims`, which is strong evidence it sits in that same
struct rather than in a refresh-token type.

**Strong evidence, not proof.** What is still missing is a real signed-in access
token decoded and read, and that needs an account this track does not sign in to
on production. Take that last step before building on it; if the claim turns out
absent, the whole shape changes and a client-generated installation id comes back
into play.

So slice F has a fork in it that §4a did not have, and the honest order is:
verify the claim, decide what «active» means, then build. The switch itself is
small either way — one boolean, read where the ring is decided.

#### «Active» measured, and the answer is `refreshed_at`

Taken on production on 2026-09-18, and the two candidate definitions are not
close:

| freshness taken as | sessions in 30 days | per person: fewest / average / most |
|---|---|---|
| `refreshed_at` | 24 | 1 / **2.0** / 7 |
| `coalesce(refreshed_at, created_at)` | 298 | 1 / **19.9** / **127** |

**318 of 342 sessions have never been refreshed.** A session that came back for a
token is a living installation; one that never did is a sign-in that went
nowhere. So «active» is `refreshed_at within 30 days`, which gives a person two
entries on average and seven at worst — a list somebody can read. The other
definition gives one person **127**, which is not a device list, it is a log.

Every session inside that window has a `user_agent`, so a label is always
available and none of them has to be called «unknown device».

One wart, named rather than solved: a session that has just signed in and not yet
refreshed is **not** in its own list until it does. Measured: no session created
in the last day is unrefreshed, so the window is short in practice — but a device
that cannot see itself for an hour is a confusing first impression, and
`or created_at > now() - interval '1 hour'` is the cheap answer if it shows up.

#### And the number nobody asked about is the interesting one

**342 sessions for 15 people, 318 of them never refreshed.** That is roughly
twenty-three dead sign-ins each, and nothing prunes them. It does not break the
list — the freshness window hides them — but it is worth knowing before a screen
called «Активные сеансы» exists, because the same rows are what a security
screen would be counting, and because something is creating far more sessions
than there are devices. Not diagnosed here; recorded so that the device work does
not quietly inherit it.
### What a per-device switch must not become

A device that refuses calls must still be told that a call happened, or the
person picks up their laptop and has no idea somebody rang. The refusal is about
**ringing**, not about the record: the missed-call row in the conversation is the
same for every device, because it is a fact about the call rather than about the
phone.

## 4b. Moving a call between your own devices

Asked for by the owner on 2026-09-18, after slice F's database half landed:
«если он заходит с условного телефона то система видела что активна условная
голосовая сессия в какой-то группе и предлагает по аналогии с discord
присоединиться в этот голосовой чат с телефона заместо компьютера, но
одновременно с двух устройств в один войс зайти должна быть нельзя, сами войсы
не должны иметь грубой привязки и в случае если изначальный владелец голосового
канала выйдет то подключение не должно обрываться».

Three requirements. **Two of them are already true**, which is worth establishing
before building anything.

### «Сами войсы не должны иметь грубой привязки» — already so, measured

Nothing binds a room to whoever made it.

- `created_by` on `voice_channels` is **written and never read to decide
  anything**: the only function whose body mentions it is `voice_private_room`,
  which sets it on insert. Grepped across every function in `public` and
  `private`.
- Nothing ends a room because a **particular** person left. The two functions
  that touch `active_since` are `voice_channel_recount` and
  `voice_channel_set_active`, and both key on the **count**, never on identity.
- LiveKit closes a room `empty_timeout: 60` seconds after it is empty — that is
  emptiness, not ownership, and a room with anybody still in it stays.

So a group voice channel already behaves as Discord's does: a place that exists,
which people enter and leave, whose life is occupancy. The one call that *does*
end when somebody leaves is the one-to-one call, which the owner confirmed
separately on the same day and which is deliberate.

### «Одновременно с двух устройств в один войс нельзя» — already so in the data

`voice_participants`'s primary key is **`(channel_id, user_id)`**. One person
cannot be represented twice in one room, whatever any client does.

What that does *not* settle is the transport. LiveKit is documented to
disconnect an existing participant when a second connection arrives with the
same identity — and the identity this product mints is the user id, read off the
SFU's own log: `participant: 1532baab-…`. **That behaviour is not verified
here**, and the design below deliberately does not depend on it: the client
refuses to join a room it already believes itself to be in elsewhere, and offers
to *move* instead. If LiveKit's rule is what the documentation says, the move is
belt and braces; if it is not, the interface is the thing that keeps the rule.

### What is actually missing: the phone does not know

Everything needed is already on the client, which is the pleasant part.

`voice_participants` is `SELECT`-able by any member of the chat — “members read
voice participants”, `is_chat_member(voice_channel_chat(channel_id))` — and it is
in the `supabase_realtime` publication. So a phone that has just signed in can
see that **its own user id** is a participant of room C, while its own call state
says it is connected to nothing. Those two facts together are «вы в этом
голосовом чате на другом устройстве», and neither needs a new table, a new
device identity, or a round trip to ask.

The rule is therefore pure and small, and belongs in `lib/` with the others:

    inCallElsewhere(myUserId, participantRows, localCallChannelId)
      → the channel I am in somewhere else, or null

### What the surface says, and the one place it must not lie

Discord simply moves you, and says so afterwards. This should **say it first**,
because moving is not free: it disconnects the person's other device
mid-sentence, and on a computer that device may be the one with the good
microphone in front of the person they are talking to.

So: «Вы в этом разговоре на другом устройстве» with «Перейти сюда», and the
press does two things in one: join here, which ends the connection there. The
sentence must not promise both devices can listen, because they cannot.

### The device's name is slice F's, and this is why it was worth building

The banner reads better as «на компьютере» than as «на другом устройстве», and
slice F now has the registry that can say which: `session_devices_list` labels
each authorisation from its `user_agent`. Wiring the label in needs one thing
this schema does not have — **which session a participant row belongs to** — and
that is the honest shape of «чёткое определение устройства пользователя»:

    alter table public.voice_participants add column session_id uuid

written by the gateway from the token's own `session_id` claim at join, read by
nobody else. It is a small migration and it is **not** in the first version of
this: the banner works without it, and the claim is still the one thing in slice
F that is strongly evidenced rather than proved. Prove the claim, then name the
device.

### What this is not

**Not a second mechanism for «who is in this room».** The participant rows and
the presence reader already answer that, and a banner that asked the server its
own question would be a second source of a fact that has one.

**Not a way to be in two rooms at once.** Joining anywhere still leaves whatever
you were in — `joinVoiceChannel` already leaves the room it finds this client in
before joining the next. The move is that same rule seen from the other device.

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

**Slice G — moving a call to the device in your hand.** The banner that says
you are in this conversation on another device, and the press that brings it
here. §4b measures what is already true — no ownership binding, and one person
cannot be twice in a room — and what is missing, which is only that the phone
does not know. Naming *which* device is slice F's registry plus a `session_id`
on `voice_participants`, and is deliberately not in the first version.

**Slice F — «do not accept calls on this device», as a device registry.**
Decided on 2026-09-18. A row per authorised device, written at sign-in and
refreshed while the session lives; a list that names each one the way Telegram's
«Активные сеансы» does — what it is, where it last was, when — and a switch on
each that any of them can flip. The switch is read where the ring is decided,
so a device that refuses calls is simply not among those rung.

Ringing every device and stopping the rest is **not** in this slice — it falls
out of the ring itself and is built in slice A. What this slice adds is the
*choice*, and the reason it is a stage rather than a setting is the registry:
nothing in this product currently knows what a device is (§4a measures exactly
what does and does not exist), so the row, its identity across a token refresh,
and its retirement all have to be designed before a switch means anything.

## 6. Open questions, which are the owner's

1. **Does a missed call notify?** A system row pushes nothing by design. Telegram
   sends a missed-call notification. Making it do so is a deliberate addition,
   and it inherits the existing gates — `_notification_push_allowed` requires an
   explicit `push_enabled` row and honours per-chat mutes — so a person who muted
   a chat would not learn they were called. Correct for messages; a decision for
   calls.
2. ~~**How long does it ring before it is missed?**~~ **Answered on
   2026-09-18: 45 seconds**, Telegram's number. It is a ceiling as well as a
   duration — a ring that ends by itself is what makes «пропущенный» a fact
   somebody can write down — and it makes slice C mandatory rather than
   optional, because something has to decide the 45 seconds are up.
3. ~~**Is a call offered in every private chat, or only between people who are
   already in contact?**~~ **Answered on 2026-09-18: every private chat, minus
   the block list.** The gate is the one that already exists; no notion of «a
   contact» is invented for this. A private chat only exists because somebody
   already opened it, which is the product's own definition of being in touch.
4. ~~**Video, or audio only, in the first version?**~~ **Answered on
   2026-09-18: audio only.** The incoming-call surface stays a name, a
   photograph and two buttons, and video keeps its own slice — it is a
   different bandwidth question, a different permission prompt and a different
   thing to do on a weak connection. Nothing in the schema forecloses it: the
   token already permits video, so adding it later needs no migration.
5. ~~**Windows closed is a stage of its own.**~~ **Answered by the owner on
   2026-09-18:** a closed client should not ring, as Telegram's does not.
   Autostart — to the tray and normally — is the requirement instead, and it is
   slice D2. WNS delivery to a closed application stays unbuilt and unwanted.
6. ~~**Does the first version ship the per-device switch as A or wait for B?**~~
   **Answered on 2026-09-18: B, the device registry.** Shape A is local to the
   installation, and «turn off calls on the laptop» that can only be done *from
   the laptop* is not what was asked for — it is the lesser function wearing
   the name of the one asked for, which this project refuses on principle.
   Slice F is therefore the registry: a row per authorised device, registered
   at sign-in, listed with «Активные сеансы» beside it, each with its own
   switch, visible and changeable from any of them. It is a stage of its own
   and it does not block slices A–C.
7. **When a device refuses calls, does it still show the incoming call
   silently, or nothing at all?** Telegram shows nothing on a device you have
   turned off. Either is defensible; the record in the conversation is the same
   for every device regardless.
8. **Do the three Chromium flags go on?** `--disable-background-timer-throttling`,
   `--disable-renderer-backgrounding` and `--disable-backgrounding-occluded-windows`
   would keep a hidden window's clocks running, which the ring's expiry and the
   missed-call cut-off both need. They apply to every launch and cost battery
   whenever the window is hidden. Measure first — the section above says how —
   then decide.

## 7. What this proposal will not claim

It will not claim a ring on a backgrounded iPhone, because that is not possible
here and it was measured rather than assumed. It will not claim one on a closed
Windows application either — but for a different reason, and the difference
matters: that one is **correct behaviour** rather than a missing feature, and
the setting that makes the application run is the answer to it.

It will not route a ring through push, because the measured floor is up to
eighty seconds. And it will not reuse the group call's occupancy trigger for
«missed», because that mechanism announces calls that never happened.
