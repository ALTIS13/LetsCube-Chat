import { admitHistoryCacheReply, type AdmittedHistoryCachePage, type HistoryCacheScope } from "./codec.ts";
import type { HistoryCacheStorage } from "./storage.ts";

interface HistoryCacheRead {
  storage: HistoryCacheStorage;
  namespace: string;
  ownerId: string;
  scope: HistoryCacheScope;
  request: (scope: HistoryCacheScope, ifDigest: string | null) => Promise<unknown>;
  isCurrent: () => boolean;
  now?: () => number;
}

/** A failed/unsupported cache read returns null for the normal history path.
 * Disk data is never published before a fresh server admission and both fences. */
export async function loadHistoryCachePage(input: HistoryCacheRead): Promise<AdmittedHistoryCachePage | null> {
  try {
    const { storage, namespace, ownerId, request, isCurrent, now = Date.now } = input;
    const scope: HistoryCacheScope = Object.freeze({
      chatId: input.scope.chatId, mode: input.scope.mode, topicId: input.scope.topicId,
      before: input.scope.before ? Object.freeze({ ...input.scope.before }) : null,
    });
    if (!isCurrent()) return null;
    const lease = await storage.capture(namespace, ownerId);
    if (!isCurrent()) return null;
    const key = JSON.stringify([1, scope.chatId, scope.mode, scope.topicId, scope.before?.createdAt ?? null, scope.before?.id ?? null]);
    const saved = await storage.read(lease, key, now());
    if (!isCurrent()) return null;
    const reply = await request(scope, saved?.digest ?? null);
    if (!isCurrent()) return null;
    const admitted = await admitHistoryCacheReply(reply, scope, saved, isCurrent);
    if (!admitted || !isCurrent()) return null;
    const current = await storage.capture(namespace, ownerId);
    if (!isCurrent() || current.generation !== lease.generation) return null;
    const written = await storage.write(lease, key, { payload: admitted.payload, digest: admitted.digest }, now());
    if (!written || !isCurrent()) return null;
    const final = await storage.capture(namespace, ownerId);
    if (!isCurrent() || final.generation !== lease.generation) return null;
    return admitted;
  } catch { return null; }
}
