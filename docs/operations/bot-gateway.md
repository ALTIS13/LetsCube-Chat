# Bot Gateway Packaging And Routing

## Scope And Approval Boundary

This runbook covers the `letscube-bot-gateway` image, Coolify service, path
routing, health verification and rollback. It does not authorize a production
deployment, database migration, public bot creation, canary expansion or a
change to the release catalog.

Keep public bot creation disabled in the existing rollout admission control.
Making the gateway reachable does not authorize bot creation for a broader
cohort.

**Superseded on 2026-09-02, corrected here on 2026-09-19.** Bot creation went to
general availability on the owner's instruction; the canary cohort is retired in
code and `BOT_CREATION_ENABLED` is a kill switch whose production value is
`true`. The paragraph above describes the packaging stage and is kept as
history. Every other sentence in this file that says creation is disabled
(the canary record, rollback step 4) is history for the same reason.

## What Is Actually Running (measured 2026-09-19)

Read off the host, not from a webhook, because this is the one application of
five with Coolify auto-deploy switched off:

| Fact | Value |
| --- | --- |
| Coolify application | `twezs89u2m6d6ln6c0rpaqxe` |
| Image tag / commit | `935a670db6ab90f289164c7e2c27faa5b5c62a35` (2026-09-02) |
| Distance from `main` | 599 commits; **one route** of difference inside `artifacts/api-server/src/bot` |
| `BOT_CREATION_ENABLED` | `true` |
| Health | `Up`, healthy; `"Bot Gateway listening"` logged once at start, zero error-level lines since |
| Traffic | ~1440 POSTs to `/bot/v1/:method` per day, all `200` |

The one route of difference is `PATCH /bots/:botId/avatar`
(`b5402f7d`, 2026-09-04), which is therefore **absent in production** while the
browser bundle and the database function both have their halves. See D-241 and
D-242 in `docs/INTERFACE_DEFECT_REGISTER.md`. A deployment of this service at a
commit containing `b5402f7d` is the fix.

`BOT_CREATION_CANARY_USER_IDS` is still set in the Coolify environment. It is
inert — the deployed code ignores it deliberately — but it should be deleted.

Queue and delivery state, read read-only off production the same day:

| Table | State |
| --- | --- |
| `public.bots` | 3 active, `count(avatar_url) = 0` |
| `private.bot_webhooks` | **0 rows** — no webhook has ever been configured |
| `private.bot_delivery_attempts` | 0 rows |
| `private.bot_delivery_leases` | 0 rows at every sample |
| `private.bot_updates` | 2 rows, both unacknowledged, ~10 h old, expiring at 24 h |
| `public.chat_bot_members` | 1 live row, a private chat, `restricted` |

Not accumulating, and not draining either: the two queued updates belong to a bot
whose token has **never** been used, while the bot that authenticates every few
minutes is in no chat at all and has no counter row. So the transport is proved
(auth, routing and the database round trip, ~1440 × `200` a day) and an update
actually reaching a bot is **unproved since the 2026-08-31 canary**. Webhook
delivery — `validateWebhookTarget`, the encrypted secret, the retry worker — has
never run in production at all.

The public method URL remains:

```text
https://api.letscube.ru/bot/v1/<method>
```

Authenticated management traffic from the LETSCUBE app uses
`https://api.letscube.ru/bot/manage/v1/*`. The public documentation entrypoint
`https://api.letscube.ru/bots/docs` permanently redirects to the public SPA
route `https://app.letscube.ru/bots/docs`. The page is served by `kub-web`, not
by the Bot Gateway.

**True again since 2026-09-19 (D-245), and by a different mechanism than the
one this file used to describe.** It was declared as container labels in
`docs/deploy/docker-compose.coolify.yml` and never applied — Coolify generates
its own Compose from the application's settings, so a label written in a
repository file never reaches the running container, and the request fell
through to the release catch-all and answered `404` from nginx for the whole
life of the deployment.

It is now a Traefik **file-provider** router, `zz-letscube-bot-docs.yaml` in
`/data/coolify/proxy/dynamic/`, kept in the repository at
`docs/deploy/traefik-dynamic/letscube-bot-docs.yaml`. It belongs to no
container on purpose: nothing is proxied, the request never reaches an
application, and a label on the gateway would vanish the next time Coolify
regenerated that container's labels — which is how it was lost in the first
place. The file provider runs with `watch=true`, so installing it needs no
proxy restart.

## Runtime Boundary

The Docker target is `bot-gateway-runtime`. It starts only
`artifacts/api-server/dist/botGatewayIndex.mjs`, runs as the unprivileged
`node` user, exposes container port `8098`, has no shell wrapper and does not
load an environment file from the image. The runtime stage copies only that
compiled bundle and its required compiled Pino worker files. It contains no
workspace source tree, package manifests, `node_modules`, source maps, local
operations evidence or private files.

