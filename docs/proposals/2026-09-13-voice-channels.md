# Voice channels — a design to build from

Written 2026-09-13 against `integration/message-actions` at `14854cc`. **Nothing
here has been applied.** No database was touched, no server was contacted over
SSH, no container was started. Every claim about this repository carries a
`file:line`; every claim about the production host is either quoted from a
measurement already recorded in the repo, or listed in section 6 as something
that must be measured before it can be believed.

The owner's direction, recorded the same day
(`docs/PRODUCTION_PRIORITY_TRACKER.md:495-498`): «мы и так планировали делать
это скорее как каналы в дискорде с войсами и т.п, чем просто группами как
изначально в телеге». So: **persistent voice rooms inside a group that people
join and leave, with a visible participant list** — Discord's shape. Telegram's
group call is the second reference, and it contributes two things Discord does
not have: the bar pinned under the chat header, and the system message in the
conversation when a call starts.

The other standing rule this is written under, from the same day
(`docs/PRODUCTION_PRIORITY_TRACKER.md:481-488`): «нам незачем всё писать с нуля
если уже придумано хорошее решение» — with «хорошая» load-bearing, and a
dependency judged on what it costs to audit, how much of it is used, whether it
can be replaced, and whether it drags a runtime in behind it.

**A caveat about the line numbers.** Everything below was read at `14854cc` plus
the working tree as it stood on 2026-09-13. While this was being written another
agent's uncommitted work rewrote `ChatInfoPanel.tsx` (320 lines changed) and
added `ChatSettingsView.tsx` and `lib/chatSettings.ts`. The citations into that
file were re-read afterwards and are current as of that tree; citations into it
may drift again before this is implemented. Every other file cited here was
untouched. Re-read before relying on a line, never the other way round.

---

## 0. The answer, in four lines

- **Transport:** a self-hosted **LiveKit** SFU, one container, on the existing
  host. Section 2.
- **Ceiling:** **10** per voice channel for the first three slices, a schema
  `CHECK` that refuses more than 20, and no claim above 20 until section 6's
  load test has been run. Section 2.5.
- **First slice:** deploy the SFU and prove two browsers — one of them behind
  the VLESS/REALITY tunnel this product's users actually use — can hear each
  other. No product code, no migration, no new client dependency. Section 5.
- **Biggest risk:** UDP. The repository already records that HTTP/3 was
  *disabled at the proxy* because a share of this product's users reach it over
  a TCP-only tunnel whose iOS clients drop UDP 443
  (`docs/PRODUCTION_PRIORITY_TRACKER.md:792-801`). WebRTC is the first thing
  this product has ever built that wants UDP. Section 2.2.

---

## 1. Ground truth

### 1.1 Voice does not exist, and the store listing already promises it

Searched rather than assumed. Across the client, the API server, the migrations
and the Android project there is no `RTCPeerConnection`, no `webrtc`, no
`livekit`, no `jitsi`, no `mediasoup`, no signalling of any kind. The only two
hits in the whole tree are prose in the tracker
(`docs/PRODUCTION_PRIORITY_TRACKER.md:506` and `:800`), and the first of them is
this same finding recorded on 2026-09-13.

`getUserMedia` appears in five files and every one of them **records** rather
than calls a peer:

| file:line | what it captures |
| --- | --- |
| `artifacts/kub/src/hooks/useVoiceRecorder.ts:163,170` | voice messages |
| `artifacts/kub/src/components/chat/VideoMessageRecorderModal.tsx:157,164,368,371,398,401` | video circles |
| `artifacts/kub/src/components/chat/CameraCaptureModal.tsx:56,62` | camera |
| `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx:215,579,589,600,606` | the microphone test |
| `artifacts/kub/src/lib/platform/capabilities.ts:74,79` | a capability probe |

One thing to fix early, because it is a claim already in front of users:
`docs/native/ANDROID_STORE_LISTING.md:6-9` describes LETSCUBE as a messenger for
«conversations, media sharing, voice messages, **calls**, and shared tasks». The
listing promises a feature that does not exist. Slice 7.

### 1.2 Realtime, as it is actually used

The client is constructed with **no realtime configuration at all** —
`artifacts/kub/src/lib/supabase/client.ts:54-67` passes only an `auth` block, so
Realtime runs on supabase-js defaults. The auth token is bridged into the
realtime socket in two places: `client.ts:70-77` and
`artifacts/kub/src/hooks/useUser.ts:157,175,198`.

**Presence is not used anywhere.** No `.track(`, no `presenceState`, no
`on("presence")` in `artifacts/kub`. What the product calls presence is its own
thing: a `profiles.online_at` column written by a 60-second REST heartbeat
(`artifacts/kub/src/hooks/useHeartbeat.ts:9,69-72`) and read against a 90-second
threshold (`artifacts/kub/src/lib/presence.ts:1,12-30`).

**Broadcast is used exactly once**, for typing —
`artifacts/kub/src/hooks/useMessages.ts:676-710`, topic
`messages:chat:{chatId}:typing`, `{ config: { broadcast: { ack: false } } }`.

Everything else is `postgres_changes`, and there is one rule that governs all of
it. `artifacts/kub/src/lib/realtimeTableChannels.ts:1-38` records a production
measurement from 2026-09-05: **a channel with a binding to a table that is not in
the `supabase_realtime` publication stops delivering everything on that channel,
while still reporting `SUBSCRIBED`.** Hence one channel per table, and hence
`tableChannelName` at `realtimeTableChannels.ts:84-86`:

```ts
export function tableChannelName(baseName: string, table: string): string {
  return `${baseName}:${table}`;
}
```

Topic naming convention, from ~25 call sites: `{domain}:{scopeKind}:{id}`
(`chats:user:{userId}`, `messages:chat:{chatId}`, `reactions:chat:{chatId}`) or
the shorthand `{domain}:{id}` (`topics:{chatId}`, `notifications:{userId}`),
separator always `:`, segments lower-case and hyphenated, and when
`subscribeByTable` is used the table name is always the last segment.

Reconnection is not hand-written anywhere. `SUBSCRIBED` arriving a second time
is treated as the reconnect signal and triggers a refetch
(`artifacts/kub/src/lib/resumeRevalidation.ts:19-22`,
`useMessages.ts:824-832`, `useChats.ts:343-345`). Only one site handles
`CHANNEL_ERROR` / `TIMED_OUT` at all: `useMessages.ts:833-838`.

### 1.3 Chats, membership, roles

`public.chats` — `.migration-backup/supabase/schema.sql:51-60`. `type` is plain
`text` with a CHECK of `('private','group','channel')`, not an enum; code casts
`chat.type::text` defensively
(`.migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql:164`).
Only two columns were ever added: `is_forum`
(`20260427_topics.sql:28-29`) and `invite_policy`
(`20260512_group_invite_reinvite_and_policy.sql:20-21`).

`public.chat_members` — `.migration-backup/supabase/schema.sql:70-77`, primary
key `(chat_id, user_id)`, `role` promoted to the enum
`public.chat_member_role ('owner','admin','member')` by
`20260504_chats_membership_hardening.sql:34-37,193-208`.

Four RLS helpers exist and **take one argument**, reading `auth.uid()`
internally — `20260504_chats_membership_hardening.sql:216-280`:
`is_chat_member(cid)`, `is_chat_admin(cid)`, `is_chat_owner(cid)`,
`chat_role_of(cid)`. The header at `:17-24` explains why: the old `(cid, uid)`
shape let a caller probe someone else's membership. The sanction helpers are the
other shape — `is_banned(uid default auth.uid())`, `is_muted(uid, cid default
null)` — `20260504_roles_admin.sql:76-104`. Mixing the two is the mistake that
migration was written to fix.

The dynamic permission system is `20260514_dynamic_roles_permissions.sql` (39
live permission keys, `has_permission(uuid,text)` at `:330-363`). Note
`20260904060000_roles_retire_dead_tiers_and_club_naming.sql:31-33`: chat-scope
roles in that system are **never evaluated** — «Chat access comes from
`chat_members.role`». So a voice channel's permissions come from
`chat_members.role`, not from `roles`.

