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

test("export acquires the exact managed bytes but retirement invalidates its held lease", () => {
  const revoked: string[] = [];
  const registry = createMediaObjectUrls({create:()=>"blob:export",revoke:url=>revoked.push(url)});
  const bytes = new Blob(["synthetic original"], {type:"image/png"});
  const view = registry.create(bytes, {partition:"owner",chatId:"chat"});
  assert.equal(registry.acquire("blob:foreign"), null);
  const exported = registry.acquire(view.url);
  assert.ok(exported); assert.equal(exported.blob, bytes); assert.equal(exported.current(), true);
  view.release(); assert.equal(exported.current(), true); assert.deepEqual(revoked, []);
  registry.retire("owner", "chat");
  assert.equal(exported.current(), false); assert.deepEqual(revoked, ["blob:export"]);
  exported.release(); exported.release(); assert.equal(revoked.length, 1);
  assert.equal(registry.acquire(view.url), null);
});
