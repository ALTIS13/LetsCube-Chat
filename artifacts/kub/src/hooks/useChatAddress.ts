"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import {
  reconcileChatAddress,
  type ChatAddressState,
} from "@/lib/chatRoute";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { useAppStore } from "@/store/app.store";

/**
 * Keeps the address bar and the open conversation saying the same thing.
 *
 * The rule is `lib/chatRoute.ts`, where `node --test` can reach it; what is
 * here is the wiring, and two things the rule cannot know about.
 *
 * **A conversation is opened by id, not by fetch.** The id in the URL came out
 * of this product, so the first thing that happens is `setSelectedChatId` — no
 * network, no wait. The chat list is what carries a conversation's unread
 * count and read boundary, and `ChatWindow` latches the entry position the
 * first time it sees a chat row. So calling `safeOpenChat` up front would be
 * actively wrong on a cold load: its hydrated summary carries
 * `unread_count: 0`, and a row with no unread in it lands the reader at the
 * bottom instead of on the divider — the exact thing the address exists to
 * preserve. It is the fallback instead, for a conversation the loaded list does
 * not contain, where it either hydrates one (a hidden or cleared chat) or says
 * «Чат недоступен» and clears the selection.
 *
 * **The message jump is asked for twice.** `ChatWindow` listens for
 * `KUB_CHAT_MESSAGE_JUMP_EVENT` and its handler loads a message that is not on
 * screen yet, so one request is enough *once the pane is listening* — and on a
 * cold load the pane mounts a moment after this effect runs. Two spaced
 * attempts is what `SearchShared` already does for the same reason; the
 * handler is idempotent, so the second costs nothing when the first landed.
 */

/** When to ask for the jump, in ms after the conversation is opened. */
const JUMP_ATTEMPTS_MS = [250, 900] as const;

/**
 * How long to wait for the chat list before verifying an id against the server.
 *
 * Only reached when the list stays empty — a person with no chats, or a read
 * that failed. Measured cold list readiness on production is 505-564 ms
 * (tracker, queue item 2), so this is a wide margin rather than a threshold.
 */
const VERIFY_FALLBACK_MS = 6000;

export function useChatAddress(): void {
  const [location, navigate] = useLocation();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const agreed = useRef<ChatAddressState | null>(null);
  const [unverifiedChatId, setUnverifiedChatId] = useState<string | null>(null);
  // A preview or receipt in another chat cannot change address validation.
  // Subscribe to that answer, not the list that would rerender MainLayout.
  const chatVerification = useAppStore((state) => {
    if (!unverifiedChatId) return "idle";
    if (state.chats.some((chat) => chat.id === unverifiedChatId)) return "known";
    return state.chats.length > 0 ? "missing" : "waiting";
  });

  useEffect(() => {
    const next: ChatAddressState = { location, selectedChatId };
    const action = reconcileChatAddress(agreed.current, next);

    switch (action.kind) {
      case "idle":
        agreed.current = next;
        return;
      case "close":
        agreed.current = next;
        setSelectedChatId(null);
        return;
      case "navigate":
        // What was observed, not where we are going. Recording the destination
        // optimistically means that if this effect runs again before wouter has
        // flushed — another dependency changing is enough — the next comparison
        // reads a location that has not happened yet, and «the location moved
        // to `/`» is how a conversation gets closed out from under somebody.
        // The navigation's own location change drives the next run instead.
        //
        // `replace` is not used: Back between conversations is the point of
        // having an address at all, and both reference clients push.
        agreed.current = next;
        navigate(action.path);
        return;
      case "open": {
        agreed.current = next;
        setSelectedChatId(action.chatId);
        setUnverifiedChatId(action.chatId);
        if (!action.messageId) return;
        const messageId = action.messageId;
        const timers = JUMP_ATTEMPTS_MS.map((delay) =>
          window.setTimeout(() => requestChatMessageJump(action.chatId, messageId), delay),
        );
        return () => timers.forEach((timer) => window.clearTimeout(timer));
      }
    }
  }, [location, navigate, selectedChatId, setSelectedChatId]);

  // A conversation named by a URL is taken on trust until the list can answer
  // for it. Once the list has loaded and still does not hold it, the server is
  // asked — which is also the only path that can tell somebody the chat is gone.
  useEffect(() => {
    if (!unverifiedChatId) return undefined;
    if (chatVerification === "known") {
      setUnverifiedChatId(null);
      return undefined;
    }
    if (chatVerification === "missing") {
      const chatId = unverifiedChatId;
      setUnverifiedChatId(null);
      void safeOpenChat(chatId);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const chatId = unverifiedChatId;
      setUnverifiedChatId(null);
      void safeOpenChat(chatId);
    }, VERIFY_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [chatVerification, unverifiedChatId]);
}
