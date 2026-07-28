import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8").catch(() => "");
}

test("support mail bridge has a separate entrypoint and hardened runtime boundary", async () => {
  const [build, dockerfile, compose, entrypoint, packageJson] =
    await Promise.all([
      source("artifacts/api-server/build.mjs"),
      source("docs/deploy/Dockerfile"),
      source("docs/deploy/docker-compose.support-mail.yml"),
      source("artifacts/api-server/src/supportMailIndex.ts"),
      source("artifacts/api-server/package.json"),
    ]);

  assert.match(build, /src\/supportMailIndex\.ts/);
  assert.match(dockerfile, /AS support-mail-runtime/i);
  assert.match(dockerfile, /supportMailIndex\.mjs/);
  assert.match(dockerfile, /USER node/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:[\s\S]+ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /stop_grace_period:\s*75s/);
  assert.match(entrypoint, /startSupportMailBridge/);
  assert.match(entrypoint, /SIGTERM/);
  assert.match(entrypoint, /\/healthz/);
  assert.match(entrypoint, /\/readyz/);
  assert.match(packageJson, /"imapflow"/);
  assert.match(packageJson, /"mailparser"/);
  assert.match(packageJson, /"nodemailer"/);
});

test("mail bridge remains server-only and redacts message data", async () => {
  const combined = (
    await Promise.all([
      source("artifacts/api-server/src/supportMailIndex.ts"),
      source("artifacts/api-server/src/workers/supportMailBridge.ts"),
      source("artifacts/api-server/src/workers/supportMailRepository.ts"),
      source("artifacts/api-server/src/workers/supportMailRules.ts"),
      source("artifacts/api-server/src/workers/supportMailTransport.ts"),
    ])
  ).join("\n");

  assert.doesNotMatch(combined, /localStorage|VITE_SUPABASE|console\.log/);
  assert.doesNotMatch(
    combined,
    /logger\.(?:info|warn|error)\(\s*\{[^}]*\b(?:token|password|body|email|source)\b/i,
  );
  assert.match(combined, /SUPABASE_SERVICE_ROLE_KEY|SELFHOST_SERVICE_ROLE_KEY/);
  assert.match(combined, /support_email_ingest_inbound/);
  assert.match(combined, /support_email_claim_outbound/);
  assert.match(combined, /support_email_retention_cleanup/);
  assert.match(combined, /SUPPORT_MAIL_TRUSTED_AUTH_SERVER/);
  assert.match(combined, /p_limit:\s*1/);
  assert.match(combined, /p_lease_seconds:\s*300/);
  assert.match(combined, /skipTextToHtml:\s*true/);
  assert.match(combined, /skipTextLinks:\s*true/);
  assert.match(combined, /message_parse_failed/);
  assert.match(combined, /current\.ready = false/);
  assert.match(combined, /responseCode >= 400 && responseCode < 500/);
});
