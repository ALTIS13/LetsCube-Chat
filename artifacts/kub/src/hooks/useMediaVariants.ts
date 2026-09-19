import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MediaVariant, MessageWithSender } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import {
  beginMessageVariantRefresh,
  collectSettledMessageVariantKinds,
  completeMessageVariantRefresh,
  createMessageVariantRefreshLifecycle,
  decideMessageVariantPoll,
  getExpectedMessageVariantKindsByMessage,
  getMessageVariantCacheKey,
  getMessageVariantRowsSignature,
  getMessageVariantSourceIds,
  hasNewMessageVariantWork,
  queueMessageVariantRefresh,
  selectMessageVariantCacheEvictions,
  type MessageVariantKind,
  type MessageVariantRefreshState,
  type MessageVariantRefreshLifecycle,
} from "@/lib/messageVariantRefresh";
import { createAvatarVariantStore, sameAvatarVariantUrls, type AvatarVariantUrls } from "@/lib/avatarVariantStore";
import { withVersionToken } from "@/lib/mediaCacheControl";
import { readOriginalPreview } from "@/lib/mediaCompression";
import { variantMediaObjectRef } from "@/lib/media/mediaObjectRef";
import {
  mediaObjectUrl,
  requestMediaObjectUrl,
  signedMediaUrls,
  variantMediaUrl,
} from "@/lib/media/mediaUrl";

type MessageMediaVariantSource = Pick<MessageWithSender, "id" | "chat_id" | "type" | "media_url" | "deleted_at">;

export interface MessageMediaVariantUrls {
  previewUrl?: string;
  previewWidth?: number | null;
  previewHeight?: number | null;
  thumbUrl?: string;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  videoPosterUrl?: string;
  videoPosterWidth?: number | null;
  videoPosterHeight?: number | null;
  video720pUrl?: string;
  video720pWidth?: number | null;
  video720pHeight?: number | null;
}

// Defined with the store so the two cannot drift apart.
export type { AvatarVariantUrls } from "@/lib/avatarVariantStore";

const MESSAGE_VARIANT_KINDS = ["image_preview", "image_thumb", "video_poster", "video_720p"] as const;
const AVATAR_VARIANT_KINDS = ["avatar_128", "avatar_256"] as const;
/**
 * The rows a message's poll reads.
 *
 * A failed row is read alongside the ready ones only so the polling rule can
 * tell "not made yet" from "never going to be made" (D-176); nothing is drawn
 * from one. `stale` is left out because a row being remade is still owed.
 */
const MESSAGE_VARIANT_STATUSES = ["ready", "failed"] as const;
const MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS = 120;
const MESSAGE_VARIANT_TAB_RETURN_DEBOUNCE_MS = 80;
const MESSAGE_VARIANT_CACHE_LIMIT = 8;

interface MessageVariantCacheEntry {
  chatId: string;
  refreshState: MessageVariantRefreshState;
  variants: Record<string, MessageMediaVariantUrls>;
  listeners: Set<(variants: Record<string, MessageMediaVariantUrls>) => void>;
  refreshLifecycle: MessageVariantRefreshLifecycle | null;
  debounceTimer: number | null;
  evictionTimer: number | null;
  hasStarted: boolean;
  disposed: boolean;
  /** What the messages on screen are waiting for, and what the last answer settled (D-176). */
  expectedKinds: Map<string, readonly MessageVariantKind[]>;
  settledKinds: Map<string, Set<string>>;
  unchangedPolls: number;
  lastRowsSignature: string | null;
  /** The pace the running lifecycle was built with, so it is only rebuilt when that changes. */
  pollIntervalMs: number | null;
  /** The last answer's rows, so the addresses can be re-derived without a poll (D-208). */
  lastRows: MediaVariant[];
  /** Ends this entry's interest in signature renewals. */
  urlRenewalUnsubscribe: (() => void) | null;
}

const messageVariantCache = new Map<string, MessageVariantCacheEntry>();

