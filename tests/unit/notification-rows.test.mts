import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeNotificationRows,
  rollbackFailedNotificationReads,
} from "../../artifacts/kub/src/lib/notificationRows.ts";

const unread = {
  id: "notification-1",
  created_at: "2026-09-24T10:00:00.000Z",
  read_at: null as string | null,
  title: "Old title",
};

test("a stale refresh cannot undo a local read receipt", () => {
  const readAt = "2026-09-24T10:01:00.000Z";
  const current = { ...unread, read_at: readAt };
  const incoming = { ...unread, title: "Updated title" };

  assert.deepEqual(mergeNotificationRows([current], [incoming], 30), [
    { ...incoming, read_at: readAt },
  ]);
});

test("a server read receipt is accepted and rows remain newest first", () => {
  const readAt = "2026-09-24T10:01:00.000Z";
  const second = {
    id: "notification-2",
    created_at: "2026-09-24T10:02:00.000Z",
    read_at: null as string | null,
    title: "Second",
  };

  assert.deepEqual(
    mergeNotificationRows([unread], [{ ...unread, read_at: readAt }, second], 30),
    [second, { ...unread, read_at: readAt }],
  );
});

test("merge keeps the newest rows within the requested page size", () => {
  const second = {
    id: "notification-2",
    created_at: "2026-09-24T10:02:00.000Z",
    read_at: null as string | null,
    title: "Second",
  };
  const third = {
    id: "notification-3",
    created_at: "2026-09-24T10:03:00.000Z",
    read_at: null as string | null,
    title: "Third",
  };

  assert.deepEqual(mergeNotificationRows([unread], [third, second], 2), [third, second]);
});

test("a failed read does not roll back another row that the server accepted", () => {
  const readAt = "2026-09-24T10:01:00.000Z";
  const second = {
    id: "notification-2",
    created_at: "2026-09-24T10:02:00.000Z",
    read_at: readAt,
    title: "Second",
  };
  const first = { ...unread, read_at: readAt };

  assert.deepEqual(
    rollbackFailedNotificationReads(
      [first, second],
      new Map([[first.id, null], [second.id, null]]),
      new Set([second.id]),
    ),
    [first, { ...second, read_at: null }],
  );
});
