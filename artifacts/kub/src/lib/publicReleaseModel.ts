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
  /**
   * The platform's name inside a list sentence.
   *
   * Separate from `title` because a heading may read "iPhone и iPad" while a
   * comma-joined list needs a name that does not contain a conjunction.
   */
  listTitle: string;
  version: string | null;
  href: string | null;
  highlights: string[];
  stale: boolean;
};

export type PublicPlatformInput = {
  platform: ReleasePlatform;
  title: string;
  /** Defaults to `title` when the heading is already list-safe. */
  listTitle?: string;
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
    listTitle: input.listTitle ?? input.title,
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
 * its claim after the catalog stops supporting it. It is **total**: every
 * platform lands in exactly one clause, so the sentence can never quietly omit
 * one whose catalog failed while describing the others, and never generalises
 * one platform's state to another.
 *
 * A platform still being read gets its own clause rather than collapsing the
 * whole sentence. Retrying refreshes every platform at once, so collapsing
 * would drop a working download from the sentence while its section still
 * offers it.
 */
export function describePublicAvailability(platforms: PublicPlatformState[]): string {
  const published = platforms.filter((platform) => platform.catalogPublished);
  const named = (group: PublicPlatformState[]) => joinTitles(group.map((platform) => platform.listTitle));

  const ready = published.filter((platform) => platform.state === "available");
  const preparing = published.filter((platform) => platform.state === "unavailable");
  const unreachable = published.filter((platform) => platform.state === "error");
  const checking = published.filter((platform) => platform.state === "loading");
  const planned = platforms.filter((platform) => !platform.catalogPublished);

  const clauses: string[] = [];
  if (ready.length > 0) {
    clauses.push(`${named(ready)} ${ready.length === 1 ? "доступен" : "доступны"} для загрузки`);
  }
  if (preparing.length > 0) clauses.push(`${named(preparing)} готовим к выпуску`);
  if (unreachable.length > 0) clauses.push(`каталог для ${named(unreachable)} сейчас недоступен`);
  if (checking.length > 0) clauses.push(`проверяем каталог для ${named(checking)}`);
  if (planned.length > 0) clauses.push(`${named(planned)} в разработке`);

  if (clauses.length === 0) return "Проверяем каталог релизов.";
  const sentence = `${clauses.join("; ")}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  // Joined with "и", which is what the sentence needs to read as Russian. This
  // is only unambiguous because `listTitle` carries no conjunction of its own —
  // a heading like "iPhone и iPad" would turn the list into a longer one. A
  // unit test holds that guarantee on the names the app actually supplies.
  return `${titles.slice(0, -1).join(", ")} и ${titles[titles.length - 1]}`;
}
