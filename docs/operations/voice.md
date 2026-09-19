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
| Container | `letscube-voice`, `livekit/livekit-server:v1.13.7`, capped at 2 cores / 1 GiB |
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

> **These four were measured against `v1.8.4` and the server now runs `v1.13.7`
> (2026-09-19).** They are recorded as what was true of the version that was
> deployed when they were taken, not as facts about the Twirp API in general —
> a method set, a 404 shape and a build's embedded strings are all things a
> release may change. Re-probe before relying on any of them; the negative
> control (`NoSuchMethodZZZ`) is what makes that cheap to repeat.

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

## The kill switch, the limit and the cap

Added 2026-09-18, slice 5. **Two new names in the functions runtime's `.env`,
both optional, both read on every request** — so changing either needs the
functions container restarted and does *not* need the function redeployed:

    VOICE_ENABLED=true                 # `false` is the kill switch
    VOICE_MAX_TOTAL_PARTICIPANTS=      # empty is no cap; a positive integer is one

`VOICE_ENABLED` follows `BOT_CREATION_ENABLED` exactly
(`docs/operations/bot-gateway.md:84-88`): absent, empty and `true` all leave
voice open, `false` closes it, and **anything else refuses the route with
`not_configured` rather than being read as «on»** — so `FALSE`, `0` and a
trailing space are all configuration errors, not switches.

**What `false` reaches, and what it does not.** It stops `/token`, so nobody can
start or re-join a call. It deliberately does not gate `/webhook` — refusing
those would strand `participant_left` and `room_finished` and leave every chat
list showing calls that had ended — and it does not gate `/force-mute` or
`/remove`, so a moderator keeps their levers while a call drains.

**It does not hang up a call already in progress.** LiveKit keeps a room alive
while anybody is in it, and a token already minted is good for ten minutes, so a
live call ends when its participants leave. If «off» ever has to mean «and end
what is running», that is `DeleteRoom` from the reconciler and a worker change,
not a wider switch.

`VOICE_MAX_TOTAL_PARTICIPANTS` is deliberately unset by default: **the number
cannot be derived from anything in this repository.** Section 1.6 of the
proposal says there is no `nproc`, no `free -h` and no traffic allowance
recorded for this host; the measured arithmetic is the egress table in section
2.3 — worst case 18.2 Mbps for one room of twenty, 117.6 Mbps for one of fifty
— and it is per-room and quadratic, so no participant total bounds it exactly.
Pick a number, set it, and watch the SFU. `0` is refused: turning voice off is
the switch's job.

The cap is **advisory at the gateway**. It refuses to mint past the number; it
cannot evict anybody already connected, and LiveKit has no server-wide
equivalent to the per-room `max_participants` that does the hard enforcing. It
counts `public.voice_participants` plus the mints of the last thirty seconds
that have not yet become a row in it, because the mirror lags a join by a
webhook round trip and counting it alone would let a rush all pass.

**The rate limit is now a table**, `private.voice_rate_limit_signals`, and one
RPC that counts the window and records the attempt in one transaction — twenty
actions per sixty seconds per caller per action, the token route and the two
moderation routes keeping separate allowances. The per-isolate `Map` stays in
front of it as a free pre-filter.

Both limits **fail open**: a missing function, an error or an unrecognised
answer allows the call and the deployment degrades to per-isolate limiting. They
are abuse controls, and `is_banned`, the membership row and the per-channel cap
all still fail closed, so a limiter failure cannot let an unauthorised person
in. That is also why the migration and the function can be deployed or rolled
back in either order.

**How to tell whether the deployment-wide limit is actually live**, since both
layers answer `rate_limited`: after a join,
`select count(*) from private.voice_rate_limit_signals where action = 'token_mint'`
is non-zero. And `select public.voice_active_participants(30)` answering a
number proves the cap has something to compare against. The gateway logs
nothing — that is a contract a unit test enforces — so asking is the only way.

Migration: `.migration-backup/supabase/migrations/20260918190000_voice_limits_bind_the_deployment.sql`,
applied as `supabase_admin`, with a rollback and a rehearsal beside it. The
sweep that trims the table is in the reconciler beside the webhook purge, so
`letscube-worker` carries it; if that is not deployed, rows accumulate at
twenty per caller per minute and nothing else breaks.

