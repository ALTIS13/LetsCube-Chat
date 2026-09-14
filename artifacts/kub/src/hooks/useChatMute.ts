"use client";

import { useCallback, useEffect, useMemo } from "react";

import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import { useAppStore } from "@/store/app.store";
import {
  CHAT_MUTE_CACHE_KEY,
  chatMuteFor,
  chatMuteState,
  mutesReadFailureText,
  nextChatMuteChange,
  type ChatMuteOptionId,
  type ChatMutePreferenceRow,
  type ChatMuteState,
} from "@/lib/chatMute";

/**
 * Reading `chat_notification_preferences` for the signed-in account (D-167).
 *
 * The decisions are not here. Whether a row means muted now, the durations, the
 * sentence naming when a mute ends and the rule that a cached answer never beats
 * a server one are all in `lib/chatMute.ts`, which imports nothing that needs a
 * browser; what is left in this file is one read, one timer, and the wiring that
 * keeps the three surfaces showing the same thing.
 *
 * The read is guarded at module scope rather than per component because three
 * surfaces mount it — the chat header, the contact card and the chat list — and
 * a query per mounted surface would ask the same question three times on every
 * chat switch. The guard is the shape `personalBlocksStore` uses: load once per
 * person, and forget on sign-out.
 */

let loadedFor: string | null = null;
let inFlight: Promise<void> | null = null;

/** For the specs that need the account asked again from scratch. */
export function resetChatMuteReads(): void {
  loadedFor = null;
  inFlight = null;
}

async function readChatMutes(userId: string): Promise<void> {
  const store = useAppStore.getState();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("chat_notification_preferences")
      .select("chat_id,push_enabled,muted_until")
      .eq("user_id", userId);
    if (error) throw error;
    // The person may have signed out while the read was in flight; an answer
    // for somebody else must never become this person's list. The store checks
    // it again, because `applyServerMutes` is what makes the source «server».
    if (useAppStore.getState().currentUser?.id !== userId) return;
    loadedFor = userId;
    store.applyServerChatMutes(userId, (data ?? []) as ChatMutePreferenceRow[]);
  } catch (error) {
    if (useAppStore.getState().currentUser?.id !== userId) return;
    // The cause goes to the log; the screen keeps whatever the cache had, and
    // the source stays «cache», so the account's own answer still wins when it
    // arrives.
    console.error("[chat-mute] read failed.", (error as { code?: string })?.code ?? "", (error as { message?: string })?.message ?? "");
    store.setChatMutesError(userId, mutesReadFailureText(mapPgError(error)));
  }
}

/**
 * Keeps the account's mutes on screen, and current.
 *
 * Safe to call from more than one surface: the read is shared, and the timer is
 * per caller but costs one `setTimeout` aimed at a single instant rather than a
 * tick.
 */
export function useChatMutes() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const snapshot = useAppStore((s) => s.chatMutes);
  const syncChatMuteUser = useAppStore((s) => s.syncChatMuteUser);
  const applyCachedChatMutes = useAppStore((s) => s.applyCachedChatMutes);
  const refreshChatMutes = useAppStore((s) => s.refreshChatMutes);

  useEffect(() => {
    syncChatMuteUser(userId);
    if (!userId) {
      loadedFor = null;
      inFlight = null;
      return;
    }
    // The cache first, so the first paint is not a list of chats that all look
    // unmuted; then the account, which replaces it.
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(CHAT_MUTE_CACHE_KEY);
    } catch {
      raw = null;
    }
    applyCachedChatMutes(userId, raw);
    if (loadedFor === userId || inFlight) return;
    inFlight = readChatMutes(userId).finally(() => {
      inFlight = null;
    });
  }, [applyCachedChatMutes, syncChatMuteUser, userId]);

  // A timed mute is the one piece of state that changes with nothing happening.
  // One timer to the earliest end, re-armed whenever the rows change.
  useEffect(() => {
    const at = nextChatMuteChange(snapshot.prefs, Date.now());
    if (at === null) return;
    // `setTimeout` clamps a delay beyond a 32-bit millisecond count to zero and
    // fires at once, which would spin. A far end is looked at again in a day.
    const delay = Math.min(Math.max(at - Date.now(), 250), 24 * 60 * 60 * 1000);
    const timer = window.setTimeout(() => refreshChatMutes(), delay);
    return () => window.clearTimeout(timer);
  }, [refreshChatMutes, snapshot]);

  return snapshot;
}

export interface ChatMuteControl {
  /** Muted now, and until when, by the two conditions the database applies. */
  readonly state: ChatMuteState;
  /** Writes the choice; «off» lifts it. Resolves with the sentence when it failed. */
  readonly setMute: (option: ChatMuteOptionId | "off") => Promise<{ ok: boolean; error: string | null }>;
}

/**
 * One chat's mute, for a surface that offers the control.
 *
 * `now` is read at render rather than held, because the only thing that moves it
 * is the timer above, and that re-renders every reader of the snapshot.
 */
export function useChatMute(chatId: string | null | undefined): ChatMuteControl {
  const snapshot = useChatMutes();
  const setChatMute = useAppStore((s) => s.setChatMute);
  const pref = chatId ? chatMuteFor(snapshot, chatId) : null;
  const state = useMemo(() => chatMuteState(pref, Date.now()), [pref]);
  const setMute = useCallback(
    (option: ChatMuteOptionId | "off") =>
      chatId ? setChatMute(chatId, option) : Promise.resolve({ ok: false, error: null }),
    [chatId, setChatMute],
  );
  return { state, setMute };
}
