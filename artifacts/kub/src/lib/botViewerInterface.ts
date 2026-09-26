import {
  BOT_CALLBACK_DONE,
  botCallbackFailureMessage,
  classifyBotCallbackFailure,
} from "./botChatSurfaces.ts";
import { mapPgError } from "./errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANSWER_WAIT_MS = 3200;
const ANSWER_POLL_MS = 400;
const PRESS_WAIT_MS = 7000;

export interface BotViewerButton {
  readonly key: string;
  readonly text: string;
}

export interface BotViewerInterface {
  readonly id: string;
  readonly botId: string;
  readonly callbackQueryId: string;
  readonly sourceMessageId: string;
  readonly version: number;
  readonly expiresAt: number;
  readonly title: string;
  readonly body: string | null;
  readonly progress: number | null;
  readonly buttons: readonly (readonly BotViewerButton[])[];
}

type RpcError = { code?: unknown; message?: unknown } | null;
type RpcResult = { data: unknown; error: RpcError };
type RpcRequest = PromiseLike<RpcResult> & { abortSignal(signal: AbortSignal): PromiseLike<RpcResult> };
interface ViewerClient {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): RpcRequest;
}

async function client(): Promise<ViewerClient> {
  const { createClient } = await import("./supabase/client");
  return createClient() as unknown as ViewerClient;
}

async function accountId(): Promise<string | null> {
  try {
    const { data, error } = await (await client()).auth.getSession();
    return error ? null : data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export async function botViewerAccountStillCurrent(account: string): Promise<boolean> {
  return await accountId() === account;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function length(value: string): number {
  return Array.from(value).length;
}

function parseButtons(value: unknown): readonly (readonly BotViewerButton[])[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return null;
  const keys = new Set<string>();
  let count = 0;
  const rows: BotViewerButton[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length < 1 || row.length > 6) return null;
    const buttons: BotViewerButton[] = [];
    for (const button of row) {
      if (!object(button) || !exactKeys(button, ["key", "text"])) return null;
      const { key, text } = button;
      if (typeof key !== "string" || length(key) < 1 || length(key) > 32 || keys.has(key)) return null;
      if (typeof text !== "string" || length(text) < 1 || length(text) > 64 || !text.trim()) return null;
      keys.add(key);
      buttons.push({ key, text });
      count += 1;
      if (count > 6) return null;
    }
    rows.push(buttons);
  }
  return rows;
}

/** The actor RPC is a privacy boundary, so refuse unknown or bot-only fields. */
export function parseBotViewerInterfaces(value: unknown, now = Date.now()): BotViewerInterface[] {
  if (!Array.isArray(value) || value.length > 8) return [];
  const panels: BotViewerInterface[] = [];
  for (const row of value) {
    if (!object(row) || !exactKeys(row, ["id", "bot_id", "callback_query_id", "source_message_id", "version", "expires_at", "state"])) continue;
    const { id, bot_id: botId, callback_query_id: callbackQueryId, source_message_id: sourceMessageId, version, expires_at: expiresAt, state } = row;
    if (![id, botId, callbackQueryId, sourceMessageId].every((part) => typeof part === "string" && UUID.test(part))) continue;
    if (!Number.isInteger(version) || (version as number) < 1) continue;
    if (typeof expiresAt !== "string") continue;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) continue;
    if (!object(state) || !exactKeys(state, ["title", "body", "progress", "buttons"])) continue;
    const { title, body, progress } = state;
    if (typeof title !== "string" || length(title) < 1 || length(title) > 64 || !title.trim()) continue;
    if (body !== undefined && (typeof body !== "string" || length(body) > 512)) continue;
    if (progress !== undefined && (!Number.isInteger(progress) || (progress as number) < 0 || (progress as number) > 100)) continue;
    const buttons = parseButtons(state.buttons);
    if (!buttons) continue;
    panels.push({
      id: id as string,
      botId: botId as string,
      callbackQueryId: callbackQueryId as string,
      sourceMessageId: sourceMessageId as string,
      version: version as number,
      expiresAt: expiry,
      title,
      body: body === undefined ? null : body as string,
      progress: progress === undefined ? null : progress as number,
      buttons,
    });
  }
  return panels;
}

function linkedAbort(signal: AbortSignal | undefined, timeoutMs: number) {
  const request = new AbortController();
  const abort = () => request.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) request.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  return {
    signal: request.signal,
    timedOut: () => timedOut,
    close: () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); },
  };
}

async function rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeoutMs = PRESS_WAIT_MS): Promise<RpcResult | null> {
  const request = linkedAbort(signal, timeoutMs);
  try {
    const result = await (await client()).rpc(name, args).abortSignal(request.signal);
    return request.timedOut() ? null : result;
  } catch {
    return null;
  } finally {
    request.close();
  }
}

