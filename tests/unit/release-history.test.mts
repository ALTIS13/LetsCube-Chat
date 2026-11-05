import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { mergeReleaseHistory, VERIFIED_RELEASE_HISTORY } from "../../artifacts/kub/src/lib/releaseHistory.ts";
import type { ReleaseHistoryEntry } from "../../artifacts/kub/src/lib/releaseHistory.ts";
import type { ReleaseCatalogSnapshot, ReleaseManifest } from "../../artifacts/kub/src/lib/releaseCatalog.ts";

function source(platform: "android" | "windows" = "android", overrides: Partial<ReleaseManifest> = {}, stale = false) {
  const manifest: ReleaseManifest = {
    schemaVersion: 1, platform, channel: "stable", available: true, version: "0.1.45", build: 46,
    publishedAt: "2026-11-05T14:38:00Z", minimumSupportedVersion: null, mandatory: false,
    notes: "Synthetic catalog notes", highlights: ["Synthetic catalog change"],
    artifact: { url: `https://api.letscube.ru/releases/files/${platform}/0.1.45/synthetic.apk`, size: 123, sha256: "a".repeat(64) },
    ...overrides,
  };
  return { title: platform === "android" ? "Android" : "Windows", snapshot: {
    manifest, fetchedAt: 0, stale, source: stale ? "stale-cache" : "network",
  } as ReleaseCatalogSnapshot };
}

