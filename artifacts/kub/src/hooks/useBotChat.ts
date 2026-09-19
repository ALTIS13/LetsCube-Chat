"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { loadBotCommands } from "@/lib/botCallback";
import { chooseChatBot, type BotCommand } from "@/lib/botChatSurfaces";

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
 *
 * ── Why the username comes from here and not from the chat list (D-244) ────
 *
 * In a group, a command only reaches a bot when it names it:
 * `private.bot_can_receive_message` admits `/shift@shiftbot` and refuses
 * `/shift`. The name therefore has to be right, and it has to belong to the
 * bot whose commands are on the screen. `useChats` already hangs a `bots` array
 * on every chat, but it is a snapshot of the sidebar's last fetch and its
 * entries are sorted by display name — pairing a command with the first of them
 * would address the wrong bot in a group that holds two, and a rename between
 * the two fetches would address a name that no longer matches. So the
 * membership read asks for the bot in the same row as the command's owner, and
 * the two cannot disagree.
 *
 * A membership whose bot row does not come back is reported as no bot rather
 * than as a bot without a name. It cannot happen for a chat member — the `bots`
 * SELECT policy admits anyone sharing a live chat with the bot, which is the
 * same reader the membership policy admits — and the alternative is a command
 * menu that offers what nothing can deliver.
 *
 * ── Which bot, and whether it is one worth offering (D-247) ───────────────
 *
 * Neither question is answered here. `chooseChatBot` in `lib/botChatSurfaces.ts`
 * takes the rows and answers both — which of several bots the composer speaks
 * to, and whether the bot in a row is in a state that can be sent anything at
 * all — and it imports nothing, so `node --test` can reach it.
 *
 * That move is the fix rather than a tidy-up. The state filter had to live
 * somewhere a test could see it: this module reads `import.meta.env` through
 * `createClient` and pulls in supabase-js, so a decision buried in it is a
 * decision no unit test can mutate. It is the lesson of
 * `lib/supabase/config.ts`, one file over — a check that cannot be reached from
 * a test is a gap in the module boundary, not in the suite.
 */
export interface BotChatState {
  readonly botId: string | null;
  /** `bots.username` of that same bot, for addressing it (D-244). */
  readonly botUsername: string | null;
  readonly commands: readonly BotCommand[];
  /** False until both reads have settled, so nothing flickers into place. */
  readonly ready: boolean;
}

const EMPTY: BotChatState = { botId: null, botUsername: null, commands: [], ready: false };
const NO_BOT: BotChatState = { botId: null, botUsername: null, commands: [], ready: true };

/** How many memberships are read before one is chosen. A group holds few. */
const MEMBERSHIP_READ_LIMIT = 16;

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
        // `state` travels with the username because `chooseChatBot` refuses a
        // bot that is not `active` (D-247). It is one more column on a read
        // that already happens once per chat, and it is the same column
        // `fetchChatBots` asks for; leaving it out is what made the two
        // readers disagree.
        .select("bot_id,joined_at,bot:bots(username,state)")
        .eq("chat_id", chatId)
        .is("removed_at", null)
        .limit(MEMBERSHIP_READ_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error("useBotChat membership error:", error);
        setState(NO_BOT);
        return;
      }
      const membership = chooseChatBot(data);
      if (!membership) {
        setState(NO_BOT);
        return;
      }
      const commands = await loadBotCommands(membership.botId);
      if (cancelled) return;
      setState({
        botId: membership.botId,
        botUsername: membership.username,
        commands,
        ready: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  return state;
}
