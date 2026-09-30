import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVACY_DEFAULTS,
  createPrivacyPreferencesStore,
  type PrivacyGateway,
  type PrivacyPreferences,
} from "../../artifacts/kub/src/lib/privacyPreferences.ts";

interface Recorder extends PrivacyGateway {
  reads: string[];
  writes: Array<{ userId: string; presenceVisible: boolean }>;
  rows: Record<string, PrivacyPreferences | undefined>;
  cleared: string[];
  statuses: Array<{ userId: string; status: string; until: string | null }>;
}

/** The whole row, as the table holds it; a bare boolean is presence shorthand. */
const row = (value: boolean | Partial<PrivacyPreferences>): PrivacyPreferences =>
  typeof value === "boolean"
    ? { ...PRIVACY_DEFAULTS, presenceVisible: value }
    : { ...PRIVACY_DEFAULTS, ...value };

function recordingGateway(
  seed: Record<string, boolean | Partial<PrivacyPreferences> | undefined> = {},
  failures: { read?: Error; write?: Error; clear?: Error; status?: Error } = {},
): Recorder {
  const reads: string[] = [];
  const writes: Array<{ userId: string; presenceVisible: boolean }> = [];
  const cleared: string[] = [];
  const statuses: Array<{ userId: string; status: string; until: string | null }> = [];
  const rows: Record<string, PrivacyPreferences | undefined> = {};
  for (const [userId, value] of Object.entries(seed)) {
    if (value !== undefined) rows[userId] = row(value);
  }
  return {
    reads,
    writes,
    cleared,
    statuses,
    rows,
    async read(userId) {
      reads.push(userId);
      if (failures.read) throw failures.read;
      return rows[userId] ?? null;
    },
    async write(userId, preferences) {
      if (failures.write) throw failures.write;
      writes.push({ userId, presenceVisible: preferences.presenceVisible });
      rows[userId] = { ...preferences };
    },
    async clearPresence(userId) {
      if (failures.clear) throw failures.clear;
      cleared.push(userId);
    },
    // `presence_set_status`: two columns of the row, and nothing else.
    async setStatus(userId, status, until) {
      if (failures.status) throw failures.status;
      statuses.push({ userId, status, until });
      rows[userId] = { ...(rows[userId] ?? PRIVACY_DEFAULTS), manualStatus: status, manualStatusUntil: until };
    },
  };
}

test("an absent row means presence is published", async () => {
  const store = createPrivacyPreferencesStore(recordingGateway());
  await store.sync("user-1");
  assert.deepEqual(store.getSnapshot(), {
    preferences: { presenceVisible: true, forwardOriginVisible: true, manualStatus: "online", manualStatusUntil: null },
    loading: false,
    error: null,
    userId: "user-1",
  });
});

test("a stored preference is what the person gets back", async () => {
  const store = createPrivacyPreferencesStore(recordingGateway({ "user-1": false }));
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, false);
  assert.equal(store.getSnapshot().loading, false);
});

test("every reader sees one snapshot, so the heartbeat cannot disagree with the switch", async () => {
  // This is the contract the whole store exists for. With state per caller,
  // turning presence off in settings left the heartbeat publishing.
  const store = createPrivacyPreferencesStore(recordingGateway());
  await store.sync("user-1");

  const settingsPanel: boolean[] = [];
  const heartbeat: boolean[] = [];
  store.subscribe(() => settingsPanel.push(store.getSnapshot().preferences.presenceVisible));
  store.subscribe(() => heartbeat.push(store.getSnapshot().preferences.presenceVisible));

  await store.setPresenceVisible("user-1", false);

  assert.equal(store.getSnapshot().preferences.presenceVisible, false);
  assert.deepEqual(settingsPanel, [false], "the panel that flipped the switch saw it");
  assert.deepEqual(heartbeat, [false], "and so did the heartbeat, without a reload");
});

test("turning presence off erases what was already published", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  assert.equal(await store.setPresenceVisible("user-1", false), true);
  assert.deepEqual(gateway.writes, [{ userId: "user-1", presenceVisible: false }]);
  assert.deepEqual(gateway.cleared, ["user-1"], "the stored last-seen value is cleared");
});

test("turning presence back on does not erase anything", async () => {
  const gateway = recordingGateway({ "user-1": false });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  await store.setPresenceVisible("user-1", true);
  assert.deepEqual(gateway.cleared, [], "there is nothing to clear when publishing resumes");
});

test("a failed write rolls the switch back instead of lying about it", async () => {
  const gateway = recordingGateway({}, { write: new Error("network down") });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  assert.equal(await store.setPresenceVisible("user-1", false), false);
  assert.equal(store.getSnapshot().preferences.presenceVisible, true, "back to what is stored");
  assert.equal(store.getSnapshot().error, "network down");
  assert.deepEqual(gateway.cleared, [], "and nothing was erased on a write that never landed");
});

