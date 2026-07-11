import assert from "node:assert/strict";
import test from "node:test";

import {
  persistPushPreferenceState,
  shouldRestoreNativePushRegistration,
} from "../../artifacts/kub/src/lib/pushPreferences.ts";

test("native push enable persists the server preference state", async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, "notification_preferences");
      return {
        async upsert(value, options) {
          calls.push({ value, options });
          return { error: null };
        },
      };
    },
  };

  const result = await persistPushPreferenceState(
    client,
    "user-1",
    {
      push_enabled: false,
      message_push_enabled: true,
      task_push_enabled: true,
      invite_push_enabled: false,
    },
    true,
    "2026-07-11T19:15:00.000Z",
  );

  assert.equal(result, null);
  assert.deepEqual(calls, [
    {
      value: {
        user_id: "user-1",
        push_enabled: true,
        message_push_enabled: true,
        task_push_enabled: true,
        invite_push_enabled: false,
        updated_at: "2026-07-11T19:15:00.000Z",
      },
      options: { onConflict: "user_id" },
    },
  ]);
});

test("native push disable persists the server preference state", async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, "notification_preferences");
      return {
        async upsert(value, options) {
          calls.push({ value, options });
          return { error: null };
        },
      };
    },
  };

  const result = await persistPushPreferenceState(
    client,
    "user-1",
    {
      push_enabled: true,
      message_push_enabled: true,
      task_push_enabled: false,
      invite_push_enabled: true,
    },
    false,
    "2026-07-11T19:20:00.000Z",
  );

  assert.equal(result, null);
  assert.deepEqual(calls, [
    {
      value: {
        user_id: "user-1",
        push_enabled: false,
        message_push_enabled: true,
        task_push_enabled: false,
        invite_push_enabled: true,
        updated_at: "2026-07-11T19:20:00.000Z",
      },
      options: { onConflict: "user_id" },
    },
  ]);
});

test("native push registration is restored only for an enabled authenticated Android user", () => {
  assert.equal(shouldRestoreNativePushRegistration({
    nativeAndroid: true,
    userId: "user-1",
    loadingPreferences: false,
    pushEnabled: true,
    attemptedUserId: null,
  }), true);
  assert.equal(shouldRestoreNativePushRegistration({
    nativeAndroid: false,
    userId: "user-1",
    loadingPreferences: false,
    pushEnabled: true,
    attemptedUserId: null,
  }), false);
  assert.equal(shouldRestoreNativePushRegistration({
    nativeAndroid: true,
    userId: "user-1",
    loadingPreferences: false,
    pushEnabled: false,
    attemptedUserId: null,
  }), false);
  assert.equal(shouldRestoreNativePushRegistration({
    nativeAndroid: true,
    userId: "user-1",
    loadingPreferences: false,
    pushEnabled: true,
    attemptedUserId: "user-1",
  }), false);
});
