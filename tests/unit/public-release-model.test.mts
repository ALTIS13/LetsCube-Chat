import assert from "node:assert/strict";
import test from "node:test";

import type { ReleaseCatalogSnapshot, ReleaseManifest } from "../../artifacts/kub/src/lib/releaseCatalog.ts";
import {
  describePublicPlatform,
  selectPublicChangelog,
  PUBLIC_CHANGELOG_HIGHLIGHT_LIMIT,
} from "../../artifacts/kub/src/lib/publicReleaseModel.ts";

const PUBLISHED_AT = "2026-08-30T09:00:00.000Z";

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    schemaVersion: 1,
    platform: "windows",
    channel: "stable",
    available: true,
    version: "0.2.10",
    build: 14,
    publishedAt: PUBLISHED_AT,
    minimumSupportedVersion: null,
    mandatory: false,
    notes: "Плановое обновление.",
    highlights: ["Быстрее открывается чат"],
    artifact: {
      url: "https://api.letscube.ru/releases/files/windows/0.2.10/LETSCUBE-Setup.exe",
      size: 2_322_508,
      sha256: "697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd",
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<ReleaseCatalogSnapshot> = {}): ReleaseCatalogSnapshot {
  return {
    manifest: manifest(),
    fetchedAt: 0,
    source: "network",
    stale: false,
    ...overrides,
  };
}

function input(overrides: Parameters<typeof describePublicPlatform>[0] | Record<string, unknown> = {}) {
  return {
    platform: "windows" as const,
    title: "Windows",
    catalogPublished: true,
    loading: false,
    failed: false,
    snapshot: snapshot(),
    ...overrides,
  } as Parameters<typeof describePublicPlatform>[0];
}

test("a valid available manifest offers the validated artifact", () => {
  const state = describePublicPlatform(input());

  assert.equal(state.state, "available");
  assert.equal(state.version, "0.2.10");
  assert.equal(
    state.href,
    "https://api.letscube.ru/releases/files/windows/0.2.10/LETSCUBE-Setup.exe",
  );
  assert.equal(state.stale, false);
});

test("a valid unavailable manifest is in development and offers nothing to download", () => {
  const state = describePublicPlatform(
    input({ snapshot: snapshot({ manifest: manifest({ available: false, artifact: null }) }) }),
  );

  assert.equal(state.state, "unavailable");
  assert.equal(state.href, null);
});

test("a platform without a published catalog is unavailable rather than broken", () => {
  for (const platform of ["macos", "ios"] as const) {
    const state = describePublicPlatform(
      input({ platform, title: platform, catalogPublished: false, snapshot: null }),
    );

    // A missing manifest for a platform nobody publishes yet is the normal
    // state, not a failure, so the surface must not show a retry or error.
    assert.equal(state.state, "unavailable", platform);
    assert.equal(state.href, null, platform);
    assert.equal(state.version, null, platform);
  }
});

test("a published catalog that cannot be reached is an error, not a silent absence", () => {
  const state = describePublicPlatform(input({ failed: true, snapshot: null }));

  assert.equal(state.state, "error");
  assert.equal(state.href, null);
});

test("a stale snapshot still offers the download and says so quietly", () => {
  const state = describePublicPlatform(
    input({ snapshot: snapshot({ stale: true, source: "stale-cache" }) }),
  );

  assert.equal(state.state, "available");
  assert.equal(state.stale, true);
  assert.notEqual(state.href, null);
});

test("an available manifest with no artifact never produces a link", () => {
  // The parser rejects this shape, so it should be unreachable. The model still
  // refuses to render a download control it cannot point anywhere.
  const state = describePublicPlatform(
    input({ snapshot: snapshot({ manifest: manifest({ artifact: null }) }) }),
  );

  assert.equal(state.href, null);
  assert.notEqual(state.state, "available");
});

test("loading wins over every other input", () => {
  const state = describePublicPlatform(input({ loading: true, snapshot: null }));

  assert.equal(state.state, "loading");
  assert.equal(state.href, null);
});

test("a loading platform that already has a snapshot keeps showing it", () => {
  const state = describePublicPlatform(input({ loading: true }));

  // Refreshing in the background must not blank a working download button.
  assert.equal(state.state, "available");
});

test("the changelog picks the newest published available release", () => {
  const entry = selectPublicChangelog([
    {
      title: "Windows",
      snapshot: snapshot({
        manifest: manifest({ publishedAt: "2026-08-30T09:00:00.000Z", version: "0.2.10" }),
      }),
    },
    {
      title: "Android",
      snapshot: snapshot({
        manifest: manifest({
          platform: "android",
          publishedAt: "2026-08-31T09:00:00.000Z",
          version: "0.1.3",
          highlights: ["Стабильнее работает загрузка файлов"],
          artifact: {
            url: "https://api.letscube.ru/releases/files/android/0.1.3/letscube.apk",
            size: 1,
            sha256: "a".repeat(64),
          },
        }),
      }),
    },
  ]);

  assert.equal(entry?.platform, "android");
  assert.equal(entry?.version, "0.1.3");
  assert.deepEqual(entry?.highlights, ["Стабильнее работает загрузка файлов"]);
});

test("the changelog ignores releases that are not available", () => {
  const entry = selectPublicChangelog([
    {
      title: "Windows",
      snapshot: snapshot({
        manifest: manifest({ available: false, artifact: null, publishedAt: "2026-09-01T09:00:00.000Z" }),
      }),
    },
    { title: "Android", snapshot: snapshot({ manifest: manifest({ platform: "android" }) }) },
  ]);

  // Windows is newer but not released, so the older released build wins.
  assert.equal(entry?.platform, "android");
  assert.equal(entry?.version, "0.2.10");
});

test("the changelog caps highlights and falls back to notes when there are none", () => {
  const many = Array.from({ length: 9 }, (_, index) => `Пункт ${index + 1}`);
  const capped = selectPublicChangelog([
    { title: "Windows", snapshot: snapshot({ manifest: manifest({ highlights: many }) }) },
  ]);
  assert.equal(capped?.highlights.length, PUBLIC_CHANGELOG_HIGHLIGHT_LIMIT);

  const fallback = selectPublicChangelog([
    {
      title: "Windows",
      snapshot: snapshot({ manifest: manifest({ highlights: [], notes: "Плановое обновление." }) }),
    },
  ]);
  assert.deepEqual(fallback?.highlights, []);
  assert.equal(fallback?.notes, "Плановое обновление.");
});

test("the changelog is absent when nothing is published", () => {
  assert.equal(selectPublicChangelog([]), null);
  assert.equal(selectPublicChangelog([{ title: "Windows", snapshot: null }]), null);
});