/**
 * The address of one variant object.
 *
 * D-208: this used to call `getPublicUrl` here, which is how a preview of a
 * photograph somebody sent became readable by anyone who could guess four leaf
 * names. The shape of the address is now a decision taken once, in
 * `lib/media/mediaUrl`; in the shipped `"public"` mode it still resolves to the
 * same string, byte for byte.
 */
function getVariantUrl(row: Pick<MediaVariant, "variant_bucket" | "variant_path">): string | null {
  requestMediaObjectUrl(variantMediaObjectRef(row));
  return variantMediaUrl(row);
}

/**
 * The address of an original photo's preview, when the message has a valid one.
 *
 * The client uploads that preview beside the original, so a conversation can
 * draw the photo before — or without — the worker's `image_preview`. Only the
 * path is read from the message, and only the one derived from its own
 * `media_path`; the URL is built here, in the message's bucket.
 */
export function resolveOriginalPreviewUrl(message: {
  type: string | null;
  media_bucket: string | null;
  media_path: string | null;
  media_metadata: unknown;
}): { url: string; width: number; height: number } | null {
  const preview = readOriginalPreview(message);
  if (!preview || !message.media_bucket) return null;
  const ref = { bucket: message.media_bucket, path: preview.path };
  requestMediaObjectUrl(ref);
  const url = mediaObjectUrl(ref);
  return url ? { url, width: preview.width, height: preview.height } : null;
}

export function useMessageMediaVariantUrls(messages: MessageMediaVariantSource[]): Record<string, MessageMediaVariantUrls> {
  const messageIds = useMemo(() => getMessageVariantSourceIds(messages), [messages]);
  const messageIdKey = messageIds.join("|");
  const chatId = useMemo(() => getMessageVariantCacheKey(messages), [messages]);
  const expectedKinds = useMemo(() => getExpectedMessageVariantKindsByMessage(messages), [messages]);
  const [variantsByMessageId, setVariantsByMessageId] = useState<Record<string, MessageMediaVariantUrls>>({});

  useEffect(() => {
    if (!chatId) {
      setVariantsByMessageId({});
      return;
    }

    const entry = getMessageVariantCacheEntry(chatId);
    entry.listeners.add(setVariantsByMessageId);
    if (entry.evictionTimer !== null) {
      window.clearTimeout(entry.evictionTimer);
      entry.evictionTimer = null;
    }
    setVariantsByMessageId(entry.variants);
    updateMessageVariantCacheEntry(entry, messageIds, expectedKinds);
    return () => {
      entry.listeners.delete(setVariantsByMessageId);
      scheduleMessageVariantEntryEviction(entry);
    };
  }, [chatId, messageIdKey]);

  return variantsByMessageId;
}

function getMessageVariantCacheEntry(chatId: string): MessageVariantCacheEntry {
  const existing = messageVariantCache.get(chatId);
  if (existing) return existing;
  const entry: MessageVariantCacheEntry = {
    chatId,
    refreshState: { messageIds: [], loading: false, reloadPending: false },
    variants: {},
    listeners: new Set(),
    refreshLifecycle: null,
    debounceTimer: null,
    evictionTimer: null,
    hasStarted: false,
    disposed: false,
    expectedKinds: new Map(),
    settledKinds: new Map(),
    unchangedPolls: 0,
    lastRowsSignature: null,
    pollIntervalMs: null,
    lastRows: [],
    urlRenewalUnsubscribe: null,
  };
  evictUnusedMessageVariantEntries();
  messageVariantCache.set(chatId, entry);
  subscribeMessageVariantUrlRenewals(entry);
  return entry;
}

function updateMessageVariantCacheEntry(
  entry: MessageVariantCacheEntry,
  messageIds: string[],
  expectedKinds: Map<string, readonly MessageVariantKind[]>,
): void {
  const transition = queueMessageVariantRefresh(entry.refreshState, messageIds);
  entry.refreshState = transition.state;
  // A message that arrived after the polling gave up has to hand the patience
  // back, or D-176 is traded for a video that never loads. Only genuinely new
  // work counts; see `hasNewMessageVariantWork`.
  if (hasNewMessageVariantWork(entry.expectedKinds, expectedKinds)) entry.unchangedPolls = 0;
  entry.expectedKinds = expectedKinds;
  applyMessageVariantPolling(entry);
  if (messageIds.length === 0) {
    entry.variants = {};
    notifyMessageVariantListeners(entry);
    return;
  }
  if (transition.startNow) {
    scheduleMessageVariantLoad(entry, entry.hasStarted ? MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS : 0);
  }
}

