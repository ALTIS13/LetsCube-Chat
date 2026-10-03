import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createBotMethodRepository, createBotServiceClient } from "../../artifacts/api-server/src/bot/repository.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";

const botId = "e5080000-0000-4000-8000-000000000001";
const chatId = "e5080000-0000-4000-8000-000000000002";
const input = {
  botId, chatId, tokenId: "e5080000-0000-4000-8000-000000000003",
  leaseId: "e5080000-0000-4000-8000-000000000004",
  idempotencyKey: "fictional-sdk-http-0001", requestFingerprint: "a".repeat(64),
  objectPath: `${chatId}/bots/${botId}/${"a".repeat(64)}.pdf`,
  mimeType: "application/pdf", bytes: Buffer.from("fictional equal bytes"),
};

// Actual installed SDK and fetch over owned loopback HTTP. RPC responses and
// Storage are controlled, not a real DB/provider/durable-intent acceptance claim.
async function fixture(t, mode, makeClient) {
  const key = randomBytes(32).toString("hex"), calls = [], failures = [];
  const control = { puts: 0, gets: 0, getFinished: false, getClosed: false };
  const reply = (response, status, data) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.apikey === key, true, "only the generated fictional credential is sent");
      assert.equal(request.headers.authorization === "Bearer " + key, true);
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
        assert.ok(chunks.reduce((n, value) => n + value.length, 0) < 16384);
      }
      const body = Buffer.concat(chunks);
      if (request.method === "POST" && path.startsWith("/rest/v1/rpc/")) {
        const name = path.slice("/rest/v1/rpc/".length), args = JSON.parse(body.toString());
        assert.ok(["bot_media_upload_begin_internal", "bot_media_upload_finish_internal"].includes(name));
        assert.equal(args.p_bot_id, botId); assert.equal(args.p_idempotency_key, input.idempotencyKey);
        calls.push({ name, args });
        if (name === "bot_media_upload_begin_internal") {
          assert.equal(args.p_token_id, input.tokenId);
          assert.equal(args.p_lease_id, input.leaseId);
          reply(response, 200, { attempt_id: input.leaseId, state: "pending" });
        } else {
          assert.equal(args.p_attempt_id, input.leaseId);
          reply(response, 200, { attempt_id: input.leaseId, state: args.p_outcome });
        }
        return;
      }
      const object = "/storage/v1/object/chat-media/" + input.objectPath;
      if (request.method === "POST" && path === object) {
        control.puts++;
        assert.equal(calls.length, 1, "begin intent response precedes any provider request");
        assert.equal(request.headers["x-upsert"], "false");
        assert.equal(request.headers["content-type"], "application/pdf");
        assert.deepEqual(body, input.bytes);
        if (mode === "ok") reply(response, 200, { Id: input.leaseId, Key: "chat-media/" + input.objectPath });
        else if (mode === "put-reset") request.socket.destroy();
        else if (mode === "denied") reply(response, 403,
          { statusCode: "403", error: "AccessDenied", message: "fictional provider detail" });
        else if (mode === "malformed") { response.writeHead(200); response.end("not-json"); }
        else reply(response, 409,
          { statusCode: "409", error: "ResourceAlreadyExists", message: "fictional duplicate" });
        return;
      }
      if (request.method === "GET" && path === object) {
        control.gets++;
        assert.match(request.headers["cache-control"], /no-cache|no-store/);
        if (mode === "get-reset") { request.socket.destroy(); return; }
        const bytes = mode === "changed" ? Buffer.from("fictional other bytes") :
          mode === "short" ? input.bytes.subarray(0, -1) :
          mode === "oversize" ? Buffer.alloc(input.bytes.length + 1) : input.bytes;
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        if (mode === "oversize") {
          response.flushHeaders(); response.write(bytes);
          // Keep the remainder pending: a buffered download cannot finish here.
          response.once("finish", () => { control.getFinished = true; });
          response.once("close", () => { control.getClosed = true; });
        } else {
          response.write(bytes.subarray(0, 5)); response.end(bytes.subarray(5));
        }
        return;
      }
      assert.fail("unexpected method/path: no DELETE, extra RPC or automatic retry is permitted");
    } catch (error) {
      failures.push(error);
      if (!response.headersSent) reply(response, 500, { error: "fictional_fixture_refused" });
      else response.destroy();
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closing;
    assert.deepEqual(failures, [], "controlled HTTP assertions cannot be swallowed by SDK error mapping");
  });
  const client = makeClient({
    SUPABASE_URL: "http://127.0.0.1:" + server.address().port,
    SUPABASE_SERVICE_ROLE_KEY: key, BOT_TOKEN_PEPPER: randomBytes(32).toString("hex"),
  });
  return { client, control, calls };
}

export async function runStorageSdkHttpCase(t, mode, implementation = {
  createBotMethodRepository, createBotServiceClient, toBotApiErrorResponse,
}) {
    assert.ok(["ok", "equal", "changed", "short", "oversize", "get-reset", "put-reset", "denied", "malformed"].includes(mode));
    const f = await fixture(t, mode, implementation.createBotServiceClient);
    f.repository = implementation.createBotMethodRepository(f.client);
    if (["ok", "equal"].includes(mode)) await f.repository.uploadInlineMedia(input);
    else await assert.rejects(f.repository.uploadInlineMedia(input), error => {
      const result = implementation.toBotApiErrorResponse(error, "fictional-sdk-http");
      assert.equal(result.status, ["changed", "short", "oversize"].includes(mode) ? 409 : 500);
      assert.equal(result.body.error.code, ["changed", "short", "oversize"].includes(mode) ? "conflict" : "internal_error");
      assert.equal(JSON.stringify(result).includes("fictional provider detail"), false);
      return true;
    });
    assert.equal(f.control.puts, 1);
    assert.equal(f.control.gets, ["ok", "put-reset", "denied", "malformed"].includes(mode) ? 0 : 1);
    assert.deepEqual(f.calls.map(call => call.name),
      ["bot_media_upload_begin_internal", "bot_media_upload_finish_internal"]);
    assert.equal(f.calls[1].args.p_outcome, ["ok", "equal"].includes(mode) ? "acknowledged" : "unknown");
    if (mode === "oversize") {
      for (let i = 0; i < 50 && !f.control.getClosed; i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(f.control.getClosed, true, "real SDK stream cancels its oversized HTTP response");
      assert.equal(f.control.getFinished, false, "verification returns before the controlled body ends");
    }
}
