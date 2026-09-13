// The worker is told about work instead of hunting for it (D-176).
//
// Three triggers put a row in `private.media_variant_jobs` the moment a message
// arrives with media or a picture changes, and the worker drains that queue.
// The scan it used to live by is kept as a half-hourly safety net, which is why
// every assertion here drives a tick with `scan: false`: what is being measured
// is the queue path alone, and a tick that also scanned would find the same
// message by the old road and prove nothing about the new one.
//
// The stub throws on any path it was not given, so a worker that stopped
// calling `finish` — or started calling something else — fails here rather than
// passing on a fixture that answers everything.

import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";

import { createClient } from "@supabase/supabase-js";

process.env["NODE_ENV"] = "production";
process.env["LOG_LEVEL"] = process.env.KUB_TEST_LOG ?? "silent";

const worker = await import("../../artifacts/api-server/dist/workers/mediaVariantsWorker.mjs");

const SUPABASE_URL = "https://storage.invalid";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_PATH = `${USER_ID}/1778416018284.png`;

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

/** A grey PNG, built here: only the shape matters. */
function greyPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const row = Buffer.alloc(1 + width, 0x80);
  row[0] = 0x00;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const imageMessage = () => ({
  id: MESSAGE_ID,
  chat_id: CHAT_ID,
  user_id: USER_ID,
  type: "image",
  media_bucket: "media",
  media_path: SOURCE_PATH,
  media_url: null,
});

/** PostgREST, Storage and the queue RPCs, as far as this worker uses them. */
function createBackend({ jobs = [], message = imageMessage(), sourceBody, variants = [] } = {}) {
  const claimed = [];
  const finished = [];
  const retried = [];
  const uploads = [];
  const requests = [];
  const rows = [...variants];
  const queue = [...jobs];

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchStub = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    requests.push({ method, path: url.pathname, search: url.search });
    // Parsed where it is needed, never up front: a storage upload carries bytes
    // rather than JSON, and parsing it here threw inside the stub -- which
    // supabase-js turns into an ordinary upload failure, so the worker recorded
    // a failed variant and every assertion measured the stub bug instead.
    const body = () => JSON.parse(init.body);

    if (url.pathname === "/rest/v1/rpc/media_variant_jobs_claim") {
      const taken = queue.splice(0, body().p_limit);
      claimed.push(...taken);
      return json(taken);
    }
    if (url.pathname === "/rest/v1/rpc/media_variant_job_finish") {
      const finish = body();
      finished.push({ scope: finish.p_scope, target_id: finish.p_target_id });
      return json(true);
    }
    if (url.pathname === "/rest/v1/rpc/media_variant_job_retry") {
      const retry = body();
      retried.push({ scope: retry.p_scope, target_id: retry.p_target_id, error: retry.p_error });
      return json(true);
    }

    if (url.pathname === "/rest/v1/messages") {
      const wanted = url.searchParams.get("id");
      const match = message && (!wanted || wanted === `eq.${message.id}`) ? [message] : [];
      return json(match);
    }
    if (url.pathname === "/rest/v1/profiles" || url.pathname === "/rest/v1/chats") return json([]);

    if (url.pathname === "/rest/v1/media_variants") {
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
      if (method === "GET") return json(rows.filter(matches));
      if (method === "DELETE") {
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1);
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const inserted = body();
        for (const row of Array.isArray(inserted) ? inserted : [inserted]) rows.push(row);
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

  return {
    supabase: createClient(SUPABASE_URL, "anon-key-for-a-stubbed-fetch", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub },
    }),
    claimed,
    finished,
    retried,
    uploads,
    rows,
    requests,
    sourceDownloads: () =>
      requests.filter((r) => r.method === "GET" && r.path.startsWith("/storage/v1/object/")).length,
  };
}

const messageJob = () => ({ scope: "message", target_id: MESSAGE_ID, attempts: 0 });