/** Null means the read was not trustworthy; callers must clear visible state. */
export async function readBotViewerInterfaces(chatId: string, account: string, signal?: AbortSignal): Promise<BotViewerInterface[] | null> {
  if (signal?.aborted || await accountId() !== account) return null;
  const result = await rpc("bot_viewer_interfaces_for_actor", { p_chat_id: chatId }, signal);
  if (signal?.aborted || await accountId() !== account || !result || result.error || !Array.isArray(result.data)) return null;
  return parseBotViewerInterfaces(result.data);
}

export type BotViewerPress =
  | { readonly kind: "accepted"; readonly callbackId: string | null; readonly accountId: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly failure: "missing" | "refused" | "failed"; readonly message: string };

let originalDoorMissing = false;
export function botViewerOriginalDoorMissing(): boolean { return originalDoorMissing; }

/** Keep the original keyboard RPC and feedback semantics, retaining its UUID for panel matching. */
export async function pressBotViewerOriginal(messageId: string, callbackData: string, signal?: AbortSignal): Promise<BotViewerPress> {
  if (originalDoorMissing) return { kind: "failed", failure: "missing", message: botCallbackFailureMessage("missing") };
  const account = await accountId();
  if (!account) return { kind: "failed", failure: "failed", message: "Сеанс завершился. Войдите снова." };
  if (signal?.aborted) return { kind: "cancelled" };
  const result = await rpc("bot_callback_press", { p_message_id: messageId, p_data: callbackData }, signal);
  if (signal?.aborted || await accountId() !== account) return { kind: "cancelled" };
  if (!result) return { kind: "failed", failure: "failed", message: "Нет ответа о нажатии. Проверьте результат перед повтором." };
  if (result.error) {
    const failure = classifyBotCallbackFailure(result.error);
    if (failure === "missing") originalDoorMissing = true;
    return { kind: "failed", failure, message: botCallbackFailureMessage(failure, mapPgError(result.error)) };
  }
  return { kind: "accepted", callbackId: typeof result.data === "string" && UUID.test(result.data) ? result.data : null, accountId: account };
}

export interface BotViewerAnswer { readonly text: string; readonly alert: boolean }

function parseAnswer(value: unknown): BotViewerAnswer {
  if (!object(value)) return { text: "Ответ получен", alert: false };
  const text = typeof value.text === "string" ? value.text.trim() : "";
  return { text: text ? text.slice(0, 200) : "Ответ получен", alert: value.show_alert === true };
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function waitForBotViewerAnswer(callbackId: string | null, account: string, signal?: AbortSignal): Promise<BotViewerAnswer> {
  if (!callbackId) return { text: BOT_CALLBACK_DONE, alert: false };
  const deadline = Date.now() + ANSWER_WAIT_MS;
  while (!signal?.aborted && Date.now() < deadline) {
    if (await accountId() !== account) break;
    const result = await rpc("bot_callback_answer_for_actor", { p_callback_query_id: callbackId }, signal, Math.max(1, deadline - Date.now()));
    if (!result || result.error) break;
    if (object(result.data)) return parseAnswer(result.data);
    await pause(Math.min(ANSWER_POLL_MS, Math.max(0, deadline - Date.now())), signal);
  }
  return { text: BOT_CALLBACK_DONE, alert: false };
}

export async function pressBotViewerButton(panel: BotViewerInterface, key: string, account: string, signal?: AbortSignal): Promise<BotViewerPress> {
  if (signal?.aborted || await accountId() !== account) return { kind: "cancelled" };
  const result = await rpc("bot_viewer_interface_press", {
    p_interface_id: panel.id, p_expected_version: panel.version, p_button_key: key,
  }, signal);
  if (signal?.aborted || await accountId() !== account) return { kind: "cancelled" };
  if (!result) return { kind: "failed", failure: "failed", message: "Нет ответа о нажатии. Проверьте результат перед повтором." };
  if (result.error || typeof result.data !== "string" || !UUID.test(result.data)) {
    return { kind: "failed", failure: "failed", message: "Панель изменилась. Проверьте её перед повтором." };
  }
  return { kind: "accepted", callbackId: result.data, accountId: account };
}

export async function dismissBotViewerInterface(panel: BotViewerInterface, account: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || await accountId() !== account) return false;
  const result = await rpc("bot_viewer_interface_dismiss", {
    p_interface_id: panel.id, p_expected_version: panel.version,
  }, signal);
  if (signal?.aborted || await accountId() !== account) return false;
  return result?.error === null && result.data === true;
}
