// D-103, the worker half. A message deleted for everyone has its row cleared by
// `20260928210000_deleted_message_keeps_nothing.sql`, and what it pointed at in
// storage is queued; this worker removes those files through the Storage API.
// The database decides what may go. These tests pin what the worker does with
// what it is handed: one request per bucket, the stored path turned back into
// the one Storage knows, and every file's outcome reported, including the ones
// Storage refused.

import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

process.env["NODE_ENV"] = "production";
process.env["LOG_LEVEL"] = process.env.KUB_TEST_LOG ?? "silent";

const worker = await import("../../artifacts/api-server/dist/workers/mediaPurgeWorker.mjs");

const USER = "33333333-3333-4333-8333-333333333333";

function fakeBackend(items, { refuse = new Set() } = {}) {
  const removed = [];
  const finished = [];
  return {
    removed,
    finished,
    backend: {
      async claim(limit) {
        return items.slice(0, limit);
      },
      async remove(bucket, paths) {
        removed.push({ bucket, paths });
        return { error: refuse.has(bucket) ? "storage said no" : null };
      },
      async finish(id, error) {
        finished.push({ id, error });
      },
    },
  };
}

test("one request per bucket, and every file's outcome is reported", async () => {
  const { backend, removed, finished } = fakeBackend([
    { id: "a", bucket: "media", path: `${USER}/photo.jpg` },
    { id: "b", bucket: "media", path: `${USER}/photo.preview.webp` },
    { id: "c", bucket: "chat-media", path: `${USER}/old.png` },
  ]);
  const result = await worker.runMediaPurgeTick(backend);
  assert.deepEqual(result, { claimed: 3, removed: 3, failed: 0 });
  assert.deepEqual(removed, [
    { bucket: "media", paths: [`${USER}/photo.jpg`, `${USER}/photo.preview.webp`] },
    { bucket: "chat-media", paths: [`${USER}/old.png`] },
  ]);
  assert.deepEqual(finished, [
    { id: "a", error: null },
    { id: "b", error: null },
    { id: "c", error: null },
  ]);
});

test("a refused bucket reports its refusal on each of its files and does not hold the others back", async () => {
  const { backend, finished } = fakeBackend(
    [
      { id: "a", bucket: "media", path: `${USER}/one.jpg` },
      { id: "b", bucket: "chat-media", path: `${USER}/two.jpg` },
    ],
    { refuse: new Set(["media"]) },
  );
  const result = await worker.runMediaPurgeTick(backend);
  assert.deepEqual(result, { claimed: 2, removed: 1, failed: 1 });
  assert.deepEqual(finished, [
    { id: "a", error: "storage said no" },
    { id: "b", error: null },
  ]);
});

test("a path kept from an old public URL is decoded before Storage is asked", () => {
  // Rows older than `media_path` kept only the URL, whose tail is encoded.
  assert.equal(worker.storagePath(`${USER}/%D1%84%D0%BE%D1%82%D0%BE%201.jpg`), `${USER}/фото 1.jpg`);
  assert.equal(worker.storagePath(`${USER}/plain.jpg`), `${USER}/plain.jpg`);
  // A broken escape is left as it is rather than thrown on.
  assert.equal(worker.storagePath(`${USER}/100%.jpg`), `${USER}/100%.jpg`);
});

test("nothing claimed is nothing asked", async () => {
  const { backend, removed, finished } = fakeBackend([]);
  assert.deepEqual(await worker.runMediaPurgeTick(backend), { claimed: 0, removed: 0, failed: 0 });
  assert.equal(removed.length, 0);
  assert.equal(finished.length, 0);
});

test("the running backend speaks the two functions and Storage's own remove", async () => {
  const requests = [];
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetchStub = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/rest/v1/rpc/message_media_purge_claim") {
      return json([
        { id: "q1", bucket: "media", path: `${USER}/a.jpg` },
        { id: "q2", bucket: "media", path: `${USER}/a.preview.webp` },
      ]);
    }
    if (url.pathname === "/storage/v1/object/media" && method === "DELETE") {
      return json([{ name: `${USER}/a.jpg` }]);
    }
    if (url.pathname === "/rest/v1/rpc/message_media_purge_finish") return json(null);
    throw new Error(`unstubbed ${method} ${url.pathname}`);
  };
  const supabase = createClient("https://storage.invalid", "anon-key-for-a-stubbed-fetch", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub },
  });
  const result = await worker.runMediaPurgeTick(worker.supabaseMediaPurgeBackend(supabase), 7);
  assert.deepEqual(result, { claimed: 2, removed: 2, failed: 0 });
  assert.deepEqual(requests[0], { method: "POST", path: "/rest/v1/rpc/message_media_purge_claim", body: { p_limit: 7 } });
  assert.deepEqual(requests[1], {
    method: "DELETE",
    path: "/storage/v1/object/media",
    body: { prefixes: [`${USER}/a.jpg`, `${USER}/a.preview.webp`] },
  });
  assert.deepEqual(
    requests.slice(2).map((request) => request.body),
    [
      { p_id: "q1", p_error: null },
      { p_id: "q2", p_error: null },
    ],
  );
});
