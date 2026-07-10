"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type AccessSnapshot,
  isAccessSnapshotEnabled,
  isAccessSnapshotUnavailable,
  normalizeAccessSnapshot,
} from "@/lib/accessSnapshot";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

const snapshotCache = new Map<
  string,
  {
    snapshot?: AccessSnapshot;
    promise?: Promise<AccessSnapshot>;
    fallbackRequired?: boolean;
  }
>();
const snapshotListeners = new Map<string, Set<() => void>>();
const accessSnapshotRpcEnabled = isAccessSnapshotEnabled(
  import.meta.env.VITE_ACCESS_SNAPSHOT_RPC_ENABLED,
);

export function clearAccessSnapshotCache(userId?: string): void {
  if (userId) {
    snapshotCache.delete(userId);
    notifySnapshotListeners(userId);
    return;
  }

  snapshotCache.clear();
  for (const listeners of snapshotListeners.values()) {
    for (const listener of listeners) listener();
  }
}

export function useAccessSnapshot(shouldLoad: boolean): {
  snapshot: AccessSnapshot | null;
  checking: boolean;
} {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const enabled = Boolean(
    accessSnapshotRpcEnabled && shouldLoad && currentUserId,
  );
  const supabase = useMemo(() => createClient(), []);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    userId: string | null;
    enabled: boolean;
    snapshot: AccessSnapshot | null;
    checking: boolean;
    fallbackRequired: boolean;
  }>({
    userId: currentUserId,
    enabled,
    snapshot: null,
    checking: enabled,
    fallbackRequired: false,
  });

  useEffect(() => {
    if (!currentUserId) return;
    const listeners =
      snapshotListeners.get(currentUserId) ?? new Set<() => void>();
    const listener = () => {
      setState({
        userId: currentUserId,
        enabled,
        snapshot: null,
        checking: enabled,
        fallbackRequired: false,
      });
      setRevision((value) => value + 1);
    };
    listeners.add(listener);
    snapshotListeners.set(currentUserId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) snapshotListeners.delete(currentUserId);
    };
  }, [currentUserId, enabled]);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !currentUserId) {
      setState({
        userId: currentUserId,
        enabled,
        snapshot: null,
        checking: false,
        fallbackRequired: false,
      });
      return () => {
        cancelled = true;
      };
    }

    const cached = snapshotCache.get(currentUserId);
    if (cached?.snapshot) {
      setState({
        userId: currentUserId,
        enabled,
        snapshot: cached.snapshot,
        checking: false,
        fallbackRequired: false,
      });
      return () => {
        cancelled = true;
      };
    }
    if (cached?.fallbackRequired && !cached.promise) {
      setState({
        userId: currentUserId,
        enabled,
        snapshot: null,
        checking: false,
        fallbackRequired: true,
      });
      return () => {
        cancelled = true;
      };
    }

    setState({
      userId: currentUserId,
      enabled,
      snapshot: null,
      checking: true,
      fallbackRequired: false,
    });
    const snapshotClient = supabase as unknown as {
      rpc: (
        name: "current_user_access_snapshot",
      ) => Promise<{ data: unknown; error: unknown }>;
    };
    const lookup =
      cached?.promise ??
      snapshotClient
        .rpc("current_user_access_snapshot")
        .then(({ data, error }) => {
          if (error) throw error;
          return normalizeAccessSnapshot(data);
        });

    snapshotCache.set(currentUserId, { promise: lookup });
    lookup
      .then((snapshot) => {
        snapshotCache.set(currentUserId, { snapshot });
        if (!cancelled) {
          setState({
            userId: currentUserId,
            enabled,
            snapshot,
            checking: false,
            fallbackRequired: false,
          });
        }
      })
      .catch((error) => {
        const expectedCompatibilityFallback =
          isAccessSnapshotUnavailable(error);
        snapshotCache.set(currentUserId, { fallbackRequired: true });
        if (import.meta.env.DEV && !expectedCompatibilityFallback) {
          console.warn("[access-snapshot] lookup failed", error);
        }
        if (!cancelled) {
          setState({
            userId: currentUserId,
            enabled,
            snapshot: null,
            checking: false,
            fallbackRequired: true,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, enabled, revision, supabase]);

  if (state.userId !== currentUserId || state.enabled !== enabled) {
    return { snapshot: null, checking: enabled };
  }
  return { snapshot: state.snapshot, checking: state.checking };
}

function notifySnapshotListeners(userId: string): void {
  const listeners = snapshotListeners.get(userId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}
