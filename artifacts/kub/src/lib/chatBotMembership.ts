"use client";

import { createClient } from "@/lib/supabase/client";
import { isBotDoorMissing, type BotLike } from "@/lib/chatBots";

/**
 * Reading and changing which bots are in a chat (D-235, D-236).
 *
 * `public.chat_bot_members` is not in the generated `Database` type — only
 * `bots` and the `search_public_bots` RPC are — so every reader of it in this
 * product goes through a loosely typed client. `useBotChat` and
 * `lib/botCallback.ts` each keep their own; this is the third and it is
 * deliberately the last, because the three now cover the three different
 * questions and none of them is the same read.
 *
 * ── What the door is ──────────────────────────────────────────────────────
 *
 * `20260919010000_a_bot_can_be_put_in_a_group.sql` added three definer
 * functions, granted to `authenticated`, and **no** INSERT policy: these
 * functions are the only way a bot gets into a group, and the table still has
 * SELECT and nothing else for a client.
 *
 *   - `chat_bots_available(chat, query)` answers with the active bots an
 *     administrator of that group could add — and with **nothing at all**, not
 *     an error, for anybody who may not. So an empty list and a refusal look
 *     identical from here, which is the point: it cannot be used to enumerate
 *     bots from a chat you administer nothing in.
 *   - `chat_bot_add(chat, bot)` is idempotent and always joins `restricted`.
 *   - `chat_bot_remove(chat, bot)` is soft — it sets `removed_at`, which is
 *     what `bot_membership_authorize_internal` reads.
 *
 * ── Why the list read is one request for the whole sidebar ────────────────
 *
 * D-236 needs «is this a bot?» answered for every row of the chat list at once.
 * A per-chat read is what `useBotChat` does for the open conversation and it is
 * right there; doing it per row would be one request per chat on every list
 * fetch. The SELECT policy allows a member to read the membership of any chat
 * they are in, so one `in(chat_id, …)` answers the whole list.
 *
 * Nothing about bots streams — no bot table is in the `supabase_realtime`
 * publication — so a bot added elsewhere appears on the next list fetch. That
 * is written down rather than worked around, exactly as `useBotChat` records
 * it, and it is why the surfaces that change a membership also update their own
 * copy rather than waiting to be told.
 */

type PostgrestFailure = { code?: unknown; message?: unknown; details?: unknown } | null;
type Answer<T> = { data: T | null; error: PostgrestFailure };

interface LooseFilter<T> extends PromiseLike<Answer<T>> {
  eq(column: string, value: string): LooseFilter<T>;
  in(column: string, values: readonly string[]): LooseFilter<T>;
  is(column: string, value: null): LooseFilter<T>;
  limit(count: number): LooseFilter<T>;
}

interface LooseClient {
  from(table: string): { select<T>(columns: string): LooseFilter<T> };
  rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<Answer<T>>;
}

function looseClient(): LooseClient {
  return createClient() as unknown as LooseClient;
}

/** The columns a bot is drawn from, wherever it is drawn. */
const BOT_COLUMNS = "id,username,display_name,description,avatar_url,state";

function readBot(value: unknown): BotLike | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.username !== "string") return null;
  if (typeof row.display_name !== "string") return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    description: typeof row.description === "string" ? row.description : null,
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    state: typeof row.state === "string" ? row.state : null,
  };
}

/**
 * The live bots of each of these chats.
 *
 * A failure answers an empty map rather than throwing: a chat list that cannot
 * read bot memberships must look exactly like a chat list with no bots in it,
 * which is what it looked like before this feature existed. The cause goes to
 * the log.
 *
 * `state` is filtered here rather than on the wire: a deleted bot's row stays
 * in `chat_bot_members` with `removed_at` null, and drawing «Бот» for something
 * the authoriser refuses every operation to would be a mark that lies.
 */
export async function fetchChatBots(chatIds: readonly string[]): Promise<Map<string, BotLike[]>> {
  const byChat = new Map<string, BotLike[]>();
  if (chatIds.length === 0) return byChat;
  const { data, error } = await looseClient()
    .from("chat_bot_members")
    .select<{ chat_id?: unknown; bot?: unknown }[]>(`chat_id,bot:bots(${BOT_COLUMNS})`)
    .in("chat_id", chatIds)
    .is("removed_at", null)
    .limit(500);
  if (error) {
    console.error("fetchChatBots error:", error);
    return byChat;
  }
  for (const row of Array.isArray(data) ? data : []) {
    const chatId = typeof row?.chat_id === "string" ? row.chat_id : null;
    // PostgREST answers a to-one embed as an object; some versions answer an
    // array of one. Both are read, because guessing wrong empties the map.
    const embedded = Array.isArray(row?.bot) ? row.bot[0] : row?.bot;
    const bot = readBot(embedded);
    if (!chatId || !bot || bot.state !== "active") continue;
    const held = byChat.get(chatId);
    if (held) held.push(bot);
    else byChat.set(chatId, [bot]);
  }
  for (const bots of byChat.values()) {
    bots.sort((left, right) => left.display_name.localeCompare(right.display_name, "ru-RU"));
  }
  return byChat;
}

export interface BotCandidatesResult {
  readonly bots: readonly BotLike[];
  /** The deployment has no `chat_bots_available`; draw no section at all. */
  readonly unavailable: boolean;
  readonly error: PostgrestFailure;
}

/**
 * The bots this chat could take, as the server decides it.
 *
 * Nothing here checks whether the reader is an administrator, deliberately: the
 * function answers an empty list for somebody who may not, and a role test in
 * the interface would be a second copy of a rule that is already enforced — the
 * mistake `ChatHeader`'s call button comment names.
 */
export async function fetchAvailableChatBots(
  chatId: string,
  query: string | null,
): Promise<BotCandidatesResult> {
  const { data, error } = await looseClient().rpc<unknown[]>("chat_bots_available", {
    p_chat_id: chatId,
    p_query: query && query.trim() ? query.trim() : null,
  });
  if (error) {
    // A deployment without the migration must show no bot section rather than
    // an error about one. `isBotDoorMissing` is the same absence
    // `classifyBotCallbackFailure` recognises, and it is the only failure this
    // surface silences.
    return isBotDoorMissing(error)
      ? { bots: [], unavailable: true, error: null }
      : { bots: [], unavailable: false, error };
  }
  const bots: BotLike[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as Record<string, unknown>;
    // The function names its first column `bot_id`, not `id`.
    const bot = readBot({ ...entry, id: entry.bot_id, state: "active" });
    if (bot) bots.push(bot);
  }
  return { bots, unavailable: false, error: null };
}

export interface BotMembershipChange {
  readonly ok: boolean;
  readonly error: PostgrestFailure;
}

export async function addChatBot(chatId: string, botId: string): Promise<BotMembershipChange> {
  const { error } = await looseClient().rpc<boolean>("chat_bot_add", {
    p_chat_id: chatId,
    p_bot_id: botId,
  });
  return { ok: !error, error: error ?? null };
}

export async function removeChatBot(chatId: string, botId: string): Promise<BotMembershipChange> {
  const { error } = await looseClient().rpc<boolean>("chat_bot_remove", {
    p_chat_id: chatId,
    p_bot_id: botId,
  });
  return { ok: !error, error: error ?? null };
}
