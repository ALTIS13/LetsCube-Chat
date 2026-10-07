import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { createStore } = requireKub("zustand/vanilla");
const requireSupabase = createRequire(requireKub.resolve("@supabase/supabase-js"));
const { RealtimeClient } = requireSupabase("@supabase/realtime-js");
const read = (file) => readFileSync(new URL(file, root), "utf8").replaceAll("\r\n", "\n");
const hookSource = read("hooks/useUser.ts");
const storeSource = read("store/app.store.ts");
const identitySource = existsSync(new URL("lib/authSessionIdentity.ts", root)) ? read("lib/authSessionIdentity.ts") : null;
const A = "10000000-0000-0000-0000-000000000001";
const B = "10000000-0000-0000-0000-000000000002";
const S1 = "20000000-0000-0000-0000-000000000001";
const S2 = "20000000-0000-0000-0000-000000000002";
const S3 = "20000000-0000-0000-0000-000000000003";
const CHAT = "30000000-0000-0000-0000-000000000001";
const FIRST = "2026-10-07T00:00:01.123456Z";
const profile = (id = A, frame = "initial") => ({ id, full_name: "Fictional QA", username: "qa_fixture",
  avatar_url: null, bio: null, online_at: FIRST, created_at: FIRST, updated_at: FIRST, profile_frame: frame });
const session = (id = A, sid = S1, revision = 1, claimUser = id) => ({
  user: { id, user_metadata: {} },
  access_token: `fixture.${Buffer.from(JSON.stringify({ sub: claimUser,
    ...(sid ? { session_id: sid } : {}), exp: 2_000_000_000 + revision })).toString("base64url")}.fixture`,
});

function compile(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node) ? ts.factory.createIdentifier("testImportMeta")
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, atob, Date,
    testImportMeta: { env: { DEV: false } },
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; },
    ...globals });
  return module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function reactLifecycle() {
  const slots = [], pending = [], stateWrites = [];
  let cursor = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const api = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
        stateWrites.push({ index, value: slots[index] });
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++, old = slots[index];
      if (!old || changed(old.deps, deps)) pending.push(() => {
        old?.cleanup?.(); slots[index] = { deps, cleanup: callback() };
      });
    },
  };
  return { api, stateWrites,
    render(fn) { cursor = 0; const value = fn(); for (const effect of pending.splice(0)) effect(); return value; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    reset() { slots.length = 0; pending.length = 0; },
  };
}

