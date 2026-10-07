import assert from "node:assert/strict";
import test from "node:test";

const source = await import("../../artifacts/kub/src/lib/platform/nativeMessagePreviewContract.ts").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const U = "11111111-1111-4111-8111-000000000001";
const S = "22222222-2222-4222-8222-000000000001";
const D = "33333333-3333-4333-8333-000000000001";
const now = 1_800_000_000_000;
const session = extra => ({user:{id:U}, access_token: `fixture.${Buffer.from(JSON.stringify({
  sub:U, session_id:S, role:"authenticated", is_anonymous:false, exp:1_800_000_060, ...extra,
})).toString("base64url")}.fixture`});
const binding = {recipientId:U, recipientSessionId:S, deviceId:D};
const row = {preview_v:1, recipient_id:U, session_id:S, device_id:D, preview_level:"none"};
const readSession = (...args) => source.readMessagePreviewSession?.(...args) ?? null;
const readBinding = (...args) => source.readMessagePreviewBinding?.(...args) ?? null;
const readCapability = (...args) => source.readMessagePreviewCapability?.(...args) ?? null;
const readWrite = (...args) => source.readMessagePreviewConsent?.(...args) ?? null;

test("valid auth context and distinct protocol1 candidate accept an exact server row", () => {
  assert.deepEqual(readSession(session(), now), {recipientId:U, recipientSessionId:S, expiresAt:1_800_000_060_000});
  assert.deepEqual(readBinding({protocol:1, ...binding}, {recipientId:U, recipientSessionId:S}), binding);
  for (const level of ["none", "sender", "message"]) {
    assert.equal(readCapability([{...row, preview_level:level}], binding), level);
    assert.equal(readWrite([{user_id:U, preview_level:level}], U, level), level);
  }
});

test("JWT claims are only candidates and malformed/anonymous/wrong-role/expired contexts deny", () => {
  for (const extra of [{role:"anon"}, {role:"service_role"}, {is_anonymous:true}, {is_anonymous:undefined},
    {session_id:"bad"}, {sub:D}, {exp:1_800_000_000}, {exp:"1800000060"}, {exp:1.5}]) {
    assert.equal(readSession(session(extra), now), null);
  }
  for (const value of [null, {}, {user:{id:U}, access_token:"bad"}]) assert.equal(readSession(value, now), null);
});

test("strict protocol, IDs, five-key single row and explicit choice refuse ambiguous replies", () => {
  for (const value of [{protocol:0, ...binding}, {protocol:"1", ...binding}, {protocol:2, ...binding},
    {protocol:1, ...binding, deviceId:"bad"}, {protocol:1, ...binding, recipientId:D},
    {protocol:1, ...binding, recipientSessionId:D}]) {
    assert.equal(readBinding(value, {recipientId:U, recipientSessionId:S}), null);
  }
  for (const data of [null, [], [row,row], row, [{...row, preview_v:2}], [{...row, preview_v:"1"}],
    [{...row, recipient_id:D}], [{...row, session_id:D}], [{...row, device_id:S}],
    [{...row, preview_level:"rich"}], [{...row, title:"private"}], [{...row, device_id:"bad"}]]) {
    assert.equal(readCapability(data, binding), null);
  }
  for (const data of [[], [{user_id:D,preview_level:"sender"}], [{user_id:U,preview_level:"message"}],
    [{user_id:U,preview_level:"sender",body:"private"}]]) assert.equal(readWrite(data, U, "sender"), null);
});