/**
 * Starts, re-paces or ends this chat's polling from the current rule.
 *
 * Called after anything that could change the answer: the messages on screen,
 * and every poll's own result. The lifecycle takes its interval once, when it
 * is built, so a changed pace means a new one — but it is only rebuilt when the
 * pace actually changed, or a poll that keeps its interval would reset its own
 * timer and its tab-return listeners every time it ran.
 *
 * `decideMessageVariantPoll` is the whole rule (D-176). This used to add a
 * condition of its own on top — only a chat holding a video polled at all — on
 * the grounds that «a picture's variants land in one pass, and the sender's own
 * preview is already on screen while they do». Neither half held for a photo
 * somebody else sent: the one pass runs before the worker has written anything,
 * and the sender-side preview exists only for an «Оригинал» send
 * (`readOriginalPreview` requires `uncompressed`). So an ordinary photo in a
 * chat without a video was drawn from its full-size original for the rest of
 * the session, and the info panel's grid showed a placeholder where its tile
 * should be. That was D-095, and the gate was the pre-D-176 crude form of the
 * same idea the rule now states properly — bounded, backed off, and stopping
 * the moment everything has arrived.
 */
function applyMessageVariantPolling(entry: MessageVariantCacheEntry): void {
  const decision = decideMessageVariantPoll({
    expected: entry.expectedKinds,
    settled: entry.settledKinds,
    unchangedPolls: entry.unchangedPolls,
  });
  if (entry.disposed || !decision.poll) {
    stopMessageVariantPolling(entry);
    return;
  }
  if (entry.refreshLifecycle && entry.pollIntervalMs === decision.intervalMs) return;
  stopMessageVariantPolling(entry);
  entry.pollIntervalMs = decision.intervalMs;
  entry.refreshLifecycle = createMessageVariantRefreshLifecycle({
    windowTarget: window,
    documentTarget: document,
    getVisibilityState: () => document.visibilityState,
    timer: window,
    intervalMs: decision.intervalMs,
    tabReturnDebounceMs: MESSAGE_VARIANT_TAB_RETURN_DEBOUNCE_MS,
    onRefresh: () => requestMessageVariantLifecycleRefresh(entry),
  });
  entry.refreshLifecycle.start();
}

function stopMessageVariantPolling(entry: MessageVariantCacheEntry): void {
  entry.refreshLifecycle?.stop();
  entry.refreshLifecycle = null;
  entry.pollIntervalMs = null;
}

function requestMessageVariantLifecycleRefresh(entry: MessageVariantCacheEntry): void {
  if (entry.refreshState.loading) return;
  scheduleMessageVariantLoad(entry, 0);
}

function scheduleMessageVariantLoad(entry: MessageVariantCacheEntry, delay: number): void {
  if (entry.disposed || entry.refreshState.messageIds.length === 0) return;
  if (entry.refreshState.loading) {
    entry.refreshState = { ...entry.refreshState, reloadPending: true };
    return;
  }
  if (entry.debounceTimer !== null) window.clearTimeout(entry.debounceTimer);
  if (delay === 0) {
    entry.debounceTimer = null;
    void loadMessageVariants(entry);
    return;
  }
  entry.debounceTimer = window.setTimeout(() => {
    entry.debounceTimer = null;
    void loadMessageVariants(entry);
  }, delay);
}