// Full hook/store/receipt source and Zustand core are real. React lifecycle,
// SDK I/O, timers, outbox stop and browser event publication are fictional.
function fixture({ hook = hookSource, store = storeSource, identity = identitySource, delayedChannels = false } = {}) {
  const react = reactLifecycle(), boot = deferred(), listeners = new Set();
  const profiles = [], authUsers = [], channels = [], calls = [], reads = [], answers = [], timers = new Map();
  const channelRemovals = [];
  let nextTimer = 0, stops = 0, liveSession = null, core;
  const clock = {
    setTimeout(callback, ms) { const handle = ++nextTimer; timers.set(handle, { callback, ms }); return handle; },
    clearTimeout(handle) { timers.delete(handle); },
  };
  const sdk = {
    auth: {
      getSession: () => boot.promise,
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: {
        unsubscribe() { listeners.delete(callback); },
      } } }; },
      getUser() { const pending = deferred(); authUsers.push(pending); return pending.promise; },
      signOut: async () => {},
    },
    realtime: { setAuth() {} },
    from(table) {
      assert.equal(table, "profiles");
      let userId, kind = "select", inserted;
      const query = {
        select() { return query; }, eq(field, value) { assert.equal(field, "id"); userId = value; return query; },
        insert(value) { kind = "insert"; inserted = value; userId = value.id; return query; },
        maybeSingle: request, single: request,
      };
      function request() { const pending = deferred(); profiles.push({ kind, userId, inserted, ...pending }); return pending.promise; }
      return query;
    },
    channel(name) {
      if (delayedChannels) {
        const existing = channels.find((channel) => channel.name === name && !channel.closed);
        if (existing) return existing;
      }
      const channel = { name, closed: false, on(_event, _filter, callback) { channel.callback = callback; return channel; },
        subscribe() { return channel; } };
      channels.push(channel); return channel;
    },
    removeChannel(channel) {
      if (delayedChannels) {
        const pending = deferred();
        channelRemovals.push({ channel, ...pending });
        return pending.promise.then(() => { channel.closed = true; return "ok"; });
      }
      channel.closed = true; return Promise.resolve("ok");
    },
  };
  const identityModule = identity ? compile(identity) : {};
  const storeModule = compile(store, {
    zustand: { create(initializer) {
      core = createStore(initializer);
      return Object.assign((selector) => selector(core.getState()), core);
    } },
    "@/lib/supabase/client": { createClient: () => sdk },
    "@/lib/chatSort": {}, "@/lib/chatListChange": {}, "@/lib/chatListDelta": {},
    "@/lib/structuralSharing": {}, "@/lib/messageActor": {},
    "@/lib/profileChange": compile(read("lib/profileChange.ts")),
    "@/lib/authSessionIdentity": identityModule,
    "@/lib/chatMute": { EMPTY_CHAT_MUTES: {} }, "@/lib/errors": {},
    "@/lib/outbox/appOutbox": { appOutbox: { stop() { stops += 1; } } },
  });
  const { useAppStore } = storeModule;
  const hookModule = compile(hook, {
    react: react.api, "@/lib/supabase/client": { createClient: () => sdk },
    "@/store/app.store": storeModule,
    "@/lib/authSessionIdentity": identityModule,
    "@/lib/dev/instrumentation": { registerChannel() {}, unregisterChannel() {} },
    "@/lib/singleFlight": compile(read("lib/singleFlight.ts")),
    "@/lib/media/mediaUrl": { signedMediaUrls: () => ({ setAccount() {} }) },
  }, clock);
  const availabilityModule = compile(read("lib/rpcAvailability.ts"));
  const availability = availabilityModule.createRpcAvailability({ now: () => 0 });
  const receipts = compile(read("lib/deliveryReceipts.ts"), {
    "@/store/app.store": storeModule,
    "@/lib/receiptScheduler": compile(read("lib/receiptScheduler.ts"), {
      "./readMarkWatermark.ts": compile(read("lib/readMarkWatermark.ts")),
    }),
    "@/lib/rpcAvailability": { ...availabilityModule, rpcAvailability: availability },
    "@/lib/notificationEvents": { dispatchChatNotificationsRead(detail) { reads.push(detail); } },
  }, clock);
  const client = { rpc(fn, args) { calls.push({ fn, args, authUser: liveSession?.user.id ?? null });
    return answers.shift() ?? Promise.resolve({ error: null }); } };
  let output;
  const render = () => output = react.render(hookModule.useUser);
  const drain = async () => { await new Promise((resolve) => setImmediate(resolve)); render(); };
  render();
  return { profiles, authUsers, channels, calls, reads, timers, receipts, client, answers, availability,
    get state() { return useAppStore.getState(); }, get output() { return output; },
    get stops() { return stops; }, stateWrites: react.stateWrites,
    setState: useAppStore.setState, drain, render,
    emit(value, event = "SIGNED_IN", rerender = true) {
      liveSession = value; for (const callback of listeners) callback(event, value); if (rerender) render();
    },
    async finishChannelRemovals() {
      for (const removal of channelRemovals.splice(0)) removal.resolve("ok"); await drain();
    },
    async restore(value) { liveSession = value; boot.resolve({ data: { session: value }, error: null }); await drain(); },
    async finishProfile(index, row = profile(profiles[index].userId)) {
      profiles[index].resolve({ data: row, error: null }); await drain();
    },
    async ready(value = session()) { await this.restore(value); assert.equal(profiles.length, 1, "initial profile request control");
      await this.finishProfile(0); assert.equal(this.state.currentUser.id, value.user.id); },
    holdReceipt() { const pending = deferred(); answers.push(pending.promise); return pending; },
    async flushTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } await drain(); },
    unmount() { react.unmount(); },
    async remount() { react.reset(); render(); await drain(); },
  };
}

async function replacement(options) {
  const f = fixture(options); await f.ready();
  const epoch = f.state.accountEpoch;
  f.emit(session(A, S2));
  assert.equal(f.state.accountEpoch, epoch + 1, "new same-user session advances epoch synchronously");
  assert.equal(f.state.currentUser, null, "retired profile is cleared before replacement profile load");
  return f;
}
test("actual auth observer: new same-user session retires the owner synchronously", () => replacement());

