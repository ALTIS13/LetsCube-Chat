export const RELEASE_CATALOG_ORIGIN = "https://api.letscube.ru";
export const RELEASE_CATALOG_TIMEOUT_MS = 5_000;
export const RELEASE_CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;

export type ReleasePlatform = "android" | "windows" | "macos" | "ios" | "web";
export type ReleaseChannel = "stable";

export type ReleaseArtifact = {
  url: string;
  size: number;
  sha256: string;
};

export type ReleaseManifest = {
  schemaVersion: 1;
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  available: boolean;
  version: string;
  build: number;
  publishedAt: string;
  minimumSupportedVersion: string | null;
  mandatory: boolean;
  notes: string;
  highlights: string[];
  artifact: ReleaseArtifact | null;
};

export type ReleaseCatalogSnapshot = {
  manifest: ReleaseManifest;
  fetchedAt: number;
  source: "network" | "cache" | "stale-cache";
  stale: boolean;
};

export type InstalledReleaseInfo = {
  version: string;
  build: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ReleaseCatalogClientOptions = {
  fetchImpl?: FetchLike;
  storage?: StorageLike;
  now?: () => number;
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
};

type LoadOptions = {
  force?: boolean;
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_NOTES_LENGTH = 500;
const MAX_HIGHLIGHTS = 6;
const MAX_HIGHLIGHT_LENGTH = 140;

export class ReleaseCatalogError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReleaseCatalogError";
    this.code = code;
  }
}

export function parseReleaseManifest(
  input: unknown,
  expectedPlatform: ReleasePlatform,
  expectedChannel: ReleaseChannel = "stable",
): ReleaseManifest {
  const value = asRecord(input, "manifest");
  if (value.schemaVersion !== 1) throw new ReleaseCatalogError("schema_version");
  if (value.platform !== expectedPlatform) throw new ReleaseCatalogError("platform");
  if (value.channel !== expectedChannel) throw new ReleaseCatalogError("channel");
  if (typeof value.available !== "boolean") throw new ReleaseCatalogError("available");

  const version = requireSemVer(value.version, "version");
  const build = requireNonNegativeInteger(value.build, "build");
  const publishedAt = requireTimestamp(value.publishedAt);
  const minimumSupportedVersion = value.minimumSupportedVersion === null
    ? null
    : requireSemVer(value.minimumSupportedVersion, "minimum_supported_version");
  if (typeof value.mandatory !== "boolean") throw new ReleaseCatalogError("mandatory");
  if (typeof value.notes !== "string" || value.notes.length > MAX_NOTES_LENGTH) {
    throw new ReleaseCatalogError("notes");
  }
  const highlights = parseHighlights(value.highlights);

  const artifact = value.artifact === null
    ? null
    : parseArtifact(value.artifact, expectedPlatform, version);
  if (value.available && !artifact) throw new ReleaseCatalogError("artifact_required");
  if (!value.available && artifact) throw new ReleaseCatalogError("artifact_unavailable");

  return {
    schemaVersion: 1,
    platform: expectedPlatform,
    channel: expectedChannel,
    available: value.available,
    version,
    build,
    publishedAt,
    minimumSupportedVersion,
    mandatory: value.mandatory,
    notes: value.notes,
    highlights,
    artifact,
  };
}

