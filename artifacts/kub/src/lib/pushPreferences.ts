export type PushPreferenceState = {
  push_enabled: boolean;
  message_push_enabled: boolean;
  task_push_enabled: boolean;
  invite_push_enabled: boolean;
};

export type NativePushRestoreState = {
  nativeAndroid: boolean;
  userId: string | null;
  loadingPreferences: boolean;
  pushEnabled: boolean;
  attemptedUserId: string | null;
};

export function shouldRestoreNativePushRegistration(state: NativePushRestoreState): boolean {
  return Boolean(
    state.nativeAndroid &&
      state.userId &&
      !state.loadingPreferences &&
      state.pushEnabled &&
      state.attemptedUserId !== state.userId,
  );
}

type PushPreferenceWriter = {
  from: (table: "notification_preferences") => {
    upsert: (
      value: PushPreferenceState & { user_id: string; updated_at: string },
      options: { onConflict: "user_id" },
    ) => PromiseLike<{ error: unknown }>;
  };
};

export async function persistPushPreferenceState(
  client: PushPreferenceWriter,
  userId: string,
  preferences: PushPreferenceState,
  enabled: boolean,
  updatedAt = new Date().toISOString(),
): Promise<unknown | null> {
  const { error } = await client.from("notification_preferences").upsert(
    {
      user_id: userId,
      ...preferences,
      push_enabled: enabled,
      updated_at: updatedAt,
    },
    { onConflict: "user_id" },
  );
  return error ?? null;
}
