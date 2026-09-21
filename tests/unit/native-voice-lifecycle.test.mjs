import assert from "node:assert/strict";
import test from "node:test";

const source = await import("../../artifacts/kub/src/lib/platform/nativeVoiceLifecycle.ts").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function setup() {
  assert.equal(typeof source.attachNativeVoiceLifecycle, "function");
  const reads = [], signals = []; let event; let resume; let stopped = false; let invalidated = 0;
  const dispose = source.attachNativeVoiceLifecycle({
    signalSession: (session) => { signals.push(session); },
    invalidate: () => { invalidated++; }, stop: () => { stopped = true; },
  }, {
    subscribe: (callback) => { event = callback; return () => {}; },
    onResume: (callback) => { resume = callback; return () => {}; },
    getSession: () => { const read = deferred(); reads.push(read); return read.promise; },
  });
  return { reads, signals, event: (...args) => event(...args), resume: () => resume(), dispose, stopped: () => stopped, invalidated: () => invalidated };
}

test("late boot snapshot cannot overwrite a newer auth event; callback returns void", async () => {
  const h = setup();
  assert.equal(h.event({ user: "new" }), undefined);
  h.reads[0].resolve({ session: { user: "old" }, error: null }); await ticks();
  assert.deepEqual(h.signals, [{ user: "new" }]); h.dispose();
});

test("resume invalidates before session read; auth failure and logout clear locally", async () => {
  const h = setup(); h.reads[0].resolve({ session: { user: "a" }, error: null }); await ticks();
  h.resume(); assert.equal(h.invalidated(), 1);
  h.reads[1].resolve({ session: null, error: new Error("synthetic") }); await ticks();
  assert.deepEqual(h.signals, [{ user: "a" }, null]);
  h.event(null); assert.equal(h.signals.at(-1), null); h.dispose();
});

test("unmount stops the controller and drops late session reads", async () => {
  const h = setup(); h.dispose();
  h.reads[0].resolve({ session: { user: "late" }, error: null }); await ticks();
  assert.deepEqual(h.signals, []); assert.equal(h.stopped(), true);
});
