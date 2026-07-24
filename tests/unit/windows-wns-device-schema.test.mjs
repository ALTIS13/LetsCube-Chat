import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql",
  import.meta.url,
);

test("Windows WNS device proposal extends the existing native push model safely", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /drop constraint if exists user_push_devices_platform_check/i,
  );
  assert.match(
    sql,
    /platform in \('android', 'ios', 'windows'\)/i,
  );
  assert.match(
    sql,
    /provider in \('fcm', 'apns', 'wns'\)/i,
  );
  assert.match(
    sql,
    /constraint user_push_devices_platform_provider_check[\s\S]+platform = 'android' and provider = 'fcm'[\s\S]+platform = 'ios' and provider = 'apns'[\s\S]+platform = 'windows' and provider = 'wns'/i,
  );
  assert.match(
    sql,
    /alter table public\.user_push_devices enable row level security/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.user_push_devices from public, anon, authenticated/i,
  );
});

test("Windows WNS registration trusts auth.uid and validates channel URI server-side", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /create or replace function public\.register_push_device\(/i,
  );
  assert.match(sql, /if auth\.uid\(\) is null then/i);
  assert.match(
    sql,
    /v_platform = 'windows' and v_provider = 'wns'/i,
  );
  assert.match(sql, /notify\\?\.windows\\?\.com/i);
  assert.match(
    sql,
    /v_token_hash := encode\(digest\(v_token, 'sha256'\), 'hex'\)/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.register_push_device\(text, text, text, text, text, text, text\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.register_push_device\(text, text, text, text, text, text, text\)[\s\S]+to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.register_push_device[^;]+to anon/i,
  );
});

test("Windows WNS enqueue preserves Android FCM and selects only valid provider pairs", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /create or replace function public\._enqueue_push_after_notification_insert\(\)/i,
  );
  assert.match(
    sql,
    /pd\.platform = 'android' and pd\.provider = 'fcm'/i,
  );
  assert.match(
    sql,
    /pd\.platform = 'windows' and pd\.provider = 'wns'/i,
  );
  assert.match(sql, /pd\.enabled is true/i);
  assert.match(sql, /pd\.revoked_at is null/i);
  assert.match(
    sql,
    /on conflict \(notification_id, device_id\) do nothing/i,
  );
  assert.match(
    sql,
    /revoke all on function public\._enqueue_push_after_notification_insert\(\)[\s\S]+from public, anon, authenticated/i,
  );
});
