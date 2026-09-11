/**
 * The order a send uploads and inserts its attachments in.
 *
 * D-114, «фото 300 КБ отправляется очень долго», and D-113, «видео не
 * отправляется». Both went through one loop that uploaded and inserted one
 * attachment at a time and returned at the first failure. A photo picked with
 * a video waited for the whole video, reading «Готово к отправке» meanwhile,
 * and one refused file left every attachment after it waiting for a send that
 * had already ended, with no reason given.
 *
 * Now up to `ATTACHMENT_UPLOAD_CONCURRENCY` uploads run at once, started in the
 * order the files were picked, and the messages are inserted strictly in that
 * order: an attachment is inserted only once every attachment before it has
 * been inserted or has failed. A failure is that attachment's alone. The
 * conversation reads exactly as it did — only the waiting is shorter.
 *
 * What the order does not buy: a photo picked after a video still appears
 * after the video. Its bytes are up by then, so it follows the video at once.
 *
 * Imports nothing, so `node --test` loads it directly:
 * `tests/unit/attachment-send-queue.test.mts`.
 */

/**
 * Three: enough that a photo is not held behind a video, few enough that a
 * phone on mobile data is not asked to push ten files at once.
 */
export const ATTACHMENT_UPLOAD_CONCURRENCY = 3;

export type OrderedSendOutcome = "sent" | "upload_failed" | "insert_failed" | "skipped";

export interface OrderedSendSteps<T, U> {
  /** Uploads running at once; anything below one is one. */
  concurrency: number;
  /** False once the whole send is abandoned — the conversation changed. Nothing starts or inserts after that. */
  isActive(): boolean;
  /** False for an attachment taken out of the send. It is skipped, and the rest go on. */
  isWanted(item: T): boolean;
  upload(item: T, index: number): Promise<U>;
  /** As soon as its upload is done, while attachments before it may still be on their way. */
  onUploaded?(item: T, uploaded: U, index: number): void;
  /** As soon as its upload fails. It is not inserted; the attachments after it are. */
  onUploadFailed?(item: T, error: unknown, index: number): void;
  /** One at a time, in pick order. Resolves true when the message is in. */
  insert(item: T, uploaded: U, index: number): Promise<boolean>;
}

export interface OrderedSendResult {
  /** One per attachment, in pick order. */
  outcomes: OrderedSendOutcome[];
  /** False when the send was abandoned before every attachment was settled. */
  completed: boolean;
}

type UploadSettlement<U> =
  | { kind: "uploaded"; value: U }
  | { kind: "failed" }
  | { kind: "skipped" };

interface Slots {
  acquire(): Promise<void>;
  release(): void;
}

function createSlots(concurrency: number): Slots {
  let free = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const waiting: Array<() => void> = [];
  return {
    acquire() {
      if (free > 0) {
        free -= 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    release() {
      const next = waiting.shift();
      if (next) next();
      else free += 1;
    },
  };
}

/** A callback's own failure is the caller's to report; it must not stall the send. */
function quietly(run: () => void): void {
  try {
    run();
  } catch {
    // The send goes on.
  }
}

async function uploadInTurn<T, U>(
  item: T,
  index: number,
  steps: OrderedSendSteps<T, U>,
  slots: Slots,
): Promise<UploadSettlement<U>> {
  // Every attachment asks for a slot in pick order, and slots are handed out in
  // the order they were asked for, so uploads start in pick order too.
  await slots.acquire();
  try {
    const stillWanted = () => steps.isActive() && steps.isWanted(item);
    if (!stillWanted()) return { kind: "skipped" };
    let value: U;
    try {
      value = await steps.upload(item, index);
    } catch (error) {
      if (!stillWanted()) return { kind: "skipped" };
      quietly(() => steps.onUploadFailed?.(item, error, index));
      return { kind: "failed" };
    }
    if (!stillWanted()) return { kind: "skipped" };
    quietly(() => steps.onUploaded?.(item, value, index));
    return { kind: "uploaded", value };
  } finally {
    slots.release();
  }
}

export async function runOrderedSend<T, U>(
  items: readonly T[],
  steps: OrderedSendSteps<T, U>,
): Promise<OrderedSendResult> {
  const slots = createSlots(steps.concurrency);
  const uploads = items.map((item, index) => uploadInTurn(item, index, steps, slots));
  const outcomes: OrderedSendOutcome[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const settlement = await uploads[index];
    if (!steps.isActive()) {
      while (outcomes.length < items.length) outcomes.push("skipped");
      return { outcomes, completed: false };
    }
    const item = items[index];
    if (settlement.kind === "failed") {
      outcomes.push("upload_failed");
      continue;
    }
    if (settlement.kind === "skipped" || !steps.isWanted(item)) {
      outcomes.push("skipped");
      continue;
    }
    let inserted = false;
    try {
      inserted = await steps.insert(item, settlement.value, index);
    } catch {
      inserted = false;
    }
    outcomes.push(inserted ? "sent" : "insert_failed");
  }

  return { outcomes, completed: true };
}

/**
 * The `client_sent_at` of the next message in a send: now, but always later
 * than the message before it, so the conversation's order is the pick order
 * even when two inserts start within one millisecond.
 */
export function nextClientSentAt(previous: string | null, nowMs: number): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  const at = Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs;
  return new Date(at).toISOString();
}
