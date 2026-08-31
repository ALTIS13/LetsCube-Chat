# Bot Gateway Packaging And Routing

## Scope And Approval Boundary

This runbook covers the `letscube-bot-gateway` image, Coolify service, path
routing, health verification and rollback. It does not authorize a production
deployment, database migration, public bot creation, canary expansion or a
change to the release catalog.

Keep public bot creation disabled in the existing rollout admission control.
Making the gateway reachable does not authorize bot creation for a broader
cohort.

The public method URL remains:

```text
https://api.letscube.ru/bot/v1/<method>
```

Authenticated management traffic from the LETSCUBE app uses
`https://api.letscube.ru/bot/manage/v1/*`. The public documentation entrypoint
`https://api.letscube.ru/bots/docs` permanently redirects to the public SPA
route `https://app.letscube.ru/bots/docs`. The page is served by `kub-web`, not
by the Bot Gateway.

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
| `BOT_CREATION_ENABLED` | Exact `true` enables canary admission evaluation. Missing, empty or `false` keeps creation disabled. Runtime only. |
| `BOT_CREATION_CANARY_USER_IDS` | Required only when creation is enabled: 1–25 unique authenticated user UUIDs, comma-separated. Runtime only. |

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

Bot creation requires both `BOT_CREATION_ENABLED=true` and membership of the
authenticated user ID in the bounded cohort. The default denies every create
request with generic `403 bot_creation_not_allowed`; list and detail management
remain available and list eligibility reports `can_create=false`. Invalid
enabled configuration fails gateway startup with the generic configuration
error. Never add either rollout variable to Docker build args, `VITE_*`, SPA
configuration, logs or a committed environment file. Expansion beyond 25
users requires a separately reviewed rollout mechanism, not a larger string.

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
| `210` | Exact `/bots/docs` or `/bots/docs/` | Redirect middleware | Permanent redirect to `https://app.letscube.ru/bots/docs`; query/suffix is preserved. |
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
and styles come from `app.letscube.ru/assets/*`. Expected remaining results are
a healthy internal check, HTTP `401` for both unauthenticated Bot API and
management probes, and an unchanged successful response from the existing
public health path. A `404` or release-catalog response on either bot path means
the higher-priority router is absent or does not match.

Recheck at least one known-good `/releases/v1/*` manifest and its immutable
artifact URL from the release catalog's existing verification procedure. Do
not change or republish a release as part of this check.

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

## Rollback

1. Disable the `letscube-bot-gateway` service and the two scoped bot routers.
2. Remove or revert only the `/bot/v1`, `/bot/manage/v1` routers and the
   `/bots/docs` redirect labels from this deployment revision.
3. Confirm the release catch-all, `/releases/*` and its public health path are
   unchanged and healthy.
4. Keep public bot creation disabled. Do not delete bot rows, messages, update
   queues or release manifests during packaging rollback.

With the scoped routers absent, bot paths may fall through to the release
catch-all and return its normal not-found response. Human messaging, existing
release downloads and the release health route must continue independently.
