# Voice channels in production

The SFU, how it is published, what talks to what, and what is deliberately not
built yet. Slice 1's throwaway probe is gone; this replaces it.
`docs/operations/voice-probe.md` stays as the record of what was measured before
any of this was built, including the webhook table that the gateway is written
against.

## The shape of it

```
browser ──wss──▶ api.letscube.ru/voice/rtc ──Traefik──▶ letscube-voice:7880
browser ──udp/tcp──▶ 157.22.206.43:7882 / :7881          (media, no proxy)
                                     │
voice-gateway (Edge Function) ──http──┘  letscube-voice:7880/twirp/…
                                     ▲
letscube-voice ──http──▶ supabase-edge-functions:9000/voice-gateway/webhook
```

**The SFU has no hostname of its own, and needs none.** Signalling is a path on
`api.letscube.ru`, which already has a certificate and already carries two
services on different path prefixes — the release catalogue at `/` and the bot
gateway at `/bot/v1`. Voice is the third, at `/voice/rtc`, with a Traefik
`stripprefix` in front of it and `priority: 210` so it wins over the catalogue's
`PathPrefix('/')`.

**Only `/voice/rtc*` is routed.** The twirp administrative API — which can list,
create and delete any room and remove any participant — is not published at all.
The gateway and the reconciler reach it at `http://letscube-voice:7880` over the
`supabase_default` docker network, which is the whole reason the container joins
two networks.

**Media is not proxied.** ICE needs the real ports: `7882/udp` is the mux and
`7881/tcp` is the path a client on a network with no UDP takes. Slice 1 measured
that second path carrying a real conversation over the open internet, without
TURN and without a certificate, which is why there is no TURN server here.

## Where things live

| | |
| --- | --- |
| Compose project | `/srv/letscube/voice/` on `ms.letscube.ru` (not a Coolify application) |
| Container | `letscube-voice`, `livekit/livekit-server:v1.8.4`, capped at 2 cores / 1 GiB |
| Key pair | `/srv/letscube/voice/livekit.env`, mode 600, generated on the host |
| Config | `/srv/letscube/voice/livekit.yaml` |
| Gateway | `supabase/functions/voice-gateway/`, deployed to `…/volumes/functions/voice-gateway` |
| Reconciler | `artifacts/api-server/src/workers/voiceReconciler.ts`, inside `letscube-worker` |

Start, stop and read it:

```bash
ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru 'cd /srv/letscube/voice && docker compose up -d'
ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru 'docker logs --since 10m letscube-voice | grep webhook'
```

The SFU's own log is the best account of what happened in a call: it prints one
line per webhook it sends, naming the event, the room and the participant.

## The two URLs, which are not the same URL

`LIVEKIT_URL` is what a **browser** dials — `wss://api.letscube.ru/voice` — and
it is what the gateway returns to the client. `LIVEKIT_API_URL` is where a
**server process** reaches the twirp API — `http://letscube-voice:7880`.

Deriving the second from the first is wrong in this arrangement, and was the
first draft's bug: `new URL(…).origin` drops the path, so a twirp call built
from the public URL lands on the release catalogue and answers 404, which reads
exactly like an SFU that is down. Both `livekitHttpOrigin` in the gateway and
`httpBase` in the reconciler now keep the path, and both prefer
`LIVEKIT_API_URL` when it is set. A deployment where the SFU owns a hostname can
set only `LIVEKIT_URL` and nothing changes.

## What is configured where

The functions runtime (`/srv/letscube/platform/supabase-docker/.env`, and four
names added to the `functions` service in its `docker-compose.yml`):

    LIVEKIT_URL=wss://api.letscube.ru/voice
    LIVEKIT_API_URL=http://letscube-voice:7880
    LIVEKIT_API_KEY=<the key id from /srv/letscube/voice/livekit.env>
    LIVEKIT_API_SECRET=<its secret>

The SFU's `webhook.api_key` names that same key, and `webhook.urls` is
`http://supabase-edge-functions:9000/voice-gateway/webhook` — the runtime
directly, not through Kong, because LiveKit sends no `apikey` header and Kong
would refuse the call before it arrived. `FUNCTIONS_VERIFY_JWT` is `false` on
this deployment, so the function does its own verification, which is what the
webhook route needs.

Two kernel parameters were raised in `/etc/sysctl.d/99-livekit.conf`:
`net.core.rmem_max` and `net.core.wmem_max` to 5000000. LiveKit asks for a 5 MB
receive buffer, the kernel silently capped it at 212992, and the server said so
in a WARN on every start. These raise only the ceiling a socket may ask for.

The worker (`letscube-worker`) gets the same four names from
`/srv/letscube/secrets/letscube-infra.env`, the file its entrypoint sources —
**not** from Coolify's environment UI, which holds nothing for this application.
`LIVEKIT_API_URL` is `http://letscube-voice:7880`: both containers are on the
`coolify` network, so the worker reaches the SFU by container name and the twirp
API stays off the internet. A restart of the worker container is enough to pick
up a change to that file; no redeploy is needed.

