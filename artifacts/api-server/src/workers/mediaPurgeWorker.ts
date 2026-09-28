import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";

/**
 * D-103: the files of a message deleted for everyone are removed from storage.
 *
 * `20260928210000_deleted_message_keeps_nothing.sql` clears the row and queues
 * what it pointed at — the file, the preview named after it, and the message's
 * variants — in `private.message_media_purge`. This worker empties that queue
 * through the Storage API, which is the only way the bytes go: deleting the
 * `storage.objects` row in SQL would leave the file on disk. The database
 * decides what may go (`message_media_purge_claim` keeps a file some live
 * message still shows, as a forward shares its source's); the worker only
 * removes what it is handed and says how that went.
 *
 * It logs counts, never a path: a path carries an account id and a file name.
 */

export type MediaPurgeItem = { id: string; bucket: string; path: string };

export interface MediaPurgeBackend {
  claim(limit: number): Promise<MediaPurgeItem[]>;
  remove(bucket: string, paths: string[]): Promise<{ error: string | null }>;
  finish(id: string, error: string | null): Promise<void>;
}

export type MediaPurgeTickResult = { claimed: number; removed: number; failed: number };

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_BATCH = 50;

/**
 * The path Storage knows. Rows older than `media_path` kept only a public URL,
 * whose tail is percent-encoded; the queue stores it as it was written.
 */
export function storagePath(path: string): string {
  if (!path.includes("%")) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** One pass: claim, remove by bucket, and report each file's outcome. */
export async function runMediaPurgeTick(
  backend: MediaPurgeBackend,
  limit: number = DEFAULT_BATCH,
): Promise<MediaPurgeTickResult> {
  const items = await backend.claim(limit);
  const result: MediaPurgeTickResult = { claimed: items.length, removed: 0, failed: 0 };
  const byBucket = new Map<string, MediaPurgeItem[]>();
  for (const item of items) {
    const group = byBucket.get(item.bucket);
    if (group) group.push(item);
    else byBucket.set(item.bucket, [item]);
  }
  for (const [bucket, group] of byBucket) {
    // One request per bucket: Storage takes a list, and a file already gone is
    // not an error — it is simply absent from the answer.
    let error: string | null;
    try {
      ({ error } = await backend.remove(bucket, group.map((item) => storagePath(item.path))));
    } catch {
      error = "remove_threw";
    }
    for (const item of group) {
      try {
        await backend.finish(item.id, error);
      } catch {
        // The claim lapses in five minutes and the file is handed out again.
      }
      if (error) result.failed += 1;
      else result.removed += 1;
    }
  }
  return result;
}

/** The backend the running worker uses: two RPCs and Storage's own remove. */
export function supabaseMediaPurgeBackend(supabase: SupabaseClient): MediaPurgeBackend {
  return {
    async claim(limit) {
      const { data, error } = await supabase.rpc("message_media_purge_claim", { p_limit: limit });
      if (error) throw new Error("message_media_purge_claim failed");
      return ((data ?? []) as MediaPurgeItem[]).filter(
        (item) => typeof item?.id === "string" && typeof item.bucket === "string" && typeof item.path === "string",
      );
    },
    async remove(bucket, paths) {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      return { error: error ? (error.message || "remove_failed").slice(0, 200) : null };
    },
    async finish(id, error) {
      const { error: failed } = await supabase.rpc("message_media_purge_finish", { p_id: id, p_error: error });
      if (failed) throw new Error("message_media_purge_finish failed");
    },
  };
}

let started = false;

export function startMediaPurgeWorker(): void {
  if (started) return;
  if (process.env["MEDIA_PURGE_WORKER_ENABLED"] === "0") {
    logger.info("mediaPurgeWorker disabled by MEDIA_PURGE_WORKER_ENABLED=0");
    return;
  }
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SELFHOST_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    logger.warn("mediaPurgeWorker disabled: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const backend = supabaseMediaPurgeBackend(
    createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  const parsed = Number(process.env["MEDIA_PURGE_WORKER_TICK_MS"]);
  const tickMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_MS;

  started = true;
  logger.info("mediaPurgeWorker started");
  const loop = async (): Promise<void> => {
    try {
      const result = await runMediaPurgeTick(backend);
      if (result.claimed > 0) logger.info(result, "mediaPurgeWorker removed deleted messages' files");
    } catch {
      logger.warn("mediaPurgeWorker tick failed");
    } finally {
      const timer = setTimeout(() => void loop(), tickMs);
      timer.unref?.();
    }
  };
  void loop();
}