The closest existing thing to a Discord channel is `public.topics`
(`20260427_topics.sql`): `id, chat_id, name, emoji, is_general, position,
archived, created_by, created_at, updated_at`, with `members read topics` and
`admins manage topics` policies and a realtime publication add at `:71-80`. The
voice-channel table below is deliberately that table's shape, so this codebase
has one pattern for "a named sub-thing inside a chat" rather than two.

Restrictive "block banned" policies are applied table-by-table in a loop over a
fixed array (`20260504_roles_admin.sql:411-464`). **The loop will not pick up a
new table.** Any new chat-domain table owes itself those four policies by hand,
copied by name — the convention is stated at
`20260504_chats_membership_hardening.sql:360-364`.

### 1.4 The audio stack that already exists

More of this is built than it first appears, and all of it is directly reusable:

- `artifacts/kub/src/hooks/useAudioSettings.ts:172-186` —
  `buildAudioTrackConstraints(settings)` already returns exactly the
  `MediaTrackConstraints` a call wants: `echoCancellation`, `noiseSuppression`,
  `autoGainControl`, `channelCount: 1`, an exact `deviceId` when one is chosen,
  `sampleRate: { ideal: 48000 }`.
- `useAudioSettings.ts:5-32` — a persisted `AudioSettings` shape with a
  clean/raw/custom processing mode, mic gain, playback volume, monitor gain and
  chosen input/output device ids, stored under `kub:audio-settings:v1`.
- `artifacts/kub/src/lib/audioOutput.ts:14-20` — output device selection via
  `setSinkId`.
- `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx:58-91` — device
  enumeration with a re-pick when a chosen device vanishes; `:171-230` — a live
  microphone monitor.
- `artifacts/kub/src/hooks/useVoiceRecorder.ts:142-205` — the acquisition
  sequence worth copying line for line: a session token so a teardown during the
  `await` releases the tracks, an `OverconstrainedError` retry that drops back
  to the default device, and `classifyMicError` (`:44-57`) mapping
  `NotAllowedError` / `PermissionDeniedError` / `SecurityError` to
  `permission_denied`.

A voice call needs none of this written again. It needs the stream handed to a
peer connection instead of to a `MediaRecorder`.

### 1.5 The three shells

| | Microphone | Playback | Background |
| --- | --- | --- | --- |
| **Windows / Tauri 2.11.5** | Works per QA (`docs/native/WINDOWS_PACKAGING_PLAN.md:181`), but **no `PermissionRequested` handler exists in the Rust** — searched `windows-tauri/src-tauri/` for `PermissionRequested`, `ICoreWebView2`, `webview2_com`: no matches. The allow/deny matrix is unchecked (`:182`). | Web audio only | **Yes.** `prevent_close` + hide (`windows-tauri/src-tauri/src/lib.rs:1871-1878`), tray (`:1022-1053`), WinRT toasts (`:884-947`) |
| **Android / Capacitor 8** | `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` declared (`android/app/src/main/AndroidManifest.xml:49-50`); granted by Capacitor's own `BridgeWebChromeClient.onPermissionRequest`, which is why those two appear as a pair | Web audio only | **No.** Zero `<service>` in the source manifest, zero `foregroundServiceType`, zero `FOREGROUND_SERVICE*`. `targetSdk = 36` (`android/variables.gradle:2-4`) |
| **iOS / PWA** | `getUserMedia` only; no `ios/` directory exists — iOS is PWA-only (`docs/native/NATIVE_QA_CHECKLIST.md:4`) | Web audio only | **No.** `artifacts/kub/public/sw.js` registers `install`, `activate`, `message`, `pushsubscriptionchange`, `fetch`, `push`, `notificationclick` — no `sync`, no `periodicsync`, and `showPushNotification` (`:228-245`) sets no `actions`, so an incoming-call notification would have no answer or decline button |

Three consequences that shape the product and not just the build:

- **The Tauri window refuses to open new windows** — `lib.rs:1345-1352` returns
  `NewWindowResponse::Deny`. A pop-out call window is not available; the call
  lives in the main window.
- **Android is locked to portrait** — `AndroidManifest.xml:14`
  `android:screenOrientation="portrait"`. A landscape call grid is not a
  possibility there.
- **On iOS the page is suspended when it goes to the background or the screen
  locks**, and the microphone mutes. This is WebKit behaviour, not something a
  manifest flag changes. An installed-PWA voice channel therefore works
  foreground-only, screen on. Discord's own web client has the same limit. The
  right response is to say so in the interface (slice 6), not to pretend.

No `Content-Security-Policy` and no `Permissions-Policy` is served anywhere —
searched `docs/deploy/nginx.conf` and the whole tree. The Tauri CSP
(`windows-tauri/src-tauri/tauri.conf.json:32`) applies only to the bundled
startup screen; the app then navigates to `https://app.letscube.ru/`
(`lib.rs:1291`), which ships no CSP. So no header change is needed to reach a new
WebSocket origin — and equally, there is no CSP to lean on.

### 1.6 The server

**The repository records no CPU count and no RAM measurement for the production
host.** The "8 CPU cores, 12 GB RAM, 120 GB storage" in
`docs/infra/NODE_REQUIREMENTS.md:3` and
`docs/infra/SELF_HOSTING_OVERVIEW.md:5-7` are planning *targets* in documents
that still use placeholder domains; they were never a `nproc` or `free -h`
reading. There is no `nproc`, `lscpu`, `free`, swap figure, load average, link
speed or traffic allowance anywhere in the tree. The hosting provider is never
named for `ms.letscube.ru`.

What *is* measured:

- **53 containers up, 0 unhealthy** on 2026-09-05
  (`docs/operations/disk-maintenance.md:19,69`). That is the only container
  count on record.
- Disk, repeatedly, and it is the one dimension under pressure: 86% on
  2026-09-05 (`docs/operations/disk-maintenance.md:3`), 77% of 119 GB on
  2026-09-11 (`docs/QA_RESULTS.md:1365-1366`), 79% then 73% after a prune on
  2026-09-12 (`docs/QA_RESULTS.md:1237-1239`). Backups are 39 GB of that and
  must not be touched.
- What shares the box: 6 Coolify containers, 12 self-hosted Supabase
  containers, the whole of Mailcow, the five LETSCUBE applications, and 12
  leftover bot-rehearsal containers
  (`docs/infra/BACKUP_RESTORE_STATUS_20260622.md:87-107`,
  `docs/QA_RESULTS.md:5261-5262`). That inventory is from June and already
  predates three of the five applications.

**No container anywhere in this repository has a CPU or memory limit.** Searched
every compose file for `deploy:`, `resources:`, `limits:`, `mem_limit`, `cpus:`:
nothing. Every service currently competes freely with `supabase-db` for the
host. An SFU is the first service this product would run whose CPU is
proportional to what users do minute by minute, so it is the first one that must
have a limit — see section 2.4.

### 1.7 Deployment

Coolify 4.1 behind Traefik 3.6, webhook-driven; GitHub Actions deliberately
removed (`CLAUDE.md:616-617`). Five applications today:

| application | uuid | auto-deploy |
| --- | --- | --- |
| `letscube-web` | `l64kyyu1sysev2izzjjbizhe` | on |
| `letscube-worker` | `fkd10qwlo4qod9e6gtyzzuwk` | on |
| `letscube-bot-gateway` | `twezs89u2m6d6ln6c0rpaqxe` | **off** — pinned during the canary |
| `letscube-releases` | `fsk7qm5e4nm9kap9hv8chtts` | not recorded |
| `letscube-support-mail` | uuid not recorded anywhere | on |

