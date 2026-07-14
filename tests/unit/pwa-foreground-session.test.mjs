import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookUrl = new URL(
  "../../artifacts/kub/src/hooks/usePushForegroundSession.ts",
  import.meta.url,
);

test("foreground session follows visibility, network and active chat lifecycle", async () => {
  const source = await readFile(hookUrl, "utf8");

  assert.match(source, /FOREGROUND_REFRESH_MS\s*=\s*7_000/);
  assert.match(source, /push_foreground_session_touch/);
  assert.match(source, /push_foreground_session_close/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /window\.addEventListener\("online"/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /selectedChatId/);
});

test("foreground session uses one runtime id and never logs user or chat identifiers", async () => {
  const source = await readFile(hookUrl, "utf8");

  assert.match(source, /kub:push-foreground-client-id/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /WARN_THROTTLE_MS\s*=\s*60_000/);
  assert.doesNotMatch(source, /console\.(?:warn|error)\([^\n]*(?:userId|selectedChatId)/);
});