/**
 * The rows a poll returned, as the addresses a conversation draws from.
 *
 * Extracted from the poll so it can be run again without one. Under D-208 an
 * address has a lifetime, and the moment it is replaced is not the moment new
 * rows arrive — the polling rule deliberately stops asking once everything has
 * converged (D-176), so by the time a signature needs renewing there is no poll
 * left to carry it. `subscribeMessageVariantUrlRenewals` below re-runs this
 * instead.
 */
function projectMessageVariantRows(rows: MediaVariant[]): Record<string, MessageMediaVariantUrls> {
  const next: Record<string, MessageMediaVariantUrls> = {};
  for (const row of rows) {
    if (!row.message_id) continue;
    // A failed row is here for the polling rule and nothing else: its
    // `variant_path` names an object that was never written, so building a
    // URL from it would put a broken picture in the conversation.
    if (row.status !== "ready") continue;
    // A message variant keeps its path when it is rewritten, and the worker
    // writes it `max-age=31536000, immutable`. Without the moment it was
    // written in the URL, a reader who has already seen a picture keeps the
    // old bytes for a year — which would make the D-116 backfill invisible to
    // exactly the people who complained. Avatars have carried this token for
    // the same reason since they were cacheable.
    const url = withVersionToken(getVariantUrl(row), row.updated_at);
    if (!url) continue;
    const current = next[row.message_id] ?? {};
    if (row.variant_kind === "image_preview") {
      current.previewUrl = url;
      current.previewWidth = row.width;
      current.previewHeight = row.height;
    } else if (row.variant_kind === "image_thumb") {
      current.thumbUrl = url;
      current.thumbWidth = row.width;
      current.thumbHeight = row.height;
    } else if (row.variant_kind === "video_poster") {
      current.videoPosterUrl = url;
      current.videoPosterWidth = row.width;
      current.videoPosterHeight = row.height;
    } else if (row.variant_kind === "video_720p") {
      current.video720pUrl = url;
      current.video720pWidth = row.width;
      current.video720pHeight = row.height;
    }
    next[row.message_id] = current;
  }
  return next;
}

/**
 * A short, exact description of what a projection would put in the `src`s.
 *
 * Compared before notifying, so a signature store that emits for somebody
 * else's object does not re-render every conversation on screen — and so a
 * renewal that produced the same address (the store hands out one URL per
 * object, and two signings inside a second are identical) costs nothing.
 */
function messageVariantUrlSignature(variants: Record<string, MessageMediaVariantUrls>): string {
  const parts: string[] = [];
  for (const id of Object.keys(variants).sort()) {
    const v = variants[id];
    parts.push(
      `${id}|${v.previewUrl ?? ""}|${v.thumbUrl ?? ""}|${v.videoPosterUrl ?? ""}|${v.video720pUrl ?? ""}`,
    );
  }
  return parts.join("\n");
}

/**
 * Re-derives this chat's addresses when a signature is replaced.
 *
 * The store notifies on every answer it gets, including answers about objects
 * this chat has never heard of, so the recomputation is guarded by the
 * signature above rather than by the notification.
 */
function subscribeMessageVariantUrlRenewals(entry: MessageVariantCacheEntry): void {
  entry.urlRenewalUnsubscribe = signedMediaUrls().subscribe(() => {
    if (entry.disposed || entry.lastRows.length === 0) return;
    const next = projectMessageVariantRows(entry.lastRows);
    if (messageVariantUrlSignature(next) === messageVariantUrlSignature(entry.variants)) return;
    entry.variants = next;
    notifyMessageVariantListeners(entry);
  });
}

