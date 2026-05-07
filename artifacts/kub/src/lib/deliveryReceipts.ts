const DELIVERED_DEBOUNCE_MS = 2500;
const READ_DEBOUNCE_MS = 700;

type ReceiptClient = {
  rpc: (fn: string, args: { p_chat_id: string }) => PromiseLike<{ error: unknown }>;
};

type ReceiptMaps = {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  scheduled: Map<string, number>;
  confirmed: Map<string, number>;
};

const deliveredReceipts: ReceiptMaps = {
  timers: new Map(),
  scheduled: new Map(),
  confirmed: new Map(),
};

const readReceipts: ReceiptMaps = {
  timers: new Map(),
  scheduled: new Map(),
  confirmed: new Map(),
};

export function scheduleMarkChatDelivered(
  client: ReceiptClient,
  chatId: string | null | undefined,
  latestIncomingCreatedAt?: string | null,
) {
  scheduleReceiptRpc(client, chatId, latestIncomingCreatedAt, "mark_chat_delivered", deliveredReceipts, DELIVERED_DEBOUNCE_MS);
}

export function scheduleMarkChatRead(
  client: ReceiptClient,
  chatId: string | null | undefined,
  latestVisibleCreatedAt?: string | null,
) {
  scheduleReceiptRpc(client, chatId, latestVisibleCreatedAt, "mark_chat_read", readReceipts, READ_DEBOUNCE_MS);
}

function scheduleReceiptRpc(
  client: ReceiptClient,
  chatId: string | null | undefined,
  watermark: string | null | undefined,
  rpcName: "mark_chat_delivered" | "mark_chat_read",
  maps: ReceiptMaps,
  delayMs: number,
) {
  if (!chatId) return;
  const watermarkMs = toWatermarkMs(watermark);
  const knownMs = Math.max(maps.scheduled.get(chatId) ?? 0, maps.confirmed.get(chatId) ?? 0);
  if (watermarkMs <= knownMs) return;

  maps.scheduled.set(chatId, watermarkMs);
  const existingTimer = maps.timers.get(chatId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    maps.timers.delete(chatId);
    const targetMs = maps.scheduled.get(chatId) ?? watermarkMs;
    void client.rpc(rpcName, { p_chat_id: chatId }).then(({ error }) => {
      if (error) {
        if (maps.scheduled.get(chatId) === targetMs) maps.scheduled.delete(chatId);
        if (import.meta.env.DEV) console.warn(`[${rpcName}] failed`, error);
        return;
      }
      maps.confirmed.set(chatId, Math.max(maps.confirmed.get(chatId) ?? 0, targetMs));
      if (maps.scheduled.get(chatId) === targetMs) maps.scheduled.delete(chatId);
    });
  }, delayMs);

  maps.timers.set(chatId, timer);
}

function toWatermarkMs(value: string | null | undefined): number {
  if (!value) return Date.now();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}