One thing was fixed in that file while adding them: it is sourced by `sh`, and a
value containing a space with no quotes runs its second word as a command. The
worker had been printing `/run/secrets/letscube-infra.env: Support: not found`
on every start, and the variable that line came from had been truncated to its
first word ever since. Every unquoted value carrying a space is now quoted.

`rtc.node_ip` is pinned to `157.22.206.43` and `use_external_ip` is off. With
two docker networks attached, LiveKit's STUN probe cancelled itself and fell
back to the node IP — right here, but a fallback that happens to be right is not
a configuration.

## Rooms, and who makes them

**A group has rooms, not a voice chat.** That changed on 2026-09-14, and the
change was almost entirely in the interface: `voice_channels` has carried
`chat_id`, `name`, `position`, `max_participants`, `speak_role` and `archived`
since this feature shipped, with «admins manage voice channels» =
`is_chat_admin(chat_id)` FOR ALL as both USING and WITH CHECK. An administrator
could always have had as many rooms as they liked. What the client did was read
`.limit(1)` and offer one control that made one room.

Rooms are made, renamed, reordered and removed in **«Каналы»** on the group's
settings screen, which draws nothing at all for anybody who is not an owner or
an administrator of that group. The same dialog holds the headings that group
them (`public.chat_channel_categories`, added the same day) and each room's two
settings:

- **how many seats** — `max_participants`, which the SFU enforces. The gateway
  compares the row's `participant_count` against it before it mints a token, so
  a full room refuses at the token rather than at the SDK;
- **who may speak** — `speak_role`, and it is not decorative. The gateway
  computes `canPublish` from the member's role against it and mints the token
  with that claim, so somebody below the bar joins, hears everything and cannot
  be heard. That is a real state and the interface says so in those words
  («Остальные смогут зайти и слушать»), not as «нельзя войти».

**Removing a room sets `archived = true`; it is not a DELETE.** Messages and the
row survive, which is what lets the question promise that nothing is lost.
Whoever is inside is disconnected by `voiceCallLostItsChannel` on the next read
of the chat's rooms — the SFU's own room closes 60 seconds after the last person
leaves, and no client call closes it sooner.

**Where a room is joined:** the channel rail, which lists every room with the
people inside it, live. On a pane too narrow for a column it is a sheet behind a
capsule under the header. The group card still names one room and offers the way
in, but **only while the group has exactly one** — naming whichever came first
beside a rail listing three is not a fact about the group.

The equivalent by hand, for a deployment being set up before anybody is an
administrator of anything:

```sql
insert into public.voice_channels (chat_id, name, created_by, max_participants)
values ('<a group chat id>', 'Общий голос', '<a member id>', 10);
```

`participant_count` and `active_since` are deliberately not written by any
client: they belong to the SFU's webhooks, and the column grant does not include
them.

One consequence worth knowing: **asking for a token creates the room**, so
`voice_channels.active_since` is set for a minute after anyone presses join even
if they never connect. Nothing in the interface reads that column — occupancy
comes from `participant_count` — so it shows nobody a call that is not
happening; it only costs the reconciler one extra question per tick. The
reconciler sweeps at most 64 channels that have somebody in them per tick
(`VOICE_RECONCILER_CHANNEL_LIMIT`), which is a bound on *occupied* rooms rather
than on how many a group may have.

## Silencing and disconnecting somebody who is already inside

Added 2026-09-18. **The gateway is four routes, not two.** It was `/token` and
`/webhook`; it is now also:

- `POST /functions/v1/voice-gateway/force-mute` — `{channelId, userId, muted}`
- `POST /functions/v1/voice-gateway/remove` — `{channelId, userId}`

Both take the caller's Supabase JWT, verified the way `/token` verifies it, plus
the publishable key in `apikey` because Kong wants it on every function call
here. Owner and administrator of the chat only; nobody may act on themselves,
and nobody at all may act on the owner — one step stricter than
`enforce_chat_member_update`, which lets an owner change a co-owner's role.

**Four things about this are measurements, and each one cost a round trip.**

**`MuteRoomTrack` does not exist.** It is the name of the *request message* for
`MutePublishedTrack`, not a method. Probed against the deployed v1.8.4 with a
negative control (`NoSuchMethodZZZ`): `MuteRoomTrack` answers 404 `bad_route`
byte for byte like the fake, while `UpdateParticipant`, `RemoveParticipant`,
`MutePublishedTrack` and eight others answer 401.

**`UpdateParticipant` is used rather than `MutePublishedTrack`, because of the
configuration.** `room.enable_remote_unmute` is absent from `livekit.yaml` and
therefore false, and the binary carries the string «cannot unmute track, remote
unmute is disabled». Muting that way would work and could never be undone.