The repository-root `.dockerignore` excludes `.ops-private`, `.ops-local`, all
environment files, private keys and signing stores, mobile service
configuration, backup trees and review evidence before any build stage can
read them. Do not weaken those exclusions to debug a deployment.

The Coolify service adds these controls:

- no host port publication;
- read-only root filesystem with a bounded `/tmp` tmpfs;
- all Linux capabilities dropped and `no-new-privileges` enabled;
- internal healthcheck at `http://127.0.0.1:8098/healthz`;
- required secret interpolation, so an incomplete Coolify environment does not
  produce a partially configured service.

The process also validates configuration before listening. A missing or weak
pepper, malformed webhook encryption key, unusable Supabase URL or missing
service-role credential makes startup fail closed with a generic error.

## Runtime Environment

Configure values in the Coolify environment UI. Do not use Docker build args,
`VITE_*` values, committed `.env` files or image layers for the following
runtime settings.

| Variable | Requirement |
| --- | --- |
| `PORT` | Fixed to `8098` by Compose. |
| `SUPABASE_URL` | Required trusted Supabase HTTP(S) origin. Runtime only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required service credential. Runtime secret. |
| `BOT_TOKEN_PEPPER` | Required server-only pepper: 32–1024 UTF-8 bytes with at least eight distinct characters. |
| `BOT_WEBHOOK_ENCRYPTION_KEY` | Required 32-byte key encoded as exactly 43 base64url characters. Runtime secret. |
| `BOT_MANAGEMENT_ALLOWED_ORIGINS` | Optional comma-separated exact HTTPS origins. `https://app.letscube.ru` is always allowed by the runtime. |
| `BOT_CREATION_ENABLED` | Kill switch. Exact `false` disables creation; missing, empty or `true` allows it. Any other value fails startup. Runtime only. |

Never print these values, copy them into a ticket, include them in a Compose
render, or inspect a running container's environment. Rotate the bot-token
pepper only under a separate token invalidation plan. Rotate the webhook key
only with a plan for existing encrypted webhook credentials.

The existing production worker uses the historical
`SELFHOST_SERVICE_ROLE_KEY` alias, and the gateway runtime can recognize that
alias in source. This Coolify service deliberately requires the canonical
`SUPABASE_SERVICE_ROLE_KEY` binding. Before deployment, bind the same managed
secret to the canonical variable through Coolify without displaying or copying
its value. The existing worker alias remains unchanged; do not rename or remove
it as part of Task 7. If the canonical binding is absent, Compose validation
must fail instead of silently substituting a public or empty key.

Bot creation is generally available. The gateway allows it unless
`BOT_CREATION_ENABLED` is exactly `false`, which is now a kill switch rather
than an enable switch; the compose default is `true`. An unrecognised value
still fails gateway startup with the generic configuration error, so a typo
cannot quietly open or close the feature.

`BOT_CREATION_CANARY_USER_IDS` is **retired**. The gateway does not read it and
compose no longer passes it. Removing it was the fix for a real failure, not
tidying: after the canary finished, the variable was still set, so every account
outside that one cohort received `403 bot_creation_not_allowed` while meeting
every account requirement — including the product owner. Leaving the variable in
place would have let the same value close the feature again. Delete it from the
Coolify environment when convenient; a leftover value is inert, and a unit test
holds that it cannot narrow admission.

Admission is not the same as eligibility, and abuse control has not moved.
`bot_creation_eligibility_internal` still requires a confirmed email, a verified
phone, an account older than 24 hours, no active ban, and fewer than three live
bots.

**Corrected on 2026-09-19.** This paragraph used to end «Because phone
verification is currently restricted to administrators, an ordinary user still
cannot satisfy the phone requirement; opening bot creation to everyone therefore
also needs a separate decision on phone verification.» That decision was taken:
phone verification has been open to every authenticated account since
2026-09-02 (`20260902120000_phone_verification_open_to_all_users`; see
`CLAUDE.md` §12). The five eligibility requirements above are unchanged and are
still the whole of the abuse control.

When creation is refused, list and detail management remain available and list
eligibility reports `can_create=false`. The client names the reason: the unmet
requirements when there are any, and otherwise that the feature is switched off
on the server. It previously joined an empty list and rendered
"Создание недоступно: ." with no reason at all.

Never add the rollout variable to Docker build args, `VITE_*`, SPA
configuration, logs or a committed environment file.

## Local Packaging Checks

These commands build and inspect image metadata without supplying runtime
secrets:

