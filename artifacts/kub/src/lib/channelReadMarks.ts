/**
 * Moving this reader's mark in a channel forward (tracker item 54), the way
 * `lib/deliveryReceipts.ts` moves the chat's own: debounced per channel, never
 * backwards, and given up for the session if the database has no such function.
 * The chat's own mark is not touched here; it is still moved where it always
 * was, so the chat list's count, push and receipts are what they were.
 */

type ChannelReadClient = {
  rpc: (fn: "mark_channel_read", args: { p_chat_id: string; p_channel: string; p_read_through: string }) => PromiseLike<{
    error: { code?: string | null; message?: string | null } | null;
  }>;
};

const DEBOUNCE_MS = 800;
const pending = new Map<string, { at: string; timer: ReturnType<typeof setTimeout> }>();
const sent = new Map<string, string>();
let unavailable = false;

export function scheduleMarkChannelRead(
  client: ChannelReadClient,
  chatId: string | null | undefined,
  channel: string | null | undefined,
  readThrough: string | null | undefined,
): void {
  if (unavailable || !chatId || !channel || !readThrough) return;
  const key = `${chatId}:${channel}`;
  const known = pending.get(key)?.at ?? sent.get(key) ?? null;
  if (known && Date.parse(known) >= Date.parse(readThrough)) return;
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    sent.set(key, readThrough);
    void client
      .rpc("mark_channel_read", { p_chat_id: chatId, p_channel: channel, p_read_through: readThrough })
      .then(({ error }) => {
        if (!error) return;
        // A database without the function says so once; nothing else is asked.
        if (error.code === "PGRST202" || error.code === "42883") unavailable = true;
        // Anything else is asked again by the next message read.
        if (sent.get(key) === readThrough) sent.delete(key);
      });
  }, DEBOUNCE_MS);
  pending.set(key, { at: readThrough, timer });
}