test("a failed read leaves the default rather than guessing", async () => {
  const store = createPrivacyPreferencesStore(
    recordingGateway({ "user-1": false }, { read: new Error("unreachable") }),
  );
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, true);
  assert.equal(store.getSnapshot().loading, false, "a failure still ends the loading state");
  assert.equal(store.getSnapshot().error, "unreachable");
});

test("a second account does not inherit the first one's answer", async () => {
  const gateway = recordingGateway({ "user-1": false });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, false);

  await store.sync("user-2");
  assert.equal(
    store.getSnapshot().preferences.presenceVisible,
    true,
    "user-2 has no row, so user-2 publishes",
  );
  assert.deepEqual(gateway.reads, ["user-1", "user-2"]);
});

test("signing out clears the answer and stops claiming to be loading", async () => {
  const store = createPrivacyPreferencesStore(recordingGateway({ "user-1": false }));
  await store.sync("user-1");
  await store.sync(null);
  assert.deepEqual(store.getSnapshot(), {
    preferences: { presenceVisible: true, forwardOriginVisible: true, manualStatus: "online", manualStatusUntil: null },
    loading: false,
    error: null,
    userId: null,
  });
});

test("a reply for an account that has since been left is discarded", async () => {
  // The slow read for user-1 resolves after the tab has moved to user-2. It
  // must not overwrite user-2's answer with user-1's.
  let releaseFirst: (() => void) | null = null;
  const firstRead = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let call = 0;
  const gateway: PrivacyGateway = {
    async read(userId) {
      call += 1;
      if (call === 1) await firstRead;
      return { ...PRIVACY_DEFAULTS, presenceVisible: userId === "user-2" };
    },
    async write() {},
    async clearPresence() {},
    async setStatus() {},
  };

  const store = createPrivacyPreferencesStore(gateway);
  const slow = store.sync("user-1");
  const fresh = store.sync("user-2");
  releaseFirst?.();
  await Promise.all([slow, fresh]);

  assert.equal(
    store.getSnapshot().preferences.presenceVisible,
    true,
    "user-2's answer stands, not the late reply for user-1",
  );
});

test("the same account is not queried twice", async () => {
  const gateway = recordingGateway({ "user-1": false });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  await store.sync("user-1");
  await store.sync("user-1");
  assert.deepEqual(gateway.reads, ["user-1"], "settings opening again costs no query");
});

test("a write settles the value, so a later sync costs nothing and changes nothing", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  await store.setPresenceVisible("user-1", false);
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, false);
  assert.deepEqual(gateway.reads, ["user-1"], "the store already knows what it just wrote");
});

test("a saved choice survives a store that could never read one", async () => {
  // The read failed, so the store fell back to the default. The person then
  // turned presence off and it saved. A later sync must not re-read and hand
  // the default back — that would silently flip the switch on again.
  const failures = { read: new Error("unreachable") as Error | undefined };
  const reads: string[] = [];
  const gateway: PrivacyGateway = {
    async read(userId) {
      reads.push(userId);
      if (failures.read) throw failures.read;
      return null;
    },
    async write() {},
    async clearPresence() {},
    async setStatus() {},
  };

  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, true, "the default stood in");

  assert.equal(await store.setPresenceVisible("user-1", false), true);
  await store.sync("user-1");

  assert.equal(store.getSnapshot().preferences.presenceVisible, false, "the choice held");
  assert.deepEqual(reads, ["user-1"], "and the store did not go back for an answer it has");
});

test("a new account never shows the previous one's answer, not even while loading", async () => {
  // The window between switching accounts and the read landing is exactly when
  // the heartbeat would publish presence the new person had turned off.
  let release: (() => void) | null = null;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway: PrivacyGateway = {
    async read(userId) {
      if (userId === "user-2") await pending;
      return { ...PRIVACY_DEFAULTS, presenceVisible: userId !== "user-1" };
    },
    async write() {},
    async clearPresence() {},
    async setStatus() {},
  };

  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, false);

  const switching = store.sync("user-2");
  const midFlight = store.getSnapshot();
  assert.equal(midFlight.loading, true, "the new account's answer is not known yet");
  assert.equal(
    midFlight.preferences.presenceVisible,
    true,
    "and user-1's stored answer is gone rather than standing in for it",
  );

  release?.();
  await switching;
  assert.equal(store.getSnapshot().preferences.presenceVisible, true);
  assert.equal(store.getSnapshot().loading, false);
});

test("nothing happens without an account", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  assert.equal(await store.setPresenceVisible(null, false), false);
  assert.deepEqual(gateway.writes, []);
  assert.deepEqual(gateway.cleared, []);
});

