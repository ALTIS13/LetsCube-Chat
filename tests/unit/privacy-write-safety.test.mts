import assert from "node:assert/strict";
import test from "node:test";
import { createPrivacyPreferencesStore, PRIVACY_DEFAULTS, type PrivacyGateway, type PrivacyPreferences } from "../../artifacts/kub/src/lib/privacyPreferences.ts";

function fixture() {
  let persisted: PrivacyPreferences = { ...PRIVACY_DEFAULTS, phoneFindableBy: "contacts", forwardOriginVisible: false };
  let failure = false;
  const writes: Array<{ userId: string; patch: object }> = [];
  const gateway: PrivacyGateway = {
    async read() { if (failure) throw new Error("offline"); return { ...persisted }; },
    async write(userId, patch) { writes.push({ userId, patch }); persisted = { ...persisted, ...patch }; },
    async clearPresence() {},
    async setStatus(_userId, status, until) { persisted = { ...persisted, manualStatus: status, manualStatusUntil: until }; },
  };
  return { gateway, writes, fail: (value: boolean) => { failure = value; }, get: () => persisted,
    elsewhere: (patch: Partial<PrivacyPreferences>) => { persisted = { ...persisted, ...patch }; } };
}

test("a failed initial read cannot replace a stored privacy choice with defaults", async () => {
  const db = fixture();
  db.fail(true);
  const store = createPrivacyPreferencesStore(db.gateway);
  await store.sync("account-a");
  assert.equal(await store.setPresenceVisible("account-a", false), false);
  assert.equal(await store.setPreference("account-a", "phoneFindableBy", "everybody"), false);
  assert.equal(await store.setManualStatus("account-a", "dnd", null), false);
  assert.deepEqual(db.writes, []);
  assert.equal(db.get().phoneFindableBy, "contacts");
  assert.equal(db.get().forwardOriginVisible, false);
});

test("retrying a failed initial read enables changes without widening unrelated privacy", async () => {
  const db = fixture();
  db.fail(true);
  const store = createPrivacyPreferencesStore(db.gateway);
  await store.sync("account-a");
  db.fail(false);
  await store.sync("account-a");
  assert.equal(await store.setPresenceVisible("account-a", false), true);
  assert.equal(db.get().phoneFindableBy, "contacts");
  assert.equal(db.get().forwardOriginVisible, false);
});

test("changing presence never overwrites privacy or status chosen on another device", async () => {
  const db = fixture();
  db.elsewhere({ phoneFindableBy: "everybody", forwardOriginVisible: true });
  const store = createPrivacyPreferencesStore(db.gateway);
  await store.sync("account-a");
  db.elsewhere({ phoneFindableBy: "contacts", forwardOriginVisible: false, manualStatus: "invisible" });
  await store.setPresenceVisible("account-a", false);
  assert.deepEqual(db.writes, [{ userId: "account-a", patch: { presenceVisible: false } }]);
  assert.equal(db.get().phoneFindableBy, "contacts");
  assert.equal(db.get().forwardOriginVisible, false);
  assert.equal(db.get().manualStatus, "invisible");
});

test("a setter cannot use a different account's loaded answer", async () => {
  const db = fixture();
  const store = createPrivacyPreferencesStore(db.gateway);
  await store.sync("account-a");
  assert.equal(await store.setPresenceVisible("account-b", false), false);
  assert.equal(await store.setPreference("account-b", "phoneFindableBy", "everybody"), false);
  assert.deepEqual(db.writes, []);
});

test("a completed old-account write cannot restore its snapshot after an account change", async () => {
  const db = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const store = createPrivacyPreferencesStore({ ...db.gateway, async write() { await pending; } });
  await store.sync("account-a");
  const writing = store.setPreference("account-a", "phoneFindableBy", "everybody");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await store.sync("account-b");
  release();
  await writing;
  assert.equal(store.getSnapshot().userId, "account-b");
  assert.equal(store.getSnapshot().preferences.phoneFindableBy, "contacts");
});

test("two writes are serialized so a late failure cannot erase a successful choice", async () => {
  const db = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let call = 0;
  const store = createPrivacyPreferencesStore({ ...db.gateway, async write(userId, patch) {
    call += 1;
    if (call === 1) { await pending; throw new Error("offline"); }
    await db.gateway.write(userId, patch);
  } });
  await store.sync("account-a");
  const first = store.setPresenceVisible("account-a", false);
  const second = store.setPreference("account-a", "phoneFindableBy", "everybody");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(call, 1, "the second write must wait for the first to settle");
  release();
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(store.getSnapshot().preferences.phoneFindableBy, "everybody");
  assert.equal(store.getSnapshot().preferences.presenceVisible, true);
});

test("a failed write from an earlier session cannot roll back the same account after relogin", async () => {
  const db = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const store = createPrivacyPreferencesStore({ ...db.gateway, async write() {
    await pending;
    throw new Error("old connection failed");
  } });
  await store.sync("account-a");
  const writing = store.setPreference("account-a", "phoneFindableBy", "everybody");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await store.sync(null);
  db.elsewhere({ phoneFindableBy: "everybody" });
  await store.sync("account-a");
  release();
  assert.equal(await writing, false);
  assert.equal(store.getSnapshot().preferences.phoneFindableBy, "everybody");
  assert.equal(store.getSnapshot().error, null);
});

test("a refresh during a pending write waits for the accepted choice", async () => {
  const db = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const store = createPrivacyPreferencesStore({ ...db.gateway,
    async read(userId) { reads += 1; return db.gateway.read(userId); },
    async write(userId, patch) { await pending; await db.gateway.write(userId, patch); },
  });
  await store.sync("account-a");
  const writing = store.setPreference("account-a", "phoneFindableBy", "everybody");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const refreshing = store.refresh("account-a");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const prematureReads = reads;
  const during = store.getSnapshot().preferences.phoneFindableBy;
  release();
  await Promise.all([writing, refreshing]);
  assert.equal(prematureReads, 1, "refresh must not read before the write has settled");
  assert.equal(during, "everybody", "the optimistic choice cannot flicker back during saving");
  assert.equal(db.get().phoneFindableBy, "everybody");
  assert.equal(store.getSnapshot().preferences.phoneFindableBy, "everybody");
  assert.equal(store.getSnapshot().error, null);
});
