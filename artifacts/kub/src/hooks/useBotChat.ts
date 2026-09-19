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
 * ── Which bot, when a group holds more than one ───────────────────────────
 *
 * One of them, and always the same one: the one that joined first. The composer
 * has room for a single bot's menu, so this is a choice the product has to make
 * either way; before this change it was `limit(1)` with no ordering, which is
 * whichever row Postgres handed back that time. A group with two bots still
 * only reaches one of them from the menu — recorded rather than fixed here,
 * because a per-bot menu is a different surface.
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

interface BotMembershipRow {
  readonly botId: string;
  readonly username: string;
  readonly joinedAt: string;
}

/**
 * A row of `chat_bot_members` with its bot embedded, or null.
 *
 * PostgREST answers a to-one embed as an object; some versions answer an array
 * of one. Both are read, the way `fetchChatBots` reads them, because guessing
 * wrong turns every bot chat into a chat without a bot.
 */
function readMembership(value: unknown): BotMembershipRow | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const embedded = Array.isArray(row.bot) ? row.bot[0] : row.bot;
  const bot = typeof embedded === "object" && embedded !== null ? (embedded as Record<string, unknown>) : null;
  const botId = typeof row.bot_id === "string" ? row.bot_id : null;
  const username = typeof bot?.username === "string" ? bot.username : null;
  if (!botId || !username) return null;
  return {
    botId,
    username,
    joinedAt: typeof row.joined_at === "string" ? row.joined_at : "",
  };
}

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
        .select("bot_id,joined_at,bot:bots(username)")
        .eq("chat_id", chatId)
        .is("removed_at", null)
        .limit(MEMBERSHIP_READ_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error("useBotChat membership error:", error);
        setState(NO_BOT);
        return;
      }
      const rows = (Array.isArray(data) ? data : [])
        .map(readMembership)
        .filter((row): row is BotMembershipRow => row !== null)
        // The one that joined first, and its username as a tie-break so that
        // two memberships written in the same transaction still order the same
        // way on every load.
        .sort((left, right) =>
          left.joinedAt === right.joinedAt
            ? left.username.localeCompare(right.username, "en-US")
            : left.joinedAt.localeCompare(right.joinedAt),
        );
      const membership = rows[0];
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