## Proved in production, 2026-09-14

**Read the correction under this list before trusting it.** Every one of the
seven ran against the real thing and every one passed, and the feature still
could not do the single thing it exists for.

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

### The correction, 2026-09-19: none of the seven was «somebody heard somebody»

Read the list again with that sentence in mind. One is `CreateRoom`. Two is a
WebSocket reaching the SFU. Three is four webhooks moving four columns. Four and
five are a token and its grant. Six is the SFU accepting that token. Seven is
the reconciler clearing a ghost. Every one is about **signalling, admission or
bookkeeping**, and the list is genuinely thorough about those — which is exactly
what made it convincing.

The owner reported on 2026-09-19 that two people in a channel hear nothing from
each other. The cause was that `hooks/voiceRoom.ts` has never attached a
subscribed remote track to anything that can play it: no `track.attach()`, no
`srcObject`, no `room.startAudio()` — measured across all six commits the file
has ever had, so there was never an attach to lose. livekit-client does not
attach for you; the SDK's own line is that it autoplays audio tracks *when you
attach them to audio elements*. The same absence is why per-person volume,
deafen and output-device selection had never done anything either: all three
operate on `attachedElements`, and there were none.

`tests/e2e/voice-call.spec.ts` could not have caught it, and says so honestly in
its own header: it replaces the transport with the DEV stand-in
`window.__letscubeVoiceRoom`, so it proves everything between the press and the
transport and nothing after it.

**The rule this earns:** a checklist for a feature must contain the sentence a
user would say. «Кто-то кого-то услышал» for a call, «письмо пришло» for mail,
«файл открылся» for an upload. A list that is complete about the plumbing and
silent about the purpose passes in full while the feature does not work at all,
and its very thoroughness is what stops anyone looking further.

## Upgraded to `v1.13.7`, 2026-09-19

`v1.8.4` was an eighteen-month-old release and the client is
`livekit-client ^2.22.3`. The gap was visible in the server's own log: the
client opens a publisher data channel labelled `_data_track` and the server
answered `unsupported datachannel added` once per session, 69 times in an hour,
because that feature postdates it. Measured alongside: ~8 new RTC sessions per
minute across two participants, median 15–16 seconds between one participant's
own successive sessions, every close `CLIENT_REQUEST_LEAVE` and every join a
fresh one with no resume attempted — while ICE reached connected over UDP on
127 of 127 attempts. Kong logged **7** token requests against **92** new
sessions, so the application was not re-joining: the client library was
restarting its own connection on a saved token.

Done on the owner's explicit instruction to move the server rather than pin the
client down.

**How it was done**, and the order matters:

1. **Rehearsed first.** `v1.13.7` was pulled and run in a throwaway container in
   its own network namespace, with the **real** `livekit.yaml` mounted read-only
   and a throwaway key whose *name* matches `webhook.api_key` — the first
   attempt used an unrelated key name and failed on `api_key is required to use
   webhooks`, which is a fact about the rehearsal, not about the version. It
   then started clean: same `portHttp 7880`, `rtc.portTCP 7881`,
   `rtc.portUDP 7882`, the explicit node IP read as before, no deprecation and
   no config error. The config needed **no** edit.
2. **Backed up and verified**: `docker-compose.yml` and `livekit.yaml` copied to
   `/srv/letscube/voice/.backup/*.20260919-171358` with a `sha256` file beside
   them, and both copies diffed against the originals before anything changed.
3. One line rewritten — the image tag — then `docker compose up -d`.
4. Healthy on `v1.13.7`, `nodeIP` unchanged, ports unchanged.

**Rollback** is the same shape: put `v1.8.4` back in the image line and
`docker compose up -d`. The old image is still in the local cache, so it needs
no network.

**One consequence to expect, and it is not a fault.** LiveKit single-node keeps
rooms in memory and `room.auto_create` is `false` here, so the restart emptied
every room and the clients still holding a session got
`404 requested room does not exist` on `/rtc/v1`. The system heals on the next
join: the gateway's join path calls `CreateRoom`, which is idempotent. The
reconciler is safe across this too — it takes the **union** of the channels the
database believes are live and the rooms the SFU reports, so an empty room list
never by itself deletes anything.

