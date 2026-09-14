"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { loadBotCommands } from "@/lib/botCallback";
import type { BotCommand } from "@/lib/botChatSurfaces";

/**
 * The bot a chat holds, and the commands it registered (D-126).
 *
 * Two reads, both of them allowed to an ordinary account and both of them
 * pointless in the overwhelming majority of chats, so they are asked for only
 * once per chat and never again until the chat changes:
 *
 *   - `public.chat_bot_members`, under «chat members and owners read bot
 *     membership» — which chats a bot is in, filtered here to this one;
 *   - `public.bot_commands`, under «members and owners read bot commands» —
 *     readable exactly because the first read found a live membership.
 *
 * Nothing streams. No bot table is in the `supabase_realtime` publication, so a
 * bot added to a chat, or a bot that replaces its commands, is seen on the next
 * time the chat is opened. Written down rather than worked around: a poll would
 * cost every chat in the product a request for a fact that changes perhaps once
 * in a bot's life.
 *
 * A failure is not a sentence. A chat with no bot and a chat whose membership
 * could not be read look identical — an ordinary composer — and that is the
 * correct degradation: the alternative is an error about bots on the screen of
 * somebody talking to a person.
 */
export interface BotChatState {
  readonly botId: string | null;
  readonly commands: readonly BotCommand[];
  /** False until both reads have settled, so nothing flickers into place. */
  readonly ready: boolean;
}

const EMPTY: BotChatState = { botId: null, commands: [], ready: false };

export function useBotChat(chatId: string): BotChatState {
  const [state, setState] = useState<BotChatState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setState(EMPTY);
    if (!chatId) return;

    void (async () => {
      const supabase = createClient() as unknown as {
        from(table: string): {
          select(columns: string): {
            eq(column: string, value: string): {
              is(column: string, value: null): {
                limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
              };
            };
          };
        };
      };
      const { data, error } = await supabase
        .from("chat_bot_members")
        .select("bot_id")
        .eq("chat_id", chatId)
        .is("removed_at", null)
        .limit(1);
      if (cancelled) return;
      if (error) {
        console.error("useBotChat membership error:", error);
        setState({ botId: null, commands: [], ready: true });
        return;
      }
      const rows = Array.isArray(data) ? (data as { bot_id?: unknown }[]) : [];
      const botId = typeof rows[0]?.bot_id === "string" ? rows[0].bot_id : null;
      if (!botId) {
        setState({ botId: null, commands: [], ready: true });
        return;
      }
      const commands = await loadBotCommands(botId);
      if (cancelled) return;
      setState({ botId, commands, ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  return state;
}