async function loadMessageVariants(entry: MessageVariantCacheEntry): Promise<void> {
  if (entry.disposed || entry.refreshState.loading || entry.refreshState.messageIds.length === 0) return;
  entry.refreshState = beginMessageVariantRefresh(entry.refreshState);
  entry.hasStarted = true;
  const messageIds = entry.refreshState.messageIds;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_variants")
      .select("id,message_id,variant_kind,variant_bucket,variant_path,width,height,status,error_code,updated_at")
      .in("status", [...MESSAGE_VARIANT_STATUSES])
      .in("variant_kind", [...MESSAGE_VARIANT_KINDS])
      .in("message_id", messageIds);
    // An answer that never came is no evidence that the variants have
    // converged, so it leaves the futile-poll count where it was: a minute
    // offline must not retire this chat's polling for the rest of the session.
    if (error) return;

    const rows = (data ?? []) as unknown as MediaVariant[];
    entry.lastRows = rows;
    const next = projectMessageVariantRows(rows);
    // What this answer settled, and whether it said anything the last one did
    // not — the two things the polling rule reads (D-176).
    const signature = getMessageVariantRowsSignature(rows);
    entry.unchangedPolls = signature === entry.lastRowsSignature ? entry.unchangedPolls + 1 : 0;
    entry.lastRowsSignature = signature;
    entry.settledKinds = collectSettledMessageVariantKinds(rows);
    entry.variants = next;
    notifyMessageVariantListeners(entry);
  } finally {
    const transition = completeMessageVariantRefresh(entry.refreshState);
    entry.refreshState = transition.state;
    applyMessageVariantPolling(entry);
    if (transition.startNow) scheduleMessageVariantLoad(entry, MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS);
  }
}

function notifyMessageVariantListeners(entry: MessageVariantCacheEntry): void {
  for (const listener of entry.listeners) listener(entry.variants);
}

function scheduleMessageVariantEntryEviction(entry: MessageVariantCacheEntry): void {
  if (entry.listeners.size > 0 || entry.evictionTimer !== null) return;
  entry.evictionTimer = window.setTimeout(() => {
    entry.evictionTimer = null;
    if (entry.listeners.size === 0) destroyMessageVariantCacheEntry(entry);
  }, 0);
}

function evictUnusedMessageVariantEntries(): void {
  if (messageVariantCache.size < MESSAGE_VARIANT_CACHE_LIMIT) return;
  const chatIds = selectMessageVariantCacheEvictions(
    Array.from(messageVariantCache.values()).map((entry) => ({
      chatId: entry.chatId,
      listenerCount: entry.listeners.size,
    })),
    MESSAGE_VARIANT_CACHE_LIMIT,
  );
  for (const chatId of chatIds) {
    const entry = messageVariantCache.get(chatId);
    if (entry) destroyMessageVariantCacheEntry(entry);
  }
}

function destroyMessageVariantCacheEntry(entry: MessageVariantCacheEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.debounceTimer !== null) window.clearTimeout(entry.debounceTimer);
  if (entry.evictionTimer !== null) window.clearTimeout(entry.evictionTimer);
  stopMessageVariantPolling(entry);
  entry.urlRenewalUnsubscribe?.();
  entry.urlRenewalUnsubscribe = null;
  messageVariantCache.delete(entry.chatId);
}

export function useAvatarVariantUrls(profileIds: readonly string[]): Record<string, AvatarVariantUrls> {
  const profileIdKey = useMemo(() => {
    const ids = new Set<string>();
    for (const id of profileIds) {
      if (id) ids.add(id);
    }
    return Array.from(ids).sort().join("|");
  }, [profileIds]);
  const normalizedProfileIds = useMemo(
    () => profileIdKey ? profileIdKey.split("|") : [],
    [profileIdKey],
  );
  const [variantsByProfileId, setVariantsByProfileId] = useState<Record<string, AvatarVariantUrls>>({});
  /** The last answer's rows, so a renewed signature needs no second query (D-208). */
  const rowsRef = useRef<MediaVariant[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (normalizedProfileIds.length === 0) {
      rowsRef.current = [];
      setVariantsByProfileId({});
      return () => {
        cancelled = true;
      };
    }

    const supabase = createClient();

    const loadVariants = async () => {
      const { data, error } = await supabase
        .from("media_variants")
        .select("id,profile_id,variant_kind,variant_bucket,variant_path,width,height,status,updated_at")
        .eq("status", "ready")
        .in("variant_kind", [...AVATAR_VARIANT_KINDS])
        .in("profile_id", normalizedProfileIds);

      if (cancelled) return;
      if (error) {
        console.warn("Avatar variants fetch failed.");
        rowsRef.current = [];
        setVariantsByProfileId({});
        return;
      }

      rowsRef.current = (data ?? []) as unknown as MediaVariant[];
      setVariantsByProfileId(projectAvatarVariantRowsByProfile(rowsRef.current));
    };

    void loadVariants();
    return () => {
      cancelled = true;
    };
  }, [profileIdKey]);

  // This hook asks once per set of ids and then stops, so without this a
  // renewed signature would never reach the chat list, the chat header or the
  // sender avatars beside a message. Same rule as the shared store's
  // `reproject`: re-derive from rows already held, and keep the previous object
  // when nothing changed so React can bail out.
  useEffect(() => signedMediaUrls().subscribe(() => {
    const next = projectAvatarVariantRowsByProfile(rowsRef.current);
    setVariantsByProfileId((current) =>
      sameAvatarVariantRecord(current, next) ? current : next
    );
  }), []);

  return variantsByProfileId;
}

