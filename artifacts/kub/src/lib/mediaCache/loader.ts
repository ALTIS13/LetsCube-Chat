import type { MediaCacheScope } from "./cache";

interface BinaryCache {
  get(scope: MediaCacheScope): Promise<Blob | null>;
  put(scope: MediaCacheScope, blob: Blob): Promise<boolean>;
  prepare(scope: MediaCacheScope): Promise<{ put(blob: Blob): Promise<boolean> } | null>;
}
interface LoadOptions {
  download: boolean;
  maxBytes?: number;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 32;

/** Cache only this backend's Storage objects, not arbitrary URLs in a message. */
export function isManagedMediaAddress(address: string | null, backend: string): boolean {
  if (!address) return false;
  try {
    const url = new URL(address), base = new URL(backend);
    if (url.origin !== base.origin || url.username || url.password || !["https:", "http:"].includes(url.protocol)) return false;
    const path = decodeURIComponent(url.pathname);
    return /^\/storage\/v1\/object\/(public|sign)\/[^/]+\/.+/.test(path)
      && !/[\x00-\x1f\x7f\\]/.test(path)
      && !path.split("/").some(part => part === "." || part === "..");
  } catch { return false; }
}

export function createMediaLoader(options: {
  cache: BinaryCache;
  backend: string;
  fetch: typeof globalThis.fetch;
  onRefused?: (scope: MediaCacheScope) => void;
  onStored?: () => void;
}) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const enter = async () => {
    if (active >= MAX_CONCURRENT) {
      if (waiting.length >= MAX_QUEUED) return false;
      await new Promise<void>(resolve => waiting.push(resolve));
    } else active++;
    return true;
  };
  const leave = () => { const next = waiting.shift(); if (next) next(); else active--; };
  return {
    async load(scope: MediaCacheScope, address: string | null, input: LoadOptions): Promise<Blob | null> {
      const current = () => !input.signal?.aborted && (input.isCurrent?.() ?? true);
      if (!current()) return null;
      try {
        const cached = await options.cache.get(scope);
        if (!current()) return null;
        if (cached) return cached;
      } catch { /* A refused disk must not prevent ordinary network display. */ }
      if (!current() || !input.download || !isManagedMediaAddress(address, options.backend)) return null;
      const maxBytes = Math.min(MAX_BYTES, input.maxBytes ?? MAX_BYTES);
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !await enter()) return null;
      const abort = new AbortController();
      const cancel = () => abort.abort();
      input.signal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 15_000);
      try {
        if (!current()) return null;
        // A different document can clear this cache while the response is in
        // flight. A producer captured afterwards would silently adopt its epoch.
        let producer: { put(blob: Blob): Promise<boolean> } | null = null;
        try { producer = await options.cache.prepare(scope); }
        catch { /* Network display remains available without disk. */ }
        if (!current()) return null;
        const response = await options.fetch(address!, {
          signal: abort.signal, credentials: "omit", redirect: "error",
        });
        if (!current()) { await response.body?.cancel(); return null; }
        if (response.status === 401 || response.status === 403) {
          options.onRefused?.(scope); await response.body?.cancel(); return null;
        }
        const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
        const size = response.headers.get("content-length");
        // Executable documents must never be promoted to this origin's Blob URLs.
        const safeType = /^(image\/(jpeg|png|webp|gif|avif|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/(pdf|octet-stream|zip)|text\/plain)$/.test(mime);
        if (response.status !== 200 || !safeType || (size !== null && (!/^\d+$/.test(size) || Number(size) > maxBytes))) {
          await response.body?.cancel(); return null;
        }
        if (!response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (!current() || bytes > maxBytes) { await reader.cancel(); return null; }
            chunks.push(new Uint8Array(part.value));
          }
        } finally { reader.releaseLock(); }
        if (!current() || !bytes || (size !== null && bytes !== Number(size))) return null;
        const blob = new Blob(chunks, { type: mime });
        if (producer && await producer.put(blob)) options.onStored?.();
        return current() ? blob : null;
      } catch { return null; }
      finally {
        clearTimeout(timeout); input.signal?.removeEventListener("abort", cancel); leave();
      }
    },
  };
}
