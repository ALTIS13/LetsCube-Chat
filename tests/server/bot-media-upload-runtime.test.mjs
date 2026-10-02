import assert from "node:assert/strict";
import test from "node:test";
import { postgres, read, quote, bot, token, chat } from "./bot-inline-media-ingest.fixture.mjs";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";

// Real handlers/repository/RPCs; only provider I/O is simulated. No production access.
const migration = "supabase/migrations/20261002155123_bot_media_upload_intents.sql";
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=", "base64");
const context = { bot: { botId: bot, tokenId: token }, requestId: "fictional-intent-integration" };
const input = { chat_id: chat, photo: { mime_type: "image/png", bytes_base64: bytes.toString("base64") },
  idempotency_key: "runtime-pg-intent-0001" };
const allowed = new Set(["bot_media_ingest_reserve_internal", "bot_media_ingest_commit_internal",
  "bot_media_upload_begin_internal", "bot_media_upload_finish_internal"]);

async function fixture(t, initialMode = "ok") {
  const db = await postgres(t);
  await db.exec(read(migration));
  const control = { mode: initialMode, uploads: 0, downloads: 0, calls: [] };
  const repository = createBotMethodRepository({
    async rpc(name, args) {
      assert.ok(allowed.has(name)); control.calls.push(name);
      const parameters = Object.entries(args).map(([key, value]) => {
        assert.match(key, /^p_[a-z0-9_]+$/);
        return key + " => " + quote(typeof value === "object" ? JSON.stringify(value) : value);
      }).join(",");
      let result;
      try { result = (await db.service("select public." + name + "(" + parameters + ") as value")).value; }
      catch (error) {
        return { data: null, error: { code: error.code,
          message: error.message.match(/ERROR:\s+[A-Z0-9]{5}:\s+([^\r\n]*)/)?.[1] ?? "fixture SQL error" } };
      }
      if (control.mode === "lost-begin" && name === "bot_media_upload_begin_internal") throw new Error("fictional lost admission reply");
      if (control.mode === "lost-finish" && name === "bot_media_upload_finish_internal") throw new Error("fictional lost outcome reply");
      return { data: result, error: null };
    },
    storage: { from(bucket) {
      assert.equal(bucket, "chat-media");
      return {
        async upload(path, body, options) {
          control.uploads++;
          assert.deepEqual(body, bytes); assert.deepEqual(options, { contentType: "image/png", upsert: false });
          // Prove that the SQL row is durably visible before provider I/O.
          const [attempt] = await db.query("select state,byte_size::int,content_sha256 from private.bot_media_upload_attempts order by started_at desc limit 1");
          assert.deepEqual(attempt, { state: "pending", byte_size: 68,
            content_sha256: "1206f9d3b441f79f05d47c2d722c11236e11769101efadde7c24083e3fa18ab5" });
          const [existing] = await db.query("select count(*)::int as n from storage.objects where bucket_id='chat-media' and name=" + quote(path));
          if (existing.n) return { data: null, error: { status: 409, statusCode: "ResourceAlreadyExists" } };
          await db.exec("insert into storage.objects(bucket_id,name,metadata) values ('chat-media'," + quote(path) + ",' {\"mimetype\":\"image/png\",\"size\":68}'::jsonb)");
          if (control.mode === "uncertain-put") throw new Error("fictional reply lost after provider wrote bytes");
          if (control.mode === "revoke-token") await db.exec("update private.bot_tokens set revoked_at=now() where id=" + quote(token));
          return { data: { path }, error: null };
        },
        download() {
          control.downloads++;
          return { asStream: async () => ({ data: new ReadableStream({ start(controller) {
            controller.enqueue(bytes); controller.close();
          } }), error: null }) };
        },
        remove() { assert.fail("provider removal is out of scope"); },
      };
    } },
  });
  const handlers = createMessageHandlers(repository, () => "a".repeat(64), async () => {});
  const send = () => handlers.sendPhoto(context, input);
  const snapshot = async () => {
    const [counts] = await db.query("select (select count(*)::int from public.messages) as messages," +
      "(select count(*)::int from storage.objects) as objects,(select count(*)::int from private.bot_media_ingests) as receipts," +
      "(select sum(byte_size)::int from private.bot_media_ingests) as charged_bytes");
    return { counts, attempts: await db.query("select state from private.bot_media_upload_attempts order by started_at"),
      receipts: await db.query("select state,result,created_at from private.bot_media_ingests") };
  };
  return { db, control, send, snapshot };
}

test("real RPC envelope commits one photo and completed retry skips intent and provider", async t => {
  const f = await fixture(t);
  const result = await f.send(); const before = await f.snapshot();
  assert.deepEqual(await f.send(), result); const after = await f.snapshot();
  assert.deepEqual(after, before);
  assert.deepEqual(after.counts, { messages: 1, objects: 1, receipts: 1, charged_bytes: 68 });
  assert.deepEqual(after.attempts, [{ state: "acknowledged" }]);
  assert.equal(f.control.uploads, 1);
  assert.deepEqual(f.control.calls, ["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
    "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal", "bot_media_ingest_reserve_internal"]);
});

test("uncertain old PUT remains a hold after a verified duplicate retry on another lease", async t => {
  const f = await fixture(t, "uncertain-put");
  await assert.rejects(f.send, /internal_error/);
  const before = await f.snapshot();
  assert.deepEqual(before.counts, { messages: 0, objects: 1, receipts: 1, charged_bytes: 68 });
  assert.deepEqual(before.attempts, [{ state: "unknown" }]);
  await f.db.exec("update private.bot_media_ingests set lease_expires_at=now()-interval '1 second'");
  f.control.mode = "ok"; await f.send(); const after = await f.snapshot();
  assert.deepEqual(after.attempts, [{ state: "unknown" }, { state: "acknowledged" }]);
  assert.equal(after.receipts[0].created_at, before.receipts[0].created_at);
  assert.deepEqual(after.counts, { messages: 1, objects: 1, receipts: 1, charged_bytes: 68 });
  assert.equal(f.control.downloads, 1);
});

test("lost begin response leaves a pending hold but no object or message", async t => {
  const f = await fixture(t, "lost-begin"); await assert.rejects(f.send, /internal_error/);
  const value = await f.snapshot();
  assert.deepEqual(value.attempts, [{ state: "pending" }]);
  assert.deepEqual(value.counts, { messages: 0, objects: 0, receipts: 1, charged_bytes: 68 });
  assert.equal(f.control.uploads, 0);
});

test("lost finish response preserves acknowledgement but never commits a message", async t => {
  const f = await fixture(t, "lost-finish"); await assert.rejects(f.send, /internal_error/);
  const value = await f.snapshot();
  assert.deepEqual(value.attempts, [{ state: "acknowledged" }]);
  assert.deepEqual(value.counts, { messages: 0, objects: 1, receipts: 1, charged_bytes: 68 });
  assert.equal(f.control.calls.includes("bot_media_ingest_commit_internal"), false);
});

test("revocation after provider success can record its outcome but cannot send", async t => {
  const f = await fixture(t, "revoke-token"); await assert.rejects(f.send, /unauthorized/);
  const value = await f.snapshot();
  assert.deepEqual(value.attempts, [{ state: "acknowledged" }]);
  assert.deepEqual(value.counts, { messages: 0, objects: 1, receipts: 1, charged_bytes: 68 });
  assert.equal(value.receipts[0].state, "reserved"); assert.equal(value.receipts[0].result, null);
});