```powershell
docker build --target bot-gateway-runtime -f docs/deploy/Dockerfile -t letscube-bot-gateway:local .
docker image inspect letscube-bot-gateway:local --format '{{json .Config.User}} {{json .Config.Cmd}} {{json .Config.ExposedPorts}}'
docker run --rm --entrypoint node letscube-bot-gateway:local -e "const fs=require('node:fs'); const names=fs.readdirSync('/app/artifacts/api-server/dist').sort(); const expected=['botGatewayIndex.mjs','pino-file.mjs','pino-pretty.mjs','pino-worker.mjs','thread-stream-worker.mjs']; if(JSON.stringify(names)!==JSON.stringify(expected)) process.exit(1)"
docker run --rm letscube-bot-gateway:local
```

The inspect output must show user `node`, only the `botGatewayIndex.mjs`
command and port `8098/tcp`. The content check requires exactly five compiled
`.mjs` files and rejects source, source maps, manifests and private evidence.
The final command intentionally omits runtime configuration: it must exit
non-zero instead of listening. Do not add example secret values to make that
negative check start.

Where the approved Coolify runtime environment is already attached, validate
Compose interpolation without rendering it to the terminal:

```bash
docker compose -f docs/deploy/docker-compose.coolify.yml config --quiet
```

Do not use `docker compose config` without `--quiet`; the rendered result would
contain runtime credentials.

## Traefik Path Ownership

Production already has a `letscube-releases` router combining
`Host(api.letscube.ru)` with the catch-all `PathPrefix("/")`. Keep that router
unchanged. The Compose labels add only higher-priority, narrower routers:

| Priority | Public path | Target | Behavior |
| --- | --- | --- | --- |
| `210` | `/bots/docs` or the `/bots/docs/` prefix | Redirect middleware | Permanent redirect to `https://app.letscube.ru/bots/docs`; query/suffix is preserved. Served by Traefik's file provider, not by a container label (D-245). |
| `200` | Exact `/bot/v1` or `/bot/v1/*` | `letscube-bot-gateway:8098` | Rule is `Path('/bot/v1') || PathPrefix('/bot/v1/')`; sibling names such as `/bot/v10` do not match. |
| `200` | Exact `/bot/manage/v1` or `/bot/manage/v1/*` | `letscube-bot-gateway:8098` | Rule is `Path('/bot/manage/v1') || PathPrefix('/bot/manage/v1/')`; sibling names do not match. |

Traefik chooses these rules ahead of the lower-priority release catch-all only
for the listed paths. The documentation redirect is intentional: Vite builds
with `BASE_PATH=/`, so the SPA references `/assets/*`. Serving only its HTML on
`api.letscube.ru` would send those assets to the release catch-all and could
produce a blank page. On `app.letscube.ru`, the existing web router owns both
the SPA route and its root-relative assets.

Do not add an `api.letscube.ru/assets/*` router. That broad path has no Bot API
ownership boundary and could collide with current or future API-host assets.
The Bot Gateway labels must not contain the catch-all `PathPrefix("/")`, `/assets`,
`/releases`, `/healthz` or a strip-prefix middleware.

Ownership that must remain unchanged:

- `/releases/*` stays on `letscube-releases`;
- the existing public release-catalog health path stays on its current router;
- `/healthz` on the Bot Gateway remains container-internal for Coolify;
- `/assets/*` on `api.letscube.ru` stays on the existing catch-all;
- unrelated `api.letscube.ru` paths continue to reach the existing catch-all.

Do not replace, lower the priority of or edit the release router to expose the
Bot API. Do not add a public Bot Gateway health router.

## Approved Deployment Verification

After an explicitly authorized Coolify deployment, verify the service without
using a bot token:

```bash
docker compose -f docs/deploy/docker-compose.coolify.yml ps letscube-bot-gateway kub-web
docker compose -f docs/deploy/docker-compose.coolify.yml exec -T letscube-bot-gateway node -e "fetch('http://127.0.0.1:8098/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
curl -fsSI https://api.letscube.ru/bots/docs
curl -fsS -o /dev/null https://app.letscube.ru/bots/docs
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' --data '{}' https://api.letscube.ru/bot/v1/getMe
curl -sS -o /dev/null -w '%{http_code}\n' https://api.letscube.ru/bot/manage/v1/bots
curl -fsS -o /dev/null https://api.letscube.ru/healthz
```

The API-host documentation request must return a permanent redirect whose
`Location` is `https://app.letscube.ru/bots/docs`; use `curl -I` without `-L`
when checking that header, then load the app-host URL and confirm its scripts
and styles come from `app.letscube.ru/assets/*`. **That step is red today and has
been for the whole life of this deployment — see D-245.** Until the redirect
labels are actually applied, `curl -fsSI https://api.letscube.ru/bots/docs`
fails and the app-host check is the only meaningful one. Expected remaining
results are
a healthy internal check, HTTP `401` for both unauthenticated Bot API and
management probes, and an unchanged successful response from the existing
public health path. A `404` or release-catalog response on either bot path means
the higher-priority router is absent or does not match.