test("the bundled fallback contains exactly the three released Android version/build pairs, not candidates", () => {
  assert.deepEqual(mergeReleaseHistory([]).map((e) => [e.platform, e.version, e.build]), [
    ["android", "0.1.45", 46], ["android", "0.1.44", 45], ["android", "0.1.43", 44],
  ]);
  for (const entry of VERIFIED_RELEASE_HISTORY) {
    assert(entry.highlights.length > 0);
    assert(entry.whatToTest.length > 0);
    assert(entry.limitations.length > 0);
    assert(entry.evidenceRef && existsSync(new URL(`../../${entry.evidenceRef}`, import.meta.url)));
    assert.equal("artifact" in entry, false);
    assert.equal("url" in entry, false);
    assert.match(entry.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("live metadata deduplicates by platform/build and keeps reviewed tester notes only for the exact version", () => {
  const merged = mergeReleaseHistory([source()]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].source, "catalog");
  assert.equal(merged[0].publishedAt, "2026-11-05T14:38:00Z");
  assert.match(merged[0].whatToTest.join(" "), /MP4/);
  const changed = mergeReleaseHistory([source("android", { version: "9.9.9" })]);
  assert.equal(changed.filter((e) => e.build === 46).length, 1);
  assert.equal(changed[0].notes, "Synthetic catalog notes");
  assert.deepEqual(changed[0].whatToTest, []);
});

test("a new actually available Stable joins history without a fabricated future release", () => {
  const merged = mergeReleaseHistory([source("android", { version: "9.9.9", build: 999 })]);
  assert.deepEqual(merged.map((e) => e.build), [999, 46, 45, 44]);
  assert.equal(mergeReleaseHistory([]).some((e) => e.build === 47), false);
});

test("equal build numbers on Windows and Android remain separate tracks", () => {
  const merged = mergeReleaseHistory([source(), source("windows")]);
  assert.equal(merged.filter((e) => e.build === 46).length, 2);
  assert.equal(merged.find((e) => e.platform === "windows")?.notes, "Synthetic catalog notes");
  assert.deepEqual(merged.find((e) => e.platform === "windows")?.whatToTest, []);
  assert.equal(merged.some((e) => ["ios", "macos", "web"].includes(e.platform)), false);
});

test("test channel, unavailable and missing-artifact manifests cannot become Stable history", () => {
  for (const overrides of [{ channel: "test" as const }, { available: false }, { artifact: null }]) {
    assert.deepEqual(mergeReleaseHistory([source("android", { build: 999, version: "9.9.9", ...overrides })]), mergeReleaseHistory([]));
  }
});

test("stale catalog remains labelled and an unavailable current release does not erase factual old notes", () => {
  assert.equal(mergeReleaseHistory([source("android", {}, true)])[0].source, "stale-catalog");
  assert.equal(mergeReleaseHistory([source("android", { available: false, artifact: null })]).length, 3);
});

test("next-build note map is inert until an exact available Stable version/build is present", () => {
  const notes = { "android:47": {
    version: "9.9.9", notes: "Synthetic frozen notes", highlights: ["Synthetic frozen change"],
    whatToTest: ["Synthetic tester check"], limitations: [],
  } };
  assert.equal(mergeReleaseHistory([], undefined, notes).some((e) => e.build === 47), false);
  for (const overrides of [{ channel: "test" as const }, { available: false, artifact: null }]) {
    assert.equal(mergeReleaseHistory([source("android", { version: "9.9.9", build: 47, ...overrides })], undefined, notes).some((e) => e.build === 47), false);
  }
  const published = mergeReleaseHistory([source("android", { version: "9.9.9", build: 47 })], undefined, notes);
  assert.equal(published[0].notes, "Synthetic frozen notes");
  const mismatch = mergeReleaseHistory([source("android", { version: "9.9.8", build: 47 })], undefined, notes);
  assert.equal(mismatch[0].notes, "Synthetic catalog notes");
});

test("reviewed build47 tester checks require exact released version and preserve publication highlights", () => {
  assert.equal(mergeReleaseHistory([]).some((e) => e.build === 47), false);
  const matching = mergeReleaseHistory([source("android", { version: "0.1.46", build: 47 })])[0];
  assert.deepEqual(matching.highlights, ["Synthetic catalog change"]);
  assert.equal(matching.notes, "Synthetic catalog notes");
  assert.equal(matching.whatToTest.length, 2);
  assert.match(matching.whatToTest.join(" "), /без права/);
  assert.match(matching.whatToTest.join(" "), /без назначения/);
  assert.match(matching.whatToTest.join(" "), /нескольким людям/);
  assert.match(matching.whatToTest.join(" "), /трёх версий/);
  for (const overrides of [{ version: "0.1.45" }, { channel: "test" as const }, { available: false }, { artifact: null }]) {
    const entries = mergeReleaseHistory([source("android", { version: "0.1.46", build: 47, ...overrides })]);
    assert.equal(entries.some((e) => e.whatToTest.some((s) => s.includes("подтверждение собственной задачи"))), false);
  }
});

test("per-platform cap is literally four and merging does not mutate the bundled source", () => {
  const archive: ReleaseHistoryEntry[] = Array.from({ length: 8 }, (_, index) => ({
    ...VERIFIED_RELEASE_HISTORY[0], build: index, version: `0.0.${index}`,
  }));
  const before = JSON.stringify(VERIFIED_RELEASE_HISTORY);
  assert.deepEqual(mergeReleaseHistory([], archive).map((e) => e.build), [7, 6, 5, 4]);
  const result = mergeReleaseHistory([]);
  result[0].highlights.push("Synthetic consumer mutation");
  assert.equal(JSON.stringify(VERIFIED_RELEASE_HISTORY), before);
});

test("loaded cap and Stable-admission omissions fail the literal positive oracles", async () => {
  const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
  const { transform } = createRequire(requireKub.resolve("vite"))("esbuild");
  const original = readFileSync(new URL("../../artifacts/kub/src/lib/releaseHistory.ts", import.meta.url), "utf8");
  for (const [before, after] of [
    ["RELEASE_HISTORY_PER_PLATFORM_LIMIT = 4", "RELEASE_HISTORY_PER_PLATFORM_LIMIT = 5"],
    ['manifest.channel !== "stable"', "false"],
  ]) {
    assert.equal(original.split(before).length - 1, 1);
    const { code } = await transform(original.replace(before, after), { loader: "ts", format: "esm" });
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    if (before.includes("LIMIT")) {
      const archive = Array.from({ length: 8 }, (_, build) => ({ ...VERIFIED_RELEASE_HISTORY[0], build }));
      assert.throws(() => assert.equal(mutant.mergeReleaseHistory([], archive).length, 4));
    } else {
      assert.throws(() => assert.equal(mutant.mergeReleaseHistory([source("android", { channel: "test", build: 999 })]).length, 3));
    }
  }
});