`docs/operations/bot-gateway.md` is the pattern a new service copies: a target
in `docs/deploy/Dockerfile` (`:138-155`) that copies only the built entry point,
runs as `node`, `read_only: true`, `tmpfs /tmp:size=64m`, `cap_drop: ALL`,
`no-new-privileges`, `init: true`, an internal-only healthcheck on
`127.0.0.1:8098/healthz`, `expose` rather than `ports`, and exactly two narrow
Traefik path-prefix routers on `api.letscube.ru`
(`docs/deploy/docker-compose.coolify.yml:113-118`). That document also lists what
must *not* be added — an `/assets/*` router, a catch-all `PathPrefix("/")`, a
strip-prefix middleware, a public health router
(`docs/operations/bot-gateway.md:168-177`).

`artifacts/api-server` is both an Express 5 HTTP server on port 8096 and the
host for three in-process workers started inside the `listen` callback
(`artifacts/api-server/src/index.ts:32-36`): the push dispatcher, the
registration cleanup worker and the media variants worker. A fourth worker is
the natural home for the voice reconciler.

Six Supabase Edge Functions already exist (`supabase/functions/`), including
`phone-verification-gateway` and `support-gateway` — the pattern for "a small
publicly reachable endpoint that verifies the caller's Supabase JWT and then
does something privileged".

---

## 2. The transport

### 2.1 The arithmetic, first

Opus voice, mono, 48 kHz, DTX on: 24–40 kbps of audio plus roughly 16 kbps of
RTP/UDP/IP overhead at 50 packets per second. **48 kbps per stream on the wire**
is the planning number below. A silent participant with DTX drops to ~2 kbps.

| | mesh (peer-to-peer) | SFU (forwarding) | MCU (mixing) |
| --- | --- | --- | --- |
| client uplink | (N−1) × 48 kbps | 48 kbps | 48 kbps |
| client downlink | (N−1) × 48 kbps | (N−1) × 48 kbps | 48 kbps |
| server ingress | 0 | N × 48 kbps | N × 48 kbps |
| server egress | 0 | N × (N−1) × 48 kbps | N × 48 kbps |
| server CPU | none | SRTP decrypt + re-encrypt per forwarded packet | decode + mix + encode per participant |

At the sizes that matter, worst case (everyone talking at once), SFU egress:

| N | server egress | packets/s the SFU forwards |
| --- | --- | --- |
| 5 | 0.96 Mbps | 1,000 |
| 10 | 4.3 Mbps | 4,500 |
| 20 | 18.2 Mbps | 19,000 |
| 50 | 117.6 Mbps | 122,500 |

With DTX and two people actually speaking, N=20 is about 2.6 Mbps instead of
18.2. Both numbers are worth carrying: the first is what the capacity plan must
survive, the second is what it will normally cost.

**Mesh dies at 5-6.** Not on server cost — there is none — but on the client: a
phone on a mobile network uploading 5 × 48 kbps while running 5 encoders and 5
ICE agents, and every join renegotiating with every existing participant. It is
also the option with the most code, because the signalling, the renegotiation,
the ICE restarts and the glare handling are all yours. Rejected.

**MCU** moves the ceiling: downlink and egress stop being N², and a 50-person
room costs the same as a 5-person one on the wire. The price is CPU — the server
decodes every stream, mixes, and encodes per listener — on a box that already
runs Postgres for the whole product and has no measured headroom. Rejected for
now, named in section 2.6 as the escape hatch if egress ever becomes the binding
constraint.

**SFU** is the middle, and it is where every product of this shape sits.

### 2.2 The constraint this repository already recorded

This is the finding that should change how anyone reads the rest of the section.

On 2026-09-06 HTTP/3 was turned off at the proxy on the owner's instruction
(`docs/PRODUCTION_PRIORITY_TRACKER.md:792-806`). The reason:

> Traefik advertised `Alt-Svc: h3=":443"; ma=2592000`, and a VLESS/REALITY
> tunnel carries TCP only — its iOS clients commonly drop UDP 443 so QUIC cannot
> leak around the proxy — so an affected browser spent a full connect timeout on
> every navigation for up to thirty days.

The sentence immediately after is the one that stops being true the moment this
proposal ships:

> Nothing in the product needs UDP: no `RTCPeerConnection`, voice and video
> captured with `getUserMedia` and uploaded over HTTPS, realtime over a
> WebSocket.

So: an unknown but non-trivial share of this product's users reach it over a
tunnel that carries TCP only. WebRTC prefers UDP and falls back to ICE-TCP or a
TURN relay. Those users will land on the fallback, or they will fail to connect
at all.

Two things follow, and both are in the plan:

1. **ICE-TCP and TURN over TLS are not optional extras here, they are the
   primary path for part of the audience.** LiveKit's `rtc.tcp_port` (7881) and
   its built-in TURN/TLS must both be on from day one.
2. **The first slice's only job is to find out how bad this is**, before any
   product code exists. Section 6, question 2, names the measurement:
   `chrome://webrtc-internals` on a tunnelled client, reading which candidate
   pair actually carried the media.

One piece of good news already recorded: `ufw`'s missing `443/udp` rule does not
matter, because Docker's published-port DNAT runs ahead of `ufw` and did forward
UDP (`docs/PRODUCTION_PRIORITY_TRACKER.md:803-806`). Publishing a UDP port from
a container will work at the host firewall level without touching `ufw`.

### 2.3 The decision: self-hosted LiveKit

**LiveKit server**, Apache-2.0, a single Go binary using Pion, deployed as one
container as a sixth Coolify application.

Why it, and not a library:

1. **It is a finished product, not a toolkit.** Rooms, participants, permissions
   carried in the join token, active-speaker detection, DTX, reconnection, ICE
   restart, simulcast, a built-in TURN server, and webhooks for every lifecycle
   event are all already written. mediasoup is a Node library that would live
   inside `api-server` with no new container — and then the room model, the
   signalling protocol, the reconnection, the ICE restart handling, the TURN
   integration and the client are all yours. That is exactly «писать с нуля».
2. **It solves the hard problem for us.** The participant list is only correct
   if something with an actual connection to each participant decides who is
   present. LiveKit has that connection and exposes its view as
   `participant_joined` / `participant_left` webhooks and a `ListParticipants`
   API. Section 3.6 is built on those two facts.
3. **One SDK covers all three shells.** Tauri is WebView2, Capacitor is Chrome's
   WebView, iOS is Safari. All three are browsers. `livekit-client` is the only
   client dependency; there is no native SDK to add to the Rust or to Gradle.
4. **The server side needs no dependency at all.** A LiveKit join token is an
   HS256 JWT with a `video` claim; a webhook is verified by an HS256 JWT whose
   `sha256` claim is the hash of the body. Both are a few lines in Deno or Node.
   `livekit-server-sdk` (Apache-2.0, 3 dependencies) is available if wanted, but
   it is not required, and the smaller audit surface is the better default here.
5. **It can be replaced.** The client talks to `livekit-client`; the server
   contract is "mint a token, receive webhooks, list participants". Swapping to
   mediasoup or Janus later rewrites both of those; the data model of section 3
   and the whole of section 4 survive untouched.

The audit cost, stated honestly: `livekit-client@2.22.3` is Apache-2.0 but
**12.4 MB unpacked across 636 files**, with ten transitive dependencies
(`jose`, `tslib`, `events`, `machina`, `loglevel`, `sdp-transform`,
`typed-emitter`, `@livekit/mutex`, `webrtc-adapter`, `@livekit/protocol`).
Section 6, question 8, makes "does it lazy-split out of the main chunk" a
condition of adoption rather than an assumption.

### 2.4 What it costs to run

One container. Ports, from LiveKit's own reference:

| port | protocol | what | needed here |
| --- | --- | --- | --- |
| 7880 | TCP | API and signalling WebSocket | yes, behind Traefik on `voice.letscube.ru` |
| 7882 | UDP | ICE/UDP mux — **one** port instead of the 50000-60000 range | yes |
| 7881 | TCP | ICE/TCP fallback | yes — section 2.2 |
| 5349 | TLS | built-in TURN/TLS | yes — section 2.2 |
| 3478 | UDP | TURN/UDP and STUN | optional |

