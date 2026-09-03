import assert from "node:assert/strict";
import test from "node:test";

import {
  accentBorder,
  accentSurface,
  attachmentHint,
  notificationAccent,
  notificationTone,
} from "../../artifacts/kub/src/lib/notificationPresentation.ts";

test("each kind of notification gets its own tone", () => {
  assert.equal(notificationTone("message"), "message");
  assert.equal(notificationTone("task_assigned"), "task");
  assert.equal(notificationTone("task_waiting_confirmation"), "task");
  assert.equal(notificationTone("support_ticket_created"), "support");
  assert.equal(notificationTone("support_requester_message"), "support");
  assert.equal(notificationTone("group_invite"), "invite");
  assert.equal(notificationTone("chat_added"), "invite");
  assert.equal(notificationTone("ban_issued"), "system");
  assert.equal(notificationTone("mute_issued"), "system");
});

test("a support message is support, not a message", () => {
  // Both kinds contain "message"; the support prefix has to win or the ticket
  // reply would be drawn as a chat message.
  assert.equal(notificationTone("support_operator_message"), "support");
  assert.notEqual(notificationTone("support_operator_message"), notificationTone("message"));
});

test("no two tones share a colour, or the stream stays undifferentiated", () => {
  const colors = new Set(
    (["message", "task", "support", "invite", "system"] as const).map(
      (kind) =>
        notificationAccent({
          kind:
            kind === "message"
              ? "message"
              : kind === "task"
                ? "task_assigned"
                : kind === "support"
                  ? "support_ticket_created"
                  : kind === "invite"
                    ? "group_invite"
                    : "ban_issued",
          payload: {},
        }).color,
    ),
  );
  assert.equal(colors.size, 5);
});

test("an urgent task is drawn as an alert, not as a louder task", () => {
  const ordinary = notificationAccent({ kind: "task_assigned", payload: { priority: "normal" } });
  const urgent = notificationAccent({ kind: "task_assigned", payload: { priority: "urgent" } });

  assert.equal(ordinary.urgent, false);
  assert.equal(urgent.urgent, true);
  assert.notEqual(urgent.color, ordinary.color, "urgency changes the hue");
  assert.deepEqual(
    urgent.chips.map((chip) => chip.key),
    ["urgent"],
  );
  assert.equal(urgent.chips[0].emphasis, "alert");
});

test("an urgent task from an administrator says both things", () => {
  // They are different facts: one is about when, the other about who, and a
  // reader acts on them differently.
  const accent = notificationAccent({
    kind: "task_assigned",
    payload: { priority: "urgent", created_for_admin: true },
  });
  assert.deepEqual(accent.chips.map((chip) => chip.key), ["urgent", "admin"]);
  assert.equal(accent.urgent, true);
});

test("a high-priority task is marked without being made an alert", () => {
  const accent = notificationAccent({ kind: "task_assigned", payload: { priority: "high" } });
  assert.equal(accent.urgent, false);
  assert.deepEqual(accent.chips.map((chip) => chip.key), ["high"]);
  assert.equal(accent.chips[0].emphasis, "quiet");
});

test("urgency is a claim only a task may make", () => {
  // A chat message carrying a stray priority must not steal the alert.
  for (const kind of ["message", "ban_issued", "group_invite", "support_ticket_created"]) {
    const accent = notificationAccent({ kind, payload: { priority: "urgent" } });
    assert.equal(accent.urgent, false, `${kind} must not raise itself`);
    assert.deepEqual(accent.chips, []);
  }
});

test("an unrecognised priority is not urgency", () => {
  for (const priority of ["URGENT", "critical", "", null, 5, true]) {
    const accent = notificationAccent({ kind: "task_assigned", payload: { priority } });
    assert.equal(accent.urgent, false, `${String(priority)} must not read as urgent`);
  }
});

test("created_for_admin is read whether it arrives as a boolean or a string", () => {
  for (const value of [true, "true"]) {
    const accent = notificationAccent({ kind: "task_assigned", payload: { created_for_admin: value } });
    assert.ok(accent.chips.some((chip) => chip.key === "admin"));
  }
  for (const value of [false, "false", null, undefined, 0, "yes"]) {
    const accent = notificationAccent({ kind: "task_assigned", payload: { created_for_admin: value } });
    assert.equal(accent.chips.some((chip) => chip.key === "admin"), false, `${String(value)}`);
  }
});

test("a message with an attachment says which kind", () => {
  for (const [type, label] of [
    ["image", "Фото"],
    ["video", "Видео"],
    ["audio", "Голосовое"],
    ["file", "Файл"],
    ["location", "Местоположение"],
  ] as const) {
    const accent = notificationAccent({ kind: "message", payload: { message_type: type } });
    assert.equal(accent.attachment?.label, label);
    assert.ok(accent.attachment?.icon);
  }
});

test("a plain text message carries no attachment hint", () => {
  assert.equal(notificationAccent({ kind: "message", payload: { message_type: "text" } }).attachment, null);
  assert.equal(notificationAccent({ kind: "message", payload: {} }).attachment, null);
});

test("an attachment type this build has never heard of shows nothing rather than a wrong icon", () => {
  assert.equal(attachmentHint({ message_type: "hologram" }), null);
  // A plain object lookup reaches the prototype: a message typed "constructor"
  // would resolve to a function and be rendered as an attachment.
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(attachmentHint({ message_type: key }), null, key);
  }
  assert.equal(attachmentHint({ message_type: 7 }), null);
  assert.equal(attachmentHint(null), null);
  assert.equal(attachmentHint("not an object"), null);
});

test("only a message shows an attachment, whatever the payload claims", () => {
  const accent = notificationAccent({ kind: "task_assigned", payload: { message_type: "image" } });
  assert.equal(accent.attachment, null);
});

test("a read notification loses its tint but an urgent one keeps its edge", () => {
  const urgent = notificationAccent({ kind: "task_assigned", payload: { priority: "urgent" } });
  const ordinary = notificationAccent({ kind: "message", payload: {} });

  assert.equal(accentSurface(ordinary, false), "var(--kub-surface-2)", "read and ordinary is plain");
  assert.notEqual(accentSurface(ordinary, true), "var(--kub-surface-2)", "unread is tinted");
  assert.notEqual(accentSurface(urgent, false), "var(--kub-surface-2)", "urgency survives being read");
  assert.notEqual(
    accentBorder(urgent, false),
    "var(--kub-border-color)",
    "and so does its border",
  );
  assert.equal(accentBorder(ordinary, false), "var(--kub-border-color)");
});

test("an unread urgent item is stronger than a read one", () => {
  const urgent = notificationAccent({ kind: "task_assigned", payload: { priority: "urgent" } });
  assert.notEqual(accentSurface(urgent, true), accentSurface(urgent, false));
});

test("a malformed payload never throws", () => {
  for (const payload of [null, undefined, 7, "text", [], { priority: {} }]) {
    const accent = notificationAccent({ kind: "task_assigned", payload });
    assert.equal(accent.urgent, false);
    assert.ok(accent.color);
  }
});

test("an unknown kind falls back to system rather than to a message", () => {
  // Guessing "message" would put an unknown event into the conversation tone,
  // which is the one place it certainly does not belong.
  assert.equal(notificationTone("something_new"), "system");
});