async function pendingAccount(options) {
  const f = fixture(options); await f.ready();
  f.receipts.scheduleMarkChatRead(f.client, CHAT, FIRST); f.receipts.scheduleMarkChatDelivered(f.client, CHAT, FIRST);
  assert.equal(f.timers.size, 2, "pending receipt positive control");
  f.emit(session(B, S2));
  assert.equal(f.timers.size, 0, "auth switch cancels receipts before profile fetch completes");
  assert.equal(f.state.currentUser, null);
  await f.flushTimers(); assert.equal(f.calls.length, 0);
}
test("actual auth observer: A-to-B pending profile immediately cancels both receipt lanes", () => pendingAccount());

test("actual callback/store: same-user replacement does not inherit confirmed receipt suppression", async () => {
  const f = fixture(); await f.ready(); f.receipts.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flushTimers();
  assert.equal(f.calls.length, 1);
  f.emit(session(A, S2)); await f.finishProfile(1);
  f.receipts.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flushTimers();
  assert.equal(f.calls.length, 2, "replacement session reports its own equal watermark");
});

async function lateReceipt(error, options) {
  const f = fixture(options); await f.ready(); const old = f.holdReceipt();
  f.receipts.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flushTimers();
  assert.equal(f.calls.length, 1); assert.equal(f.reads.length, 0);
  f.emit(session(A, S2));
  old.resolve({ error }); await f.drain();
  if (error) assert.equal(f.calls.length, 1, "old-session response cannot start replacement fallback");
  assert.equal(f.reads.length, 0, "old-session ACK cannot publish into replacement session");
  assert.equal(f.calls.length, 1, "old-session response cannot start replacement fallback");
  assert.equal(f.availability.shouldTry("mark_chat_read_through"), true);
}
test("actual auth observer fences late receipt ACK", () => lateReceipt(null));
test("actual auth observer fences late receipt fallback", () => lateReceipt({ code: "PGRST202" }));

async function profileGeneration(options) {
  const f = fixture(options); f.emit(session());
  assert.equal(f.profiles.length, 1);
  f.emit(session(A, S2));
  assert.equal(f.profiles.length, 2, "new ownership generation must not join retired profile single-flight");
  await f.finishProfile(0, profile(A, "retired"));
  assert.equal(f.state.currentUser, null, "retired same-user profile SELECT cannot publish");
  await f.finishProfile(1, profile(A, "current"));
  assert.equal(f.state.currentUser.profile_frame, "current");
}
test("actual hook: profile single-flight and SELECT ACK are ownership-generation scoped", () => profileGeneration());

async function oldChannel(options) {
  const f = fixture(options); await f.ready(); const old = f.channels[0];
  assert.ok(old?.callback, "profile channel positive control");
  f.emit(session(A, S2)); await f.finishProfile(1, profile(A, "current"));
  old.callback({ new: profile(A, "retired") });
  assert.equal(f.state.currentUser.profile_frame, "current", "retired profile channel cannot replace current profile");
}
test("actual hook: queued old-profile realtime callback cannot restore retired session profile", () => oldChannel());

async function beforeChannelCleanup(options) {
  const f = fixture(options); await f.ready(); const old = f.channels[0];
  f.emit(session(A, S2), "SIGNED_IN", false);
  old.callback({ new: profile(A, "retired") });
  assert.equal(f.state.currentUser, null, "old profile channel is inert before React cleanup runs");
}
test("actual callback/store: old channel is fenced synchronously before passive cleanup", () => beforeChannelCleanup());

test("installed SDK control: equal topics reuse a channel without opening a transport", () => {
  const realtime = new RealtimeClient("ws://127.0.0.1/fictional", { params: { apikey: "fictional" },
    transport: class { constructor() { throw new Error("transport must never open in this control"); } } });
  const old = realtime.channel("fictional-profile");
  assert.equal(realtime.channel("fictional-profile"), old);
  assert.notEqual(realtime.channel("fictional-profile-next"), old);
  assert.equal(realtime.isConnected(), false);
});

