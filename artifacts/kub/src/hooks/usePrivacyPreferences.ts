"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import {
  createPrivacyPreferencesStore,
  type PrivacyGateway,
  type PrivacyPreferences,
} from "@/lib/privacyPreferences";

export type { PrivacyPreferences };

const gateway: PrivacyGateway = {
  async read(userId) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("privacy_preferences")
      .select("presence_visible")
      .eq("user_id", userId)
      .maybeSingle();
    // An absent row is not an error — it is the default.
    if (error) throw new Error(error.message);
    return data ? { presenceVisible: data.presence_visible !== false } : null;
  },

  async write(userId, presenceVisible) {
    const supabase = createClient();
    const { error } = await supabase.from("privacy_preferences").upsert(
      { user_id: userId, presence_visible: presenceVisible, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
  },

  async clearPresence(userId) {
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ online_at: null }).eq("id", userId);
    if (error) throw new Error(error.message);
  },
};

const store = createPrivacyPreferencesStore(gateway);

/**
 * A person's privacy preferences.
 *
 * The first of them is presence, and it is honest rather than cosmetic: the
 * "last seen" timestamp is written by this person's own client on a heartbeat,
 * so turning it off stops the publishing and clears what was stored. There is
 * then nothing for anyone — staff included — to read, which is the difference
 * between privacy and a display filter.
 *
 * Nothing here affects being found or being written to. That was the condition
 * the setting was asked for under: a colleague must always be reachable.
 */
export function usePrivacyPreferences() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.sync(userId);
  }, [userId]);

  const setPresenceVisible = useCallback(
    (visible: boolean) => store.setPresenceVisible(userId, visible),
    [userId],
  );

  return { ...snapshot, setPresenceVisible };
}
