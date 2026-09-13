# The voice transport probe (slice 1)

What was deployed, what it measured, and how to take it away again.

This is slice 1 of `docs/proposals/2026-09-13-voice-channels.md`: a LiveKit SFU
on the production host, reachable by nothing in the product, whose only purpose
was to answer the question the rest of that plan rests on — **can media reach
this host from a client whose network carries no UDP?**

Everything below was measured on 2026-09-13.

## The answer

**Yes, over ICE/TCP, with no TURN and no certificate.**

Two headless Chromium instances joined one room from this workstation, over the
open internet, and each subscribed to the other's audio. The second ran with
`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, which is Chrome's
own enterprise switch for exactly the environment this product's tunnelled users
are in: it refuses non-proxied UDP and leaves ICE to find a TCP path or fail.

What actually carried the bytes, read from `getStats()` rather than inferred from
the call "working":

| client | publisher pair | subscriber pair | bytes out / in |
| --- | --- | --- | --- |
| ordinary | **udp**, srflx → host | **udp**, srflx → host | 102 720 / 79 074 |
| no UDP | **tcp**, prflx → host | **tcp**, prflx → host | 82 374 / 85 805 |

The kill criterion — *if a tunnelled client cannot connect even over TURN/TLS,
the plan changes here* — is not met. The plan proceeds to slice 2.

This matters because of what the tracker already recorded on 2026-09-06: HTTP/3
was switched off at the proxy because part of the audience reaches this product
through a VLESS/REALITY tunnel that carries only TCP. The line that followed it —
«nothing in the product needs UDP» — stops being true the day voice ships, and
this is the measurement that says what happens to those people: they get their
call over TCP, at a cost in latency rather than in failure.

## What it cost the box

Ten audio publishers for ten minutes (`livekit-cli load-test --audio-publishers 10`),
which with every publisher subscribing to the others is the 90-stream worst case
the proposal's arithmetic used:

| | before | during | after |
| --- | --- | --- | --- |
| livekit CPU | 0.26 % | **18.58 %** | 0.13 % |
| livekit memory | 31 MiB | 64 MiB | 38 MiB |
| supabase-db CPU | 0.58 % | 0.92 % | 6.40 % |
| a fixed Postgres read, p50 | 127 ms | 135 ms | 132 ms |
| a fixed Postgres read, p95 | 137 ms | 146 ms | 150 ms |
| load average (8 cores) | 1.51 | 2.13 | 2.29 |

The percentages are of the container's own two-core limit, so 18.58 % is about a
third of one core for a full room. The database's latency moves by about seven
per cent across all three phases, which is the band it moves in anyway — the
«after» figure being the highest of the three is the plainest statement that the
SFU is not what moved it.

## The host, measured at last

The proposal's section 6 asked for this and nothing in the repository had it.

- **8 cores**, AMD EPYC 7662.
- **11 GiB** memory, 5.4 used, 6.1 available.
- **119 GB** disk, 91 used — **82 % full**, which is the number worth watching.
- 41 containers; load average about 1.5 at rest.

**And a correction to the proposal**: it says nothing on this host is capped.
`letscube-bot-gateway` is — one CPU and one GiB — so the probe's limit is the
*second*, not the first.

## Three things learned by doing it

1. **`auto_create: false` does exactly what it promises, and it bites first.**
   The load test's publishers answered «not found» until the room was created
   deliberately through `CreateRoom`. That is the behaviour slice 2's gateway
   depends on — a token cannot conjure a room — confirmed by experiment rather
   than by reading the documentation.
2. **Docker publishes past ufw on this host.** `DOCKER-USER` is empty, so the
   probe's ports were reachable from outside the moment the container started,
   without any firewall rule being added. Worth knowing for every future
   container here, and worth deciding about deliberately rather than
   rediscovering.
3. **The kernel's UDP receive buffer is too small for an SFU**: LiveKit warns at
   startup, `425 984` against a suggested `5 000 000`. It did not matter at ten
   publishers over TCP and UDP alike, and it should be set before any real
   traffic: `net.core.rmem_max` and `net.core.rmem_default`.

## What is running, and how to remove it

`/srv/letscube/voice-probe/` on the production host, as a plain Compose project
rather than a Coolify application — slice 1 must be cheap to discard, and it must
not acquire a hostname, a Traefik router or an auto-deploy hook before it has
earned them.

- `livekit/livekit-server:v1.8.4`, container `letscube-voice-probe`, limited to
  2 CPUs and 1 GiB.
- Published: 7880/tcp (API and signalling), 7881/tcp (ICE/TCP), 7882/udp (the
  ICE mux — one port, not a range), 3478/udp (TURN).
- `livekit.env` holds the key pair, `chmod 600`, generated on the host and never
  transcribed anywhere else. `mint.py` beside it signs a token so that no secret
  has to leave the machine to run a test.
- No TLS, no hostname, no DNS record: `voice.letscube.ru` does not resolve, and
  the probe is addressed by IP from a page served on `localhost`, which is a
  secure context.

To take it away entirely:

```bash
cd /srv/letscube/voice-probe && docker compose down
rm -rf /srv/letscube/voice-probe
```

The configuration files are kept in this repository under
`docs/operations/voice-probe/` so that removing the directory loses nothing but
the key pair.