The UDP mux (`rtc.udp_port`) is what makes this deployable as a normal container
rather than with host networking: one published UDP port instead of a
ten-thousand-port range, which matters on a host whose Docker address pools were
already customised to avoid a provider conflict and must not be reset
(`CLAUDE.md:485-487`).

Configuration, as it should start:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882          # mux: one UDP port, not a range
  port_range_start: 0
  port_range_end: 0
  use_external_ip: true
turn:
  enabled: true
  domain: voice.letscube.ru
  tls_port: 5349
  external_tls: true      # TLS terminated by Traefik
room:
  auto_create: false      # a room is created by the gateway, never by a joiner
  empty_timeout: 60
  max_participants: 10
keys:
  # from the environment, never in the image
logging:
  level: info
```

`auto_create: false` is deliberate. With it on, any valid token conjures a room,
so a token bug becomes a room-spam bug. With it off the gateway must call
`CreateRoom`, which is also the second place the participant cap is enforced —
LiveKit refuses the eleventh joiner itself, so the cap does not depend on the
client or on a race in a `COUNT(*)`.

**And a resource limit, which would be the first one in this repository:**

```yaml
deploy:
  resources:
    limits: { cpus: "2.0", memory: 1g }
```

Nothing else on this host is capped (section 1.6). An SFU whose CPU rises with
how many people are talking, sharing a box with the production database, is
exactly the service that must not be allowed to take the whole machine. If the
limit turns out to be the thing that degrades calls, that is a visible,
diagnosable failure of one container — which is better than an invisible one of
Postgres.

Operationally it is the bot gateway again: its own Coolify application, its own
Traefik router scoped to one hostname, `expose` not `ports` for 7880 (the UDP and
TCP ICE ports do need real host publishing), an internal healthcheck, and
auto-deploy decided deliberately rather than inherited.

### 2.5 The ceiling

**10 per voice channel** for slices 1-4. A `CHECK` on the column that refuses
anything above **20**. No product claim above 20 at all until section 6's load
test has run.

The reasoning, kept separate from the vendor's:

- Bandwidth at 10 is 4.3 Mbps worst case, about 1.1 Mbps realistically. That is
  not a number that needs defending on any VPS.
- Bandwidth at 20 is 18.2 Mbps worst case. Sustained for an hour that is roughly
  8 GB of egress, and **nothing in this repository says whether this host's
  traffic is metered** (section 6, question 7).
- The packets-per-second column is the one that decides CPU: 4,500/s at N=10,
  19,000/s at N=20. LiveKit does not transcode audio — it forwards Opus — so the
  per-packet cost is SRTP decrypt and re-encrypt plus routing, which is cheap
  but not free. On a box with **no measured CPU headroom**, 19,000 pps is
  plausible and unmeasured, and "plausible and unmeasured" is not a number to
  put in a product.

Above 20 the answer is not to tune LiveKit. It is to change architecture (an
MCU, section 2.6) or to change the box.

### 2.6 What was rejected, and what would bring it back

- **Mesh WebRTC.** Ceiling 5-6, all the signalling code is yours, and the cost
  lands on the phone. Comes back only if the SFU cannot be reached at all on
  this host — and even then a 5-person cap would be a different product.
- **mediasoup.** Excellent, efficient, and a library. Rejected under the owner's
  own rule: choosing it means writing the server. Comes back if LiveKit's
  resource footprint proves unacceptable and a hand-tuned minimal forwarder is
  genuinely cheaper — which should be measured, not assumed.
- **Janus, specifically the AudioBridge plugin.** A finished server, and an MCU:
  one downstream stream per participant regardless of N, which is the only
  option that makes a 50-person channel cheap on the wire. Rejected now because
  it buys bandwidth with CPU on the one resource that is unmeasured, and because
  its client story (a bespoke JSON-over-WebSocket protocol, plugin `.cfg` files,
  no first-party SDKs of LiveKit's quality) is more work for all three shells.
  **This is the escape hatch** if section 6's measurements say egress, not CPU,
  is the binding constraint.
- **A managed SFU** (LiveKit Cloud, Daily, Agora, Twilio). Zero operations, real
  per-minute cost, and it is the one option that puts this product's voice
  traffic on somebody else's infrastructure outside the country — against the
  whole premise of a self-hosted Supabase, self-hosted mail deployment. Payment
  from this jurisdiction is its own problem. Rejected on product grounds, not
  technical ones.
- **Opus over the existing Supabase Realtime WebSocket** — no WebRTC at all.
  This deserves more than a sneer, because it is the only option that needs no
  UDP whatsoever, and section 2.2 says that is the real risk. It is still
  rejected: Realtime is a Phoenix channel over TCP with a default rate limit of
  10 events per second, it has head-of-line blocking, no jitter buffer, no
  packet loss concealment, and no path to the browser's echo canceller — and it
  would route conversation audio through the same WebSocket server the entire
  product's chat depends on. A voice feature that can take chat down with it is
  not a trade worth making. What survives from the idea is its insight: the
  fallback path must be TCP-capable, which is what LiveKit's ICE-TCP and
  TURN/TLS give.

---

## 3. The data model

### 3.1 One decision governs the rest: the SFU owns the truth

**The client never writes the participant table.** Not once, not for its own
row, not on leave. The only writer is a mirror of the SFU's own view of its
connections.

This is not tidiness. Every failure mode in section 3.6 comes from a client
being asked to announce its own absence, which is the one thing a client that
has just disappeared cannot do.

A second consequence, which shapes what the table needs to hold: **a person who
is in the call does not read this table.** The LiveKit client SDK already tells
them who else is connected, who is speaking and who is muted, over the
signalling channel they already have. The table exists for everyone *outside*
the call — the chat list badge, the channel row, the group panel. That halves
what has to be stored and it means a stale row is never visible to the people in
the call.

So `speaking` is not a column. It changes several times a second per person and
it is free from the SDK (`RoomEvent.ActiveSpeakersChanged`). Self-mute is not a
column either: it already propagates to every connected client through LiveKit's
own track publication state. **What goes in the database is membership, and
nothing else.**

### 3.2 The tables

Following `20260427_topics.sql` for shape and
`20260913120000_media_variant_job_queue.sql` for house style (one transaction,
`set local lock_timeout`, a self-check that raises rather than committing half).

```sql
create table if not exists public.voice_channels (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid not null references public.chats(id) on delete cascade,
  name               text not null,
  position           integer not null default 0,
  max_participants   smallint not null default 10,
  speak_role         public.chat_member_role not null default 'member',
  participant_count  integer not null default 0,
  active_since       timestamptz null,
  archived           boolean not null default false,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default pg_catalog.now(),
  updated_at         timestamptz not null default pg_catalog.now(),
  constraint voice_channels_name_length_check
    check (char_length(btrim(name)) between 1 and 64),
  constraint voice_channels_max_participants_check
    check (max_participants between 2 and 20),
  constraint voice_channels_count_check
    check (participant_count >= 0)
);

create index if not exists voice_channels_chat_idx
  on public.voice_channels (chat_id, position);

-- One per chat for now. Dropping this index is how the product grows to many.
create unique index if not exists voice_channels_one_per_chat_idx
  on public.voice_channels (chat_id) where not archived;
