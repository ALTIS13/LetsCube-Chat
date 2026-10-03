import assert from "node:assert/strict";
import test from "node:test";
import { avatarRaceFixture, assertAvatarTargets, assertCurrentAvatar, compileAvatarWorker, finishOldAfterNew,
  changeOnce, idleReloadCandidate, workerSource } from "./media-variant-avatar-races.fixture.mjs";

process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
const worker = await compileAvatarWorker();
const wrongTargetWorker = await compileAvatarWorker(changeOnce(workerSource,
  "const variantPath = avatarVariantPath(owner, variant.kind, source.path);",
  'const variantPath = avatarVariantPath({ ...owner, id: "73000000-0000-4000-8000-000000000099" }, variant.kind, source.path);'));

for (const scope of ["profile", "chat"]) {
  test(`${scope}: compiled wrong-owner target must go RED against the exact publication oracle`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, wrongTargetWorker, { scope, pause: "get" });
    f.owner.avatar_url = f.urls.B;
    await f.run("B"); await f.settled(); f.assertAdapters(); f.assertUnrelated();
    assert.deepEqual(f.ownRows().map(r => r.status), ["ready", "ready"]);
    assert.equal(f.puts.length, 2); assert.equal(f.publications.length, 2);
    const state = f.snapshot();
    assert.throws(() => assertCurrentAvatar(state, f.paths.B),
      { code: "ERR_ASSERTION", message: /literal current avatar targets/ });
    assert.throws(() => assertAvatarTargets(state),
      { code: "ERR_ASSERTION", message: /literal avatar PUT target/ });
    // Independently prove the published-target oracle, not only the first PUT.
    assert.throws(() => assertAvatarTargets({ ...state, puts: [] }),
      { code: "ERR_ASSERTION", message: /literal avatar publication target/ });
    assert.deepEqual(f.failures, [], "the expected target RED is not an adapter refusal");
    t.diagnostic("compiled wrong-owner target: literal row/PUT/publication oracles RED; no adapter failure");
  });

  test(`${scope}: shipped late PUT refutes the current-publication invariant`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, worker, { scope });
    const { before, after } = await finishOldAfterNew(f);
    assert.throws(() => assertCurrentAvatar(after, f.paths.B), { code: "ERR_ASSERTION" });
    assertCurrentAvatar(after, f.paths.A);
    assert.equal(after.owner.avatar_url, f.urls.B, "the actual owner still points to B");
    assert.deepEqual(after.puts.map(p => p.actor), ["A", "B", "B", "A"]);
    if (scope === "profile") {
      assert.equal(before.objects.length, 2); assert.equal(after.objects.length, 2);
      assert.deepEqual(after.objects.map(([path]) => path), before.objects.map(([path]) => path));
      assert.throws(() => assert.deepEqual(after.objects, before.objects), { code: "ERR_ASSERTION" });
    } else {
      assert.equal(before.objects.length, 2); assert.equal(after.objects.length, 4);
      for (const object of before.objects) assert.ok(after.objects.some(entry => entry[0] === object[0] && entry[1] === object[1]));
    }
  });

  test(`${scope}: late failed PUT replaces both newer ready rows with old failures`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, worker, { scope, late: "failure" });
    const { before, after } = await finishOldAfterNew(f);
    assert.throws(() => assertCurrentAvatar(after, f.paths.B), { code: "ERR_ASSERTION" });
    assert.deepEqual(after.rows.map(r => [r.variant_kind, r.source_path, r.status]).sort(),
      [["avatar_128", f.paths.A, "failed"], ["avatar_256", f.paths.A, "failed"]]);
    assert.deepEqual(after.objects, before.objects, "failed old PUT does not remove the newer stored bytes");
  });

  test(`${scope}: stale missing-source result cannot be mistaken for current source absence`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, worker, { scope, pause: "get", late: "missing" });
    const { before, after } = await finishOldAfterNew(f);
    assert.throws(() => assertCurrentAvatar(after, f.paths.B), { code: "ERR_ASSERTION" });
    assert.deepEqual(after.rows.map(r => [r.variant_kind, r.source_path, r.status, r.error_code]).sort(),
      [["avatar_128", f.paths.A, "failed", "source_missing"], ["avatar_256", f.paths.A, "failed", "source_missing"]]);
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(after.puts.map(p => p.actor), ["B", "B"]);
  });

  test(`${scope}: successful isolated current work satisfies the same literal oracle`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, worker, { scope, pause: "get" });
    f.owner.avatar_url = f.urls.B;
    await f.run("B");
    f.assertAdapters(); f.assertUnrelated();
    assertCurrentAvatar(f.snapshot(), f.paths.B); assertAvatarTargets(f.snapshot());
    assert.equal(f.objects.size, 2);
    assert.deepEqual(f.puts.map(p => p.actor), ["B", "B"]);
  });
}

test("accepted PUT followed by failing publication retains bytes but loses both row pointers", { timeout: 20000 }, async t => {
  const f = await avatarRaceFixture(t, worker, { pause: "get", fault: "after-delete" });
  f.release(); await f.run("A"); f.assertAdapters(); f.assertUnrelated();
  assertAvatarTargets(f.snapshot());
  assert.equal(f.objects.size, 2, "both controlled Storage PUTs were accepted");
  assert.deepEqual(f.ownRows(), [], "delete/insert and failure publication left neither source nor target row");
  assert.equal(f.publications.length, 0);
  assert.deepEqual(f.puts.map(p => p.actor), ["A", "A"]);
  assert.throws(() => assertCurrentAvatar(f.snapshot(), f.paths.A), { code: "ERR_ASSERTION" });
});

test("unexpected adapter assertion survives SDK/worker error mapping and cannot certify a refusal", { timeout: 20000 }, async t => {
  const f = await avatarRaceFixture(t, worker, { pause: "get", fault: "adapter" });
  f.release(); await f.run("A"); await f.settled();
  assert.deepEqual(f.failures, [f.injected]);
  assert.throws(f.assertAdapters, { code: "ERR_ASSERTION" });
  assertAvatarTargets(f.snapshot());
});

const reloadedWorker = await compileAvatarWorker(idleReloadCandidate(workerSource));
test("idle publication reload preserves B rows but cannot undo a late overwrite of B bytes", { timeout: 20000 }, async t => {
  const f = await avatarRaceFixture(t, reloadedWorker);
  const { before, after } = await finishOldAfterNew(f);
  assertCurrentAvatar(after, f.paths.B);
  assert.deepEqual(after.objects.map(([path]) => path), before.objects.map(([path]) => path));
  assert.throws(() => assert.deepEqual(after.objects, before.objects), { code: "ERR_ASSERTION" });
});
for (const scope of ["profile", "chat"]) {
  test(`${scope}: proposed idle reload still fails when URL changes between check and DELETE`, { timeout: 20000 }, async t => {
    const f = await avatarRaceFixture(t, reloadedWorker, { scope, pause: "delete" });
    const { after } = await finishOldAfterNew(f);
    assert.throws(() => assertCurrentAvatar(after, f.paths.B), { code: "ERR_ASSERTION" });
    assert.deepEqual(after.rows.map(r => [r.variant_kind, r.source_path, r.status]).sort(),
      [["avatar_128", f.paths.A, "ready"], ["avatar_256", f.paths.B, "ready"]]);
    assert.equal(after.owner.avatar_url, f.urls.B);
  });
}
