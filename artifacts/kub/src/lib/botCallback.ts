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
 *   - Bot RPCs are deployed outside the generated compatibility types.
 *
 * A generated type cannot describe any of that, so this module holds one
 * deliberately loose handle, in one place, and every row that leaves it is put
 * through a parser from `botChatSurfaces.ts` rather than trusted.
 *
 * `bot_callback_press` returns a UUID. `bot_callback_answer_for_actor` reads
 * the later answer without exposing the private answer table to the browser.
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
  rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<Answer<T>> & {
    abortSignal(signal: AbortSignal): PromiseLike<Answer<T>>;
  };
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
  /** What the bot said about the press, or the product's delivery confirmation. */
  readonly text: string;
  /** Telegram's `show_alert`: a sentence the person has to dismiss. */
  readonly alert: boolean;
}

export type BotCallbackResult =
  | { readonly kind: "answered"; readonly answer: BotCallbackAnswer; readonly accountId: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly failure: BotCallbackFailure; readonly message: string };

const CALLBACK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANSWER_WAIT_MS = 3200;
const ANSWER_POLL_MS = 400;
const PRESS_WAIT_MS = 7000;
const PRESS_OUTCOME_UNKNOWN = "Нет ответа о нажатии. Проверьте результат перед повтором.";

async function currentAccountId(): Promise<string | null> {
  try {
    const { data, error } = await createClient().auth.getSession();
    return error ? null : data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

function pauseForAnswer(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

async function waitForCallbackAnswer(callbackId: string, signal?: AbortSignal): Promise<BotCallbackAnswer | null> {
  const deadline = Date.now() + ANSWER_WAIT_MS;
  while (!signal?.aborted && Date.now() < deadline) {
    const request = new AbortController();
    const remaining = deadline - Date.now();
    const timeout = setTimeout(() => request.abort(), remaining);
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const { data, error } = await looseClient()
        .rpc<unknown>("bot_callback_answer_for_actor", { p_callback_query_id: callbackId })
        .abortSignal(request.signal);
      if (error) return null;
      if (data !== null && typeof data === "object" && !Array.isArray(data)) {
        return readCallbackAnswer(data);
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    await pauseForAnswer(Math.min(ANSWER_POLL_MS, Math.max(0, deadline - Date.now())), signal);
  }
  return null;
}

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
  signal?: AbortSignal;
}): Promise<BotCallbackResult> {
  if (callbackDoor === "missing") {
    return { kind: "failed", failure: "missing", message: botCallbackFailureMessage("missing") };
  }
  const account = await currentAccountId();
  if (!account) {
    return { kind: "failed", failure: "failed", message: "Сеанс завершился. Войдите снова." };
  }
  if (input.signal?.aborted) return { kind: "cancelled" };
  const request = new AbortController();
  const abort = () => request.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, PRESS_WAIT_MS);
  let pressResult: Answer<unknown>;
  try {
    pressResult = await looseClient().rpc<unknown>("bot_callback_press", {
      p_message_id: input.messageId,
      p_data: input.callbackData,
    }).abortSignal(request.signal);
  } catch {
    if (input.signal?.aborted) return { kind: "cancelled" };
    if (await currentAccountId() !== account) return { kind: "cancelled" };
    return { kind: "failed", failure: "failed", message: PRESS_OUTCOME_UNKNOWN };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
  if (input.signal?.aborted) return { kind: "cancelled" };
  if (await currentAccountId() !== account) return { kind: "cancelled" };
  if (request.signal.aborted) {
    return { kind: "failed", failure: "failed", message: PRESS_OUTCOME_UNKNOWN };
  }
  const { data, error } = pressResult;
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
  if (input.signal?.aborted) return { kind: "cancelled" };
  const answer = typeof data === "string" && CALLBACK_ID_PATTERN.test(data)
    ? await waitForCallbackAnswer(data, input.signal)
    : null;
  if (input.signal?.aborted) return { kind: "cancelled" };
  const currentAccount = await currentAccountId();
  if (currentAccount !== account) return { kind: "cancelled" };
  return { kind: "answered", answer: answer ?? { text: BOT_CALLBACK_DONE, alert: false }, accountId: account };
}

/**
 * The private answer reader returns an object even when the bot chose no text.
 */
function readCallbackAnswer(data: unknown): BotCallbackAnswer {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { text: "Ответ получен", alert: false };
  }
  const record = data as { text?: unknown; show_alert?: unknown };
  const text = typeof record.text === "string" ? record.text.trim() : "";
  return {
    text: text.length > 0 ? text.slice(0, 200) : "Ответ получен",
    alert: record.show_alert === true,
  };
}
