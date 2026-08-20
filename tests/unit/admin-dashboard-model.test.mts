import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRegistrationSeries,
  formatAdminAuditEvent,
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
