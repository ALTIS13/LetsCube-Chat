import { useEffect, useState, useSyncExternalStore } from "react";
import { managedMedia, type CacheableMessage, type MediaRepresentation } from "@/lib/mediaCache/appMediaCache";

/** Durable media is addressed by its message object, never by a signed URL. */
export function useCachedMediaUrl(
  message: CacheableMessage | null | undefined,
  address: string | null | undefined,
  options: { representation?: MediaRepresentation; download?: boolean; enabled?: boolean; maxBytes?: number } = {},
): string | null {
  useSyncExternalStore(managedMedia.subscribe, managedMedia.revision, () => 0);
  const scope = managedMedia.scope(message, options.representation ?? "original");
  const scopeKey = scope ? JSON.stringify(scope) : null;
  const remote = address ?? null;
  const download = options.download ?? false;
  const enabled = options.enabled ?? true;
  const maxBytes = options.maxBytes;
  const [loaded, setLoaded] = useState<{ key: string; remote: string | null; url: string | null; current: () => boolean } | null>(null);
  useEffect(() => {
    if (!scopeKey) return;
    const held = managedMedia.hold(JSON.parse(scopeKey));
    void held.load(remote, download && enabled, maxBytes).then(url => {
      if (held.current()) setLoaded({ key: scopeKey, remote, url, current: held.current });
    });
    return () => held.release();
    // Retirement cancels this lease, but never auto-downloads the cleared cache again.
  }, [scopeKey, remote, download, enabled, maxBytes]);
  if (!scopeKey) return remote;
  if (loaded?.key === scopeKey && loaded.remote === remote && loaded.current()) return loaded.url ?? (download && !enabled ? null : remote);
  // Explicit viewer/inline downloads use one bounded fetch rather than racing
  // a DOM fetch with a second cache fetch. Passive callers keep streaming URLs.
  return download ? null : remote;
}

/** Preserve lazy media admission when a long history mounts off-screen rows. */
export function useMediaVisible(ref: { readonly current: Element | null }, enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [ref, enabled]);
  return visible;
}
