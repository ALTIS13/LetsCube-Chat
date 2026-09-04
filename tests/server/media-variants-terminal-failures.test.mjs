import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";

import { createClient } from "@supabase/supabase-js";

// The worker bundle builds its logger at import time; keep it quiet and off the
// pino-pretty worker thread, which would otherwise outlive the test process.
process.env["NODE_ENV"] = "production";
process.env["LOG_LEVEL"] = "silent";

const worker = await import("../../artifacts/api-server/dist/workers/mediaVariantsWorker.mjs");
const rules = await import("../../artifacts/api-server/dist/workers/mediaVariantRules.mjs");

/**
 * D-034: the media variants worker retried work that could never succeed.
 *
 * It keeps no queue. Every tick it re-scans `messages`, and it only ever asked
 * `media_variants` which kinds were *ready*, so a row it had already failed on
 * looked exactly like a row it had never seen. Two live messages whose objects
 * were left behind by the move off the hosted Supabase project were therefore
 * fetched twice a minute forever — 826 warnings in seven hours — and three
 * messages whose stored bytes are a 1x1 PNG with a broken IDAT checksum were
 * re-decoded and re-written to `media_variants` twice a minute with no log at
 * all.
 *
 * These tests drive the real tick against a stubbed backend, because the
 * contract is about the *second* pass: no assertion on a helper alone can show
 * that the candidate loader consults it.
 */

const SUPABASE_URL = "https://storage.invalid";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

/** Exactly what Supabase storage answers for an object that is not there. */
const MISSING_OBJECT_BODY = JSON.stringify({
  statusCode: "404",
  error: "not_found",
  message: "Object not found",
});

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data, breakChecksum = false) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(breakChecksum ? (crc32(typed) ^ 0xdeadbeef) >>> 0 : crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

/**
 * A 1x1 grey PNG, optionally with the IDAT checksum corrupted.
 *
 * Built here rather than copied from production: the three objects that broke
 * the worker are user media. This reproduces only the shape that matters — 68
 * bytes, a valid signature and header, and a checksum libpng refuses.
 */
function onePixelPng({ corrupt } = { corrupt: false }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 4; // grey + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0x00, 0x80, 0xff])), corrupt),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A PostgREST and Storage stand-in that remembers what it was asked.
 *
 * `variants` is the live `media_variants` table: the worker deletes from and
 * inserts into it, and reads it back on the next tick. That round trip is the
 * whole point — a fixture that only replayed canned reads could not tell a
 * worker that records its failures from one that does not.
 */
function createBackend({ message, sourceBody, sourceStatus = 200, uploadStatus = 200 }) {
  const requests = [];
  const variants = [];

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchStub = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    requests.push({ method, path: url.pathname });

    if (url.pathname === "/rest/v1/messages") return json(message ? [message] : []);
    if (url.pathname === "/rest/v1/profiles" || url.pathname === "/rest/v1/chats") return json([]);

    if (url.pathname === "/rest/v1/media_variants") {
      // The filters are applied for real. A fixture that returned every row
      // whatever was asked would go on passing if the worker went back to
      // selecting `status=eq.ready`, which is the line that made D-034
      // permanent — so the one mutation that matters would survive.
      const matches = (row) =>
        [...url.searchParams].every(([column, expression]) => {
          if (column === "select" || column === "order") return true;
          if (expression === "is.null") return row[column] === null || row[column] === undefined;
          if (expression.startsWith("eq.")) return String(row[column]) === expression.slice(3);
          if (expression.startsWith("in.")) {
            return expression
              .slice(4, -1)
              .split(",")
              .map((value) => value.replace(/^"|"$/g, ""))
              .includes(String(row[column]));
          }
          throw new Error(`unstubbed filter ${column}=${expression}`);
        });

      if (method === "GET") return json(variants.filter(matches));
      if (method === "DELETE") {
        for (let i = variants.length - 1; i >= 0; i--) {
          if (matches(variants[i])) variants.splice(i, 1);
        }
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const rows = JSON.parse(init.body);
        for (const row of Array.isArray(rows) ? rows : [rows]) variants.push(row);
        return new Response(null, { status: 201 });
      }
    }

    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (method === "GET") {
        if (sourceStatus === 200) return new Response(sourceBody, { status: 200 });
        // 400 carries the service's own 404; anything else is its own status,
        // which is what tells a gone object from a service having a bad minute.
        const body =
          sourceStatus === 400
            ? MISSING_OBJECT_BODY
            : JSON.stringify({ statusCode: String(sourceStatus), error: "upstream", message: "no" });
        return new Response(body, {
          status: sourceStatus,
          headers: { "content-type": "application/json" },
        });
      }
      return uploadStatus === 200
        ? json({ Key: url.pathname })
        : json({ statusCode: String(uploadStatus), error: "upstream", message: "no" }, uploadStatus);
    }

    throw new Error(`unstubbed ${method} ${url.pathname}`);
  };

  const supabase = createClient(SUPABASE_URL, "anon-key-for-a-stubbed-fetch", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub },
  });

  return {
    supabase,
    variants,
    sourceDownloads: () =>
      requests.filter((r) => r.method === "GET" && r.path.startsWith("/storage/v1/object/")).length,
  };
}