export function compareReleaseVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseSemVer(left);
  const rightParts = parseSemVer(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function getInstalledReleaseState(
  manifest: ReleaseManifest,
  installed: InstalledReleaseInfo,
): "available" | "current" | "update_available" {
  if (!SEMVER_PATTERN.test(installed.version) || !Number.isSafeInteger(installed.build) || installed.build < 0) {
    return "available";
  }
  const comparison = compareReleaseVersions(manifest.version, installed.version);
  if (comparison > 0) return "update_available";
  if (comparison < 0) return "current";
  return manifest.build > installed.build ? "update_available" : "current";
}

export function getReleaseManifestUrl(
  platform: ReleasePlatform,
  channel: ReleaseChannel = "stable",
  baseUrl = RELEASE_CATALOG_ORIGIN,
): string {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:") throw new ReleaseCatalogError("base_url");
  return new URL(`/releases/v1/${platform}/${channel}.json`, origin).toString();
}

export function createReleaseCatalogClient(options: ReleaseCatalogClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const storage = options.storage ?? getDefaultStorage();
  const now = options.now ?? Date.now;
  const baseUrl = options.baseUrl ?? RELEASE_CATALOG_ORIGIN;
  const timeoutMs = options.timeoutMs ?? RELEASE_CATALOG_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? RELEASE_CATALOG_TTL_MS;

  return {
    async load(
      platform: ReleasePlatform,
      channel: ReleaseChannel = "stable",
      loadOptions: LoadOptions = {},
    ): Promise<ReleaseCatalogSnapshot> {
      const cacheKey = getCacheKey(platform, channel);
      const cached = readCache(storage, cacheKey, platform, channel);
      const currentTime = now();
      if (!loadOptions.force && cached && currentTime - cached.fetchedAt < ttlMs) {
        return { ...cached, source: "cache", stale: false };
      }

      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          getReleaseManifestUrl(platform, channel, baseUrl),
          timeoutMs,
        );
        if (!response.ok) throw new ReleaseCatalogError("network_status");
        const manifest = parseReleaseManifest(await response.json(), platform, channel);
        const snapshot = { manifest, fetchedAt: currentTime };
        writeCache(storage, cacheKey, snapshot);
        return { ...snapshot, source: "network", stale: false };
      } catch (error) {
        if (cached) return { ...cached, source: "stale-cache", stale: true };
        if (error instanceof ReleaseCatalogError && error.code !== "network_status") throw error;
        throw new ReleaseCatalogError("network");
      }
    },
  };
}

function parseArtifact(input: unknown, platform: ReleasePlatform, version: string): ReleaseArtifact {
  const value = asRecord(input, "artifact");
  if (typeof value.url !== "string") throw new ReleaseCatalogError("artifact_url");
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new ReleaseCatalogError("artifact_url");
  }
  const expectedPrefix = `/releases/files/${platform}/${version}/`;
  if (
    url.origin !== RELEASE_CATALOG_ORIGIN
    || !url.pathname.startsWith(expectedPrefix)
    || url.pathname.length <= expectedPrefix.length
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw new ReleaseCatalogError("artifact_url");
  }
  const size = requireNonNegativeInteger(value.size, "artifact_size");
  if (size === 0) throw new ReleaseCatalogError("artifact_size");
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    throw new ReleaseCatalogError("artifact_sha256");
  }
  return { url: url.toString(), size, sha256: value.sha256 };
}

function parseHighlights(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_HIGHLIGHTS) {
    throw new ReleaseCatalogError("highlights");
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > MAX_HIGHLIGHT_LENGTH) {
      throw new ReleaseCatalogError("highlights");
    }
    return item.trim();
  });
}

function requireSemVer(value: unknown, code: string): string {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    throw new ReleaseCatalogError(code);
  }
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new ReleaseCatalogError(code);
  return value;
}

function parseSemVer(value: string): [number, number, number] {
  requireSemVer(value, "version");
  const parts = value.split(".").map(Number);
  return [parts[0], parts[1], parts[2]];
}

function requireNonNegativeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ReleaseCatalogError(code);
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new ReleaseCatalogError("published_at");
  }
  return value;
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseCatalogError(code);
  }
  return value as Record<string, unknown>;
}

function getCacheKey(platform: ReleasePlatform, channel: ReleaseChannel) {
  return `letscube:release-catalog:v1:${platform}:${channel}`;
}

function readCache(
  storage: StorageLike,
  key: string,
  platform: ReleasePlatform,
  channel: ReleaseChannel,
): Pick<ReleaseCatalogSnapshot, "manifest" | "fetchedAt"> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = asRecord(JSON.parse(raw), "cache");
    if (typeof parsed.fetchedAt !== "number" || !Number.isFinite(parsed.fetchedAt)) return null;
    return {
      fetchedAt: parsed.fetchedAt,
      manifest: parseReleaseManifest(parsed.manifest, platform, channel),
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Broken storage must not block a network release check.
    }
    return null;
  }
}

function writeCache(
  storage: StorageLike,
  key: string,
  value: Pick<ReleaseCatalogSnapshot, "manifest" | "fetchedAt">,
) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache failures must not block release checks.
  }
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ReleaseCatalogError("network_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getDefaultStorage(): StorageLike {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}
