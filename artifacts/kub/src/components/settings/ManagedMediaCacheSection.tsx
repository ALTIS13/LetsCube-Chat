import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { managedMedia } from "@/lib/mediaCache/appMediaCache";
import { MediaCacheSection } from "./MediaCacheSection";

type Stats = { bytes: number; count: number; limitBytes: number };

/** UI commands never clear messages, authentication or the durable send queue. */
export function ManagedMediaCacheSection() {
  const revision = useSyncExternalStore(managedMedia.subscribe, managedMedia.revision, () => 0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const command = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; command.current++; }; }, []);
  useEffect(() => {
    let current = true;
    void managedMedia.stats().then(value => { if (current) setStats(value); }).catch(() => {
      if (current) { setStats(null); setError("Не удалось прочитать локальный кэш."); }
    });
    return () => { current = false; };
  }, [revision]);
  const run = async (action: () => Promise<boolean>) => {
    if (pending) return;
    const at = ++command.current; setPending(true); setError(null);
    try {
      if (!await action()) throw Error("MEDIA_CACHE_COMMAND_REFUSED");
      const next = await managedMedia.stats();
      if (mounted.current && command.current === at) setStats(next);
    } catch {
      if (mounted.current && command.current === at) setError("Не удалось изменить локальный кэш. Попробуйте ещё раз.");
    } finally {
      if (mounted.current && command.current === at) setPending(false);
    }
  };
  return <MediaCacheSection stats={stats} pending={pending} error={error}
    onClear={() => { void run(() => managedMedia.clear()); }}
    onLimitChange={bytes => { void run(() => managedMedia.setLimit(bytes)); }} />;
}