test("a failed erase does not undo a saved preference", async () => {
  // The preference is stored and the heartbeat has already stopped; a stale
  // timestamp expiring on its own is better than telling the person their
  // choice did not take.
  const gateway = recordingGateway({}, { clear: new Error("offline") });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(await store.setPresenceVisible("user-1", false), true);
  assert.equal(store.getSnapshot().preferences.presenceVisible, false);
});

// -- whose name a forward carries (20260921120000) ---------------------------

test("an absent row discloses the name, because that is what Telegram does", async () => {
  const store = createPrivacyPreferencesStore(recordingGateway());
  await store.sync("user-1");
  assert.equal(
    store.getSnapshot().preferences.forwardOriginVisible,
    true,
    "the owner, 2026-09-20: everyone sees the original sender unless he opts out",
  );
  // A literal, not PRIVACY_DEFAULTS.forwardOriginVisible compared with itself,
  // which would hold whichever way the default was written.
  assert.equal(PRIVACY_DEFAULTS.forwardOriginVisible, true);
});

test("the opt-out is stored and comes back", async () => {
  const gateway = recordingGateway({ "user-1": { forwardOriginVisible: false } });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(store.getSnapshot().preferences.forwardOriginVisible, false);
  assert.equal(store.getSnapshot().preferences.presenceVisible, true, "the other switch is untouched");
});

/**
 * The defect this shape exists to prevent, and it is a loss of somebody's
 * choice rather than a display bug: a write naming one column resets the other
 * to its column default, so changing presence would silently turn a forward
 * opt-out back on and the person's name would start travelling again without
 * them touching anything.
 */
test("changing one switch does not reset the other", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", false), true);
  assert.equal(await store.setPresenceVisible("user-1", false), true);

  assert.deepEqual(gateway.rows["user-1"], { ...PRIVACY_DEFAULTS, presenceVisible: false, forwardOriginVisible: false });
  assert.equal(
    store.getSnapshot().preferences.forwardOriginVisible,
    false,
    "turning presence off turned the forward opt-out back on",
  );

  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", true), true);
  assert.deepEqual(gateway.rows["user-1"], { ...PRIVACY_DEFAULTS, presenceVisible: false, forwardOriginVisible: true });
});

/**
 * The same defect with four columns: a chosen status is somebody's choice too,
 * and neither switch may reset it, nor it either switch.
 */
test("choosing a status resets neither switch, and a switch does not reset the status", async () => {
  const gateway = recordingGateway({ "user-1": { forwardOriginVisible: false } });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  const until = "2026-09-30T13:00:00.000Z";
  assert.equal(await store.setManualStatus("user-1", "dnd", until), true);
  assert.deepEqual(gateway.rows["user-1"], { ...PRIVACY_DEFAULTS, forwardOriginVisible: false, manualStatus: "dnd", manualStatusUntil: until });

  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", true), true);
  assert.deepEqual(gateway.rows["user-1"], { ...PRIVACY_DEFAULTS, manualStatus: "dnd", manualStatusUntil: until });
});

test("«В сети» carries no end, whatever the caller passed", async () => {
  const gateway = recordingGateway({ "user-1": { manualStatus: "idle", manualStatusUntil: "2026-09-30T13:00:00.000Z" } });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(await store.setManualStatus("user-1", "online", "2026-10-01T00:00:00.000Z"), true);
  assert.deepEqual(gateway.statuses, [{ userId: "user-1", status: "online", until: null }], "the database refuses «online» with an end");
  assert.equal(store.getSnapshot().preferences.manualStatusUntil, null);
});

test("a status goes to the database's own call, which publishes it; nothing is erased from here", async () => {
  // `presence_set_status` stores the choice and publishes it in one go —
  // «Невидимый» included, which it hides — so the client neither writes the
  // whole row for it nor clears presence itself.
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  await store.setManualStatus("user-1", "invisible", null);
  assert.deepEqual(gateway.statuses, [{ userId: "user-1", status: "invisible", until: null }]);
  assert.deepEqual(gateway.writes, []);
  assert.deepEqual(gateway.cleared, []);
});

test("a failed status write puts the previous status back", async () => {
  const gateway = recordingGateway({ "user-1": { manualStatus: "idle" } }, { status: new Error("network down") });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  assert.equal(await store.setManualStatus("user-1", "dnd", null), false);
  assert.equal(store.getSnapshot().preferences.manualStatus, "idle");
  assert.equal(store.getSnapshot().error, "network down");
  assert.deepEqual(gateway.cleared, []);
});

test("a failed write rolls the forward switch back too", async () => {
  const gateway = recordingGateway({}, { write: new Error("network down") });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");

  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", false), false);
  assert.equal(store.getSnapshot().preferences.forwardOriginVisible, true, "back to what is stored");
  assert.equal(store.getSnapshot().error, "network down");
});

