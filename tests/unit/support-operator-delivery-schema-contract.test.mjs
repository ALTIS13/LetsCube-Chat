import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../.migration-backup/supabase/migrations/20260727_support_operator_delivery_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

test("operator directory exposes only eligible operators through a permission-scoped RPC", () => {
  assert.match(sql, /support_operator_directory\s*\(/i);
  assert.match(sql, /support\.transfer/i);
  assert.match(sql, /has_permission\s*\([^)]*support\.view/i);
  assert.match(sql, /has_permission\s*\([^)]*support\.reply/i);
  assert.match(sql, /grant execute[\s\S]*support_operator_directory[\s\S]*authenticated/i);
});

test("settings v2 validates ticket and message rate limits", () => {
  assert.match(sql, /support_settings_update_v2\s*\(/i);
  for (const field of [
    "ticket_limit_15m",
    "ticket_limit_day",
    "message_limit_5m",
    "message_limit_day",
  ]) {
    assert.match(sql, new RegExp(field, "i"));
  }
  assert.match(sql, /support\.settings/i);
});

test("operator preferences suppress only OS push delivery, not in-app rows", () => {
  assert.match(sql, /support_push_outbox_guard/i);
  assert.match(sql, /support_operator_preferences/i);
  assert.match(sql, /push_enabled/i);
  assert.match(sql, /notifications_push_outbox/i);
  assert.match(sql, /notifications_native_push_outbox/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.notifications\b/i);
});

test("transfer preference is enforced before support notification fan-out", () => {
  assert.match(sql, /notify_transfers/i);
  assert.match(sql, /p_support_event\s*=\s*'transferred'/i);
});