test("a queued message is worked on without any scan, and leaves the queue", async () => {
  const backend = createBackend({ jobs: [messageJob()], sourceBody: greyPng(640, 480) });

  await worker.runMediaVariantsTick(backend.supabase, { scan: false });

  assert.equal(backend.claimed.length, 1, "the job was claimed");
  assert.equal(backend.sourceDownloads(), 1, "the source was read once");
  assert.equal(backend.uploads.length, 2, "both image variants were made");
  assert.deepEqual(backend.finished, [{ scope: "message", target_id: MESSAGE_ID }]);
  assert.deepEqual(backend.retried, [], "a job that succeeded is not rescheduled");
});

test("the drain does not scan, which is the whole point of the queue", async () => {
  const backend = createBackend({ jobs: [messageJob()], sourceBody: greyPng(640, 480) });

  await worker.runMediaVariantsTick(backend.supabase, { scan: false });

  // The scan is a ranged, ordered read of the newest media messages; the queue
  // path reads one message by its id. Telling them apart by the query is what
  // keeps this test honest — both hit `/rest/v1/messages`.
  const messageReads = backend.requests.filter((r) => r.path === "/rest/v1/messages");
  assert.ok(messageReads.length > 0, "the job's own message is still read");
  for (const read of messageReads) {
    assert.ok(read.search.includes(`id=eq.${MESSAGE_ID}`), `a scan-shaped read leaked in: ${read.search}`);
  }
  assert.equal(
    backend.requests.filter((r) => r.path === "/rest/v1/profiles" || r.path === "/rest/v1/chats").length,
    0,
    "the avatar scans did not run either",
  );
});

test("a job whose message has gone settles rather than retrying five times", async () => {
  const backend = createBackend({ jobs: [messageJob()], message: null, sourceBody: greyPng(64, 64) });

  await worker.runMediaVariantsTick(backend.supabase, { scan: false });

  assert.deepEqual(backend.finished, [{ scope: "message", target_id: MESSAGE_ID }]);
  assert.equal(backend.sourceDownloads(), 0, "nothing was fetched for a message that is not there");
});

test("a job whose work is already done settles without touching storage", async () => {
  const ready = (kind) => ({
    message_id: MESSAGE_ID,
    chat_id: CHAT_ID,
    profile_id: null,
    variant_kind: kind,
    status: "ready",
    error_code: null,
    source_bucket: "media",
    source_path: SOURCE_PATH,
    width: 1,
    height: 1,
  });
  const backend = createBackend({
    jobs: [messageJob()],
    sourceBody: greyPng(64, 64),
    variants: [ready("image_thumb"), ready("image_preview")],
  });

  await worker.runMediaVariantsTick(backend.supabase, { scan: false });

  assert.equal(backend.sourceDownloads(), 0);
  assert.equal(backend.uploads.length, 0);
  assert.deepEqual(backend.finished, [{ scope: "message", target_id: MESSAGE_ID }]);
});

test("a database with no queue is an empty queue, not a crash", async () => {
  // The worker and the migration deploy separately, in either order. A missing
  // function has to be a quiet nothing, because the scan still finds the work.
  const backend = createBackend({ jobs: [], sourceBody: greyPng(64, 64) });
  const supabase = backend.supabase;
  const original = supabase.rpc.bind(supabase);
  supabase.rpc = async (name, args) =>
    name === "media_variant_jobs_claim"
      ? { data: null, error: { message: "function does not exist", code: "42883" } }
      : original(name, args);

  await worker.runMediaVariantsTick(supabase, { scan: false });

  assert.equal(backend.sourceDownloads(), 0);
  assert.deepEqual(backend.finished, []);
});

test("a job that fails is rescheduled with a bounded error code", async () => {
  // Storage refuses the read: not a terminal condition, so the job stays in the
  // queue with a backoff rather than being dropped.
  const backend = createBackend({ jobs: [messageJob()], sourceBody: greyPng(64, 64) });
  const supabase = backend.supabase;
  const storage = supabase.storage.from("media");
  storage.download = async () => {
    throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
  };
  supabase.storage.from = () => storage;

  await worker.runMediaVariantsTick(supabase, { scan: false });

  assert.equal(backend.finished.length, 0, "a failure does not settle the job");
  assert.equal(backend.retried.length, 1);
  assert.equal(backend.retried[0].target_id, MESSAGE_ID);
  assert.match(backend.retried[0].error, /^[a-z][a-z0-9_]{0,63}$/, "the error code is bounded");
});