```

```sql
create table if not exists public.voice_participants (
  channel_id        uuid not null references public.voice_channels(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  joined_at         timestamptz not null,
  confirmed_at      timestamptz not null default pg_catalog.now(),
  primary key (channel_id, user_id)
);

create index if not exists voice_participants_stale_idx
  on public.voice_participants (confirmed_at);
```

`name` length 64 matches `chats_name_length_check`
(`20260506_entity_name_constraints.sql:42-44`). `speak_role` is the minimum
`chat_member_role` that may publish, so a "listen-only for members" channel is a
column change rather than a feature. `max_participants` is per channel *and*
capped by the CHECK, so no admin can set 500 by hand.

`joined_at` is **not** `default now()` — it is the value LiveKit reports for that
participant, and section 3.6 explains why that matters.

`participant_count` is a denormalisation, and denormalised counters lie. The
guard is that it is never incremented: every RPC that touches it recomputes it
in the same statement from `voice_participants`. It therefore cannot drift, and
it saves the chat list a join and N realtime subscriptions.

`private.voice_webhook_events(event_id uuid primary key, received_at
timestamptz not null default pg_catalog.now())` — webhook idempotency, in
`private` for the reason
`20260913120000_media_variant_job_queue.sql:24-28` gives: PostgREST on this
deployment exposes `public`, `storage` and `graphql_public`, and a webhook log is
nobody's business but the worker's. Rows older than a day are deleted by the
same worker.

### 3.3 RLS

Reusing the one-argument helpers from
`20260504_chats_membership_hardening.sql:216-280`, and a new one so the
participants policy does not have to subquery `voice_channels` inside a policy:

```sql
create or replace function public.voice_channel_chat(vc uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select chat_id from public.voice_channels where id = vc
$$;

revoke all on function public.voice_channel_chat(uuid) from public, anon;
grant execute on function public.voice_channel_chat(uuid) to authenticated;
```

```sql
alter table public.voice_channels enable row level security;
alter table public.voice_participants enable row level security;

create policy "members read voice channels"
  on public.voice_channels for select
  to authenticated
  using (public.is_chat_member(chat_id));

create policy "admins manage voice channels"
  on public.voice_channels for all
  to authenticated
  using      (public.is_chat_admin(chat_id))
  with check (public.is_chat_admin(chat_id));

create policy "members read voice participants"
  on public.voice_participants for select
  to authenticated
  using (public.is_chat_member(public.voice_channel_chat(channel_id)));
```

**`voice_participants` gets no INSERT, UPDATE or DELETE policy — deliberately.**
With RLS on and no permissive write policy, every non-`SECURITY DEFINER` write
is denied. This is `public.notifications` exactly
(`20260504_notifications.sql:50-52`: «No INSERT / UPDATE / DELETE policies on
purpose»), and here it is the mechanism that makes section 3.1 true rather than
a convention.

`participant_count` and `active_since` on `voice_channels` are inside a table an
admin *can* update, so the two columns need a column-level `revoke`:

```sql
revoke update (participant_count, active_since) on public.voice_channels
  from authenticated;
```

And both tables owe themselves the four restrictive "block banned" policies,
copied by name from `20260504_chats_membership_hardening.sql:371-388`, because
the loop in `20260504_roles_admin.sql:411-464` will not pick up a new table.

### 3.4 The gateway's way in

Two roles, two homes.

**Token minting and webhook receipt: a Supabase Edge Function
`supabase/functions/voice-gateway/`.** It follows `phone-verification-gateway`
and `support-gateway`: already publicly routed through Kong, already receives
the caller's Supabase JWT, already holds service-role secrets. It needs no
dependency — a LiveKit token is an HS256 JWT, and a webhook is verified by an
HS256 JWT whose `sha256` claim is the SHA-256 of the request body.

`POST /voice-gateway/token { channelId }` does, in order:

1. Verify the Supabase JWT; take `sub` as the user id.
2. Refuse if `is_banned`.
3. Read the channel and the caller's `chat_members` row with the service role.
   Refuse if not a member.
4. Refuse if `participant_count >= max_participants`.
5. Call LiveKit `CreateRoom` for `vc_{channelId}` with `maxParticipants` — the
   second, authoritative enforcement of the cap.
6. Mint and return a token with a 10-minute TTL:

```json
{
  "identity": "<supabase user id>",
  "name": "<display name>",
  "video": {
    "roomJoin": true,
    "room": "vc_<channelId>",
    "canPublish": true,
    "canSubscribe": true,
    "canPublishData": false,
    "canUpdateOwnMetadata": false,
    "roomAdmin": false,
    "roomCreate": false,
    "hidden": false
  }
}
```

The room name is derived from `channelId`, never taken from the client.
`roomAdmin` is `false` for every client token without exception; moderation
(slice 5) uses a separate admin token minted inside the gateway and never sent
anywhere.

`POST /voice-gateway/webhook` verifies the `Authorization` JWT and the body
hash, records the event id through
`public.voice_webhook_event_seen(p_event_id uuid) returns boolean` and drops
duplicates, then calls one of the RPCs below.

**The reconciler: a fourth in-process worker in `letscube-worker`**, started
beside `startMediaVariantsWorker()` at
`artifacts/api-server/src/index.ts:32-36`. It already holds the service role
key, it already runs on a timer, and it reaches LiveKit's HTTP API over the
internal Docker network with no public route. Section 3.6 is its job.

The RPCs, `SECURITY DEFINER`, `revoke ... from public, anon, authenticated,
service_role` then `grant execute ... to service_role` — the shape used 40 times
by the bot platform and by
`20260913120000_media_variant_job_queue.sql:230-235`:

| function | caller | what |
| --- | --- | --- |
| `voice_participant_joined(p_channel_id uuid, p_user_id uuid, p_joined_at timestamptz)` | webhook | upsert, recompute count |
| `voice_participant_left(p_channel_id uuid, p_user_id uuid, p_joined_at timestamptz)` | webhook | delete **only if** the stored `joined_at` is not newer; recompute count |
| `voice_participants_replace(p_channel_id uuid, p_user_ids uuid[], p_observed_at timestamptz)` | reconciler | the full set, atomically; recompute count |
| `voice_channel_set_active(p_channel_id uuid, p_active_since timestamptz)` | webhook | `room_started` / `room_finished` |
| `voice_participants_reap(p_older_than timestamptz)` | reconciler | delete rows not confirmed since |
| `voice_webhook_event_seen(p_event_id uuid) returns boolean` | webhook | insert-and-report-new |

And the self-check at the end of the migration proves both halves of every
grant, the way
`20260913120000_media_variant_job_queue.sql:396-402` does — that
`service_role` has execute, **and that `authenticated` does not**.

### 3.5 Realtime channels

Both new tables must be added to the publication with the idempotent form from
`20260906120000_publish_realtime_tables.sql:44-51`. Skipping this does not
degrade anything gracefully: per
`artifacts/kub/src/lib/realtimeTableChannels.ts:1-38`, a binding to an
unpublished table silently kills **every** binding on its channel while still
reporting `SUBSCRIBED`.

Two subscriptions, both through `subscribeByTable` so the table is the last
segment:

- **`voice:user:{userId}` → `voice:user:{userId}:voice_channels`**, event `*`,
  **no filter** — RLS decides what the user sees, exactly as
  `useChats.ts:419` does for `chat_members`. This one channel feeds every chat
  list row's badge, because `participant_count` lives on the row. One channel
  for the whole application, not one per chat.
- **`voice:channel:{channelId}` → `voice:channel:{channelId}:voice_participants`**,
  event `*`, filter `channel_id=eq.{channelId}` — subscribed only while the
  channel's participant list is on screen and the viewer is not in the call.
  Someone in the call reads the SDK instead.

`replica identity full` is needed on `voice_participants` for DELETE payloads to
carry `channel_id`; `chat_members`, `messages`, `tasks` and `task_events`
already have it (`docs/SUPABASE_CURRENT_STATE.md:115-117`).

No Broadcast, no Presence. Presence would be the obvious reach — it is exactly
"who is connected" — and it is the wrong tool here for two reasons: its state is
not queryable from SQL, so nothing outside a subscriber can read it (the chat
list badge, an RLS check, the participant cap), and it would be a **second**
truth beside the SFU's, which is the thing section 3.1 exists to prevent.

### 3.6 The hard part: the participant list when a client disappears

**The failure mode, named.** A client leaves without leaving. Concretely: the
phone loses signal in a lift; the browser tab is killed by the OS under memory
pressure; the laptop lid closes; the Windows app is force-quit from Task
Manager; the iOS PWA is backgrounded and WebKit suspends the page. In every one
of these the client runs no leave code, sends no request, fires no `beforeunload`
that survives. If the participant row were the client's own claim, it would stay
for ever — and worse, it would count against `max_participants`, so a channel
would fill up with people who are not there.

`beforeunload`, `pagehide`, `visibilitychange` and `navigator.sendBeacon` do not
solve this. They cover the polite half of the cases and none of the rude ones,
and the rude ones are the common ones on a phone.

**Four layers, each covering the previous one's failure.**

*Layer 1 — the SFU's own detection.* LiveKit holds an ICE/DTLS connection and a
signalling WebSocket per participant. When either dies it declares the
participant gone. This is the only mechanism in the stack that requires the
client to **stop** rather than to **do**, which is exactly the property the
problem demands. It fires `participant_left`.

*Layer 2 — webhook to table.* `voice-gateway` receives `participant_joined`,
`participant_left`, `room_started`, `room_finished`; verifies the JWT and the
body hash; dedupes on the event id; calls the RPC. The table updates and
Realtime carries it to everyone outside the call.

  *Its failure mode is documented by LiveKit itself:* «Due to the protocol's
  push-based nature, there are no guarantees around delivery.» A dropped
  `participant_left` leaves a ghost, and nothing in layer 2 will ever notice.

*Layer 3 — the reconciler, which is what actually makes this correct.* Every 30
seconds the worker in `letscube-worker` asks LiveKit `ListParticipants` for every
channel the table believes is non-empty, and calls
`voice_participants_replace(channel_id, user_ids[], observed_at)` with the
**complete set**. Not a diff — the whole membership, in one statement. A ghost
therefore lives at most one reconciliation period, whatever caused it. A room
LiveKit has never heard of comes back empty and is cleared, which is also the
right behaviour after a LiveKit restart or a deploy, when every room genuinely
is gone.

  **An error is not an empty room.** The reconciler writes only on a
  *successful* response. A timeout, a connection refused, a 5xx, or a partial
  page means "I do not know", and the correct action on not knowing is to write
  nothing and try again. Writing an empty set on a failed call would hang up
  every live call in the product the first time the SFU hiccuped.

*Layer 4 — the reaper.* `confirmed_at` is stamped by every webhook and every
successful reconciliation. A row not confirmed for five minutes is deleted. This
catches the residue: a channel the reconciler skipped because LiveKit no longer
lists its room at all, or a row written during a window the reconciler was down
for.

**The race that is easy to miss.** A LiveKit participant identity is unique per
room: if the same identity joins twice, the server disconnects the earlier one
with `DUPLICATE_IDENTITY`. Since identity is the Supabase user id, joining from a
second device kicks the first — which is what both Discord and Telegram do, and
is the behaviour we want, for free.

But it produces a `participant_left` and a `participant_joined` for the same
user in quick succession, and **webhook delivery order is not guaranteed.** If
the `left` is processed after the `joined`, the user is deleted from the table
while sitting in the room, and stays missing until the next reconciliation.

The fix is why `joined_at` is a column and not a `default now()`:
`voice_participant_left(channel_id, user_id, joined_at)` deletes **only if** the
stored `joined_at` is not newer than the one in the event. A late `left` from the
old session names the old timestamp, loses the comparison, and is ignored. This
costs one column and one `and` in a `where` clause, and without it the product
has an intermittent bug that reproduces only when someone switches device.

**What this bounds.** A ghost is never visible to the people in the call — they
render from the SDK — and is visible outside the call for at most 30 seconds in
the normal case, 5 minutes in the pathological one. That is the honest
statement, and it is the one to hold the implementation to.

### 3.7 Who may join, and who may speak

- **Join:** any `chat_members` row for the chat. Enforced at mint (step 3), and
  a token is the only way into the room.
- **Speak:** `canPublish` in the token, computed from the caller's
  `chat_members.role` against `voice_channels.speak_role`, and forced to `false`
  if `is_muted(user, chat_id)` or a global mute applies
  (`20260504_roles_admin.sql:91-104`).
- **Banned:** no token at all.
- **The property that matters:** publish rights are enforced by the SFU, not by
  the interface. A client that patches its own UI still cannot publish, because
  the server refuses the track. This is why the grant belongs in the token and
  not in a column the client reads and obeys.
- **Revocation mid-call** is the known gap, and it is honest to name it: a token
  already accepted is not re-evaluated. A user muted while connected keeps
  publishing until their token expires. Slice 5 closes it properly with
  LiveKit's `UpdateParticipant` (server-side mute, takes effect at once) driven
  from the same code path that writes `public.mutes`. Until slice 5, the 10-minute
  TTL is the bound, and that should be written down rather than discovered.

---

## 4. The interface

The contract is `docs/operations/interface-material.md`. Its rules are not
suggestions here — six of the fourteen bear directly on a floating call bar, and
four of those were learned by breaking something.

### 4.1 Where a voice channel lives

What the two references actually do:

- **Discord:** voice channels are permanent rows in the server's channel list,
  visible whether or not anyone is in them, with the participants nested
  underneath. Clicking joins immediately — no ring, no accept. A persistent
  "Voice connected" panel sits at the bottom of the left column, above the user
  area, and survives navigating anywhere in the app.
- **Telegram:** a group call is started deliberately, appears as a bar pinned
  under the chat header with the speakers' avatars, and becomes a floating bar
  across the top of every screen once you are in it.

This product takes Discord's placement and Telegram's two additions:

- **In the chat list** (`components/sidebar/ChatListItem.tsx`): a group with a
  live channel gets a small count indicator in the same row region as the unread
  badge — «3» beside a headset glyph. **Static, not animated**: rule 6 says
  nothing that scrolls or repeats gets the material, and the same logic applies
  to per-frame work in a list that scrolls.
- **Under the chat header**, when the chat is open: a capsule, the same
  construction as `TopicStrip` (`components/chat/TopicStrip.tsx:22-29` —
  `KubGlassLayer` with `CAPSULE_GLASS`, a leaf outside the scroller so it stays
  put and so the dialog it opens is not laid out against a frosted box, which is
  rule 3). It shows the channel name, the count, up to four avatars, and a
  «Присоединиться» control. When the chat also has topics, the voice capsule
  sits above the topic strip, because it is about the chat and the topic strip
  is about the conversation.
- **In `ChatInfoPanel`**: the channel and its full participant list, where
  members and invitations already live. This is also where an admin creates,
  renames and archives it. Note `D-169`
  (`docs/INTERFACE_DEFECT_REGISTER.md:8528-8538`): that panel already renders a
  channel as a group; the voice row must not make that worse, and «Голосовой
  канал» belongs to `type = 'group'` only in the first slices.
- **A system message in the conversation** when a call starts and when it ends —
  Telegram's, and the reason to copy it is that it is how people who were not
  looking find out. The product already has system messages
  (`20260510_group_invite_join_system_messages.sql`,
  `20260511_invite_accept_read_baseline_and_system_notice.sql`).

### 4.2 Joining

One tap joins. No ringing, no accept, no decline — that is the Discord model and
it is the right one for a persistent room. Ringing belongs to a 1:1 call, which
is a different feature and is out of scope everywhere in this document.

The participant list is visible **before** joining, from the capsule and from
the info panel, so a person can see who is there and decide. The microphone
prompt is the only gate, and it is the browser's; the error copy comes from
`classifyMicError` (`hooks/useVoiceRecorder.ts:44-57`) and
`lib/platform/capabilities.ts:82-87`, which already exist and already say the
right thing per shell.

### 4.3 The in-call bar

**On a phone.** A capsule docked above `BottomNav`, inside the pane, at the same
`inset-x-10` as the nav (`components/layout/BottomNav.tsx:56`). It carries the
channel name, up to four avatars with a «+N», a mute toggle and a leave button.
Tapping it opens a full-screen participant sheet.

`BottomNav` reserves its height through `--kub-bottom-nav` and the panes reserve
the same below themselves, because «two copies of one number drift»
(`BottomNav.tsx:64-70`). The call bar needs the same treatment: a
`--kub-call-bar` token, and the panes reserving the **sum**. And per the rule
already learned in this project, that reservation goes **inside the scroller**,
not by shrinking the container — shrinking leaves a band of ground in the old
bar's shape.

Two branches here, and the second is where D-065 would recur. When a chat is
open, `BottomNav` is not rendered (`MainLayout.tsx:163`), so the call bar becomes
the bottom-most element and must itself pad `--kub-safe-bottom`. When the chat
list is showing, the nav is below it and already pads the inset, so the call bar
must pad **zero** — padding it twice puts a strip of the inset's height between
the two.

**On a computer.** The same capsule, docked at the bottom of the left region
(`MainLayout.tsx:131`, `kub-left-region`), under the chat list — which is where
Discord puts it, and it is right for the same reason: the call is not part of any
one conversation, so it belongs to the chrome that outlives conversations. It
stays put while the user moves between chats.

It must not be `position: fixed` inside anything carrying a `backdrop-filter`
(rule 3: an element with a backdrop-filter is the containing block for fixed
descendants — glass on a 400px sidebar once made a dialog lay out inside that
column). `Sidebar` already paints its material from a positioned layer, so the
bar is a sibling inside the left region with its own `KubGlassLayer`.

**On Windows.** The bar is at the bottom, so it never meets
`--kub-window-caption` (rule 13's second kind of unsafe edge). What Windows adds
is that the window can be hidden while a call runs — `prevent_close` plus hide
at `windows-tauri/src-tauri/src/lib.rs:1871-1878` — so a call survives closing
the window, and the existing `desktop_show_main` command
(`capabilities/production.json:17`) can raise it from a toast.

**Paint order.** If the bar overlays the message list the way the header and
composer do, rule 12 applies in full: `z-index` makes a stacking context and
traps every `fixed` dialog in the subtree, `order` re-orders painting in Chromium
and **not in WebKit for positioned boxes** — which is how the chat header did not
exist on any iPhone for a whole stage. Tree order is the mechanism, and
`webkit-mobile-390` in `playwright.config.ts` is the only place that catches
getting it wrong.

### 4.4 What happens to the conversation

Nothing. That is the point of the Discord shape and it is the main thing that
distinguishes it from Telegram's: the conversation is not interrupted, replaced,
or pushed aside. The composer, the message list, the header and the search bar
are unchanged. The only change to the conversation is the reserved height at the
bottom of the pane, and one system message when the call starts.

### 4.5 Components reused rather than invented

| need | existing component | where |
| --- | --- | --- |
| the bar's and capsule's material | `KubGlassLayer` + `CAPSULE_GLASS` | `components/kub/KubGlassLayer.tsx:26`, `lib/chatChrome.ts:44` |
| a control that is itself a capsule | `CAPSULE_CONTROL_GLASS` | `lib/chatChrome.ts:57` |
| participant faces | `ChatAvatar` | `components/ui/ChatAvatar.tsx` |
| a participant row | `GroupMemberRow` | `components/chat/ChatInfoPanel.tsx:2266` — the member row with a speaking ring and a mute glyph in place of the role label |
| the full-screen sheet | `KubModal` | `components/kub/KubModal.tsx:39` |
| per-participant actions | `RowActions` + `useRowPressActions` | `components/kub/RowActions.tsx`, `hooks/useRowPressActions.ts` |
| capture constraints | `buildAudioTrackConstraints` | `hooks/useAudioSettings.ts:172-186` |
| output device | `setSinkId` wrapper | `lib/audioOutput.ts:14-20` |
| the settings screen for a call | `AudioSettingsSection` | `components/sidebar/AudioSettingsSection.tsx` — it already has both device pickers, the processing modes and the mic monitor. Call settings *are* that screen |
| errors and disconnect notices | `sonner` via `KubFeedbackViewport` | `components/kub/KubFeedbackViewport.tsx` |
| the strip's shape | `TopicStrip` | `components/chat/TopicStrip.tsx` |

New things genuinely needed: a `useVoiceChannel` hook beside `useTopics`, a
`VoiceChannelCapsule`, a `VoiceCallBar`, a `VoiceParticipantSheet`, and three
glyphs in `components/kub/icons.ts` (`mic`, `micOff`, `headset`).

Motion comes from the already-approved
`docs/superpowers/plans/2026-08-30-shared-motion-feedback.md` and nowhere else —
`CLAUDE.md:38-40` says in as many words: do not build a second animation system
beside it.

### 4.6 The material rules this touches

- **Rule 1** — no `rgba()`, no `backdrop-filter`, no shadow written in the
  component. `.kub-glass` and `KubGlassLayer` only.
- **Rule 2** — nothing opaque behind the bar, or the blur returns a flat colour.
- **Rule 3** — the bar has a `fixed` descendant (the sheet), so the material goes
  on a layer behind it, never on its root.
- **Rule 5** — the mute toggle's hover and pressed states use the veils, not a
  fixed `--kub-raised`, because the bar sits on a surface that moves between
  shells.
- **Rule 6** — the participant list scrolls: no glass on its rows.
- **Rule 7** — the bar's text is measured from photographed pixels, both themes,
  4.5:1. It composites over whatever the wallpaper and the conversation put
  behind it, which is the worst case rule 7 is about.
- **Rule 11** — the bar is a covering surface on a backdrop nobody chose, so it
  keeps a perimeter. The participant rows inside it do not.
- **Rule 12** — tree order, and `webkit-mobile-390` in the matrix.
- **Rule 13** — the two safe-area branches in 4.3.

---

## 5. The slices

Each is independently valuable, independently testable, and independently
shippable. Each names what proves it works.

### Slice 1 — the transport, proved on the real network

Deploy `livekit-server` as a sixth Coolify application with the configuration in
2.4: UDP mux on 7882, ICE/TCP on 7881, TURN/TLS on 5349, signalling behind
Traefik on `voice.letscube.ru`, `auto_create: false`, and a CPU and memory limit.
A scratch HTML page, served from nowhere near production, is the only client.

**Nothing in the product changes. No migration, no client dependency, no route
on `app.letscube.ru`.** This slice exists so that the riskiest assumption in the
whole plan is tested before a line of product code depends on it.

**Gate.**
1. Two browsers in a scratch room hear each other.
2. **One of them behind the VLESS/REALITY tunnel** (section 2.2), and
   `chrome://webrtc-internals` read to record which candidate pair actually
   carried the media — `udp`, `tcp` or `relay`. That reading is the deliverable.
3. `lk load-test --room scratch --audio-publishers 10` for ten minutes, with
   `docker stats` for `livekit` and `supabase-db` recorded, and a fixed Supabase
   query's p95 measured before and during.
4. The host's real specification recorded in the tracker at last (section 6,
   question 1).

**Kill criterion, stated up front:** if a tunnelled client cannot connect even
over TURN/TLS, the plan changes here — at the cost of one container and a day —
rather than after a data model, a migration and a UI have been built on it.

### Slice 2 — one voice channel per group: join, speak, mute, leave

The first shippable slice. The migration of section 3.2-3.5, the
`voice-gateway` Edge Function, the webhook, the reconciler worker,
`livekit-client` behind a dynamic `import()`, the capsule under the chat header,
the channel row in `ChatInfoPanel`, the in-call bar, and self-mute. Cap 10. One
voice channel per group chat, created by an owner or admin.

**Not in this slice, named so nobody has to infer it:** video, screen share,
recording, ringing, 1:1 calls, calls in private chats or channels, push-to-talk,
noise gate, more than one voice channel per group, the speaking ring, output
device selection, moderation, background audio on any shell, and anything at all
above 10 participants.

**Gate.**
1. Two accounts on two different shells join and hear each other; a third
   account watching from outside the call sees the list change within two
   seconds.
2. **The ghost test.** Kill one client's process — not a leave, `taskkill` or
   swipe the app away — and prove the row is gone within one reconciliation
   period, then repeat with the webhook endpoint deliberately returning 500 so
   that only layer 3 can have fixed it.
3. **The duplicate-identity test.** Join from a second device and prove the
   table shows the user exactly once, from the new session, with the webhooks
   delivered in both orders (the second order forced by holding one webhook
   back).
4. **The permission tests, each proved by trying rather than by reading code.** A
   token requested for a chat the caller is not a member of is refused. A token
   minted with `canPublish: false` cannot publish — attempt it and read the
   server's refusal. An eleventh joiner is refused by LiveKit, not only by the
   client.
5. The reconciler writes nothing when LiveKit returns an error — forced by
   pointing it at a closed port and proving a live room survives.
6. Unit coverage for `voice_participant_left`'s `joined_at` comparison, proved by
   mutation: removing the comparison must turn the suite red.
7. Typecheck, the unit suite, the production build, the routing matrix, and
   `webkit-mobile-390` for the bar.

### Slice 3 — presence everywhere, and the call outlives the conversation

The chat-list indicator, the call surviving navigation between chats and between
sections, the system message when a call starts and ends, and the desktop bar
docked in the left region.

**Gate.** Navigate across five chats, into settings and back, and the audio never
drops. The chat list's count matches `ListParticipants` for the same moment. The
system message lands once per call, not once per join.

### Slice 4 — the call becomes legible

Active-speaker ring from `RoomEvent.ActiveSpeakersChanged`, deafen, output-device
selection wired to the existing `setSinkId`, connection-quality indication, the
full-screen participant sheet on a phone, and reduced-motion behaviour.

**Gate.** The ring follows the person actually speaking, verified against the
SDK's own event and not by eye. The output picker moves audio to the chosen
device. `prefers-reduced-motion` collapses the ring's animation, and the
photographed contrast of the bar's text clears 4.5:1 in both themes.

### Slice 5 — moderation, limits, and the kill switch

Force-mute and remove-from-voice through `UpdateParticipant` and
`RemoveParticipant` with a gateway-held admin token; `speak_role`; mid-call
revocation when `public.mutes` changes (section 3.7's named gap); a per-chat
enable; a global `VOICE_ENABLED` kill switch on the pattern
`BOT_CREATION_ENABLED` already sets
(`docs/operations/bot-gateway.md:84-88`); a rate limit on token minting; and a
server-wide concurrency cap.

**Gate.** A muted user's audio stops within two seconds while they are connected,
proved by listening and not by reading the table. The kill switch turns the
feature off for everyone without a deploy. Token minting is rate-limited per user
and the limit is proved by exceeding it.

### Slice 6 — staying connected when the app is not in front

Android: a foreground service with `android:foregroundServiceType="microphone"`,
`FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE` in the manifest, and a
persistent notification — all of which is mandatory at `targetSdk 36` and none of
which exists today (section 1.5). Windows: the tray and a toast while the window
is hidden. iOS PWA: **it cannot**, and the interface says so — a plain line in
the call bar on that shell, in place of pretending.

**Gate.** On a physical Android device, lock the screen for two minutes and stay
audible. On Windows, close the window and stay audible, with the tray reflecting
it. On an installed iPhone app, background it, and check that the reconnection on
return is clean and that the warning was shown beforehand.

### Slice 7 — what the product says about itself

The privacy policy (`pages/public/PrivacyPage.tsx` mentions no calls today), the
Google Play Data Safety answers
(`docs/native/ANDROID_STORE_LISTING.md:22-30`), and the listing copy at
`:6-9`, which already promises «calls» and has for some time.

**Gate.** The policy names what is transmitted, where the media server is, and
what is and is not stored — which for slices 1-6 is: nothing is recorded.

---

## 6. Open questions, and the experiment that settles each

1. **What is this machine?** No CPU count and no RAM measurement exists anywhere
   (section 1.6). *Experiment:* `nproc`, `lscpu`, `free -h`,
   `cat /proc/pressure/cpu`, `docker stats --no-stream`, over SSH, recorded in
   the tracker. Until then no capacity claim in this document above the
   bandwidth arithmetic is honest.
2. **Does UDP reach the server from the networks users are really on?** This is
   the biggest risk and the repository already records the reason to doubt it
   (section 2.2). *Experiment:* slice 1's connect test from a tunnelled client,
   with `chrome://webrtc-internals` read for the selected candidate pair. The
   share of sessions that land on `relay` is the number that decides whether the
   SFU's cost is 48 kbps per stream or 48 kbps plus a TURN relay hop on the same
   box.
3. **How many audio subscriptions does this box take before Postgres notices?**
   *Experiment:* `lk load-test --audio-publishers N --subscribers M` with N
   ramped 5, 10, 20, measuring `docker stats` for the SFU and `supabase-db` and a
   fixed query's p95 before and during. The answer sets the real ceiling.
4. **Does WebView2 prompt for the microphone, and can someone who denied it get
   back?** `docs/native/WINDOWS_PACKAGING_PLAN.md:182` is unchecked, and there is
   no `PermissionRequested` handler in the Rust (section 1.5). *Experiment:* on a
   clean Windows profile, join, deny, then try to re-grant. If there is no way
   back, the fix is a `PermissionRequested` handler in
   `windows-tauri/src-tauri/src/lib.rs` plus a capability entry — Rust, a signed
   release and a QA pass, which is a slice of its own.
5. **Where does port 443 for TURN/TLS come from?** Traefik owns it.
   *Experiment:* read `/data/coolify/proxy/docker-compose.yml` and decide between
   a Traefik TCP router with TLS passthrough on the `voice.letscube.ru` SNI and a
   second address. **Do not touch that file without the owner** — its history is
   the HTTP/3 incident.
6. **Does a Docker-published UDP port survive this host's custom address pools?**
   The pools are recorded as non-default with the CIDRs written down nowhere
   (`CLAUDE.md:485-487`). *Experiment:* publish a scratch UDP listener in a
   container and send it a packet from outside.
7. **Is this VPS's bandwidth metered?** Nothing names the provider or an
   allowance. A 20-person channel at worst case is 18.2 Mbps sustained — about 8
   GB an hour. *Experiment:* ask the owner, or read the provider panel.
8. **What does `livekit-client` cost the bundle?** 12.4 MB unpacked across 636
   files, ten transitive dependencies. *Experiment:* add it behind a dynamic
   `import()` on a scratch branch and read the production build's chunk report.
   If it does not split out of the main chunk, it does not go in.
9. **Does the Android WebView allow a peer connection to a different origin from
   the bundled `localhost` page?** Voice messages prove capture works
   (`BridgeWebChromeClient.onPermissionRequest`); they prove nothing about a
   connection to `voice.letscube.ru`. *Experiment:* load slice 1's scratch page
   in the Android debug build.
10. **Does the iOS PWA reconnect cleanly after suspension?** It will suspend —
    that is settled. What is not known is whether returning gives a clean rejoin
    or a wedged `RTCPeerConnection`. *Experiment:* a physical iPhone, the
    installed app, background for 30 s and for 5 minutes. Nothing here can be
    checked on Chromium, and per
    `CLAUDE.md:457-460` it stays recorded as unverified until a device confirms
    it.

---

## 7. What this does not cover

Named so that none of it is later mistaken for an oversight: 1:1 calls and
ringing; video and screen share; recording and transcription; SIP and dial-in;
end-to-end encryption of the media (an SFU terminates DTLS, so media is
encrypted in transit and readable at the server — LiveKit has E2EE via insertable
streams, and it is a separate decision with its own key-distribution problem);
voice in private chats or in channels; noise suppression beyond what the browser
does; push-to-talk; soundboards, stage channels and every other Discord feature
that is not "a room you join"; and any participant count above 20.