function projectAvatarVariantRowsByProfile(rows: MediaVariant[]): Record<string, AvatarVariantUrls> {
  const byProfile = new Map<string, MediaVariant[]>();
  for (const row of rows) {
    if (!row.profile_id) continue;
    const bucket = byProfile.get(row.profile_id);
    if (bucket) bucket.push(row);
    else byProfile.set(row.profile_id, [row]);
  }
  const next: Record<string, AvatarVariantUrls> = {};
  for (const [profileId, profileRows] of byProfile) {
    const projected = projectAvatarVariantRows(profileRows);
    if (projected) next[profileId] = projected;
  }
  return next;
}

function sameAvatarVariantRecord(
  a: Record<string, AvatarVariantUrls>,
  b: Record<string, AvatarVariantUrls>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameAvatarVariantUrls(a[key], b[key]));
}

/**
 * The shared avatar-variant store, wired to Supabase.
 *
 * `useAvatarVariantUrls` above still exists for the surfaces that already know
 * their whole list of profiles up front. This store is for the avatars that do
 * not: it lets each one ask for itself, and turns a screenful of asking into a
 * single query. See `lib/avatarVariantStore`.
 */
const avatarVariantRowsByProfileId = new Map<string, MediaVariant[]>();
const avatarVariantRowsByChatId = new Map<string, MediaVariant[]>();

const avatarVariants = createAvatarVariantStore((profileIds) =>
  fetchAvatarVariantsBy("profile_id", profileIds, avatarVariantRowsByProfileId),
);

/**
 * The same store, for a chat's own picture.
 *
 * A group or channel avatar is keyed by `chat_id` rather than `profile_id`, so
 * it cannot share one query with the profiles — but it is the same job, so it
 * gets another instance of the same store rather than a second mechanism.
 * A private chat is not asked about here: the client shows the other person's
 * profile picture, which the store above already answers for.
 */
const chatAvatarVariants = createAvatarVariantStore((chatIds) =>
  fetchAvatarVariantsBy("chat_id", chatIds, avatarVariantRowsByChatId),
);

/**
 * Both avatar stores follow a renewed signature (D-208).
 *
 * Subscribed once, at module scope, because the stores are module scope: an
 * avatar that has scrolled away is still in the cache and is still the thing a
 * later render will be handed. The re-derivation is cheap and emits only when
 * an address actually changed, so in the shipped `"public"` mode — where
 * nothing is ever signed and the store below never notifies — this costs one
 * closure and nothing else.
 */
signedMediaUrls().subscribe(() => {
  avatarVariants.reproject((id) => projectAvatarVariantRows(avatarVariantRowsByProfileId.get(id)));
  chatAvatarVariants.reproject((id) => projectAvatarVariantRows(avatarVariantRowsByChatId.get(id)));
});

/**
 * A set of avatar-variant rows, as the addresses an avatar draws from.
 *
 * Split out of the query (D-208) for the same reason
 * `projectMessageVariantRows` was: an address has a lifetime now, and the
 * moment it is replaced is not the moment new rows arrive. This store asks once
 * per profile and then never again, so without re-deriving from rows it already
 * holds, a renewed signature would never reach a single small avatar.
 */
