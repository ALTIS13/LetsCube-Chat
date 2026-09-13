# Voice channels in production

The SFU, how it is published, what talks to what, and the two things that are
not done yet. Slice 1's throwaway probe is gone; this replaces it.
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

`rtc.node_ip` is pinned to `157.22.206.43` and `use_external_ip` is off. With
two docker networks attached, LiveKit's STUN probe cancelled itself and fell
back to the node IP — right here, but a fallback that happens to be right is not
a configuration.

## Turning it on for a group

A voice channel is a row. There is no interface that creates one yet, which is
the feature's only switch:

```sql
insert into public.voice_channels (chat_id, name, created_by, max_participants)
values ('<a group chat id>', 'Общий голос', '<a member id>', 10);
```

Delete the row and the capsule and the panel section disappear again. The room
on the SFU is created by the gateway on the first token request and closes 60
seconds after the last person leaves.

One consequence worth knowing: **asking for a token creates the room**, so
`voice_channels.active_since` is set for a minute after anyone presses join even
if they never connect. Nothing in the interface reads that column — occupancy
comes from `participant_count` — so it shows nobody a call that is not
happening; it only costs the reconciler one extra question per tick.

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

A voice channel exists on one group whose only member is a test account, left in
place as the staging state. No real user's group has one.

## Not done

**The reconciler is not running.** `letscube-worker` has no `LIVEKIT_URL`,
`LIVEKIT_API_URL`, `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET`, and the worker
logs that and sleeps rather than half-running — without a single confirmation
from the SFU its reaper would delete every participant row five minutes after
start-up, which is the failure it exists to prevent, reached by a different
door. Those four names have to be added to that application in Coolify, whose
environment this project's operators own and whose values are not readable from
here; the key and secret are in `/srv/letscube/voice/livekit.env` on the host.

Until then the webhook is the only thing that writes participants, so a webhook
that is lost — the runtime restarting mid-delivery, say — leaves a stale row
that nothing cleans up.

**There is no interface for making a channel.** Deliberate for this slice.

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
