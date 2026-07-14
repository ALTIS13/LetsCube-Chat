import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url),
  "utf8",
);

test("Web Push uses an atomic claim while native fallback still filters read rows", () => {
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /\/rest\/v1\/rpc\/push_outbox_claim/);
  assert.match(source, /p_claim_token/);
  assert.match(source, /claim_token/);
  assert.match(source, /claimed_until/);
  assert.equal(
    source.match(/notifications!inner\(read_at\)/g)?.length ?? 0,
    1,
  );
  assert.equal(
    source.match(/url\.searchParams\.set\("notifications\.read_at",\s*"is\.null"\)/g)?.length ?? 0,
    1,
  );
});
