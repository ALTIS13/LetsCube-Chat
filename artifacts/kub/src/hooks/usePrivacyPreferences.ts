"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import {
  createPrivacyPreferencesStore,
  type PrivacyGateway,
  type PrivacyPreferences,
} from "@/lib/privacyPreferences";
import { isManualStatus, type ManualStatus } from "@/lib/presenceStatus";
import { isPhoneFindableBy, PHONE_FIND_DEFAULT, type PhoneFindableBy } from "@/lib/phoneFindability";
import type { Database } from "@/types/database";

export type { PrivacyPreferences };

const gateway: PrivacyGateway = {
  async read(userId) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("privacy_preferences")
      .select("presence_visible,forward_origin_visible,manual_status,manual_status_until,phone_findable_by")
      .eq("user_id", userId)
      .maybeSingle();
    // An absent row is not an error — it is the defaults.
    if (error) throw new Error(error.message);
    return data
      ? {
          presenceVisible: data.presence_visible !== false,
          forwardOriginVisible: data.forward_origin_visible !== false,
          manualStatus: isManualStatus(data.manual_status) ? data.manual_status : "online",
          manualStatusUntil: typeof data.manual_status_until === "string" ? data.manual_status_until : null,
          phoneFindableBy: isPhoneFindableBy(data.phone_findable_by) ? data.phone_findable_by : PHONE_FIND_DEFAULT,
        }
      : null;
  },

  async write(userId, preferences) {
    const supabase = createClient();
    // Insert defaults only when no row exists. Conflict-ignore must precede a
    // PATCH: a merging upsert resets omitted fields to their column defaults.
    const { error: insertError } = await supabase.from("privacy_preferences")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (insertError) throw new Error(insertError.message);
    const patch: Database["public"]["Tables"]["privacy_preferences"]["Update"] = { updated_at: new Date().toISOString() };
    if (preferences.presenceVisible !== undefined) patch.presence_visible = preferences.presenceVisible;
    if (preferences.forwardOriginVisible !== undefined) patch.forward_origin_visible = preferences.forwardOriginVisible;
    if (preferences.phoneFindableBy !== undefined) patch.phone_findable_by = preferences.phoneFindableBy;
    const { data, error } = await supabase.from("privacy_preferences")
      .update(patch).eq("user_id", userId).select("user_id").single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("privacy_write_not_saved");
  },

  async clearPresence(userId) {
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ online_at: null, presence_status: null })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  },

  async setStatus(_userId, status, until) {
    // The caller is the database's `auth.uid()`; the account is not an argument.
    const supabase = createClient();
    const { error } = await supabase.rpc("presence_set_status", { p_status: status, p_until: until });
    if (error) throw new Error(error.message);
  },
};

const store = createPrivacyPreferencesStore(gateway);

/**
 * Ask again, for a window coming back into view: a status chosen on another
 * device reaches this one then (tracker item 37).
 */
export function refreshPrivacyPreferences(userId: string | null): Promise<void> {
  return store.refresh(userId);
}

/**
 * A person's privacy preferences.
 *
 * The first of them is presence, and it is honest rather than cosmetic: the
 * "last seen" timestamp is written by this person's own client on a heartbeat,
 * so turning it off stops the publishing and clears what was stored. There is
 * then nothing for anyone — staff included — to read, which is the difference
 * between privacy and a display filter.
 *
 * The second is whose name a forward carries. It is the same principle one step
 * further out: the decision belongs to the person being disclosed rather than
 * to whoever happens to hold access to the chat the message came from. Written
 * by the database onto each copy at forward time, so it governs what is
 * forwarded next and never what was forwarded already — in either direction.
 *
 * Phone findability governs exact verified-number resolution separately from
 * presence and forwards. It does not hide a profile from name/username search.
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

  const setForwardOriginVisible = useCallback(
    (visible: boolean) => store.setPreference(userId, "forwardOriginVisible", visible),
    [userId],
  );

  const setManualStatus = useCallback(
    (status: ManualStatus, until: string | null) => store.setManualStatus(userId, status, until),
    [userId],
  );

  const setPhoneFindableBy = useCallback(
    (value: PhoneFindableBy) => store.setPreference(userId, "phoneFindableBy", value),
    [userId],
  );

  const retry = useCallback(() => store.sync(userId), [userId]);
  return { ...snapshot, ready: store.canEdit(userId), retry,
    setPresenceVisible, setForwardOriginVisible, setManualStatus, setPhoneFindableBy };
}
