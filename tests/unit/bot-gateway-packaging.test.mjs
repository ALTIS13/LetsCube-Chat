import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const artifactRoot = "artifacts/api-server";
const entryPath = path.join(artifactRoot, "src/botGatewayIndex.ts");
const packageJson = JSON.parse(
  readFileSync(path.join(artifactRoot, "package.json"), "utf8"),
);
const buildSource = readFileSync(path.join(artifactRoot, "build.mjs"), "utf8");

test("Bot Gateway has a dedicated build and start artifact", () => {
  assert.equal(existsSync(entryPath), true);
  assert.equal(
    packageJson.scripts["start:bot"],
    "node --enable-source-maps ./dist/botGatewayIndex.mjs",
  );
  assert.match(buildSource, /src[\\/]botGatewayIndex\.ts/);
});

test("Bot Gateway entry fails closed on PORT and private auth configuration", () => {
  assert.equal(existsSync(entryPath), true);
  const entry = readFileSync(entryPath, "utf8");
  assert.match(entry, /resolveBotGatewayPort/);
  assert.match(entry, /resolveBotAuthConfig/);
  assert.match(entry, /BOT_TOKEN_PEPPER/);
  assert.match(entry, /resolveWebhookEncryptionKey/);
  assert.match(entry, /createWebhookWorkerRuntime/);
  assert.match(entry, /createBotDeletionFinalizerRuntime/);
  assert.match(entry, /createUpdateDeliveryHandlers/);
  assert.match(entry, /resolveBotManagementOrigins/);
  assert.match(entry, /management:\s*\{/);
  assert.match(entry, /tokenPepper:\s*authConfig\.pepper/);
  assert.match(entry, /webhookEncryptionKey/);
  assert.match(entry, /validateWebhookTarget/);
  assert.match(entry, /deletionFinalizer\.start\(\)/);
  assert.match(entry, /deletionFinalizer\.stop\(\)/);
  assert.doesNotMatch(entry, /VITE_BOT_TOKEN_PEPPER|PUBLIC_BOT_TOKEN_PEPPER/);
  assert.doesNotMatch(
    entry,
    /VITE_BOT_WEBHOOK_ENCRYPTION_KEY|PUBLIC_BOT_WEBHOOK_ENCRYPTION_KEY/,
  );
});

test("Bot Gateway dependency graph excludes unrelated API workers", () => {
  const pending = [entryPath];
  const visited = new Set();
  const combined = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current) || !existsSync(current)) continue;
    visited.add(current);
    const source = readFileSync(current, "utf8");
    combined.push(source);
    for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const candidate = path.resolve(path.dirname(current), match[1]);
      for (const resolved of [candidate, `${candidate}.ts`, path.join(candidate, "index.ts")]) {
        if (existsSync(resolved)) pending.push(resolved);
      }
    }
  }

  const graph = combined.join("\n");
  for (const forbidden of [
    "mediaVariantsWorker",
    "pushDispatcher",
    "supportMail",
    "registrationCleanupWorker",
  ]) {
    assert.equal(graph.includes(forbidden), false, `${forbidden} must stay isolated`);
  }
});