**The SFU discards request fields it does not recognise**, so a misspelled name
is a 200 that changes nothing. Measured: `permissionZZZ` and `permission`
produce identical answers. Every name is proved positively instead — send a
string where a bool is expected and a known field answers 400 while an unknown
one is dropped and the request goes through. The permission is written whole for
the same reason: omitting `canSubscribe` would set it to proto3's default of
false and turn a force-mute into a force-deafen.

**`is_chat_admin(cid)` cannot be used here.** It takes no user — it reads
`auth.uid()` internally, which is null on a service-role connection — so from
this gateway the predicate reduces to `user_id = null` and refuses everybody.
Safe and useless. The gateway establishes the caller the way `/token` does:
verify the JWT, then read the membership row for that `sub` with the service
role.

**Nothing is written to `public.mutes`, and each of three reasons is enough.**
That table is the staff penalty matrix. A voice silence there would (1) also
stop the person writing, because `messages` carries a restrictive
`not is_muted(...)` policy; (2) bypass the penalty ranking, which returns early
when `auth.uid()` is null — exactly the service-role case — so an administrator
of a chat who is not staff would be writing an unranked penalty; and (3) put a
row in the staff panel beside real bans. So the action is deliberately live, and
the price is stated: a reconnect mints a fresh token, so a force-mute is lifted
by leaving and rejoining. Discord's «server mute» behaves the same way.

**Where it is used:** a press on somebody in the channel rail, for an owner or
an administrator. The menu offers only what the rules allow, so the owner of a
group is never offered a control that would be refused. Whether the lift is
offered depends on whether the SFU reports a permission at all: inside the room
this client is connected to it does, and only the direction that changes
something is drawn; for any other room the table answers, which carries presence
and nothing else, and both directions are offered because both are idempotent.

**A lift is not a grant.** `muted: false` makes the gateway recompute what a
fresh token would give that person — their role against the channel's
`speak_role`, and any staff mute from `public.mutes` — and answers with
`canPublish`. Somebody below the speaking bar stays unable to publish, and the
interface says so rather than claiming they can speak.

**Not verified, and it needs a live SFU with two people in a room:** whether
`canPublish: false` stops a microphone that is **already** publishing or only
forbids publishing afresh. If it is the second, the continuation is
`MutePublishedTrack(muted: true)` per track — which this build can do in the
silencing direction and, per the configuration above, cannot undo.

## Proved in production, 2026-09-14

Each of these was run against the real thing rather than a stub:

1. `CreateRoom` over the internal network → 200.
2. A client connected over `wss://api.letscube.ru/voice` and LiveKit logged
   `connected to room` — so Traefik, the strip, TLS and the WebSocket upgrade
   all work for a path-routed SFU.
3. The webhooks landed and the database followed: `room_started` set
   `active_since`, `participant_joined` took `participant_count` to 1,
   `participant_left` took it back to 0 and removed the row, `room_finished`
   cleared `active_since` — every one verified against the production key by the
   gateway.
4. A real Supabase session for a test account called
   `POST /functions/v1/voice-gateway/token` → 200, with `url`, `room`, `token`,
   `identity`, `canPublish`, `maxParticipants`, `expiresAt`.
5. That token's grant was exactly `roomJoin: true`, `roomAdmin: false`,
   `roomCreate: false`, `canPublishData: false`, scoped to the derived room.
6. The SFU accepted it: `GET /voice/rtc/validate?access_token=…` → 200
   `success`.
7. **The reconciler clears a ghost.** A `voice_participants` row was written for
   a channel the SFU had no room for — exactly what a lost `participant_left`
   leaves behind — and the next pass removed it, 30 seconds later, logging
   `reconciled: 1, unknown: 0, reaped: 0`. The repair layer is not a theory.

A voice channel exists on one group whose only member is a test account, left in
place as the staging state. No real user's group has one.

## Not done

**Nothing outside the conversation watches the rooms.** Removing a room
disconnects everyone who is looking at that group, because that chat's own view
sees the row go; a person reading another chat keeps the call until they come
back to it. The bar that would follow them is slice 3.

**No per-channel notification settings, and no per-channel unread.** A server's
channel list marks the channels with something new in them, and mutes them one
at a time; `chat_members.last_read_at` is per chat, so neither is possible yet.
D-167 is the register entry for the mute half.

**No TURN.** The case it would serve was measured working over ICE/TCP instead.
If a network ever turns up that blocks 7881 as well, TURN/TLS needs a hostname
and a certificate, and that is when voice gets a subdomain of its own.

## Rotating the key

The key pair is in one file and named in two places. Generate a new pair into
`/srv/letscube/voice/livekit.env`, set the same key id in `livekit.yaml`'s
`webhook.api_key`, set both values in the functions `.env`, then restart
`letscube-voice` and `supabase-edge-functions`. Tokens already minted stay valid
until they expire, which is ten minutes.

## Removing it

```bash
cd /srv/letscube/voice && docker compose down
# and, so nothing in the interface offers a call that cannot connect:
# delete from public.voice_channels;
```