async function distinctChannel(options = {}) {
  const f = fixture({ ...options, delayedChannels: true }); await f.ready();
  const old = f.channels[0]; f.emit(session(A, S2));
  assert.equal(f.channels.length, 2, "replacement channel cannot reuse a retiring SDK topic");
  const current = f.channels[1];
  await f.finishChannelRemovals(); assert.equal(old.closed, true); assert.equal(current.closed, false);
  await f.finishProfile(1);
  current.callback({ new: profile(A, "current-channel") });
  assert.equal(f.state.currentUser.profile_frame, "current-channel");
}
test("actual hook: delayed old-channel removal cannot tear down the replacement channel", () => distinctChannel());

async function remountedChannel(options = {}) {
  const f = fixture({ ...options, delayedChannels: true }); await f.ready();
  const epoch = f.state.accountEpoch, old = f.channels[0]; f.unmount(); await f.remount();
  assert.equal(f.state.accountEpoch, epoch);
  assert.equal(f.profiles.length, 2, "remount owns a fresh profile operation");
  assert.equal(f.channels.length, 2, "remounted channel cannot reuse a retiring SDK topic");
  await f.finishChannelRemovals(); assert.equal(old.closed, true); assert.equal(f.channels[1].closed, false);
  await f.finishProfile(1);
}
test("actual hook: same-epoch remount also owns a distinct SDK channel", () => remountedChannel());

async function remountedProfile(options) {
  const f = fixture(options); f.emit(session()); f.unmount(); await f.remount(); await f.restore(session());
  assert.equal(f.profiles.length, 2, "remounted observer cannot join the retired profile operation");
  await f.finishProfile(0, profile(A, "retired")); assert.equal(f.state.currentUser, null);
  await f.finishProfile(1, profile(A, "current")); assert.equal(f.state.currentUser.profile_frame, "current");
}
test("actual hook: remount cannot join a pending profile request owned by the unmounted observer", () => remountedProfile());

async function detachedChannel(options) {
  const f = fixture(options); await f.ready(); const old = f.channels[0]; f.unmount();
  old.callback({ new: profile(A, "detached") });
  assert.equal(f.state.currentUser.profile_frame, "initial", "detached profile channel is inert within the same epoch");
}
test("actual hook: detached profile channel callback is inert even without an epoch change", () => detachedChannel());

async function beforeInsert(options) {
  const f = fixture(options); f.emit(session()); await f.finishProfile(0, null);
  assert.equal(f.authUsers.length, 1, "missing profile reached auth-user control");
  f.emit(session(A, S2)); f.authUsers[0].resolve({ data: { user: session().user }, error: null }); await f.drain();
  assert.equal(f.profiles.filter((request) => request.kind === "insert").length, 0,
    "retired getUser reply cannot start a profile INSERT");
}
test("actual hook: same-user replacement fences missing-profile INSERT after getUser awaits", () => beforeInsert());

async function insertAck(options) {
  const f = fixture(options); f.emit(session()); await f.finishProfile(0, null);
  f.authUsers[0].resolve({ data: { user: session().user }, error: null }); await f.drain();
  assert.equal(f.profiles[1].kind, "insert", "profile INSERT positive control");
  f.emit(session(A, S2)); assert.equal(f.profiles.length, 3);
  await f.finishProfile(2, profile(A, "current")); await f.finishProfile(1, profile(A, "retired"));
  assert.equal(f.state.currentUser.profile_frame, "current", "retired INSERT ACK cannot replace current profile");
}
test("actual hook: retired profile INSERT ACK cannot overwrite new same-user profile", () => insertAck());

async function retiredRetry(options) {
  const f = fixture(options); f.emit(session());
  f.profiles[0].resolve({ data: null, error: { code: "57014" } }); await f.drain();
  assert.equal(f.timers.size, 1); f.emit(session(B, S2));
  assert.equal(f.profiles.length, 2); await f.flushTimers();
  assert.equal(f.profiles.length, 2, "retired retry cannot dispatch another profile read");
}
test("actual hook: retired retry cannot issue another SELECT under the new owner", () => retiredRetry());

async function retiredFailure(options) {
  const f = fixture(options); await f.ready(); f.emit(session(A, S2)); f.emit(session(A, S3));
  assert.equal(f.profiles.length, 3); assert.equal(f.output.loading, true);
  f.profiles[1].reject(new Error("fictional offline")); await f.drain();
  assert.equal(f.output.loading, true, "old profile completion cannot finish replacement loading");
  assert.equal(f.output.loadingError, null, "old profile completion cannot publish replacement error");
}
test("actual hook: retired profile failure cannot clear replacement loading or set its error", () => retiredFailure());