Recheck at least one known-good `/releases/v1/*` manifest and its immutable
artifact URL from the release catalog's existing verification procedure. Do
not change or republish a release as part of this check.

### Route inventory (added 2026-09-19 after D-241)

Because this service does not auto-deploy, its route table can fall behind the
client that calls it, and every repository test will stay green while it does:
the e2e specs mock the management API and the unit tests read this repository's
own source. Neither can see what is running.

Check the routes themselves. Management routes authenticate **inside** each
handler, so an existing route answers `401` with the gateway's JSON envelope and
an absent one falls through to Express and answers `404` in HTML — which makes a
calibrated probe possible without any credential:

```bash
U=00000000-0000-4000-8000-000000000000
for r in profile avatar commands; do
  printf '%s -> ' "$r"
  curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H 'Content-Type: application/json' \
    --data '{}' "https://api.letscube.ru/bot/manage/v1/bots/$U/$r"
done
# control: a route that must NOT exist
curl -sS -o /dev/null -w 'control -> %{http_code}\n' -X PATCH \
  "https://api.letscube.ru/bot/manage/v1/bots/$U/definitelyNotARoute"
```

Every route the client calls must answer `401`; only the control may answer
`404`. The client's full call list is the `botManagement` object in
`artifacts/kub/src/lib/botManagement.ts`. Read the running commit from the
container rather than from Coolify's webhook history:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep twezs89u2m6d6ln6c0rpaqxe
```

## Operational Signals

Watch request rate and latency, `429` responses, update queue depth, webhook
failure rate, dead-letter count and Coolify health. The gateway logger redacts
`Authorization` and `X-Letscube-Bot-Webhook-Secret` and records normalized
paths rather than method payloads. Treat any raw token, webhook secret, service
credential, message payload, email or phone in logs as an incident.

Webhook delivery is at least once and uses bounded exponential retries.
Consumers must deduplicate by `update_id`. Retrying Bot API mutations must reuse
the original `idempotency_key`; a changed body with the same key is a conflict.
Rate-limit responses include `retry_after`, which callers must honor without
creating a retry burst.

## 2026-08-31 Production Canary

The production migration was applied only after fresh backup
`/srv/letscube/backups/automated/20260831-163741`, isolated PG17 restore,
transactional schema smoke and isolated RLS validation. Coolify deployment
`z9rvt9gh3qtos2oqp3lcxoh5` runs exact commit
`01d26a9225fee1cda0b8e9676b4ab03b084dec64` using the dedicated
`bot-gateway-runtime` target.

Public bot creation remains disabled except for one explicitly pinned internal
owner. *(True on 2026-08-31 and kept as the canary's record. Creation went to
general availability on 2026-09-02; see the top of this file.)* The production
canary verified:

- token creation and rotation, including rejection of the previous token;
- private updates and restricted-group mention delivery;
- exclusion of restricted-group messages that do not mention the bot;
- membership updates and no echo of bot-authored messages;
- mutual exclusion between long polling and webhook delivery;
- idempotent send retry and two distinct bot messages;
- one notification row per human recipient and message with a shared per-chat
  group tag, followed by chat-scoped read synchronization;
- zero raw bot-token matches in gateway logs;
- exact cleanup of canary chats, messages, notifications, updates, delivery
  attempts, leases, webhook state and bot memberships.

The chat participants were two dedicated QA users with no active browser or
native push destinations, so the canary could validate the in-app source of
truth without generating external device notifications. Root-only evidence is
kept under `/srv/letscube/ops/bot-platform-rollout/20260831T133211Z`; it contains
no raw bot token or account credential. Do not copy this directory into the
repository or broaden the current creation cohort without a separate review.

## Rollback

1. Disable the `letscube-bot-gateway` service and the two scoped bot routers.
2. Remove or revert only the `/bot/v1`, `/bot/manage/v1` routers and the
   `/bots/docs` redirect labels from this deployment revision.
3. Confirm the release catch-all, `/releases/*` and its public health path are
   unchanged and healthy.
4. Do not delete bot rows, messages, update queues or release manifests during
   packaging rollback. *(This step used to begin «Keep public bot creation
   disabled». Creation is generally available since 2026-09-02; a rollback that
   needs it closed sets `BOT_CREATION_ENABLED=false` deliberately, which is what
   the kill switch is for.)*

With the scoped routers absent, bot paths may fall through to the release
catch-all and return its normal not-found response. Human messaging, existing
release downloads and the release health route must continue independently.
