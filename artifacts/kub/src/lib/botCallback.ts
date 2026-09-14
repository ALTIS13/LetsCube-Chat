import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import {
  BOT_CALLBACK_DONE,
  botCallbackFailureMessage,
  classifyBotCallbackFailure,
  parseBotCommands,
  type BotCallbackFailure,
  type BotCommand,
} from "@/lib/botChatSurfaces";

/**
 * The reads and the one write the bot surfaces need (D-125, D-126, D-127).
 *
 * Every decision this file makes is in `botChatSurfaces.ts`, which imports
 * nothing and is therefore reachable from `node --test`. What is left here is
 * the part a test process cannot have: the Supabase client, and the exact shape
 * of each query.
 *
 * **Why the handle below is loosely typed.** Three of the four things this
 * module touches are absent from `types/database.ts`:
 *
 *   - `public.bot_commands` and `public.chat_bot_members` exist, are readable by
 *     an ordinary account (`grant select … to authenticated`, under policies
 *     that require owning the bot or sharing a live chat with it), and were
 *     never added to the compatibility layer. `types/database.ts` knows only
 *     `bots`.
 *   - `open_or_create_bot_chat` and `bot_callback_press` do not exist in the
 *     deployment **at all**, so adding them to a type file would be asserting
 *     something untrue about the schema.
 *
 * A generated type cannot describe any of that, so this module holds one
 * deliberately loose handle, in one place, and every row that leaves it is put
 * through a parser from `botChatSurfaces.ts` rather than trusted.
 *
 * **What the server half still owes this file**, measured rather than guessed —
 * see fact 4 in `botChatSurfaces.ts`:
 *
 *   `public.bot_callback_press(p_message_id uuid, p_data text) returns jsonb`,
 *   `security definer`, granted to `authenticated`. It must mint the callback
 *   id itself and pass `auth.uid()` as the actor, then call the existing
 *   `public.bot_update_enqueue_internal(bot_id, 'callback_query', p_message_id,
 *   jsonb_build_object('callback_id', …, 'actor_id', auth.uid(), 'data', p_data))`.
 *   Taking the actor from the caller — which is what that function does today —
 *   is the reason its grant cannot simply be opened: one member of a chat could
 *   forge a press as another. It may answer `null`, or the bot's own
 *   `answerCallbackQuery` as `{"text": …, "show_alert": …}`.
 *
 *   `public.open_or_create_bot_chat(p_bot_id uuid) returns uuid`, the bot's
 *   counterpart of `open_or_create_private_chat`. `public.chat_bot_members` has
 *   SELECT and nothing else for `authenticated`, and no policy for any other
 *   verb, so a chat with a bot cannot be created from the client at all today.
 *
 * Until both exist, the surfaces degrade rather than lie: an existing bot chat
 * still opens and still lists its commands, and a press says plainly that the
 * buttons do not work yet.
 */

type PostgrestFailure = { code?: unknown; message?: unknown; details?: unknown } | null;
type Answer<T> = { data: T | null; error: PostgrestFailure };

interface LooseFilter<T> extends PromiseLike<Answer<T>> {
  eq(column: string, value: string): LooseFilter<T>;
  in(column: string, values: readonly string[]): LooseFilter<T>;
  is(column: string, value: null): LooseFilter<T>;
  order(column: string, options: { ascending: boolean }): LooseFilter<T>;
  limit(count: number): LooseFilter<T>;
}

interface LooseClient {
  from(table: string): { select<T>(columns: string): LooseFilter<T> };
  rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<Answer<T>>;
}

function looseClient(): LooseClient {
  return createClient() as unknown as LooseClient;
}

// ---------------------------------------------------------------------------
// D-126: the commands a bot registered
// ---------------------------------------------------------------------------

/**
 * A bot's commands, in the order it registered them.
 *
 * `sort_order` is the column `setMyCommands` writes the position into, so the
 * order is asked for on the wire rather than restored afterwards; `command` is
 * the tie-break, because two rows sharing a position would otherwise come back
 * in whatever order the planner chose and the menu would reshuffle between
 * openings.
 *
 * An error is not a failure worth a sentence: a bot with no commands and a bot
 * whose commands could not be read look the same to the person, and the menu
 * says so once. The cause goes to the log.
 */
export async function loadBotCommands(botId: string): Promise<readonly BotCommand[]> {
  const { data, error } = await looseClient()
    .from("bot_commands")
    .select<unknown[]>("command,description,sort_order")
    .eq("bot_id", botId)
    .order("sort_order", { ascending: true })
    .order("command", { ascending: true })
    .limit(100);
  if (error) {
    console.error("loadBotCommands error:", error);
    return [];
  }
  return parseBotCommands(data);
}

// ---------------------------------------------------------------------------
// D-127: finding, and opening, the chat with a bot
// ---------------------------------------------------------------------------

export interface BotChatCandidate {
  readonly chatId: string;
  readonly type: string | null;
}

/**
 * The chats the reader can see this bot in, and which of them are the reader's.
 *
 * Two reads rather than one join, because the two policies answer different
 * questions: `chat_bot_members` shows a bot's owner every chat it is in, the
 * reader's own membership included or not, and `chat_members` is what says
 * which of those the reader is actually in. `chooseBotChat` does the
 * intersection, and it does it where a test can reach it.
 */