test("control: same legitimate session refresh keeps epoch, profile, route and UI", async () => {
  const f = fixture(); await f.ready();
  f.setState({ selectedChatId: CHAT, selectedTopicId: "fictional-topic", chats: [{ id: CHAT }] });
  const old = f.state.currentUser, epoch = f.state.accountEpoch, stops = f.stops;
  const writes = f.stateWrites.length;
  f.emit(session(A, S1, 2), "TOKEN_REFRESHED");
  assert.equal(f.state.accountEpoch, epoch); assert.equal(f.state.currentUser, old); assert.equal(f.stops, stops);
  assert.equal(f.state.selectedChatId, CHAT); assert.equal(f.state.selectedTopicId, "fictional-topic");
  assert.equal(f.state.chats.length, 1); assert.equal(f.output.loading, false);
  assert.equal(f.stateWrites.slice(writes).some((entry) => entry.index === 1 && entry.value === true), false,
    "token refresh cannot show loading UI");
});

test("control: initial restore retains a pending deep-link before and after profile load", async () => {
  const f = fixture(); f.setState({ selectedChatId: CHAT, selectedTopicId: "fictional-topic" });
  await f.restore(session());
  assert.equal(f.state.selectedChatId, CHAT); assert.equal(f.state.selectedTopicId, "fictional-topic");
  await f.finishProfile(0); assert.equal(f.state.accountEpoch, 1);
  assert.equal(f.state.selectedChatId, CHAT); assert.equal(f.state.selectedTopicId, "fictional-topic");
});

test("control: initial auth event and same-session refresh share the pending profile operation", async () => {
  const f = fixture(); f.emit(session(), "INITIAL_SESSION"); f.emit(session(A, S1, 2), "TOKEN_REFRESHED");
  assert.equal(f.profiles.length, 1); await f.finishProfile(0);
  assert.equal(f.output.loading, false); assert.equal(f.output.loadingError, null); assert.equal(f.state.currentUser.id, A);
});

test("control: late getSession restore cannot replace a newer observed auth owner", async () => {
  const f = fixture(); f.emit(session(B, S2)); await f.restore(session());
  assert.equal(f.profiles.length, 1); assert.equal(f.profiles[0].userId, B);
  await f.finishProfile(0); assert.equal(f.state.currentUser.id, B);
});

for (const [label, initialSid, nextSid] of [["legacy claim absent", null, null],
  ["known claim temporarily absent", S1, null], ["claim becomes available", null, S1]]) {
  test(`control: ${label} is not a token-refresh ownership reset`, async () => {
    const f = fixture(); await f.ready(session(A, initialSid));
    const epoch = f.state.accountEpoch, old = f.state.currentUser, stops = f.stops;
    f.emit(session(A, nextSid, 2), "TOKEN_REFRESHED");
    assert.equal(f.state.accountEpoch, epoch); assert.equal(f.state.currentUser, old); assert.equal(f.stops, stops);
    assert.equal(f.output.loading, false);
  });
}

async function retainedSession(options) {
  const f = fixture(options); await f.ready(); const epoch = f.state.accountEpoch;
  f.emit(session(A, null, 2), "TOKEN_REFRESHED"); f.emit(session(A, S2, 3));
  assert.equal(f.state.accountEpoch, epoch + 1, "temporary absent claim must not erase known session identity");
}
test("known session identity survives a missing claim, so a later new SID still retires ownership", () => retainedSession());

test("control: an untrusted JWT subject cannot switch the authenticated observer's identity", async () => {
  const f = fixture(); await f.ready(); const epoch = f.state.accountEpoch, old = f.state.currentUser;
  f.emit(session(A, S2, 2, B), "TOKEN_REFRESHED");
  assert.equal(f.state.accountEpoch, epoch); assert.equal(f.state.currentUser, old);
});

test("actual observer: signout retires the profile and queued channel cannot log it back in", async () => {
  const f = fixture(); await f.ready(); const old = f.channels[0], epoch = f.state.accountEpoch;
  f.emit(null, "SIGNED_OUT"); assert.equal(f.state.currentUser, null);
  old.callback({ new: profile() });
  assert.equal(f.state.currentUser, null, "queued profile UPDATE cannot restore signed-out owner");
  assert.equal(f.state.accountEpoch, epoch + 1);
});