test("hiding the name erases nothing, because nothing already sent may change", async () => {
  // Presence clears a stored timestamp. A forward's origin is written onto each
  // copy at forward time and is permanent by design, so clearing here would be
  // reaching back into messages already sent - the direction the decision
  // explicitly refuses.
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  await store.setPreference("user-1", "forwardOriginVisible", false);
  assert.deepEqual(gateway.cleared, []);
});

test("nothing is written for the forward switch without an account", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  assert.equal(await store.setPreference(null, "forwardOriginVisible", false), false);
  assert.deepEqual(gateway.writes, []);
});

test("an answer says whose it is, and a new account's is not anybody's until it arrives", async () => {
  let release: (() => void) | null = null;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway = recordingGateway();
  const slow: PrivacyGateway = {
    ...gateway,
    async read(userId) {
      if (userId === "user-2") await pending;
      return gateway.read(userId);
    },
  };
  const store = createPrivacyPreferencesStore(slow);
  assert.equal(store.getSnapshot().userId, null, "before any account was asked about");
  await store.sync("user-1");
  assert.equal(store.getSnapshot().userId, "user-1");

  const switching = store.sync("user-2");
  assert.deepEqual(
    { userId: store.getSnapshot().userId, loading: store.getSnapshot().loading },
    { userId: "user-2", loading: true },
    "the new account's, and still being asked",
  );
  release!();
  await switching;
  assert.deepEqual({ userId: store.getSnapshot().userId, loading: store.getSnapshot().loading }, { userId: "user-2", loading: false });

  await store.sync(null);
  assert.equal(store.getSnapshot().userId, null);
});

test("a refresh asks again for the same account, so a status chosen elsewhere arrives", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  // Chosen on the phone.
  gateway.rows["user-1"] = { ...PRIVACY_DEFAULTS, manualStatus: "dnd", manualStatusUntil: null };
  await store.refresh("user-1");
  assert.equal(store.getSnapshot().preferences.manualStatus, "dnd");
  assert.equal(store.getSnapshot().loading, false, "a refresh never shows a loading state");
  assert.deepEqual(gateway.reads, ["user-1", "user-1"]);
});

test("a refresh asks nothing for an account the store is not on, or before its first answer", async () => {
  const gateway = recordingGateway();
  const store = createPrivacyPreferencesStore(gateway);
  await store.refresh("user-1");
  await store.refresh(null);
  assert.deepEqual(gateway.reads, [], "nothing held yet");
  await store.sync("user-1");
  await store.refresh("user-2");
  assert.deepEqual(gateway.reads, ["user-1"]);
});

test("a failed refresh keeps the answer already held", async () => {
  const failures: { read?: Error } = {};
  const gateway = recordingGateway({ "user-1": { presenceVisible: false } }, failures);
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  failures.read = new Error("network down");
  await store.refresh("user-1");
  assert.equal(store.getSnapshot().preferences.presenceVisible, false, "not the default handed back");
  assert.equal(store.getSnapshot().error, null);
});

/**
 * A read in flight when the person changes something would otherwise land
 * afterwards and put the old value back — a switch that flips back by itself.
 */
test("a read that started before a write cannot undo it", async () => {
  let release: (() => void) | null = null;
  const gateway = recordingGateway({ "user-1": { forwardOriginVisible: true } });
  let held = false;
  const slow: PrivacyGateway = {
    ...gateway,
    async read(userId) {
      const row = await gateway.read(userId);
      if (held) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return row;
    },
  };
  const store = createPrivacyPreferencesStore(slow);
  await store.sync("user-1");
  held = true;
  const refreshing = store.refresh("user-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", false), true);
  release!();
  await refreshing;
  assert.equal(store.getSnapshot().preferences.forwardOriginVisible, false, "the stale read put the old value back");
});

/**
 * The heartbeat reads this store at the root of the application. A refresh that
 * brought back the answer already held used to hand out a new object for it,
 * and the open conversation rendered again for nothing on every return to the
 * window (`chat-list-event-cost.spec.ts`, 2026-09-30).
 */
test("an answer that did not change is not handed out again", async () => {
  const gateway = recordingGateway({ "user-1": { presenceVisible: false } });
  const store = createPrivacyPreferencesStore(gateway);
  await store.sync("user-1");
  const held = store.getSnapshot();
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  await store.refresh("user-1");
  assert.equal(notified, 0);
  assert.equal(store.getSnapshot(), held, "the same object, so nothing re-renders");

  gateway.rows["user-1"] = { ...PRIVACY_DEFAULTS, presenceVisible: false, manualStatus: "dnd" };
  await store.refresh("user-1");
  assert.equal(notified, 1, "a changed answer still arrives");
});