## TURN over TLS on 443, 2026-09-19

**Why.** A participant could not join a voice channel at all. Their sessions
lasted **15.2 s, 14.6 s, 15.0 s** — three within 0.6 s of each other, which is
livekit-client's `peerConnectionTimeout: 15000` and not a flaky link. They never
reached `participant active` and never published. Their network carried neither
`7882/udp` nor `7881/tcp`. 443 is the one port such a network reliably passes,
because blocking it breaks the web.

The `turn.enabled: false` comment that used to stand in `livekit.yaml` said the
no-UDP case «was measured connecting over ICE/TCP on 7881 instead». That
measurement was one network. This was another, and the comment is the shape of
mistake worth naming: a measurement recorded as a general fact.

### The shape

`turn.letscube.ru` → `157.22.206.43`. Traefik owns 443 already, so the relay has
**no public port of its own**: a TCP router matches the SNI, terminates TLS with
the same `letsencrypt` resolver every other host here uses, and hands plain TCP
to `letscube-voice:5349`, which runs `external_tls: true` and expects exactly
that. The router lives in the file provider at
`/data/coolify/proxy/dynamic/zz-letscube-turn.yaml`.

`relay_range` is **30000–30019**, not the default 30000–40000: Docker publishes a
port range as one userland proxy per port, and 43 already run on this host.

### The order, and the incident that fixed it in place

**The first attempt broke a working call.** TURN was switched on while the only
certificate for `turn.letscube.ru` was Traefik's self-signed default — the DNS
record was minutes old and ACME had failed on `NXDOMAIN`. The server then began
advertising a relay address whose TLS a client could not complete. The owner's
own session, which had held **8 m 43 s** unbroken an hour earlier, started
failing at exactly 15 s with no candidate pair selected — the same signature as
the participant this was meant to help. Reverted in four minutes; `livekit.yaml`
and `docker-compose.yml` restored from `.backup/*.20260919-192215` and verified
byte-identical by `sha256sum -c`.

Two mistakes, and the second is the one worth carrying:

1. The certificate was not in place before the thing that depends on it.
2. **The check was that the server starts.** It did start, cleanly, logging its
   TURN line. A server that starts and a call that connects are different
   claims, and `docs/operations/voice.md` had recorded that very lesson earlier
   the same day — a checklist must contain the sentence a user would say.

So the order is now two separate steps, and they must stay separate:

1. **Obtain the certificate with a plain HTTP router that touches nothing
   else**, and verify it **from outside the host**:
   `openssl s_client -connect turn.letscube.ru:443 -servername turn.letscube.ru`
   must show a real issuer, not `CN=TRAEFIK DEFAULT CERT`.
2. **Only then** swap in the TCP router and set `turn.enabled: true`.

If ACME has already failed for the name, Traefik backs off and touching the file
does not retry. **Renaming the router** makes Traefik treat it as new and try
again immediately — cheaper than restarting the proxy, which would interrupt
every other host on 443.

### The check that counts

Not "the server started". `scripts/` has no home for this, so it lives here:
open TLS to `turn.letscube.ru:443` exactly as a browser would and send a STUN
Binding request; a TURN server answers one, a proxy with nothing behind it does
not. Run from a workstation, outside the host, on 2026-09-19:

```
tls        : authorised
subject    : turn.letscube.ru
issuer     : Let's Encrypt
stun reply : type 0x0101, 40 bytes
cookie     : correct
txn id     : matches the request
```

A `0x0101` with the magic cookie intact and the transaction id echoed back is a
Binding Success Response. That is the relay answering over the path a blocked
client would use.

**And one more check before anybody is told it works:** a real join must still
show `[selected:1]` in the server's `publisherCandidates`. TURN is supposed to
*add* a path, never take one away, and the first attempt failed exactly there.

### Rollback

Restore `livekit.yaml` and `docker-compose.yml` from `/srv/letscube/voice/.backup/`
— each apply writes a timestamped pair plus a `sha256` file — then
`docker compose up -d`, and move
`/data/coolify/proxy/dynamic/zz-letscube-turn.yaml` aside. Nothing else on 443
is affected either way: the router matches one SNI and no other.

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