export async function findBotChats(
  botId: string,
  userId: string,
): Promise<{ candidates: readonly BotChatCandidate[]; mine: ReadonlySet<string> }> {
  const client = looseClient();
  const { data: memberships, error: membershipError } = await client
    .from("chat_bot_members")
    .select<{ chat_id?: unknown }[]>("chat_id")
    .eq("bot_id", botId)
    .is("removed_at", null)
    .limit(200);
  if (membershipError) {
    console.error("findBotChats membership error:", membershipError);
    return { candidates: [], mine: new Set() };
  }
  const chatIds = (memberships ?? [])
    .map((row) => (typeof row?.chat_id === "string" ? row.chat_id : null))
    .filter((value): value is string => value !== null);
  if (chatIds.length === 0) return { candidates: [], mine: new Set() };

  const [chats, mine] = await Promise.all([
    client
      .from("chats")
      .select<{ id?: unknown; type?: unknown }[]>("id,type")
      .in("id", chatIds)
      .limit(200),
    client
      .from("chat_members")
      .select<{ chat_id?: unknown }[]>("chat_id")
      .eq("user_id", userId)
      .in("chat_id", chatIds)
      .limit(200),
  ]);
  if (chats.error) console.error("findBotChats chats error:", chats.error);
  if (mine.error) console.error("findBotChats members error:", mine.error);

  const candidates: BotChatCandidate[] = (chats.data ?? [])
    .map((row) => ({
      chatId: typeof row?.id === "string" ? row.id : null,
      type: typeof row?.type === "string" ? row.type : null,
    }))
    .filter((entry): entry is BotChatCandidate => entry.chatId !== null);
  const mineIds = new Set(
    (mine.data ?? [])
      .map((row) => (typeof row?.chat_id === "string" ? row.chat_id : null))
      .filter((value): value is string => value !== null),
  );
  return { candidates, mine: mineIds };
}

export type BotChatOpenOutcome =
  | { readonly kind: "opened"; readonly chatId: string }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" };

/**
 * Asks the server to create the chat with a bot.
 *
 * `missing` is the deployment state described at the top of this file, not an
 * error a person can do anything about, so the surface says «Чат с ботом пока
 * недоступен.» rather than offering a retry that cannot work.
 */
export async function createBotChat(botId: string): Promise<BotChatOpenOutcome> {
  const { data, error } = await looseClient().rpc<unknown>("open_or_create_bot_chat", {
    p_bot_id: botId,
  });
  if (error) {
    console.error("createBotChat error:", error);
    return classifyBotCallbackFailure(error) === "missing" ? { kind: "missing" } : { kind: "failed" };
  }
  return typeof data === "string" && data.length > 0
    ? { kind: "opened", chatId: data }
    : { kind: "failed" };
}

// ---------------------------------------------------------------------------
// D-125: pressing a button
// ---------------------------------------------------------------------------

/**
 * Whether this deployment has the door at all.
 *
 * Module state, on purpose, and the same shape `useGlobalSearch` already uses
 * for `global_search` and `search_public_bots`: the answer is a fact about the
 * deployment, identical for every keyboard on the screen, and asking again per
 * press would cost a round trip per button to learn what the first one already
 * proved. It is not persisted — a reload re-learns it, which is what makes the
 * surface come back on its own the moment the wrapper is created.
 */
let callbackDoor: "unknown" | "missing" = "unknown";

export function botCallbackDoorMissing(): boolean {
  return callbackDoor === "missing";
}

/** Only for tests: forget what the last press proved. */
export function resetBotCallbackDoor(): void {
  callbackDoor = "unknown";
}

export interface BotCallbackAnswer {
  /** What the bot said about the press, or the product's own «Готово». */
  readonly text: string;
  /** Telegram's `show_alert`: a sentence the person has to dismiss. */
  readonly alert: boolean;
}

export type BotCallbackResult =
  | { readonly kind: "answered"; readonly answer: BotCallbackAnswer }
  | { readonly kind: "failed"; readonly failure: BotCallbackFailure; readonly message: string };

/**
 * Sends one press, and says what came back.
 *
 * The press carries the message and the button's `callback_data` and nothing
 * else: the bot, the chat and the person are all derivable from the message by
 * the server, and a client that sent its own idea of who it is would be a
 * client that could be wrong about it.
 */
export async function pressBotCallback(input: {
  messageId: string;
  callbackData: string;
}): Promise<BotCallbackResult> {
  if (callbackDoor === "missing") {
    return { kind: "failed", failure: "missing", message: botCallbackFailureMessage("missing") };
  }
  const { data, error } = await looseClient().rpc<unknown>("bot_callback_press", {
    p_message_id: input.messageId,
    p_data: input.callbackData,
  });
  if (error) {
    const failure = classifyBotCallbackFailure(error);
    if (failure === "missing") callbackDoor = "missing";
    console.error("pressBotCallback error:", error);
    // `mapPgError` first, exactly as `useCreateChat` does it: it knows the
    // failures a person can act on — an expired session, a dead network — and
    // it answers a neutral Russian sentence for everything it does not
    // recognise, so the server's own English never reaches the screen. The raw
    // error is above, in the log, where somebody who can act on it reads it.
    return {
      kind: "failed",
      failure,
      message: botCallbackFailureMessage(failure, mapPgError(error)),
    };
  }
  return { kind: "answered", answer: readCallbackAnswer(data) };
}

/**
 * `answerCallbackQuery` as it would come back through the wrapper.
 *
 * A bot is allowed to answer a press with nothing at all — Telegram's own
 * behaviour, and the reason this falls back to «Готово» rather than staying
 * silent: a press that produced no visible change and no word reads as a press
 * that did not register.
 */
function readCallbackAnswer(data: unknown): BotCallbackAnswer {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { text: BOT_CALLBACK_DONE, alert: false };
  }
  const record = data as { text?: unknown; show_alert?: unknown };
  const text = typeof record.text === "string" ? record.text.trim() : "";
  return {
    text: text.length > 0 ? text.slice(0, 200) : BOT_CALLBACK_DONE,
    alert: record.show_alert === true,
  };
}
