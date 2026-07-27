import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSupportNotification,
  isSupportNotification,
  supportNotificationTarget,
  supportNotificationTargetsRequester,
} from "../../artifacts/kub/src/lib/support/notifications.ts";

const ticketId = "2ab5bc76-751d-4b40-b868-805b07356886";

test("support notifications accept only bounded ticket metadata", () => {
  const item = {
    kind: "support_requester_message",
    payload: {
      ticket_id: ticketId,
      support_event: "requester_message",
      route: "https://evil.example/steal",
      email: "private@example.invalid",
      body: "private support text",
    },
  };

  assert.equal(isSupportNotification(item), true);
  assert.deepEqual(supportNotificationTarget(item.payload, true), {
    kind: "operator",
    route: `/admin/support?ticket=${ticketId}`,
  });
  assert.deepEqual(supportNotificationTarget(item.payload, false), {
    kind: "requester",
    route: "/support",
  });
});

test("support notification routing rejects malformed ticket identifiers", () => {
  assert.equal(
    supportNotificationTarget(
      {
        ticket_id: "../admin",
        support_event: "ticket_created",
        route: "/admin/support?ticket=trusted-by-payload",
      },
      true,
    ),
    null,
  );
});

test("support notification copy never includes private payload fields", () => {
  const display = formatSupportNotification({
    kind: "support_escalated",
    payload: {
      ticket_id: ticketId,
      support_event: "escalated",
      email: "private@example.invalid",
      phone: "+79990000000",
      body: "private support text",
    },
  });

  assert.deepEqual(display, {
    title: "Обращение эскалировано",
    body: "Обращение передано старшему оператору.",
    typeLabel: "Поддержка",
  });
  assert.doesNotMatch(JSON.stringify(display), /private|7999/i);
});

test("non-support notifications are not reclassified", () => {
  assert.equal(
    isSupportNotification({
      kind: "message",
      payload: { ticket_id: ticketId },
    }),
    false,
  );
});

test("requester events are distinguished from operator queue events", () => {
  assert.equal(
    supportNotificationTargetsRequester({
      kind: "support_operator_message",
      payload: { support_event: "operator_message" },
    }),
    true,
  );
  assert.equal(
    supportNotificationTargetsRequester({
      kind: "support_ticket_created",
      payload: { support_event: "ticket_created" },
    }),
    false,
  );
});
