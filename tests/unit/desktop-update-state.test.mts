import assert from "node:assert/strict";
import test from "node:test";

import {
  checkDesktopUpdate,
  createDesktopUpdateFailureSnapshot,
  getDesktopUpdatePresentation,
  readDesktopUpdateSnapshot,
  parseDesktopUpdateSnapshot,
  type DesktopUpdateSnapshot,
} from "../../artifacts/kub/src/lib/platform/desktopUpdates.ts";

const BASE_SNAPSHOT: DesktopUpdateSnapshot = {
  channel: "stable",
  phase: "current",
  installedVersion: "0.2.0",
  availableVersion: null,
  downloadedBytes: 0,
  totalBytes: null,
  mandatory: false,
  errorCode: null,
};

function fixture(overrides: Partial<DesktopUpdateSnapshot> = {}) {
  const snapshot = parseDesktopUpdateSnapshot({ ...BASE_SNAPSHOT, ...overrides });
  assert.ok(snapshot);
  return snapshot;
}

test("normal update is compact and requires a click", () => {
  const state = fixture({
    phase: "available",
    availableVersion: "0.2.1",
    totalBytes: 1_200_000,
  });
  const presentation = getDesktopUpdatePresentation(state);

  assert.equal(presentation.blocking, false);
  assert.equal(presentation.action, "install");
  assert.equal(presentation.persistent, true);
});

test("only a critical stable update blocks the messenger", () => {
  const stable = fixture({
    phase: "critical_update_required",
    availableVersion: "0.3.0",
    mandatory: true,
  });
  const testChannel = fixture({
    channel: "test",
    phase: "available",
    availableVersion: "0.3.0-beta.1",
  });

  assert.equal(getDesktopUpdatePresentation(stable).blocking, true);
  assert.equal(getDesktopUpdatePresentation(testChannel).blocking, false);
});

test("download presentation exposes bounded determinate progress", () => {
  const presentation = getDesktopUpdatePresentation(fixture({
    phase: "downloading",
    availableVersion: "0.2.1",
    downloadedBytes: 300,
    totalBytes: 1_200,
  }));

  assert.equal(presentation.action, null);
  assert.equal(presentation.progress, 25);
  assert.equal(presentation.persistent, true);
});

test("current state auto-collapses while failures remain discoverable", () => {
  const current = getDesktopUpdatePresentation(fixture());
  const testCurrent = getDesktopUpdatePresentation(fixture({ channel: "test" }));
  const failed = getDesktopUpdatePresentation(fixture({
    phase: "failed",
    errorCode: "update_check_failed",
  }));

  assert.equal(current.persistent, false);
  assert.equal(current.action, "check");
  assert.equal(testCurrent.persistent, true);
  assert.match(testCurrent.title, /тестовый/i);
  assert.equal(failed.persistent, true);
  assert.equal(failed.action, "check");
  assert.doesNotMatch(failed.description, /update_check_failed/);
});

test("strict parser accepts prerelease SemVer but rejects malformed bridge payloads", () => {
  assert.equal(fixture({
    channel: "test",
    phase: "available",
    availableVersion: "0.3.0-beta.1+qa.4",
  }).availableVersion, "0.3.0-beta.1+qa.4");

  const invalid: unknown[] = [
    { ...BASE_SNAPSHOT, channel: "preview" },
    { ...BASE_SNAPSHOT, phase: "ready" },
    { ...BASE_SNAPSHOT, installedVersion: "v0.2.0" },
    { ...BASE_SNAPSHOT, availableVersion: "latest" },
    { ...BASE_SNAPSHOT, downloadedBytes: -1 },
    { ...BASE_SNAPSHOT, downloadedBytes: 2, totalBytes: 1 },
    { ...BASE_SNAPSHOT, totalBytes: Number.POSITIVE_INFINITY },
    { ...BASE_SNAPSHOT, mandatory: "yes" },
    { ...BASE_SNAPSHOT, errorCode: { raw: "bridge payload" } },
  ];

  for (const value of invalid) {
    assert.equal(parseDesktopUpdateSnapshot(value), null);
  }
});

test("parser enforces phase invariants and stable-only critical state", () => {
  assert.equal(parseDesktopUpdateSnapshot({
    ...BASE_SNAPSHOT,
    channel: "test",
    phase: "critical_update_required",
    availableVersion: "0.3.0-beta.1",
    mandatory: true,
  }), null);
  assert.equal(parseDesktopUpdateSnapshot({
    ...BASE_SNAPSHOT,
    phase: "available",
    availableVersion: null,
  }), null);
  assert.equal(parseDesktopUpdateSnapshot({
    ...BASE_SNAPSHOT,
    phase: "current",
    availableVersion: "0.2.1",
  }), null);
});

test("browser update adapter is inert without the frozen desktop bridge", async () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {} as typeof window;
    assert.equal(await readDesktopUpdateSnapshot(), null);
    assert.equal(await checkDesktopUpdate(), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("concurrent desktop commands coalesce and parse the bridge result", async () => {
  const previousWindow = globalThis.window;
  let calls = 0;
  let release: ((value: unknown) => void) | null = null;
  const pending = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  try {
    globalThis.window = {
      letscubeDesktop: {
        platform: "windows",
        getRuntimeInfo: async () => ({ platform: "windows", version: "0.2.0", build: 4 }),
        checkUpdate: async () => {
          calls += 1;
          return pending;
        },
      },
    } as typeof window;

    const first = checkDesktopUpdate();
    const second = checkDesktopUpdate();
    assert.equal(calls, 1);
    release?.({
      ...BASE_SNAPSHOT,
      phase: "available",
      availableVersion: "0.2.1",
    });
    assert.deepEqual(await first, await second);
    assert.equal((await first)?.availableVersion, "0.2.1");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop adapter replaces raw native failures with a sanitized error", async () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {
      letscubeDesktop: {
        platform: "windows",
        getRuntimeInfo: async () => ({ platform: "windows", version: "0.2.0", build: 4 }),
        checkUpdate: async () => Promise.reject({ token: "must-not-escape" }),
      },
    } as typeof window;

    await assert.rejects(checkDesktopUpdate(), (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "desktop_update_check_failed");
      assert.doesNotMatch(String(error), /must-not-escape/);
      return true;
    });
  } finally {
    globalThis.window = previousWindow;
  }
});

test("native bridge failure has a bounded discoverable fallback state", () => {
  const fallback = createDesktopUpdateFailureSnapshot("0.2.0");

  assert.deepEqual(fallback, {
    ...BASE_SNAPSHOT,
    phase: "failed",
    errorCode: "desktop_update_unavailable",
  });
  assert.equal(getDesktopUpdatePresentation(fallback).persistent, true);
});
