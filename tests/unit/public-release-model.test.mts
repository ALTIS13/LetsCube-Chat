import assert from "node:assert/strict";
import test from "node:test";

import type { ReleaseCatalogSnapshot, ReleaseManifest } from "../../artifacts/kub/src/lib/releaseCatalog.ts";
import {
  describePublicAvailability,
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

test("a platform nobody publishes never shows an error, even when the network failed", () => {
  // Both halves of the guard matter. A shared network-failure flag reaching the
  // Apple entries would otherwise render "Каталог сейчас недоступен" plus a
  // retry for a platform that simply has no manifest.
  for (const platform of ["macos", "ios"] as const) {
    const state = describePublicPlatform(
      input({ platform, title: platform, catalogPublished: false, failed: true, snapshot: null }),
    );

    assert.equal(state.state, "unavailable", platform);
    assert.equal(state.href, null, platform);
  }
});

test("an unavailable manifest reports the version it is preparing, not the released one", () => {
  const state = describePublicPlatform(
    input({ snapshot: snapshot({ manifest: manifest({ available: false, artifact: null }) }) }),
  );
  assert.equal(state.version, "0.2.10");

  // An available manifest without an artifact is a broken shape, so it must not
  // present a version a reader could take as released.
  const broken = describePublicPlatform(
    input({ snapshot: snapshot({ manifest: manifest({ artifact: null }) }) }),
  );
  assert.equal(broken.version, null);
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

const PUBLISHED_STATES = ["loading", "available", "unavailable", "error"] as const;

function publishedState(platform: "windows" | "android", state: (typeof PUBLISHED_STATES)[number]) {
  return describePublicPlatform({
    platform,
    title: platform === "windows" ? "Windows" : "Android",
    catalogPublished: true,
    loading: state === "loading",
    failed: state === "error",
    snapshot: state === "available" || state === "unavailable"
      ? snapshot({
        manifest: manifest(
          // `manifest` spreads overrides wholesale, so passing `artifact:
          // undefined` would erase the default rather than keep it.
          state === "available"
            ? { platform, available: true }
            : { platform, available: false, artifact: null },
        ),
      })
      : null,
  });
}

const PLANNED = (["macos", "ios"] as const).map((platform) =>
  describePublicPlatform({
    platform,
    title: platform === "macos" ? "macOS" : "iPhone и iPad",
    listTitle: platform === "macos" ? undefined : "iOS",
    catalogPublished: false,
    loading: false,
    failed: false,
    snapshot: null,
  }),
);

/**
 * The whole reachable input space, and where each platform lands inside it.
 *
 * Two earlier versions of these tests were too weak in the same way. The first
 * only covered configurations where both published platforms shared a state, so
 * a mutation dropping the mixed cases restored the exact sentence this function
 * exists to prevent. The second checked that every platform was named somewhere
 * and that each clause appeared when its group was non-empty — which a mutation
 * putting a platform in the *wrong* clause satisfies perfectly. Rewriting
 * `named(unreachable)` as `named(published)` then produced "Windows доступен
 * для загрузки; каталог для Windows, Android сейчас недоступен" with the suite
 * fully green.
 *
 * So membership is what is asserted here: each platform must appear inside the
 * clause its own state maps to, and inside no other.
 */

/** The phrase that identifies a clause, chosen so no two of them overlap. */
const CLAUSE_MARKERS = {
  available: "для загрузки",
  unavailable: "готовим к выпуску",
  error: "недоступен",
  loading: "проверяем каталог для",
  planned: "в разработке",
} as const;

function clauseOf(summary: string, group: keyof typeof CLAUSE_MARKERS): string | null {
  const clauses = summary.replace(/\.$/, "").split("; ");
  // Markers are matched case-insensitively because the first clause of the
  // sentence is capitalized wherever it happens to land.
  const found = clauses.filter((clause) => clause.toLowerCase().includes(CLAUSE_MARKERS[group]));
  assert.ok(found.length <= 1, `more than one "${group}" clause in "${summary}"`);
  return found[0] ?? null;
}

test("every platform appears in the clause its own state maps to, and in no other", () => {
  for (const windowsState of PUBLISHED_STATES) {
    for (const androidState of PUBLISHED_STATES) {
      const published = [publishedState("windows", windowsState), publishedState("android", androidState)];
      const platforms = [...published, ...PLANNED];
      const summary = describePublicAvailability(platforms);
      const where = `${windowsState}/${androidState}`;

      assert.match(summary, /\.$/, `${where}: not a sentence`);

      const groups = Object.keys(CLAUSE_MARKERS) as (keyof typeof CLAUSE_MARKERS)[];
      for (const platform of platforms) {
        const own: keyof typeof CLAUSE_MARKERS = platform.catalogPublished ? platform.state : "planned";

        const ownClause = clauseOf(summary, own);
        assert.ok(ownClause !== null, `${where}: no "${own}" clause in "${summary}"`);
        assert.ok(
          ownClause.includes(platform.listTitle),
          `${where}: ${platform.listTitle} is not inside the "${own}" clause of "${summary}"`,
        );

        for (const other of groups) {
          if (other === own) continue;
          const clause = clauseOf(summary, other);
          if (clause === null) continue;
          assert.ok(
            !clause.includes(platform.listTitle),
            `${where}: ${platform.listTitle} also appears in the "${other}" clause of "${summary}"`,
          );
        }
      }

      // A clause exists exactly when some platform is in that state, so the
      // sentence cannot invent a group either.
      for (const group of groups) {
        const occupied =
          group === "planned"
            ? platforms.some((platform) => !platform.catalogPublished)
            : published.some((platform) => platform.state === group);
        assert.equal(
          clauseOf(summary, group) !== null,
          occupied,
          `${where}: the "${group}" clause disagrees with the states in "${summary}"`,
        );
      }
    }
  }
});

/**
 * The comma/"и" list is only unambiguous while no name carries a conjunction of
 * its own, which is why `listTitle` exists. Nothing else enforces that.
 */
test("no list name carries a conjunction that would lengthen the list", () => {
  for (const platform of [...PUBLISHED_STATES.map((state) => publishedState("windows", state)), ...PLANNED]) {
    assert.ok(
      !/\sи\s/.test(platform.listTitle),
      `${platform.platform}: list name "${platform.listTitle}" contains a conjunction`,
    );
  }
});

test("the summary reads correctly in the states a visitor is most likely to meet", () => {
  const both = describePublicAvailability([
    publishedState("windows", "available"),
    publishedState("android", "available"),
    ...PLANNED,
  ]);
  assert.equal(both, "Windows и Android доступны для загрузки; macOS и iOS в разработке.");

  const one = describePublicAvailability([
    publishedState("windows", "available"),
    publishedState("android", "unavailable"),
    ...PLANNED,
  ]);
  // Singular agreement, and the preparing platform is named rather than lumped
  // in with the ones nobody has started.
  assert.equal(one, "Windows доступен для загрузки; Android готовим к выпуску; macOS и iOS в разработке.");

  const outage = describePublicAvailability([
    publishedState("windows", "error"),
    publishedState("android", "error"),
    ...PLANNED,
  ]);
  assert.equal(outage, "Каталог для Windows и Android сейчас недоступен; macOS и iOS в разработке.");
  assert.doesNotMatch(outage, /готовим к выпуску/);
});

test("no platform name is rendered with a conjunction inside a list", () => {
  const summary = describePublicAvailability([
    publishedState("windows", "available"),
    publishedState("android", "available"),
    ...PLANNED,
  ]);
  // "iPhone и iPad" as a list item would read as two separate entries.
  assert.doesNotMatch(summary, /iPhone и iPad/);
});