async function guardedSetter(options) {
  const f = fixture(options); f.state.setCurrentUser(profile()); const epoch = f.state.accountEpoch;
  f.state.setCurrentUser(null); f.state.setCurrentUser(profile(A, "retired"), epoch);
  assert.equal(f.state.currentUser, null, "public setter rejects a retired expected epoch");
}
test("actual store: optional expected epoch fences profile publication while old one-argument API remains", () => guardedSetter());

test("control: loaded auth owner rejects a different profile without an auth boundary", async () => {
  const f = fixture(); await f.ready(); const epoch = f.state.accountEpoch, old = f.state.currentUser;
  f.state.setCurrentUser(profile(B));
  assert.equal(f.state.currentUser, old); assert.equal(f.state.accountEpoch, epoch);
  f.state.setAuthSessionIdentity({ userId: B, sessionId: S2 });
  const nextEpoch = f.state.accountEpoch; f.state.setCurrentUser(profile(B), nextEpoch);
  assert.equal(f.state.currentUser.id, B); assert.equal(f.state.accountEpoch, nextEpoch);
});

async function replacementSelection(options) {
  const f = fixture(options); await f.ready(); const epoch = f.state.accountEpoch;
  f.setState({ selectedChatId: CHAT, selectedTopicId: "fictional-topic" }); f.emit(session(A, S2));
  assert.equal(f.state.selectedChatId, null, "new session clears the previous chat selection");
  assert.equal(f.state.selectedTopicId, null);
  await f.finishProfile(1); assert.equal(f.state.accountEpoch, epoch + 1);
}
test("control: new same-user session clears old selection without a second profile epoch", () => replacementSelection());

test("control: logout then same-user login retires both ownership generations", async () => {
  const f = fixture(); await f.ready(); const epoch = f.state.accountEpoch;
  f.emit(null, "SIGNED_OUT"); f.emit(session()); await f.finishProfile(1);
  assert.equal(f.state.currentUser.id, A); assert.equal(f.state.accountEpoch, epoch + 2);
});

async function resetInvariants(options) {
  const f = fixture(options); await f.ready();
  f.setState({ selectedChatId: CHAT, selectedTopicId: "fictional-topic", chats: [{ id: CHAT }],
    messages: { [CHAT]: [{ id: "fictional-message" }] }, replyToMessage: {}, editingMessage: {},
    forwardingMessages: [], pendingForward: {}, messageSelection: {}, messageDeleteRequest: {} });
  const stops = f.stops; f.emit(session(B, S2));
  assert.equal(f.stops, stops + 1, "auth ownership change stops app outbox before publication");
  assert.equal(f.state.selectedChatId, null); assert.equal(f.state.selectedTopicId, null);
  assert.equal(f.state.chats.length, 0); assert.equal(Object.keys(f.state.messages).length, 0);
  for (const field of ["replyToMessage", "editingMessage", "forwardingMessages", "pendingForward", "messageSelection", "messageDeleteRequest"])
    assert.equal(f.state[field], null, `auth reset clears ${field}`);
}
test("actual store: immediate auth replacement preserves existing outbox/account reset invariants", () => resetInvariants());

async function unmountedProfile(options) {
  const f = fixture(options); f.emit(session()); f.unmount(); await f.finishProfile(0);
  assert.equal(f.state.currentUser, null, "unmounted profile request cannot publish its eventual reply");
}
test("control: unmounted profile SELECT cannot publish its eventual reply", () => unmountedProfile());

function literalMutation(source, needle, replacement, count = 1, index = 0) {
  const parts = source.split(needle);
  assert.equal(parts.length - 1, count, "mutation must match the frozen source exactly");
  return parts.slice(0, index + 1).join(needle) + replacement + parts.slice(index + 1).join(needle);
}

