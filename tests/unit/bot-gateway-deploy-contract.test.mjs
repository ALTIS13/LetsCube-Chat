import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function dockerStage(dockerfile, name) {
  const stages = [...dockerfile.matchAll(/^FROM\s+[^\r\n]+\s+AS\s+([^\s]+)\s*$/gim)];
  const stageIndex = stages.findIndex((match) => match[1] === name);
  assert.notEqual(stageIndex, -1, `missing Docker stage: ${name}`);
  const start = stages[stageIndex].index;
  const end = stages[stageIndex + 1]?.index ?? dockerfile.length;
  return dockerfile.slice(start, end);
}

function composeService(compose, name) {
  const match = new RegExp(`^  ${name}:\\s*$`, "m").exec(compose);
  assert.ok(match, `missing Compose service: ${name}`);
  const start = match.index;
  const remainder = compose.slice(start + match[0].length);
  const nextService = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  const end = nextService ? start + match[0].length + nextService.index : compose.length;
  return compose.slice(start, end);
}

function routerPriority(service, routerName) {
  const match = new RegExp(
    `traefik\\.http\\.routers\\.${routerName}\\.priority=(\\d+)`,
  ).exec(service);
  assert.ok(match, `missing router priority: ${routerName}`);
  return Number(match[1]);
}

