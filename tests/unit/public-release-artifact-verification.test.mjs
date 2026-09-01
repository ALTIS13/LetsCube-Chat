import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ArtifactVerificationError,
  assertArtifactUrl,
  assertPublishableManifest,
  measureArtifact,
  verifyPlatform,
} from "../../scripts/verify-public-release-artifact.mjs";

/**
 * The public home turns a manifest into a download anyone can click without
 * logging in. A manifest agreeing with itself proves nothing, so these cover the
 * cases where the metadata and the actual bytes disagree.
 */

const BYTES = Buffer.from("LETSCUBE installer payload", "utf8");
const DIGEST = createHash("sha256").update(BYTES).digest("hex");
const ARTIFACT_URL = "https://api.letscube.ru/releases/files/windows/0.2.10/LETSCUBE-Setup.exe";

function manifest({ artifact, ...overrides } = {}) {
  const base = {
    schemaVersion: 1,
    platform: "windows",
    channel: "stable",
    available: true,
    version: "0.2.10",
    build: 14,
    publishedAt: "2026-08-31T09:00:00.000Z",
    minimumSupportedVersion: null,
    mandatory: false,
    notes: "",
    highlights: [],
    ...overrides,
  };
  // `artifact: null` is a meaningful override, so only merge when it is an object.
  base.artifact = artifact === null
    ? null
    : { url: ARTIFACT_URL, size: BYTES.byteLength, sha256: DIGEST, ...artifact };
  return base;
}

function response({ status = 200, contentType = "application/json", json, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => json,
    body: body === undefined ? undefined : (async function* stream() {
      for (const chunk of body) yield chunk;
    })(),
  };
}

/** A fetch that serves one manifest and one artifact body. */
function fakeFetch({ manifestJson, artifactChunks = [BYTES], manifestStatus = 200, contentType, artifactStatus = 200 }) {
  return async (url) => {
    if (String(url).includes("/releases/v1/")) {
      return response({ status: manifestStatus, contentType, json: manifestJson });
    }
    return response({ status: artifactStatus, contentType: "application/octet-stream", body: artifactChunks });
  };
}

test("an artifact whose bytes match its manifest is verified", async () => {
  const result = await verifyPlatform("windows", { fetchImpl: fakeFetch({ manifestJson: manifest() }) });

  assert.equal(result.state, "verified");
  assert.equal(result.measured.size, BYTES.byteLength);
  assert.equal(result.measured.sha256, DIGEST);
});

test("a byte count that disagrees with the manifest is a mismatch, not a pass", async () => {
  const result = await verifyPlatform("windows", {
    fetchImpl: fakeFetch({ manifestJson: manifest({ artifact: { size: BYTES.byteLength + 1 } }) }),
  });

  assert.equal(result.state, "mismatch");
  assert.equal(result.declared.size, BYTES.byteLength + 1);
  assert.equal(result.measured.size, BYTES.byteLength);
});

test("a digest that disagrees with the manifest is a mismatch", async () => {
  const result = await verifyPlatform("windows", {
    fetchImpl: fakeFetch({ manifestJson: manifest({ artifact: { sha256: "b".repeat(64) } }) }),
  });

  assert.equal(result.state, "mismatch");
  assert.equal(result.measured.sha256, DIGEST);
});

test("the same bytes served in many chunks still hash to the same digest", async () => {
  const chunks = [BYTES.subarray(0, 5), BYTES.subarray(5, 11), BYTES.subarray(11)];
  const result = await verifyPlatform("windows", {
    fetchImpl: fakeFetch({ manifestJson: manifest(), artifactChunks: chunks }),
  });

  assert.equal(result.state, "verified");
});

test("a platform with nothing released is not a failure", async () => {
  const result = await verifyPlatform("macos", {
    fetchImpl: fakeFetch({
      manifestJson: manifest({ platform: "macos", available: false, artifact: null }),
    }),
  });

  assert.equal(result.state, "unavailable");
});

test("a platform with no manifest at all is not a failure", async () => {
  const result = await verifyPlatform("ios", {
    fetchImpl: fakeFetch({ manifestJson: null, manifestStatus: 404 }),
  });

  assert.equal(result.state, "unpublished");
});

test("a manifest that is not served as JSON is refused", async () => {
  await assert.rejects(
    () => verifyPlatform("windows", {
      fetchImpl: fakeFetch({ manifestJson: manifest(), contentType: "text/html" }),
    }),
    (error) => error instanceof ArtifactVerificationError && error.code === "manifest_content_type",
  );
});

test("an available release without an artifact is refused", async () => {
  assert.throws(
    () => assertPublishableManifest({ ...manifest(), artifact: null }, "windows"),
    (error) => error.code === "artifact_missing",
  );
});

test("the artifact must live on the catalog origin, under its own platform and version", () => {
  const cases = [
    ["https://cdn.example.com/releases/files/windows/0.2.10/setup.exe", "artifact_origin"],
    ["https://api.letscube.ru/releases/files/android/0.2.10/setup.exe", "artifact_path"],
    ["https://api.letscube.ru/releases/files/windows/0.2.9/setup.exe", "artifact_path"],
    // The directory itself is not a file.
    ["https://api.letscube.ru/releases/files/windows/0.2.10/", "artifact_path"],
    ["https://api.letscube.ru/releases/files/windows/0.2.10/setup.exe?token=x", "artifact_url"],
    ["https://api.letscube.ru/releases/files/windows/0.2.10/setup.exe#frag", "artifact_url"],
    ["https://user:pass@api.letscube.ru/releases/files/windows/0.2.10/setup.exe", "artifact_url"],
    ["http://api.letscube.ru/releases/files/windows/0.2.10/setup.exe", "artifact_origin"],
    ["not a url", "artifact_url"],
  ];

  for (const [url, code] of cases) {
    assert.throws(
      () => assertArtifactUrl(url, "windows", "0.2.10"),
      (error) => error.code === code,
      `${url} should be refused as ${code}`,
    );
  }
});

test("a manifest for another platform, channel or schema is refused", () => {
  const cases = [
    [{ platform: "android" }, "manifest_platform"],
    [{ channel: "test" }, "manifest_channel"],
    [{ schemaVersion: 2 }, "manifest_schema"],
    [{ version: "0.2" }, "manifest_version"],
  ];

  for (const [overrides, code] of cases) {
    assert.throws(
      () => assertPublishableManifest(manifest(overrides), "windows"),
      (error) => error.code === code,
      `${JSON.stringify(overrides)} should be refused as ${code}`,
    );
  }
});

test("a stream longer than the bound is abandoned rather than consumed", async () => {
  const chunks = [Buffer.alloc(64), Buffer.alloc(64)];
  await assert.rejects(
    () => measureArtifact(ARTIFACT_URL, {
      maxBytes: 100,
      fetchImpl: async () => response({ contentType: "application/octet-stream", body: chunks }),
    }),
    (error) => error instanceof ArtifactVerificationError && error.code === "artifact_size",
  );
});

test("an artifact the server refuses to serve is an error, not a silent pass", async () => {
  await assert.rejects(
    () => measureArtifact(ARTIFACT_URL, {
      fetchImpl: async () => response({ status: 403, contentType: "text/plain", body: [] }),
    }),
    (error) => error instanceof ArtifactVerificationError && error.code === "artifact_http",
  );
});