const mutants = [
  ["omit auth callback identity observation", "hook", hookSource, "const owner = observeSession(session);",
    "const owner = activeOwnerRef.current;", replacement, "new same-user session advances epoch synchronously", 2, 1],
  ["omit JWT session identity", "identity", identitySource, "sessionId = claims.session_id;",
    "sessionId = null;", replacement, "new same-user session advances epoch synchronously"],
  ["omit session identity comparison", "identity", identitySource,
    "return a.userId === b.userId && (!a.sessionId || !b.sessionId || a.sessionId === b.sessionId);",
    "return a.userId === b.userId;", replacement, "new same-user session advances epoch synchronously"],
  ["omit epoch increment", "store", storeSource, "accountEpoch: state.accountEpoch + 1",
    "accountEpoch: state.accountEpoch", replacement, "new same-user session advances epoch synchronously"],
  ["omit immediate profile retirement", "store", storeSource,
    "return { ...retireAccountState(state), authSessionIdentity: identity, currentUser: null };",
    "return { ...retireAccountState(state), authSessionIdentity: identity };", replacement,
    "retired profile is cleared before replacement profile load"],
  ["omit public profile epoch guard", "store", storeSource,
    "if (expectedAccountEpoch !== undefined && state.accountEpoch !== expectedAccountEpoch) return state;",
    "", guardedSetter, "public setter rejects a retired expected epoch"],
  ["omit outbox stop", "store", storeSource, "appOutbox.stop();", "", resetInvariants,
    "auth ownership change stops app outbox before publication"],
  ["omit known session retention", "store", storeSource,
    "identity.sessionId ?? previous?.sessionId ?? null", "identity.sessionId", retainedSession,
    "temporary absent claim must not erase known session identity"],
  ["omit old selection retirement", "store", storeSource,
    "state.currentUser || state.authSessionIdentity", "false", replacementSelection,
    "new session clears the previous chat selection"],
  ["omit detached channel identity guard", "hook", hookSource,
    "activeProfileChannels.get(key) === entry && ", "", detachedChannel,
    "detached profile channel is inert within the same epoch"],
  ["omit profile epoch key", "hook", hookSource,
    "`${owner.userId}:${owner.accountEpoch}:${owner.observerGeneration}`", "`${owner.userId}:${owner.observerGeneration}`",
    profileGeneration, "new ownership generation must not join retired profile single-flight"],
  ["omit observer generation key", "hook", hookSource,
    "`${owner.userId}:${owner.accountEpoch}:${owner.observerGeneration}`", "`${owner.userId}:${owner.accountEpoch}`",
    remountedProfile, "remounted observer cannot join the retired profile operation"],
  ["omit getUser ownership guard", "hook", hookSource,
    "if (!isCurrent(owner) || authUser.data.user?.id !== userId) return false;",
    "if (authUser.data.user?.id !== userId) return false;", beforeInsert,
    "retired getUser reply cannot start a profile INSERT"],
  ["omit retry dispatch guard", "hook", hookSource, "if (!isCurrent(owner)) return false;", "", retiredRetry,
    "retired retry cannot dispatch another profile read", 3, 0],
  ["omit loading completion guard", "hook", hookSource,
    "if (isCurrent(owner) && shouldBlockUiForProfile) setLoading(false);",
    "if (shouldBlockUiForProfile) setLoading(false);", retiredFailure,
    "old profile completion cannot finish replacement loading"],
  ["omit error publication guard", "hook", hookSource,
    "if (isCurrent(owner) && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);",
    "if (shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);", retiredFailure,
    "old profile completion cannot publish replacement error"],
  ["omit channel ownership topic", "hook", hookSource,
    "`profile-self:${key}:${++nextProfileChannelGeneration}`", "`profile-self:${userId}`", distinctChannel,
    "replacement channel cannot reuse a retiring SDK topic"],
  ["omit channel attachment generation", "hook", hookSource,
    "`profile-self:${key}:${++nextProfileChannelGeneration}`", "`profile-self:${key}`", remountedChannel,
    "remounted channel cannot reuse a retiring SDK topic"],
  ["omit observer cleanup retirement", "hook", hookSource, "activeOwnerRef.current = null;", "", unmountedProfile,
    "unmounted profile request cannot publish its eventual reply", 2, 1],
];

for (const [name, field, source, needle, replacementText, scenario, oracle, count, index] of mutants) {
  test(`compiled omission: ${name}`, async () => {
    const changed = literalMutation(source, needle, replacementText, count, index);
    await assert.rejects(() => scenario({ [field]: changed }), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "a compile/import/setup failure is not a killed mutant");
      assert.ok(error.message.includes(oracle), `expected behavioral oracle: ${oracle}`);
      return true;
    });
  });
}
