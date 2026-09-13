import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRegistrationSeries,
  formatAdminAuditEvent,
  formatAdminDateTime,
  formatNewUserLine,
} from "../../artifacts/kub/src/pages/admin/dashboardModel.ts";

test("registration series includes every requested day, including zero days", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const series = buildRegistrationSeries(
    [
      { created_at: "2026-08-20T09:00:00.000Z" },
      { created_at: "2026-08-18T08:00:00.000Z" },
      { created_at: "invalid" },
    ],
    now,
    7,
  );

  assert.equal(series.length, 7);
  assert.equal(series.at(-1)?.value, 1);
  assert.equal(series.reduce((sum, point) => sum + point.value, 0), 2);
  assert.ok(series.some((point) => point.value === 0));
});

test("audit formatter never exposes unknown actions or raw payloads", () => {
  const result = formatAdminAuditEvent({
    id: "audit-1",
    actor_id: null,
    action: "unexpected_internal_action",
    target_kind: "internal",
    target_id: "private-id",
    diff: { payload: "private-value" },
    created_at: "2026-08-20T09:00:00.000Z",
  });

  assert.equal(result, "Системное событие");
  assert.doesNotMatch(result, /unexpected|private|payload/i);
});

test("audit formatter describes known registration mode changes in Russian", () => {
  const result = formatAdminAuditEvent({
    id: "audit-2",
    actor_id: null,
    action: "registration_invite_mode_updated",
    target_kind: "registration",
    target_id: null,
    diff: { invite_only_enabled: true },
    created_at: "2026-08-20T09:00:00.000Z",
  });

  assert.equal(result, "Регистрация ограничена приглашениями");
});

test("a new registration is described by when it happened, not by a legacy role", () => {
  // D-146. The line used to read `LEGACY_APP_ROLE_LABEL[user.role]`, which on
  // this deployment is «Пользователь» for all but two accounts and contradicts
  // the global role the same person's card shows.
  const withName = formatNewUserLine({
    full_name: "Фиктивный Участник",
    username: "fixture_user",
    created_at: "2026-09-14T08:30:00.000Z",
  });
  assert.match(withName, /^@fixture_user · /);
  assert.doesNotMatch(withName, /Пользователь/);

  // The title already falls back to «@ник» when there is no name, so the line
  // underneath must not print the same handle a second time.
  const withoutName = formatNewUserLine({
    full_name: null,
    username: "fixture_user",
    created_at: "2026-09-14T08:30:00.000Z",
  });
  assert.doesNotMatch(withoutName, /@fixture_user/);
  assert.equal(withoutName, formatAdminDateTime("2026-09-14T08:30:00.000Z"));

  // And a person with neither is still described by the one fact there is.
  assert.equal(
    formatNewUserLine({ full_name: null, username: null, created_at: "2026-09-14T08:30:00.000Z" }),
    formatAdminDateTime("2026-09-14T08:30:00.000Z"),
  );
});
