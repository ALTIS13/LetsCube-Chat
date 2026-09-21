import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = await import("../../artifacts/kub/src/lib/platform/nativeVoiceContract.ts").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const user = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const chat = "33333333-3333-4333-8333-333333333333";
const channel = "44444444-4444-4444-8444-444444444444";
const caller = "55555555-5555-4555-8555-555555555555";
const context = { recipientId: user, recipientSessionId: session };
const event = {
  protocol_version: "1", type: "voice_call", event: "ring",
  ring_key: `voice:${channel}:1000`, chat_id: chat, channel_id: channel,
  caller_id: caller, recipient_id: user, recipient_session_id: session,
  route: `/chat/${chat}`, ring_started_at: "1000", expires_at: "46000",
};
const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;

test("current auth session supplies candidates, never metadata or a profile", () => {
  assert.equal(typeof source.readNativeVoiceSession, "function", "session candidate reader exists");
  const token = jwt({ sub: user, session_id: session });
  assert.deepEqual(source.readNativeVoiceSession({ user: { id: user }, access_token: token }), { ...context, accessToken: token });
  assert.equal(source.readNativeVoiceSession(null), null);
  assert.equal(source.readNativeVoiceSession({ user: { id: user, user_metadata: { session_id: session } }, access_token: "bad" }).recipientSessionId, null);
  assert.equal(source.readNativeVoiceSession({ user: { id: user }, access_token: jwt({ sub: caller, session_id: session }) }).recipientSessionId, null);
});

test("registration accepts exactly one server pair matching BOTH candidate UUIDs", () => {
  assert.equal(typeof source.verifiedNativeVoiceBinding, "function");
  const row = { recipient_id: user, recipient_session_id: session };
  assert.deepEqual(source.verifiedNativeVoiceBinding([row], context), context);
  for (const data of [null, row, [], [row, row], [{ ...row, recipient_id: caller }], [{ ...row, recipient_session_id: caller }], [{ ...row, recipient_id: user.toUpperCase().replace("1111", "ABCD") }]]) {
    assert.equal(source.verifiedNativeVoiceBinding(data, context), null);
  }
});

test("fallback is only the missing eight-argument register_push_device overload", () => {
  assert.equal(typeof source.isMissingVoiceRegistrationRpc, "function");
  assert.equal(source.isMissingVoiceRegistrationRpc({ code: "PGRST202", message: "Could not find the function public.register_push_device(p_voice_call_protocol, p_token) in the schema cache" }), true);
  assert.equal(source.isMissingVoiceRegistrationRpc({ code: "42883", message: "function public.register_push_device(p_voice_call_protocol => smallint) does not exist" }), true);
  for (const error of [null, { code: "42501", message: "permission denied for register_push_device p_voice_call_protocol" }, { code: "PGRST202", message: "other_rpc" }, { code: "PGRST301" }, { message: "network failure register_push_device" }, { code: "PGRST203", message: "ambiguous register_push_device p_voice_call_protocol" }]) {
    assert.equal(source.isMissingVoiceRegistrationRpc(error), false);
  }
});

test("native action strictly checks wire shape, 45s expiry, recipient pair and derived route", () => {
  assert.equal(typeof source.parseNativeVoiceAction, "function");
  assert.deepEqual(source.parseNativeVoiceAction(event, context, 1000), event);
  assert.deepEqual(source.parseNativeVoiceAction(event, context, 45999), event);
  for (const invalid of [
    { ...event, expires_at: "46001" }, { ...event, expires_at: "9007199254740992" },
    { ...event, ring_started_at: "01000" }, { ...event, ring_started_at: 1000 },
    { ...event, protocol_version: "2" }, { ...event, type: "message" }, { ...event, event: "cancel" },
    { ...event, recipient_id: caller }, { ...event, recipient_session_id: caller },
    { ...event, caller_id: user }, { ...event, route: `https://example.invalid/chat/${chat}` },
    { ...event, route: `/chat/${chat}?accept=1` }, { ...event, ring_key: `voice:${channel}:999` },
    { ...event, extra: "untrusted" }, { ...event, chat_id: "ABCDEFAB-1234-1234-1234-ABCDEFABCDEF" },
  ]) assert.equal(source.parseNativeVoiceAction(invalid, context, 1000), null);
  for (const now of [999, 46000, NaN, -1]) assert.equal(source.parseNativeVoiceAction(event, context, now), null);
});

test("reserved malformed voice data never falls through generic push navigation", () => {
  assert.equal(typeof source.isReservedNativeVoiceData, "function");
  for (const value of [{ type: "voice_call", route: "/" }, { ring_key: `voice:${channel}:1000` }, { protocol_version: "99" }]) assert.equal(source.isReservedNativeVoiceData(value), true);
  assert.equal(source.isReservedNativeVoiceData({ type: "message", route: `/chat/${chat}` }), false);
});

test("foreground ownership is the exact displayed incoming generation", () => {
  assert.equal(typeof source.nativeForegroundRingKey, "function");
  assert.equal(source.nativeForegroundRingKey(channel, 1000, true), `voice:${channel}:1000`);
  assert.equal(source.nativeForegroundRingKey(channel, 1000, false), null);
  assert.equal(source.nativeForegroundRingKey(channel, "bad", true), null);
});

for (const [name, needle, replacement, verify] of [
  ["45s expiry", "expiry - start > 45_000", "expiry - start > 90_000", (m) => assert.equal(m.parseNativeVoiceAction({ ...event, expires_at: "46001" }, context, 1000), null)],
  ["action user", "value.recipient_id !== binding.recipientId", "false", (m) => assert.equal(m.parseNativeVoiceAction({ ...event, recipient_id: chat }, context, 1000), null)],
  ["action session", "value.recipient_session_id !== binding.recipientSessionId", "false", (m) => assert.equal(m.parseNativeVoiceAction({ ...event, recipient_session_id: caller }, context, 1000), null)],
  ["server user", "row.recipient_id !== expected.recipientId", "false", (m) => assert.equal(m.verifiedNativeVoiceBinding([{ recipient_id: caller, recipient_session_id: session }], context), null)],
  ["server session", "row.recipient_session_id !== expected.recipientSessionId", "false", (m) => assert.equal(m.verifiedNativeVoiceBinding([{ recipient_id: user, recipient_session_id: caller }], context), null)],
  ["derived route", 'value.route !== `/chat/${value.chat_id}`', "false", (m) => assert.equal(m.parseNativeVoiceAction({ ...event, route: "/tasks" }, context, 1000), null)],
]) {
  test(`mutation killed: ${name}`, async () => {
    const text = readFileSync(new URL("../../artifacts/kub/src/lib/platform/nativeVoiceContract.ts", import.meta.url), "utf8");
    assert.equal(text.split(needle).length, 2, "mutation target is unique");
    verify(source);
    const js = stripTypeScriptTypes(text.replace(needle, replacement));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    assert.throws(() => verify(mutant), { code: "ERR_ASSERTION" });
  });
}
