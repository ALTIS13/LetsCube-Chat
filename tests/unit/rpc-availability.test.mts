import assert from "node:assert/strict";
import test from "node:test";

import {
  RPC_RECHECK_AFTER_MS,
  createRpcAvailability,
  isMissingRpcError,
} from "../../artifacts/kub/src/lib/rpcAvailability.ts";

/**
 * The client and the database go out in either order. A function the server
 * does not have yet is PostgREST's PGRST202 or Postgres's 42883; anything else
 * — a refusal, a missing message, a network failure — is an answer from a
 * server that has it, and must not send the client back to the old behaviour.
 */

test("a missing function is recognised; a refusal from a function that exists is not", () => {
  assert.equal(isMissingRpcError({ code: "PGRST202", message: "Could not find the function public.forward_message" }), true);
  assert.equal(isMissingRpcError({ code: "42883", message: "function public.forward_message(uuid) does not exist" }), true);
  assert.equal(
    isMissingRpcError({ message: "Could not find the function public.set_message_reaction(p_emoji, p_message_id) in the schema cache" }),
    true,
  );
  assert.equal(isMissingRpcError({ code: "42501", message: "not_chat_member" }), false);
  assert.equal(isMissingRpcError({ code: "P0002", message: "message_not_found" }), false);
  assert.equal(isMissingRpcError({ message: "Failed to fetch" }), false);
  assert.equal(isMissingRpcError(null), false);
  assert.equal(isMissingRpcError("PGRST202"), false);
});

test("a missing function is skipped until the recheck is due, and noted once", () => {
  let now = 1_000;
  const noted: string[] = [];
  const availability = createRpcAvailability({ now: () => now, onMissing: (name) => noted.push(name) });

  assert.equal(availability.shouldTry("forward_message"), true);
  availability.markMissing("forward_message");
  assert.equal(availability.shouldTry("forward_message"), false);
  assert.equal(availability.shouldTry("set_message_reaction"), true, "one missing function says nothing about another");

  now += RPC_RECHECK_AFTER_MS - 1;
  assert.equal(availability.shouldTry("forward_message"), false);
  now += 1;
  assert.equal(availability.shouldTry("forward_message"), true, "five minutes on, one call finds out whether the deploy landed");

  availability.markMissing("forward_message");
  assert.equal(availability.shouldTry("forward_message"), false, "still missing: skipped again");
  assert.deepEqual(noted, ["forward_message"], "a function still missing on its recheck is not noted twice");

  availability.markPresent("forward_message");
  assert.equal(availability.shouldTry("forward_message"), true);
  availability.markMissing("forward_message");
  assert.deepEqual(noted, ["forward_message", "forward_message"], "missing again after it answered is noted again");
});
