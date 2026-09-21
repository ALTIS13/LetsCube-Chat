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
}

/** The whole row, as the table holds it; a bare boolean is presence shorthand. */
const row = (value: boolean | Partial<PrivacyPreferences>): PrivacyPreferences =>
  typeof value === "boolean"
    ? { ...PRIVACY_DEFAULTS, presenceVisible: value }
    : { ...PRIVACY_DEFAULTS, ...value };

function recordingGateway(
  seed: Record<string, boolean | Partial<PrivacyPreferences> | undefined> = {},
  failures: { read?: Error; write?: Error; clear?: Error } = {},
): Recorder {
  const reads: string[] = [];
  const writes: Array<{ userId: string; presenceVisible: boolean }> = [];
  const cleared: string[] = [];
  const rows: Record<string, PrivacyPreferences | undefined> = {};
  for (const [userId, value] of Object.entries(seed)) {
    if (value !== undefined) rows[userId] = row(value);
  }
  return {
    reads,
    writes,
    cleared,
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
  };
}

test("an absent row means presence is published", async () => {
  const store = createPrivacyPreferencesStore(recordingGateway());
  await store.sync("user-1");
  assert.deepEqual(store.getSnapshot(), {
    preferences: { presenceVisible: true, forwardOriginVisible: true },
    loading: false,
    error: null,
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
    preferences: { presenceVisible: true, forwardOriginVisible: true },
    loading: false,
    error: null,
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

  assert.deepEqual(gateway.rows["user-1"], { presenceVisible: false, forwardOriginVisible: false });
  assert.equal(
    store.getSnapshot().preferences.forwardOriginVisible,
    false,
    "turning presence off turned the forward opt-out back on",
  );

  assert.equal(await store.setPreference("user-1", "forwardOriginVisible", true), true);
  assert.deepEqual(gateway.rows["user-1"], { presenceVisible: false, forwardOriginVisible: true });
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
