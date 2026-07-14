import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../artifacts/kub/src/hooks/useHeartbeat.ts", import.meta.url),
  "utf8",
);

test("heartbeat forces an immediate presence update when a visible PWA reconnects", () => {
  assert.match(source, /window\.addEventListener\(["']online["'],\s*handleOnline\)/);
  assert.match(source, /window\.removeEventListener\(["']online["'],\s*handleOnline\)/);
  assert.match(source, /handleOnline[\s\S]*?ping\(true\)/);
});
