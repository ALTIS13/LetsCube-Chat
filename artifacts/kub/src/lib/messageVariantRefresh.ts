export interface MessageVariantSource {
  id: string;
  chat_id?: string | null;
  type: string;
  media_url: string | null;
  deleted_at: string | null;
}

export interface MessageVariantRefreshState {
  messageIds: string[];
  loading: boolean;
  reloadPending: boolean;
}

export interface MessageVariantRefreshTransition {
  state: MessageVariantRefreshState;
  startNow: boolean;
}

export interface MessageVariantCacheCandidate {
  chatId: string;
  listenerCount: number;
}

export interface MessageVariantRefreshTimer {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timerId: number): void;
  setInterval(callback: () => void, delay: number): number;
  clearInterval(timerId: number): void;
}

export interface MessageVariantRefreshEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface MessageVariantRefreshLifecycle {
  start(): void;
  stop(): void;
}

export type MessageVariantKind = "image_thumb" | "image_preview" | "video_poster" | "video_720p";

/** One `media_variants` row, as much of it as the polling rule reads. */
export interface MessageVariantRow {
  message_id: string | null;
  variant_kind: string;
  status: string;
  error_code: string | null;
  updated_at: string;
}

export interface MessageVariantPollInput {
  /** Every message on screen that expects variants, and the kinds it expects. */
  expected: ReadonlyMap<string, readonly MessageVariantKind[]>;
  /** What the last answer settled for each message: ready, or failed for good. */
  settled: ReadonlyMap<string, ReadonlySet<string>>;
  /** Polls in a row that came back identical to the one before them. */
  unchangedPolls: number;
}

export interface MessageVariantPollDecision {
  poll: boolean;
  /** How long to wait before the next poll; zero when there is not going to be one. */
  intervalMs: number;
  reason: "outstanding" | "settled" | "unchanged";
}

export function getMessageVariantCacheKey(messages: readonly MessageVariantSource[]): string | null {
  const chatIds = new Set(messages.map((message) => message.chat_id).filter((chatId): chatId is string => Boolean(chatId)));
  return chatIds.size === 1 ? Array.from(chatIds)[0] : null;
}

export function getMessageVariantSourceIds(messages: readonly MessageVariantSource[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (expectsMessageVariants(message)) ids.add(message.id);
  }
  return Array.from(ids).sort();
}

export function hasVideoVariantSources(messages: readonly MessageVariantSource[]): boolean {
  return messages.some((message) => (
    message.type === "video" &&
    message.media_url &&
    !message.deleted_at &&
    !message.id.startsWith("tmp:")
  ));
}

const MESSAGE_IMAGE_VARIANT_KINDS: readonly MessageVariantKind[] = ["image_thumb", "image_preview"];
const MESSAGE_VIDEO_VARIANT_KINDS: readonly MessageVariantKind[] = ["video_poster", "video_720p"];

/**
 * The failures the worker never attempts again against the same bytes.
 *
 * The same two codes as `TERMINAL_VARIANT_ERROR_CODES` in
 * `artifacts/api-server/src/workers/mediaVariantsWorkerHelpers.ts`, which is
 * where the decision is actually made; they are repeated rather than imported
 * because that module is a different package and runs on a server with ffmpeg.
 * Getting this list wrong costs only patience in one direction or the other:
 * a code missing from it leaves the poll waiting until the bound below stops
 * it, and a code wrongly in it stops the poll early, which reopening the chat
 * undoes.
 */
const TERMINAL_MESSAGE_VARIANT_ERROR_CODES: ReadonlySet<string> = new Set([
  "source_missing",
  "source_unreadable",
]);

/** The pace the poll has always run at, and still runs at while answers keep changing. */
export const MESSAGE_VARIANT_POLL_INTERVAL_MS = 60_000;
/** However far the wait backs off, it stops here. */
export const MESSAGE_VARIANT_POLL_MAX_INTERVAL_MS = 300_000;
/** Answers that change nothing are tolerated at the full pace this many times before the wait grows. */
const MESSAGE_VARIANT_POLL_STEADY_POLLS = 2;
/**
 * How many polls in a row may change nothing before the chat stops asking.
 *
 * Eight, which with the backoff below is 60+60+60+120+240+300+300+300 seconds:
 * twenty-four minutes of patience for eight queries, against the fourteen
 * hundred a day-long conversation used to make (D-176). The number comes from
 * the worker rather than from taste — it gives one transcode up to ten minutes
 * (`MEDIA_VARIANTS_VIDEO_TRANSCODE_TIMEOUT_MS`) and takes clips one at a time,
 * so a bound under a quarter of an hour would abandon a job that is still
 * running. Twenty-four minutes covers that attempt and most of a second one.
 * Past the bound only immediacy is given up: opening the chat again, or any
 * picture or video arriving in it, starts the polling over.
 */
export const MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT = 8;

