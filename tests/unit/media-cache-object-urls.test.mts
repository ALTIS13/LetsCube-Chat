import assert from "node:assert/strict";
import test from "node:test";
import { createMediaObjectUrls } from "../../artifacts/kub/src/lib/mediaCache/objectUrls.ts";

test("a player retains a cached URL across bubble unmount, but not privacy retirement", () => {
  const revoked: string[] = []; let next = 0;
  const registry = createMediaObjectUrls({create:()=>`blob:synthetic-${++next}`,revoke:url=>revoked.push(url)});
  const lease = registry.create(new Blob(["synthetic"]), {partition:"a",chatId:"chat"});
  const playerRelease = registry.retain(lease.url);
  lease.release(); assert.deepEqual(revoked, []);
  registry.retire("other"); assert.deepEqual(revoked, []);
  registry.retire("a","chat"); assert.deepEqual(revoked, ["blob:synthetic-1"]);
  playerRelease(); lease.release(); assert.equal(revoked.length,1);
});
test("normal final owner release frees the Blob without accumulating a RAM cache", () => {
  let revoked = 0;
  const registry = createMediaObjectUrls({create:()=>"blob:one",revoke:()=>revoked++});
  const lease = registry.create(new Blob(["synthetic"]), {partition:"a",chatId:"chat"});
  const release = registry.retain(lease.url); lease.release(); release(); release();
  assert.equal(revoked,1); registry.retain("https://outside.invalid")(); assert.equal(revoked,1);
});