test("bot gateway runtime starts only the dedicated entrypoint as an unprivileged user", async () => {
  const dockerfile = await source("docs/deploy/Dockerfile");
  const runtime = dockerStage(dockerfile, "bot-gateway-runtime");

  assert.match(runtime, /ENV\s+NODE_ENV=production\s+\\?\r?\n\s*PORT=8098/);
  assert.match(
    runtime,
    /COPY\s+--chown=node:node\s+--from=build\s+\/app\/artifacts\/api-server\/dist\/botGatewayIndex\.mjs/,
  );
  assert.match(runtime, /pino-\*\.mjs/);
  assert.match(runtime, /thread-stream-worker\.mjs/);
  assert.doesNotMatch(runtime, /\/app\/\s+\.\//);
  assert.doesNotMatch(runtime, /node_modules|package\.json|\.mjs\.map|\/src\//);
  assert.match(runtime, /^USER\s+node\s*$/m);
  assert.match(runtime, /^EXPOSE\s+8098\s*$/m);
  assert.match(
    runtime,
    /^CMD\s+\["node",\s*"artifacts\/api-server\/dist\/botGatewayIndex\.mjs"\]\s*$/m,
  );
  assert.doesNotMatch(runtime, /(?:^|\/)dist\/index\.mjs|supportMailIndex\.mjs/);
  assert.doesNotMatch(runtime, /CMD\s+\[?\s*"?(?:sh|bash)|VITE_[A-Z0-9_]+|BOT_TOKEN_PEPPER/);
});

test("Docker build context excludes private operations, credentials, signing material, backups and review evidence", async () => {
  const dockerignore = await source(".dockerignore");

  for (const pattern of [
    ".ops-private",
    ".ops-local",
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*.jks",
    "**/*.keystore",
    "**/google-services.json",
    "**/GoogleService-Info.plist",
    "**/backups",
    ".superpowers",
    "**/review-artifacts",
  ]) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(pattern),
      `missing Docker exclusion: ${pattern}`,
    );
  }
  assert.doesNotMatch(dockerignore, /^!.*\.env/m);
});

test("Coolify service keeps gateway secrets runtime-only and fails closed when required values are absent", async () => {
  const compose = await source("docs/deploy/docker-compose.coolify.yml");
  const dockerfile = await source("docs/deploy/Dockerfile");
  const gateway = composeService(compose, "letscube-bot-gateway");
  const web = composeService(compose, "kub-web");

  assert.match(gateway, /target:\s*bot-gateway-runtime/);
  assert.doesNotMatch(gateway, /^\s+args:\s*$/m);
  assert.doesNotMatch(gateway, /VITE_[A-Z0-9_]+/);
  assert.match(gateway, /PORT:\s*8098/);
  assert.match(gateway, /SUPABASE_URL:\s*\$\{SUPABASE_URL:\?/);
  assert.match(
    gateway,
    /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{SUPABASE_SERVICE_ROLE_KEY:\?/,
  );
  assert.match(gateway, /BOT_TOKEN_PEPPER:\s*\$\{BOT_TOKEN_PEPPER:\?/);
  assert.match(
    gateway,
    /BOT_WEBHOOK_ENCRYPTION_KEY:\s*\$\{BOT_WEBHOOK_ENCRYPTION_KEY:\?/,
  );
  assert.match(
    gateway,
    /BOT_CREATION_ENABLED:\s*\$\{BOT_CREATION_ENABLED:-false\}/,
  );
  assert.match(
    gateway,
    /BOT_CREATION_CANARY_USER_IDS:\s*\$\{BOT_CREATION_CANARY_USER_IDS:-\}/,
  );
  assert.match(gateway, /expose:\s*\r?\n\s+-\s+"8098"/);
  assert.match(gateway, /http:\/\/127\.0\.0\.1:8098\/healthz/);
  assert.doesNotMatch(gateway, /^\s+ports:\s*$/m);
  assert.match(gateway, /read_only:\s*true/);
  assert.match(gateway, /cap_drop:\s*\r?\n\s+-\s+ALL/);
  assert.match(gateway, /no-new-privileges:true/);
  assert.doesNotMatch(dockerfile, /ARG\s+BOT_CREATION_/);
  assert.doesNotMatch(web, /BOT_CREATION_/);
});

test("Traefik routes Bot API and redirects public docs above the release catch-all without claiming assets, release, or health paths", async () => {
  const compose = await source("docs/deploy/docker-compose.coolify.yml");
  const gateway = composeService(compose, "letscube-bot-gateway");
  const web = composeService(compose, "kub-web");

  assert.match(gateway, /Host\(`api\.letscube\.ru`\)/);
  assert.match(
    gateway,
    /Path\(`\/bot\/v1`\)\s*\|\|\s*PathPrefix\(`\/bot\/v1\/`\)/,
  );
  assert.match(
    gateway,
    /Path\(`\/bot\/manage\/v1`\)\s*\|\|\s*PathPrefix\(`\/bot\/manage\/v1\/`\)/,
  );
  assert.doesNotMatch(gateway, /PathPrefix\(`\/bot\/v1`\)/);
  assert.doesNotMatch(gateway, /PathPrefix\(`\/bot\/manage\/v1`\)/);
  assert.match(
    gateway,
    /traefik\.http\.services\.letscube-bot-gateway\.loadbalancer\.server\.port=8098/,
  );
  assert.ok(routerPriority(gateway, "letscube-bot-gateway") >= 100);

  assert.match(web, /Host\(`api\.letscube\.ru`\)/);
  assert.match(web, /Path\(`\/bots\/docs`\)/);
  assert.match(
    web,
    /traefik\.http\.routers\.letscube-bot-docs\.middlewares=letscube-bot-docs-redirect/,
  );
  assert.match(
    web,
    /redirectregex\.regex=\^https:\/\/api\[\.\]letscube\[\.\]ru\/bots\/docs/,
  );
  assert.match(
    web,
    /redirectregex\.replacement=https:\/\/app\.letscube\.ru\/bots\/docs\$\$\{1\}/,
  );
  assert.match(web, /redirectregex\.permanent=true/);
  assert.match(
    web,
    /traefik\.http\.services\.letscube-bot-docs\.loadbalancer\.server\.port=80/,
  );
  assert.ok(routerPriority(web, "letscube-bot-docs") >= 100);

  const publicRouterLabels = [...gateway.matchAll(/^\s+-\s+"?(traefik\.[^\r\n"]+)/gm),
    ...web.matchAll(/^\s+-\s+"?(traefik\.[^\r\n"]+)/gm)]
    .map((match) => match[1])
    .join("\n");
  assert.doesNotMatch(
    publicRouterLabels,
    /PathPrefix\(`\/assets|\/releases|\/healthz|PathPrefix\(`\/`\)/,
  );
});
