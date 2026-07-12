import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEASE_CATALOG_TTL_MS,
  compareReleaseVersions,
  createReleaseCatalogClient,
  getInstalledReleaseState,
  getReleaseManifestUrl,
  parseReleaseManifest,
} from "../../artifacts/kub/src/lib/releaseCatalog.ts";

const SHA256 = "a".repeat(64);

function androidManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    platform: "android",
    channel: "stable",
    available: true,
    version: "0.1.0",
    build: 1,
    publishedAt: "2026-07-12T00:00:00.000Z",
    minimumSupportedVersion: null,
    mandatory: false,
    notes: "Internal LETSCUBE release",
    artifact: {
      url: "https://api.letscube.ru/releases/files/android/0.1.0/letscube-0.1.0.apk",
      size: 8_734_685,
      sha256: SHA256,
    },
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("parseReleaseManifest accepts a bounded Android release", () => {
  const manifest = parseReleaseManifest(androidManifest(), "android", "stable");
  assert.equal(manifest.platform, "android");
  assert.equal(manifest.artifact?.sha256, SHA256);
});

test("parseReleaseManifest accepts an unavailable release without an artifact", () => {
  const manifest = parseReleaseManifest(
    androidManifest({ available: false, artifact: null, version: "0.0.0", build: 0 }),
    "android",
    "stable",
  );
  assert.equal(manifest.available, false);
  assert.equal(manifest.artifact, null);
});

test("parseReleaseManifest rejects unsafe artifact metadata", () => {
  assert.throws(
    () => parseReleaseManifest(androidManifest({
      artifact: {
        url: "https://example.com/letscube.apk",
        size: 10,
        sha256: SHA256,
      },
    }), "android", "stable"),
    /artifact_url/,
  );
  assert.throws(
    () => parseReleaseManifest(androidManifest({
      artifact: {
        url: "https://api.letscube.ru/releases/files/android/0.1.0/letscube.apk",
        size: -1,
        sha256: "ABC",
      },
    }), "android", "stable"),
    /artifact_size|artifact_sha256/,
  );
});

test("parseReleaseManifest rejects platform, schema and SemVer drift", () => {
  assert.throws(
    () => parseReleaseManifest(androidManifest({ platform: "windows" }), "android", "stable"),
    /platform/,
  );
  assert.throws(
    () => parseReleaseManifest(androidManifest({ schemaVersion: 2 }), "android", "stable"),
    /schema_version/,
  );
  assert.throws(
    () => parseReleaseManifest(androidManifest({ version: "v0.1" }), "android", "stable"),
    /version/,
  );
});

test("compareReleaseVersions compares strict SemVer numerically", () => {
  assert.equal(compareReleaseVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareReleaseVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareReleaseVersions("1.0.0", "1.0.1"), -1);
  assert.throws(() => compareReleaseVersions("1.0", "1.0.0"), /version/);
});

test("getInstalledReleaseState compares Android build when SemVer matches", () => {
  const manifest = parseReleaseManifest(androidManifest({ build: 2 }), "android", "stable");
  assert.equal(getInstalledReleaseState(manifest, { version: "0.1.0", build: 1 }), "update_available");
  assert.equal(getInstalledReleaseState(manifest, { version: "0.1.0", build: 2 }), "current");
  assert.equal(getInstalledReleaseState(manifest, { version: "0.2.0", build: 1 }), "current");
});

test("getReleaseManifestUrl uses the fixed release catalog path", () => {
  assert.equal(
    getReleaseManifestUrl("windows", "stable"),
    "https://api.letscube.ru/releases/v1/windows/stable.json",
  );
});

test("release client reuses a fresh six-hour cache", async () => {
  let now = Date.parse("2026-07-12T08:00:00.000Z");
  let requests = 0;
  const client = createReleaseCatalogClient({
    storage: memoryStorage(),
    now: () => now,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify(androidManifest()), { status: 200 });
    },
  });

  const first = await client.load("android", "stable");
  now += RELEASE_CATALOG_TTL_MS - 1;
  const second = await client.load("android", "stable");

  assert.equal(first.source, "network");
  assert.equal(second.source, "cache");
  assert.equal(second.stale, false);
  assert.equal(requests, 1);
});

test("release client returns stale cache when refresh fails", async () => {
  let now = Date.parse("2026-07-12T08:00:00.000Z");
  let online = true;
  const client = createReleaseCatalogClient({
    storage: memoryStorage(),
    now: () => now,
    fetchImpl: async () => {
      if (!online) throw new TypeError("offline");
      return new Response(JSON.stringify(androidManifest()), { status: 200 });
    },
  });

  await client.load("android", "stable");
  now += RELEASE_CATALOG_TTL_MS + 1;
  online = false;
  const stale = await client.load("android", "stable");

  assert.equal(stale.source, "stale-cache");
  assert.equal(stale.stale, true);
  assert.equal(stale.manifest.version, "0.1.0");
});

test("release client aborts a request after the configured timeout", async () => {
  const client = createReleaseCatalogClient({
    storage: memoryStorage(),
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });

  await assert.rejects(() => client.load("android", "stable"), /network/);
});