function messageRow(type, path) {
  return {
    id: MESSAGE_ID,
    chat_id: CHAT_ID,
    user_id: USER_ID,
    type,
    media_bucket: "media",
    media_path: path,
    media_url: null,
  };
}

test("a source that storage says is gone is fetched once, not on every tick", async () => {
  const backend = createBackend({
    message: messageRow("video", `${USER_ID}/1778030470210.mp4`),
    sourceStatus: 400, // storage answers a missing object with 400 over a 404 body
  });

  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(backend.sourceDownloads(), 1, "the first tick must try");

  await worker.runMediaVariantsTick(backend.supabase);
  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(
    backend.sourceDownloads(),
    1,
    "a source already proven absent was fetched again — this is D-034",
  );
});

test("the absent source is written down, honestly, once per kind", async () => {
  const backend = createBackend({
    message: messageRow("video", `${USER_ID}/1778030470210.mp4`),
    sourceStatus: 400,
  });

  await worker.runMediaVariantsTick(backend.supabase);
  await worker.runMediaVariantsTick(backend.supabase);

  assert.equal(backend.variants.length, 2, "one row per expected kind, and not one per tick");
  assert.deepEqual(
    backend.variants.map((row) => [row.variant_kind, row.status, row.error_code]).sort(),
    [
      ["video_720p", "failed", "source_missing"],
      ["video_poster", "failed", "source_missing"],
    ],
  );
  const transcode = backend.variants.find((row) => row.variant_kind === "video_720p");
  assert.equal(transcode.mime_type, "video/mp4");
  assert.equal(transcode.variant_path, `variants/messages/${CHAT_ID}/${MESSAGE_ID}/video_720p.mp4`);
  assert.equal(transcode.source_path, `${USER_ID}/1778030470210.mp4`);
});

test("a source whose bytes are not a picture is decoded once, not on every tick", async () => {
  // The three production rows: 68 bytes, a real PNG signature and header, and
  // an IDAT checksum libpng rejects. sharp raises a bare Error with no code, so
  // before the fix this recorded `variant_generation_failed` — retried forever.
  const backend = createBackend({
    message: messageRow("image", `${USER_ID}/1778416018284-corrupt.png`),
    sourceBody: onePixelPng({ corrupt: true }),
  });

  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(backend.sourceDownloads(), 1);
  assert.deepEqual(
    backend.variants.map((row) => row.error_code),
    ["source_unreadable", "source_unreadable"],
  );

  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(
    backend.sourceDownloads(),
    1,
    "bytes already proven undecodable were downloaded and decoded again",
  );
  assert.equal(backend.variants.length, 2, "the failed rows were rewritten on the second tick");
});

test("a picture that decodes is still converted, and is not converted twice", async () => {
  const backend = createBackend({
    message: messageRow("image", `${USER_ID}/1778416018284-fine.png`),
    sourceBody: onePixelPng(),
  });

  await worker.runMediaVariantsTick(backend.supabase);
  assert.deepEqual(
    backend.variants.map((row) => [row.variant_kind, row.status]).sort(),
    [
      ["image_preview", "ready"],
      ["image_thumb", "ready"],
    ],
  );

  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(backend.sourceDownloads(), 1, "a converted message was picked up again");
});

test("a failure that is about the moment is retried on the next tick", async () => {
  // The fix must not turn every failure into a permanent one. A storage 503 is
  // not a fact about the bytes, so nothing is recorded and the next tick tries.
  const backend = createBackend({
    message: messageRow("image", `${USER_ID}/1778416018284-flaky.png`),
    sourceStatus: 503,
  });

  await worker.runMediaVariantsTick(backend.supabase);
  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(backend.sourceDownloads(), 2, "a transient failure must not be given up on");
  assert.equal(backend.variants.length, 0);
});

