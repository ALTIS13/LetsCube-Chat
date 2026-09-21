import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createNativeVoiceController } from "../../artifacts/kub/src/lib/platform/nativeVoiceController.ts";
import * as rules from "../../artifacts/kub/src/lib/sessionDevices.ts";

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = (id = U, sid = S) => ({ user: { id }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: id, session_id: sid })).toString("base64url")}.fixture` });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture(transform = (source) => source) {
  const pending = deferred(); const timers = new Map(); const writes = []; let timerId = 0;
  const controller = createNativeVoiceController({
    bridge: {
      beginBinding: async () => ({ epoch: "synthetic" }), clearBinding: async () => {},
      setCallsAllowed: async ({ allowed }) => { writes.push(allowed); },
    },
    defer() {},
  });
  controller.signalSession(session());
  const boundary = {
    react: {},
    "@/lib/supabase/client": { createClient: () => ({ rpc: () => pending.promise }) },
    "@/lib/actionFeedback": { showActionFeedback() {} },
    "@/lib/platform/capabilities": { isNativeAndroid: () => true },
    "@/lib/platform/nativeVoiceCalls": {
      nativeVoiceContext: controller.context,
      isCurrentNativeVoiceContext: controller.isCurrentContext,
      isCurrentNativeVoiceSession: (owner) => controller.isCurrentSession(owner),
      noteNativeCallsAllowed: (allowed, owner) => controller.setCallsAllowed(allowed, owner),
    },
    "@/lib/sessionDevices": rules,
  };
  const module = { exports: {} };
  const source = transform(readFileSync(new URL("../../artifacts/kub/src/hooks/useSessionDevices.ts", import.meta.url), "utf8"));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports: module.exports, module, Date,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    require: (name) => { assert.ok(name in boundary, name); return boundary[name]; },
  });
  return {
    gate: module.exports, controller, writes, pending,
    deadline: () => { for (const fn of [...timers.values()]) fn(); },
    verdict: () => rules.incomingRingVerdict({ direction: "incoming", ...module.exports.callsAllowedHereSnapshot(), now: Date.now() }),
  };
}

for (const boundary of ["deadline", "response"]) {
  test(`R2: unchanged-session registration refresh cannot strand the ring at ${boundary}`, async () => {
    const h = fixture(); const read = h.gate.refreshCallsAllowedHere();
    h.controller.refresh();
    if (boundary === "deadline") {
      h.deadline();
      assert.equal(h.verdict(), "show", "bounded fallback publishes despite registration refresh");
    }
    h.pending.resolve({ data: true, error: null }); await read;
    assert.equal(h.verdict(), "show");
    assert.notEqual(h.gate.callsAllowedHereSnapshot().checkedAt, null);
    assert.equal(h.writes.at(-1), true);
  });
}

for (const [name, replacement] of [["account", session(B, S)], ["session", session(U, B)], ["logout", null]]) {
  test(`R2: genuine ${name} replacement drops the old gate response`, async () => {
    const h = fixture(); const read = h.gate.refreshCallsAllowedHere();
    h.controller.signalSession(replacement);
    h.gate.resetNativeSessionCallsGate();
    const count = h.writes.length;
    h.deadline(); h.pending.resolve({ data: false, error: null }); await read;
    assert.equal(h.gate.callsAllowedHereSnapshot().checkedAt, null);
    assert.equal(h.writes.length, count);
  });
}

test("R2: a local calls toggle still defeats a late gate result across registration refresh", async () => {
  const h = fixture(); const read = h.gate.refreshCallsAllowedHere();
  h.controller.refresh(); h.gate.noteCallsAllowedHere(false);
  h.pending.resolve({ data: true, error: null }); await read;
  assert.equal(h.gate.callsAllowedHereSnapshot().allowed, false);
  assert.equal(h.writes.at(-1), false);
});

test("R2: returning to the same UUID pair cannot revive ownership from before logout", () => {
  const h = fixture(); const before = h.controller.context();
  h.controller.signalSession(null); h.controller.signalSession(session());
  const count = h.writes.length;
  h.controller.setCallsAllowed(false, before);
  assert.equal(h.writes.length, count);
});

test("mutation killed: tying the ring gate back to registration generation strands it", async () => {
  const needle = "const current = () => revision === gateRevision && (!isNativeAndroid() || isCurrentNativeVoiceSession(owner));";
  assert.equal(readFileSync(new URL("../../artifacts/kub/src/hooks/useSessionDevices.ts", import.meta.url), "utf8").split(needle).length, 2);
  const verify = async (transform) => {
    const h = fixture(transform); const read = h.gate.refreshCallsAllowedHere(); h.controller.refresh();
    h.deadline(); const verdict = h.verdict();
    h.pending.resolve({ data: true, error: null }); await read;
    assert.equal(verdict, "show");
  };
  await verify();
  await assert.rejects(() => verify((text) => {
    return text.replace(needle, needle.replace("isCurrentNativeVoiceSession(owner)", "(isCurrentNativeVoiceSession(owner) && nativeVoiceContext()?.generation === owner?.generation)"));
  }), { code: "ERR_ASSERTION" });
});