/**
 * The variant kinds the worker will produce for a message of this type.
 *
 * Must stay the same answer as `getExpectedMessageVariantKinds` in
 * `artifacts/api-server/src/workers/mediaVariantRules.ts`, which is what
 * actually decides. Both kinds are produced for every image and every video —
 * a clip small enough to need no transcode still gets a `video_720p` row, one
 * that points at its own source — so this is a complete account of what a
 * message is waiting for, which is what lets the rule below prove it is done.
 */
export function getExpectedMessageVariantKinds(type: string): readonly MessageVariantKind[] {
  if (type === "image") return MESSAGE_IMAGE_VARIANT_KINDS;
  if (type === "video") return MESSAGE_VIDEO_VARIANT_KINDS;
  return [];
}

/** What each message on screen is waiting for, keyed the way the poll reads it. */
export function getExpectedMessageVariantKindsByMessage(
  messages: readonly MessageVariantSource[],
): Map<string, readonly MessageVariantKind[]> {
  const expected = new Map<string, readonly MessageVariantKind[]>();
  for (const message of messages) {
    if (expectsMessageVariants(message)) expected.set(message.id, getExpectedMessageVariantKinds(message.type));
  }
  return expected;
}

/**
 * What an answer settles, by message.
 *
 * `ready` is the obvious half. A `failed` row carrying a terminal code is the
 * other: the worker will not attempt that kind against those bytes again, so
 * waiting for it is waiting for something nobody is making. A failure with any
 * other code is retried, so it is deliberately left outstanding, and a `stale`
 * row is one being remade.
 */
export function collectSettledMessageVariantKinds(rows: readonly MessageVariantRow[]): Map<string, Set<string>> {
  const settled = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.message_id) continue;
    const isSettled =
      row.status === "ready" ||
      (row.status === "failed" && row.error_code !== null && TERMINAL_MESSAGE_VARIANT_ERROR_CODES.has(row.error_code));
    if (!isSettled) continue;
    const kinds = settled.get(row.message_id) ?? new Set<string>();
    kinds.add(row.variant_kind);
    settled.set(row.message_id, kinds);
  }
  return settled;
}

/**
 * A stable fingerprint of one answer, so two of them can be compared.
 *
 * `updated_at` is part of it because a variant keeps its path when it is
 * rewritten: without the moment it was written, a rewritten row would read as
 * no change at all and the bound would count a poll that did deliver something.
 * The order is fixed here rather than trusted from the query.
 */
export function getMessageVariantRowsSignature(rows: readonly MessageVariantRow[]): string {
  return rows
    .filter((row) => Boolean(row.message_id))
    .map((row) => [row.message_id, row.variant_kind, row.status, row.updated_at].join("~"))
    .sort()
    .join(";");
}

/** Whether anything on screen is still waiting for a variant that might arrive. */
export function hasOutstandingMessageVariants(
  expected: ReadonlyMap<string, readonly MessageVariantKind[]>,
  settled: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (const [messageId, kinds] of expected) {
    const settledKinds = settled.get(messageId);
    for (const kind of kinds) {
      if (!settledKinds?.has(kind)) return true;
    }
  }
  return false;
}

/**
 * Whether the messages on screen have brought work the poll has not seen.
 *
 * A message that arrived after the polling converged is the one thing that must
 * undo it, or this fix trades a poll that never stops for a video that never
 * loads. Only an id that was not there before counts: a message scrolling out
 * of the window can lower the work outstanding but never raise it, so treating
 * that as new work would hand the count back for nothing.
 */
export function hasNewMessageVariantWork(
  previous: ReadonlyMap<string, readonly MessageVariantKind[]>,
  next: ReadonlyMap<string, readonly MessageVariantKind[]>,
): boolean {
  for (const messageId of next.keys()) {
    if (!previous.has(messageId)) return true;
  }
  return false;
}

/**
 * Whether another poll for this chat's variants is worth making, and when.
 *
 * D-176: this interval used to be started for any chat holding a video and then
 * never stopped, so a conversation left open all day asked the database once a
 * minute, for hours, about variants it already held — and since a 720p row now
 * usually lands within seconds of the message, almost every one of those asks
 * was for nothing.
 *
 * The first rule is the one that matters. When every kind every message on
 * screen expects is either ready or failed for good, there is nothing left for
 * a poll to find, and the polling ends rather than idles. The bound behind it
 * is for the case that rule cannot see: a row that is never written at all —
 * a worker that is down, a message the scan has not reached — leaves a kind
 * outstanding for ever, and something has to end that too.
 */
export function decideMessageVariantPoll({
  expected,
  settled,
  unchangedPolls,
}: MessageVariantPollInput): MessageVariantPollDecision {
  if (!hasOutstandingMessageVariants(expected, settled)) {
    return { poll: false, intervalMs: 0, reason: "settled" };
  }
  if (unchangedPolls >= MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT) {
    return { poll: false, intervalMs: 0, reason: "unchanged" };
  }
  return { poll: true, intervalMs: pollIntervalMs(unchangedPolls), reason: "outstanding" };
}