test("a recorded failure that is not about the bytes is tried again next tick", async () => {
  // The picture decodes; storage refuses the finished variant. That is a
  // failure of this attempt, so it is recorded as one and the worker comes
  // back to it — the fix must not quietly abandon everything it once failed.
  const backend = createBackend({
    message: messageRow("image", `${USER_ID}/1778416018284-fine.png`),
    sourceBody: onePixelPng(),
    uploadStatus: 500,
  });

  await worker.runMediaVariantsTick(backend.supabase);
  assert.deepEqual(
    backend.variants.map((row) => [row.status, row.error_code]),
    [
      ["failed", "variant_generation_failed"],
      ["failed", "variant_generation_failed"],
    ],
  );

  await worker.runMediaVariantsTick(backend.supabase);
  assert.equal(backend.sourceDownloads(), 2, "a retryable failure was treated as terminal");
});

test("a terminal failure recorded against other bytes does not suppress these", () => {
  const source = { bucket: "media", path: "user/current.png" };
  const terminal = {
    status: "failed",
    errorCode: "source_unreadable",
    sourceBucket: "media",
    sourcePath: "user/current.png",
  };

  assert.equal(rules.shouldAttemptVariantKind(undefined, source), true);
  assert.equal(rules.shouldAttemptVariantKind(terminal, source), false);
  // Replaced media: same message, new path, so the recorded verdict is stale.
  assert.equal(
    rules.shouldAttemptVariantKind({ ...terminal, sourcePath: "user/previous.png" }, source),
    true,
  );
  assert.equal(
    rules.shouldAttemptVariantKind({ ...terminal, sourceBucket: "chat-media" }, source),
    true,
  );
  // Not terminal, and therefore not suppressed.
  assert.equal(
    rules.shouldAttemptVariantKind({ ...terminal, errorCode: "etimedout" }, source),
    true,
  );
  assert.equal(
    rules.shouldAttemptVariantKind({ ...terminal, errorCode: "variant_generation_failed" }, source),
    true,
  );
  assert.equal(rules.shouldAttemptVariantKind({ ...terminal, status: "ready" }, source), false);
  assert.equal(rules.shouldAttemptVariantKind({ ...terminal, status: "stale" }, source), true);
});

test("the real client reports a missing object as 400 over 404, and we read both", async () => {
  // Asserted on the wire, not on the source. The worker logged only `status`,
  // so for 826 warnings a gone object was indistinguishable from a bad request.
  const client = createClient(SUPABASE_URL, "anon-key-for-a-stubbed-fetch", {
    global: {
      fetch: async () =>
        new Response(MISSING_OBJECT_BODY, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    },
  });
  const { error } = await client.storage.from("media").download("user/gone.mp4");

  assert.equal(error.name, "StorageApiError");
  assert.equal(error.status, 400);
  assert.equal(error.statusCode, "404");
  assert.equal(rules.isMissingStorageObjectError(error), true);
  assert.equal(
    rules.isMissingStorageObjectError({ name: "StorageApiError", status: 400, statusCode: "400" }),
    false,
    "a genuine bad request must not be mistaken for a missing object",
  );

  const details = rules.mediaVariantWorkerTestSeams.safeStorageFailureDetails(error);
  assert.equal(details.status, 400);
  assert.equal(details.statusCode, "404", "the log still cannot say why the download failed");
});

test("libvips decode failures are told apart from everything else", () => {
  for (const message of [
    "vipspng: libpng read error",
    "Input buffer contains unsupported image format",
    "VipsJpeg: Premature end of JPEG file",
  ]) {
    assert.equal(rules.isUnreadableSourceError(new Error(message)), true, message);
    assert.equal(rules.classifyVariantError(new Error(message)), "source_unreadable", message);
  }
  for (const err of [
    new Error("connect ETIMEDOUT"),
    Object.assign(new Error("spawn ffmpeg"), { code: "ENOENT" }),
    { status: 500 },
  ]) {
    assert.equal(rules.isUnreadableSourceError(err), false);
    assert.notEqual(rules.classifyVariantError(err), "source_unreadable");
  }
  assert.equal(rules.classifyVariantError(Object.assign(new Error("x"), { code: "ENOENT" })), "enoent");
});

test("only the bounded codes can reach the error_code column", () => {
  // Every write goes through this gate, so the terminal codes have to survive
  // it: sanitized away, they would read as retryable and the loop would return.
  for (const code of ["source_missing", "source_unreadable", "enoent", "etimedout"]) {
    assert.equal(rules.sanitizeVariantErrorCode(code), code);
  }
  assert.equal(
    rules.sanitizeVariantErrorCode("user/photo.png missing"),
    "variant_generation_failed",
  );
  assert.deepEqual([...rules.TERMINAL_VARIANT_ERROR_CODES].sort(), [
    "source_missing",
    "source_unreadable",
  ]);
});
