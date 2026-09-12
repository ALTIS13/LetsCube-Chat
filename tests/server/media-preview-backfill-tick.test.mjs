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
 * The backfill's premise: marking a preview `stale` makes the worker redo it.
 *
 * `scripts/media-preview-backfill.mjs` writes nothing but that status flip, so
 * the entire design rests on the worker treating a stale row as work. Nothing
 * in the worker mentions `stale` by name — it falls out of
 * `shouldAttemptVariantKind`, which attempts anything that is neither `ready`
 * nor a terminal `failed` — and a behaviour nobody wrote down is a behaviour
 * that can be removed without noticing.
 *
 * So this drives the real tick against a stubbed backend rather than asserting
 * on the helper: the helper is only right if the candidate loader consults it.
 */

const SUPABASE_URL = "https://storage.invalid";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

/** A tall source, in the proportions that made the owner complain: 1080x2341. */
const SOURCE_WIDTH = 1080;
const SOURCE_HEIGHT = 2341;

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

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

/**
 * A grey PNG of a given size, built here rather than taken from production.
 *
 * The pictures this backfill is for are user media. Only the shape matters, so
 * this reproduces the shape and nothing else.
 */
function greyPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const row = Buffer.alloc(1 + width, 0x80);
  row[0] = 0x00; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PostgREST and Storage stand-in whose `media_variants` is a live table. */
function createBackend({ message, sourceBody, seedVariants = [] }) {
  const requests = [];
  const variants = [...seedVariants];
  const uploads = [];

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
      // The filters are applied for real, so a worker that stopped consulting
      // the recorded status would fail here rather than pass on a fixture that
      // returns everything whatever it is asked.
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
      if (method === "GET") return new Response(sourceBody, { status: 200 });
      uploads.push(url.pathname);
      return json({ Key: url.pathname });
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
    uploads,
    sourceDownloads: () =>
      requests.filter((r) => r.method === "GET" && r.path.startsWith("/storage/v1/object/")).length,
  };
}

function imageMessage() {
  return {
    id: MESSAGE_ID,
    chat_id: CHAT_ID,
    user_id: USER_ID,
    type: "image",
    media_bucket: "media",
    media_path: `${USER_ID}/1778416018284.png`,
    media_url: null,
  };
}

function variantRow(kind, status, width, height) {
  return {
    message_id: MESSAGE_ID,
    chat_id: CHAT_ID,
    profile_id: null,
    variant_kind: kind,
    status,
    error_code: null,
    source_bucket: "media",
    source_path: `${USER_ID}/1778416018284.png`,
    width,
    height,
  };
}

test("a preview marked stale is regenerated at the new size, and the thumb is left alone", async () => {
  // The row as the old rule left it: 1080x2341 capped on the long side alone.
  const backend = createBackend({
    message: imageMessage(),
    sourceBody: greyPng(SOURCE_WIDTH, SOURCE_HEIGHT),
    seedVariants: [
      variantRow("image_preview", "stale", 591, 1280),
      variantRow("image_thumb", "ready", 166, 360),
    ],
  });

  await worker.runMediaVariantsTick(backend.supabase);

  const previews = backend.variants.filter((row) => row.variant_kind === "image_preview");
  assert.equal(previews.length, 1, "the stale row is replaced, not added to");
  assert.equal(previews[0].status, "ready");

  const wanted = rules.imagePreviewSize(SOURCE_WIDTH, SOURCE_HEIGHT, 1280);
  assert.deepEqual(
    { width: previews[0].width, height: previews[0].height },
    wanted,
    "the backfilled preview must be the size the worker's own rule asks for",
  );
  assert.deepEqual(wanted, { width: 720, height: 1561 }, "which is the D-116 size, not 591x1280");

  // The thumb was already ready and its rule did not change, so re-doing it
  // would be pure cost. Only the preview is rewritten.
  assert.deepEqual(
    backend.uploads,
    [`/storage/v1/object/media/variants/messages/${CHAT_ID}/${MESSAGE_ID}/image_preview.webp`],
    "only the preview is uploaded, and to the address it already had",
  );
});

test("the backfilled preview settles: a second tick does nothing", async () => {
  // Idempotence at the worker end. Once the row is `ready` again the message
  // leaves the candidate set, so a backfill that is interrupted and re-run
  // cannot put the same picture through twice.
  const backend = createBackend({
    message: imageMessage(),
    sourceBody: greyPng(SOURCE_WIDTH, SOURCE_HEIGHT),
    seedVariants: [
      variantRow("image_preview", "stale", 591, 1280),
      variantRow("image_thumb", "ready", 166, 360),
    ],
  });

  await worker.runMediaVariantsTick(backend.supabase);
  const afterFirst = backend.sourceDownloads();
  await worker.runMediaVariantsTick(backend.supabase);

  assert.equal(afterFirst, 1, "the first tick reads the original once");
  assert.equal(backend.sourceDownloads(), 1, "the second tick must not read it again");
  assert.equal(backend.uploads.length, 1, "and must not rewrite the variant");
});

test("an untouched ready preview is not regenerated", async () => {
  // The control. If the worker redid ready rows there would be no defect to
  // fix and no need for a backfill, so this is what makes the test above mean
  // what it says.
  const backend = createBackend({
    message: imageMessage(),
    sourceBody: greyPng(SOURCE_WIDTH, SOURCE_HEIGHT),
    seedVariants: [
      variantRow("image_preview", "ready", 591, 1280),
      variantRow("image_thumb", "ready", 166, 360),
    ],
  });

  await worker.runMediaVariantsTick(backend.supabase);

  assert.equal(backend.sourceDownloads(), 0, "nothing was due, so nothing was fetched");
  assert.equal(backend.uploads.length, 0);
  const preview = backend.variants.find((row) => row.variant_kind === "image_preview");
  assert.deepEqual({ width: preview.width, height: preview.height }, { width: 591, height: 1280 });
});