export function queueMessageVariantRefresh(
  state: MessageVariantRefreshState,
  messageIds: readonly string[],
): MessageVariantRefreshTransition {
  const nextMessageIds = Array.from(new Set(messageIds)).sort();
  if (sameMessageIds(state.messageIds, nextMessageIds)) {
    return { state, startNow: false };
  }
  if (state.loading) {
    return {
      state: {
        messageIds: nextMessageIds,
        loading: true,
        reloadPending: true,
      },
      startNow: false,
    };
  }
  return {
    state: {
      messageIds: nextMessageIds,
      loading: false,
      reloadPending: false,
    },
    startNow: nextMessageIds.length > 0,
  };
}

export function beginMessageVariantRefresh(state: MessageVariantRefreshState): MessageVariantRefreshState {
  return { ...state, loading: true };
}

export function completeMessageVariantRefresh(state: MessageVariantRefreshState): MessageVariantRefreshTransition {
  return {
    state: {
      ...state,
      loading: false,
      reloadPending: false,
    },
    startNow: state.reloadPending && state.messageIds.length > 0,
  };
}

export function selectMessageVariantCacheEvictions(
  entries: readonly MessageVariantCacheCandidate[],
  cacheLimit: number,
): string[] {
  const removalCount = Math.max(0, entries.length - cacheLimit + 1);
  if (removalCount === 0) return [];
  return entries
    .filter((entry) => entry.listenerCount === 0)
    .slice(0, removalCount)
    .map((entry) => entry.chatId);
}

export function createMessageVariantRefreshLifecycle({
  windowTarget,
  documentTarget,
  getVisibilityState,
  timer,
  intervalMs,
  tabReturnDebounceMs,
  onRefresh,
}: {
  windowTarget: MessageVariantRefreshEventTarget;
  documentTarget: MessageVariantRefreshEventTarget;
  getVisibilityState: () => string;
  timer: MessageVariantRefreshTimer;
  intervalMs: number;
  tabReturnDebounceMs: number;
  onRefresh: () => void;
}): MessageVariantRefreshLifecycle {
  let intervalId: number | null = null;
  let tabReturnTimerId: number | null = null;
  let started = false;

  const refreshOnTabReturn = () => {
    if (getVisibilityState() !== "visible" || tabReturnTimerId !== null) return;
    tabReturnTimerId = timer.setTimeout(() => {
      tabReturnTimerId = null;
      onRefresh();
    }, tabReturnDebounceMs);
  };

  return {
    start() {
      if (started) return;
      started = true;
      intervalId = timer.setInterval(onRefresh, intervalMs);
      windowTarget.addEventListener("focus", refreshOnTabReturn);
      documentTarget.addEventListener("visibilitychange", refreshOnTabReturn);
    },
    stop() {
      if (!started) return;
      started = false;
      if (intervalId !== null) timer.clearInterval(intervalId);
      if (tabReturnTimerId !== null) timer.clearTimeout(tabReturnTimerId);
      intervalId = null;
      tabReturnTimerId = null;
      windowTarget.removeEventListener("focus", refreshOnTabReturn);
      documentTarget.removeEventListener("visibilitychange", refreshOnTabReturn);
    },
  };
}

function sameMessageIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Whether this message is one the worker makes variants for.
 *
 * A message still uploading carries a `tmp:` id that no row can reference, and
 * a deleted one has nothing left to make variants of. Shared by the ids the
 * poll asks about and the kinds it waits for, so those two cannot come apart.
 */
function expectsMessageVariants(message: MessageVariantSource): boolean {
  return (
    (message.type === "image" || message.type === "video") &&
    Boolean(message.media_url) &&
    !message.deleted_at &&
    !message.id.startsWith("tmp:")
  );
}

/**
 * How long to wait before the next poll, once the answers stop changing.
 *
 * The first few keep the minute the poll has always used, because the common
 * shape is a transcode landing shortly after its poster. After that the wait
 * doubles up to five minutes: an answer that has told us nothing three times
 * running is unlikely to tell us anything in the next sixty seconds. Backing
 * off rather than stopping outright is what lets the bound be reached slowly
 * enough for a long transcode to be waited out — a flat minute generous enough
 * to cover ten minutes of ffmpeg would cost ten more pointless queries to get
 * there.
 */
function pollIntervalMs(unchangedPolls: number): number {
  const doublings = Math.max(0, unchangedPolls - MESSAGE_VARIANT_POLL_STEADY_POLLS);
  return Math.min(MESSAGE_VARIANT_POLL_INTERVAL_MS * 2 ** doublings, MESSAGE_VARIANT_POLL_MAX_INTERVAL_MS);
}
