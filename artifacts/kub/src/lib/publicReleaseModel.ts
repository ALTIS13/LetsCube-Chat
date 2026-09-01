import type { ReleaseCatalogSnapshot, ReleasePlatform } from "@/lib/releaseCatalog";

/**
 * View model for the public downloads surface.
 *
 * The public home makes availability claims to people who are not logged in, so
 * the rules live here rather than in the components: a platform is only ever
 * offered for download when a parsed manifest says it is available and carries a
 * validated artifact, and a platform nobody publishes yet is simply not
 * available rather than broken.
 */

export type PublicPlatformStatus = "loading" | "available" | "unavailable" | "error";

export type PublicPlatformState = {
  platform: ReleasePlatform;
  title: string;
  state: PublicPlatformStatus;
  /**
   * Whether a Stable manifest is published for this platform at all.
   *
   * "unavailable" means two different things without it: a release being
   * prepared, and a platform nobody has started publishing. A summary that
   * cannot tell them apart says the wrong thing about both.
   */
  catalogPublished: boolean;
  version: string | null;
  href: string | null;
  highlights: string[];
  stale: boolean;
};

export type PublicPlatformInput = {
  platform: ReleasePlatform;
  title: string;
  /**
   * Whether a Stable manifest is published for this platform at all. Android
   * and Windows are; macOS and iOS are not, and their absence is the expected
   * state rather than a fetch failure.
   */
  catalogPublished: boolean;
  loading: boolean;
  failed: boolean;
  snapshot: ReleaseCatalogSnapshot | null;
};

export type PublicChangelogSource = {
  title: string;
  snapshot: ReleaseCatalogSnapshot | null;
};

export type PublicChangelogEntry = {
  platform: ReleasePlatform;
  title: string;
  version: string;
  publishedAt: string;
  highlights: string[];
  notes: string;
};

export const PUBLIC_CHANGELOG_HIGHLIGHT_LIMIT = 6;

export function describePublicPlatform(input: PublicPlatformInput): PublicPlatformState {
  const base = {
    platform: input.platform,
    title: input.title,
    catalogPublished: input.catalogPublished,
    version: null as string | null,
    href: null as string | null,
    highlights: [] as string[],
    stale: false,
  };

  const manifest = input.snapshot?.manifest ?? null;

  // A background refresh must not blank a download control that already works,
  // so loading only wins while there is nothing to show.
  if (input.loading && !manifest) return { ...base, state: "loading" };

  if (!manifest) {
    // Only a platform that is supposed to have a manifest can be in error. For
    // the others this is the normal "not released yet" state and the surface
    // must not offer a retry.
    return { ...base, state: input.catalogPublished && input.failed ? "error" : "unavailable" };
  }

  const stale = input.snapshot?.stale ?? false;

  // The parser rejects an available manifest without an artifact, so this is
  // defensive: never render a download control that cannot point anywhere.
  if (!manifest.available || !manifest.artifact) {
    return {
      ...base,
      state: "unavailable",
      version: manifest.available ? null : manifest.version,
      highlights: manifest.highlights,
      stale,
    };
  }

  return {
    ...base,
    state: "available",
    version: manifest.version,
    href: manifest.artifact.url,
    highlights: manifest.highlights,
    stale,
  };
}

/** The newest actually released Stable build across the published platforms. */
export function selectPublicChangelog(sources: PublicChangelogSource[]): PublicChangelogEntry | null {
  let newest: PublicChangelogEntry | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;

  for (const source of sources) {
    const manifest = source.snapshot?.manifest;
    if (!manifest || !manifest.available || !manifest.artifact) continue;

    const publishedAt = Date.parse(manifest.publishedAt);
    if (Number.isNaN(publishedAt) || publishedAt <= newestAt) continue;

    newestAt = publishedAt;
    newest = {
      platform: manifest.platform,
      title: source.title,
      version: manifest.version,
      publishedAt: manifest.publishedAt,
      highlights: manifest.highlights.slice(0, PUBLIC_CHANGELOG_HIGHLIGHT_LIMIT),
      notes: manifest.notes,
    };
  }

  return newest;
}

/**
 * One sentence describing the whole platform list.
 *
 * It is derived rather than written down because a fixed sentence keeps making
 * its claim after the catalog stops supporting it. Every branch below is
 * reachable, and each is covered: an earlier version had an unreachable
 * "checking" branch and therefore announced that everything was being prepared
 * while the sections underneath reported the catalog was unreachable.
 */
export function describePublicAvailability(platforms: PublicPlatformState[]): string {
  const published = platforms.filter((platform) => platform.catalogPublished);
  const planned = platforms.filter((platform) => !platform.catalogPublished);
  const ready = published.filter((platform) => platform.state === "available");
  const preparing = published.filter((platform) => platform.state === "unavailable");

  if (published.some((platform) => platform.state === "loading")) {
    return "Проверяем каталог релизов.";
  }

  const inDevelopment = [...preparing, ...planned].map((platform) => platform.title);

  if (ready.length === 0) {
    if (published.some((platform) => platform.state === "error")) {
      return "Каталог релизов сейчас недоступен — используйте веб-версию.";
    }
    return "Приложения готовятся к выпуску — используйте веб-версию.";
  }

  const readyNames = joinTitles(ready.map((platform) => platform.title));
  if (inDevelopment.length === 0) return `${readyNames} доступны для загрузки.`;
  return `${readyNames} доступны для загрузки. ${joinTitles(inDevelopment)} — в разработке.`;
}

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} и ${titles[titles.length - 1]}`;
}
