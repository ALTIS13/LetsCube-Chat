import assert from "node:assert/strict";
import test from "node:test";

import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import {
  createBotMethodRepository,
  type BotServiceClient,
} from "../../artifacts/api-server/src/bot/repository.ts";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const CALLBACK_ID = "33333333-3333-4333-8333-333333333333";
const INTERFACE_ID = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);

test("viewer repository passes the exact token to each SQL writer", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = createBotMethodRepository({
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const receipt = name.includes("close")
        ? { interface_id: INTERFACE_ID, version: 3, closed_at: "2026-09-26T12:10:00Z" }
        : { interface_id: INTERFACE_ID, version: name.includes("edit") ? 2 : 1, expires_at: "2026-09-26T12:15:00Z" };
      return { data: { result: { ...receipt, viewer_id: CALLBACK_ID }, duplicate: false }, error: null };
    },
  } as unknown as BotServiceClient);
  const base = { botId: BOT_ID, tokenId: TOKEN_ID, idempotencyKey: "viewer:test:1", requestFingerprint: FINGERPRINT };
  const state = { title: "Working" };

  const created = await repository.setViewerInterface({ ...base, callbackQueryId: CALLBACK_ID, state });
  const edited = await repository.editViewerInterface({ ...base, interfaceId: INTERFACE_ID, expectedVersion: 1, state });
  const closed = await repository.closeViewerInterface({ ...base, interfaceId: INTERFACE_ID, expectedVersion: 2 });

  assert.deepEqual(created.result, { interface_id: INTERFACE_ID, version: 1, expires_at: "2026-09-26T12:15:00Z" });
  assert.deepEqual(edited.result, { interface_id: INTERFACE_ID, version: 2, expires_at: "2026-09-26T12:15:00Z" });
  assert.deepEqual(closed.result, { interface_id: INTERFACE_ID, version: 3, closed_at: "2026-09-26T12:10:00Z" });
  assert.deepEqual(calls, [
    { name: "bot_viewer_interface_set_internal", args: { p_bot_id: BOT_ID, p_token_id: TOKEN_ID, p_callback_query_id: CALLBACK_ID, p_state: state, p_idempotency_key: "viewer:test:1", p_request_fingerprint: FINGERPRINT } },
    { name: "bot_viewer_interface_edit_internal", args: { p_bot_id: BOT_ID, p_token_id: TOKEN_ID, p_interface_id: INTERFACE_ID, p_expected_version: 1, p_state: state, p_idempotency_key: "viewer:test:1", p_request_fingerprint: FINGERPRINT } },
    { name: "bot_viewer_interface_close_internal", args: { p_bot_id: BOT_ID, p_token_id: TOKEN_ID, p_interface_id: INTERFACE_ID, p_expected_version: 2, p_idempotency_key: "viewer:test:1", p_request_fingerprint: FINGERPRINT } },
  ]);
});

test("viewer repository denies a token revoked between authentication and SQL", async () => {
  const repository = createBotMethodRepository({
    async rpc() {
      return { data: null, error: { code: "42501", message: "private detail" } };
    },
  } as unknown as BotServiceClient);
  await assert.rejects(
    () => repository.setViewerInterface({ botId: BOT_ID, tokenId: TOKEN_ID, callbackQueryId: CALLBACK_ID, state: { title: "Working" }, idempotencyKey: "viewer:test:2", requestFingerprint: FINGERPRINT }),
    (error: unknown) => error instanceof BotApiError && error.code === "forbidden",
  );
});

test("viewer repository reports stale versions and capacity as conflicts", async () => {
  for (const code of ["40001", "54000"]) {
    const repository = createBotMethodRepository({
      async rpc() {
        return { data: null, error: { code, message: "private detail" } };
      },
    } as unknown as BotServiceClient);
    await assert.rejects(
      () => repository.editViewerInterface({
        botId: BOT_ID,
        tokenId: TOKEN_ID,
        interfaceId: INTERFACE_ID,
        expectedVersion: 1,
        state: { title: "Working" },
        idempotencyKey: "viewer:test:conflict",
        requestFingerprint: FINGERPRINT,
      }),
      (error: unknown) => error instanceof BotApiError && error.code === "conflict",
    );
  }
});