function projectAvatarVariantRows(rows: MediaVariant[] | undefined): AvatarVariantUrls | undefined {
  if (!rows || rows.length === 0) return undefined;
  const current: AvatarVariantUrls = {};
  for (const row of rows) {
    // An avatar variant keeps its path when the picture changes, so the URL
    // carries the moment it was written. Without that token the object could
    // not be cached for longer than it takes someone to change the picture.
    const publicUrl = withVersionToken(getVariantUrl(row), row.updated_at);
    if (!publicUrl) continue;
    if (row.variant_kind === "avatar_128") {
      current.avatar128Url = publicUrl;
      current.avatar128Width = row.width;
      current.avatar128Height = row.height;
    } else if (row.variant_kind === "avatar_256") {
      current.avatar256Url = publicUrl;
      current.avatar256Width = row.width;
      current.avatar256Height = row.height;
    }
  }
  return current;
}

async function fetchAvatarVariantsBy(
  column: "profile_id" | "chat_id",
  ids: string[],
  rowsByOwnerId: Map<string, MediaVariant[]>,
): Promise<Record<string, AvatarVariantUrls>> {
  const supabase = createClient();
  let query = supabase
    .from("media_variants")
    .select(`id,${column},variant_kind,variant_bucket,variant_path,width,height,status,updated_at`)
    .eq("status", "ready")
    .in("variant_kind", [...AVATAR_VARIANT_KINDS])
    .in(column, ids);
  // A message variant carries the id of the chat it lives in, so `chat_id`
  // alone would not mean "this chat's own picture". The row with no message
  // behind it is the chat's.
  if (column === "chat_id") query = query.is("message_id", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = new Map<string, MediaVariant[]>();
  for (const row of (data ?? []) as unknown as MediaVariant[]) {
    const ownerId = row[column];
    if (!ownerId) continue;
    const bucket = rows.get(ownerId);
    if (bucket) bucket.push(row);
    else rows.set(ownerId, [row]);
  }

  const next: Record<string, AvatarVariantUrls> = {};
  for (const [ownerId, ownerRows] of rows) {
    // Kept so a renewal can re-derive. Only owners that actually have rows: an
    // owner with none is remembered as `NONE` by the store itself, and a
    // renewal has nothing to say about it.
    rowsByOwnerId.set(ownerId, ownerRows);
    const projected = projectAvatarVariantRows(ownerRows);
    if (projected) next[ownerId] = projected;
  }
  return next;
}

/**
 * The small version of one profile's avatar, if there is one.
 *
 * Safe to call from every avatar on the screen: the first render queues the id
 * and the whole frame's ids resolve in one query.
 */
export function useAvatarVariant(profileId: string | null | undefined): {
  variant: AvatarVariantUrls | undefined;
  /** False while the answer is still coming; see `avatarVariantStore`. */
  settled: boolean;
} {
  return useVariantFromStore(avatarVariants, profileId);
}

/**
 * The small version of a chat's own picture, if there is one.
 *
 * For a group or channel. A private chat's picture is a person's, so it goes
 * through `useAvatarVariant` with that person's id instead.
 */
export function useChatAvatarVariant(chatId: string | null | undefined): {
  variant: AvatarVariantUrls | undefined;
  settled: boolean;
} {
  return useVariantFromStore(chatAvatarVariants, chatId);
}

function useVariantFromStore(
  store: typeof avatarVariants,
  id: string | null | undefined,
): { variant: AvatarVariantUrls | undefined; settled: boolean } {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  // Requested during render rather than in an effect: an effect runs after the
  // first paint, by which time an <img> falling back to the original has
  // already started downloading it, which is the whole thing being avoided.
  store.request(id);

  const variant = useSyncExternalStore(
    subscribe,
    () => store.get(id),
    () => undefined,
  );
  const settled = useSyncExternalStore(
    subscribe,
    () => store.isSettled(id),
    () => true,
  );

  return { variant, settled };
}
