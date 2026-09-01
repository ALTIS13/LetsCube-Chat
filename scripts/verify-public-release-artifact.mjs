#!/usr/bin/env node
/**
 * Verifies that a published release artifact really is what its manifest says.
 *
 * The public home turns a manifest into a download link that anyone can click
 * without logging in. A manifest is only metadata, so agreeing with itself
 * proves nothing: this streams the actual bytes, counts them, hashes them, and
 * refuses the release unless both the byte count and the SHA-256 equal what the
 * manifest declared.
 *
 * Nothing is written to disk. The body is hashed as it arrives and discarded,
 * so a wrong or hostile Content-Length cannot fill the machine.
 *
 * Usage:
 *   node scripts/verify-public-release-artifact.mjs windows
 *   node scripts/verify-public-release-artifact.mjs windows android
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const RELEASE_CATALOG_ORIGIN = "https://api.letscube.ru";
export const MANIFEST_PATH = (platform, channel = "stable") =>
  `/releases/v1/${platform}/${channel}.json`;

/** Nothing LETSCUBE publishes is anywhere near this; it exists to bound the stream. */
export const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class ArtifactVerificationError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ArtifactVerificationError";
    this.code = code;
  }
}

/**
 * The artifact URL must be inside this platform and version's own directory on
 * the catalog origin. A redirect target or a neighbouring version is refused.
 */
export function assertArtifactUrl(rawUrl, platform, version) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ArtifactVerificationError("artifact_url", "not a URL");
  }

  const prefix = `/releases/files/${platform}/${version}/`;
  if (url.origin !== RELEASE_CATALOG_ORIGIN) {
    throw new ArtifactVerificationError("artifact_origin", url.origin);
  }
  if (!url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length) {
    throw new ArtifactVerificationError("artifact_path", url.pathname);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new ArtifactVerificationError("artifact_url", "carries a query, fragment or credentials");
  }
  return url;
}

/** The subset of the manifest a public download depends on. */
export function assertPublishableManifest(manifest, platform) {
  if (!manifest || typeof manifest !== "object") {
    throw new ArtifactVerificationError("manifest", "not an object");
  }
  if (manifest.schemaVersion !== 1) {
    throw new ArtifactVerificationError("manifest_schema", String(manifest.schemaVersion));
  }
  if (manifest.platform !== platform) {
    throw new ArtifactVerificationError("manifest_platform", String(manifest.platform));
  }
  if (manifest.channel !== "stable") {
    throw new ArtifactVerificationError("manifest_channel", String(manifest.channel));
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    throw new ArtifactVerificationError("manifest_version", String(manifest.version));
  }

  // A platform with nothing released is a valid state, not a failure. It simply
  // has no artifact to verify.
  if (manifest.available !== true) return { available: false, manifest };

  const artifact = manifest.artifact;
  if (!artifact || typeof artifact !== "object") {
    throw new ArtifactVerificationError("artifact_missing", "available release without an artifact");
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new ArtifactVerificationError("artifact_size", String(artifact.size));
  }
  if (artifact.size > MAX_ARTIFACT_BYTES) {
    throw new ArtifactVerificationError("artifact_size", `${artifact.size} exceeds the bound`);
  }
  if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
    throw new ArtifactVerificationError("artifact_sha256", String(artifact.sha256));
  }

  assertArtifactUrl(artifact.url, platform, manifest.version);
  return { available: true, manifest };
}

/**
 * Streams the artifact and returns its real size and digest.
 *
 * `fetchImpl` is injected so the contract can be tested without the network.
 */
export async function measureArtifact(url, { fetchImpl = fetch, maxBytes = MAX_ARTIFACT_BYTES } = {}) {
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response.ok) {
    throw new ArtifactVerificationError("artifact_http", String(response.status));
  }
  if (!response.body) {
    throw new ArtifactVerificationError("artifact_body", "no stream");
  }

  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength ?? chunk.length;
    if (size > maxBytes) {
      throw new ArtifactVerificationError("artifact_size", `stream exceeded ${maxBytes} bytes`);
    }
    hash.update(chunk);
  }

  return { size, sha256: hash.digest("hex") };
}

/** Verifies one platform end to end. Returns a result rather than throwing on mismatch. */
export async function verifyPlatform(platform, { fetchImpl = fetch, channel = "stable" } = {}) {
  const manifestUrl = `${RELEASE_CATALOG_ORIGIN}${MANIFEST_PATH(platform, channel)}`;
  const response = await fetchImpl(manifestUrl, { redirect: "error" });

  if (response.status === 404) {
    // No manifest published for this platform yet.
    return { platform, state: "unpublished", manifestUrl };
  }
  if (!response.ok) {
    throw new ArtifactVerificationError("manifest_http", `${platform} ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ArtifactVerificationError("manifest_content_type", contentType || "missing");
  }

  const { available, manifest } = assertPublishableManifest(await response.json(), platform);
  if (!available) {
    return { platform, state: "unavailable", version: manifest.version, manifestUrl };
  }

  const measured = await measureArtifact(manifest.artifact.url, { fetchImpl });
  const sizeMatches = measured.size === manifest.artifact.size;
  const digestMatches = measured.sha256 === manifest.artifact.sha256;

  return {
    platform,
    state: sizeMatches && digestMatches ? "verified" : "mismatch",
    version: manifest.version,
    url: manifest.artifact.url,
    declared: { size: manifest.artifact.size, sha256: manifest.artifact.sha256 },
    measured,
    manifestUrl,
  };
}

async function main(platforms) {
  if (platforms.length === 0) {
    process.stderr.write("usage: node scripts/verify-public-release-artifact.mjs <platform...>\n");
    process.exitCode = 2;
    return;
  }

  let failed = false;
  for (const platform of platforms) {
    try {
      const result = await verifyPlatform(platform);
      if (result.state === "verified") {
        process.stdout.write(
          `${platform} ${result.version}: verified ${result.measured.size} bytes, sha256 ${result.measured.sha256}\n`,
        );
      } else if (result.state === "mismatch") {
        failed = true;
        process.stdout.write(
          `${platform} ${result.version}: MISMATCH\n`
            + `  declared ${result.declared.size} bytes sha256 ${result.declared.sha256}\n`
            + `  measured ${result.measured.size} bytes sha256 ${result.measured.sha256}\n`,
        );
      } else {
        process.stdout.write(`${platform}: ${result.state}, nothing to verify\n`);
      }
    } catch (error) {
      failed = true;
      process.stdout.write(`${platform}: FAILED ${error instanceof Error ? error.message : error}\n`);
    }
  }

  process.exitCode = failed ? 1 : 0;
}

// Only run when invoked directly, so the module can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
