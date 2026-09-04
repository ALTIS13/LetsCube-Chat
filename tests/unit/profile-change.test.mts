import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  HEARTBEAT_ONLY_PROFILE_FIELDS,
  isHeartbeatOnlyProfileChange,
} from "../../artifacts/kub/src/lib/profileChange.ts";

/** A profile row as it actually reaches the store: the whole `profiles` row. */
function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "6f8b94d6-72de-42fc-927c-ba18909b5d5c",
    full_name: "Пример",
    username: "example",
    avatar_url: null,
    bio: null,
    role: "user",
    profile_frame: null,
    profile_background: null,
    online_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
}

test("a heartbeat echo is not worth a repaint", () => {
  // What the filter was written for: `useHeartbeat` writes `online_at`, realtime
  // returns the whole row, and re-creating `currentUser` each time is the Task
  // #48 storm loop.
  const before = profile();
  const after = profile({
    online_at: "2026-09-04T12:00:30.000Z",
    updated_at: "2026-09-04T12:00:30.000Z",
  });
  assert.equal(isHeartbeatOnlyProfileChange(before, after), true);
});

test("choosing a frame is a real change", () => {
  // The reported bug, in one line. Every field on the old allowlist compares
  // equal, so the store returned the same object and the button looked dead —
  // while the write to the database had already succeeded.
  assert.equal(
    isHeartbeatOnlyProfileChange(profile(), profile({ profile_frame: "frame_beta" })),
    false,
  );
});

test("clearing a frame is a real change too", () => {
  assert.equal(
    isHeartbeatOnlyProfileChange(profile({ profile_frame: "frame_beta" }), profile()),
    false,
  );
});

test("choosing a background is a real change", () => {
  assert.equal(
    isHeartbeatOnlyProfileChange(profile(), profile({ profile_background: "bg_alpha" })),
    false,
  );
});

test("a column nobody has thought of yet is significant by default", () => {
  // The point of the black list. This is the assertion the old code could not
  // have passed, and the reason the fix is an inversion rather than two more
  // field names.
  assert.equal(
    isHeartbeatOnlyProfileChange(profile(), profile({ some_future_column: "value" })),
    false,
  );
  assert.equal(
    isHeartbeatOnlyProfileChange(
      profile({ profile_title: "old" }),
      profile({ profile_title: "new" }),
    ),
    false,
  );
});

test("the fields the old allowlist did cover still count", () => {
  for (const [key, value] of [
    ["full_name", "Другое имя"],
    ["username", "other"],
    ["avatar_url", "https://core.letscube.ru/x.webp"],
    ["bio", "текст"],
    ["role", "admin"],
    ["id", "0e6c5da0-0000-4000-8000-000000000000"],
  ] as const) {
    assert.equal(
      isHeartbeatOnlyProfileChange(profile(), profile({ [key]: value })),
      false,
      `${key} stopped counting as a change`,
    );
  }
});

test("only the two heartbeat fields are ignored", () => {
  assert.deepEqual([...HEARTBEAT_ONLY_PROFILE_FIELDS].sort(), ["online_at", "updated_at"]);
});

test("an identical row is not a change", () => {
  assert.equal(isHeartbeatOnlyProfileChange(profile(), profile()), true);
});

test("the store defers to this module rather than keeping its own list", () => {
  // The bug was a second copy of the rule drifting out of date. One copy.
  const store = readFileSync("artifacts/kub/src/store/app.store.ts", "utf8");
  assert.ok(
    store.includes("isHeartbeatOnlyProfileChange"),
    "app.store.ts no longer uses the shared comparison",
  );
  assert.ok(
    !/a\.full_name === b\.full_name/.test(store),
    "app.store.ts has grown a hand-maintained allowlist again",
  );
});
