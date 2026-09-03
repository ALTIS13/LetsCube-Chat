import assert from "node:assert/strict";
import test from "node:test";

import {
  isCosmeticUnlocked,
  projectAchievement,
  projectCosmetic,
  projectSyncResult,
  type CosmeticDefinition,
} from "../../artifacts/kub/src/lib/achievementRules.ts";
import {
  backgroundStyle,
  canRenderCosmetic,
  frameStyle,
  renderableCosmeticKeys,
  FRAME_RING_WIDTH,
} from "../../artifacts/kub/src/lib/profileCosmetics.ts";

function cosmetic(overrides: Partial<CosmeticDefinition> = {}): CosmeticDefinition {
  return {
    key: "frame_tester",
    kind: "frame",
    title: "Рамка тестировщика",
    requiredAchievement: "tester",
    sortOrder: 10,
    ...overrides,
  };
}

test("a decoration with no requirement is open to everyone", () => {
  assert.equal(isCosmeticUnlocked(cosmetic({ requiredAchievement: null }), new Set()), true);
});

test("a decoration stays locked until its achievement is held", () => {
  assert.equal(isCosmeticUnlocked(cosmetic(), new Set()), false);
  assert.equal(isCosmeticUnlocked(cosmetic(), new Set(["settled_in"])), false);
  assert.equal(isCosmeticUnlocked(cosmetic(), new Set(["tester"])), true);
});

test("the sync result is read as earned badges and remaining distance", () => {
  const { earned, progress } = projectSyncResult({
    earned: ["beta_tester", "settled_in"],
    progress: { veteran: { current: 122, target: 365 } },
  });
  assert.deepEqual([...earned].sort(), ["beta_tester", "settled_in"]);
  assert.deepEqual(progress.veteran, { current: 122, target: 365 });
});

test("a progress entry with no target is dropped rather than shown as complete", () => {
  // `current / 0` renders as a full bar for something not earned, which reads
  // as "done" on a badge the person does not have.
  const { progress } = projectSyncResult({
    earned: [],
    progress: { broken: { current: 5, target: 0 }, fine: { current: 1, target: 10 } },
  });
  assert.equal("broken" in progress, false);
  assert.deepEqual(progress.fine, { current: 1, target: 10 });
});

test("a negative count cannot pull a progress bar backwards", () => {
  const { progress } = projectSyncResult({
    earned: [],
    progress: { odd: { current: -40, target: 10 } },
  });
  assert.equal(progress.odd.current, 0);
});

test("a malformed sync answer yields nothing rather than throwing", () => {
  for (const payload of [null, undefined, "no", 7, [], { earned: "beta" }, { progress: 3 }]) {
    const { earned, progress } = projectSyncResult(payload);
    assert.equal(earned.size, 0);
    assert.deepEqual(progress, {});
  }
});

test("only string keys survive the earned list", () => {
  const { earned } = projectSyncResult({ earned: ["tester", 42, null, { key: "x" }] });
  assert.deepEqual([...earned], ["tester"]);
});

test("a row without a key is not an achievement", () => {
  assert.equal(projectAchievement({ title: "no key" }), null);
  assert.equal(projectCosmetic({ key: "x", kind: "hat" }), null);
  assert.equal(projectCosmetic({ kind: "frame" }), null);
});

test("an achievement row is read with sensible defaults", () => {
  const projected = projectAchievement({ key: "tester", title: "Тестировщик", grant_kind: "manual" });
  assert.equal(projected?.grantKind, "manual");
  assert.equal(projected?.icon, "crown", "a row with no icon still renders one");
  assert.equal(projected?.sortOrder, 100);
});

test("grant_kind is only ever 'manual' or 'auto'", () => {
  assert.equal(projectAchievement({ key: "a", grant_kind: "self_service" })?.grantKind, "auto");
  assert.equal(projectAchievement({ key: "a" })?.grantKind, "auto");
});

test("the frames the database offers are all drawable by this build", () => {
  // The catalogue lives in the database and the appearance lives in code. This
  // is the seam: a key in one and not the other renders nothing at all.
  for (const key of ["frame_tester", "frame_alpha", "frame_beta", "frame_veteran", "frame_talker"]) {
    assert.notEqual(frameStyle(key), null, `${key} has no appearance`);
    assert.equal(canRenderCosmetic(key), true);
  }
  for (const key of ["bg_aurora", "bg_circuit", "bg_prism"]) {
    assert.notEqual(backgroundStyle(key), null, `${key} has no appearance`);
  }
});

test("a decoration this build has never heard of renders plain instead of breaking", () => {
  assert.equal(frameStyle("frame_from_the_future"), null);
  // The key comes from the database, so the lookup must not reach the
  // prototype: "constructor" would otherwise resolve to a function and be
  // handed to the renderer as a style.
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(frameStyle(key), null, key);
    assert.equal(backgroundStyle(key), null, key);
    assert.equal(canRenderCosmetic(key), false, key);
  }
  assert.equal(backgroundStyle("bg_from_the_future"), null);
  assert.equal(canRenderCosmetic("frame_from_the_future"), false);
  assert.equal(frameStyle(null), null);
  assert.equal(frameStyle(undefined), null);
  assert.equal(frameStyle(""), null);
});

test("a frame is never asked to draw itself thinner than a gradient can be seen", () => {
  for (const width of Object.values(FRAME_RING_WIDTH)) {
    assert.ok(width >= 2, "a 1px conic gradient reads as a grey line");
  }
});

test("every listed key is one the build can draw", () => {
  for (const key of renderableCosmeticKeys()) {
    assert.equal(canRenderCosmetic(key), true);
  }
});
