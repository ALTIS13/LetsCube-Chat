"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { AppRole } from "@/types/database";

const ACCESS_ROLE_KEYS = ["owner", "tech_admin", "admin", "manager"] as const;
const accessCache = new Map<string, { keys: Set<string>; promise?: Promise<Set<string>> }>();

export function clearRoleAccessCache(userId?: string): void {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

export function useRole(): AppRole | null {
  return useAppStore((s) => s.currentUser?.role ?? null);
}

export function useIsAdmin(): boolean {
  return useRoleAccess().isAdmin;
}

export function useIsManagerOrAdmin(): boolean {
  return useRoleAccess().isStaff;
}

export function useRoleAccess(): { isAdmin: boolean; isStaff: boolean; checking: boolean } {
  const legacyRole = useRole();
  const dynamic = useCurrentGlobalRoleAccess(legacyRole !== "admin" && legacyRole !== "manager");
  const dynamicRoleKeys = dynamic.keys;
  const dynamicIsAdmin =
    dynamicRoleKeys.has("owner") ||
    dynamicRoleKeys.has("tech_admin") ||
    dynamicRoleKeys.has("admin");
  const isAdmin = legacyRole === "admin" || dynamicIsAdmin;
  const isStaff = isAdmin || legacyRole === "manager" || dynamicRoleKeys.has("manager");
  return { isAdmin, isStaff, checking: dynamic.checking };
}

function useCurrentGlobalRoleAccess(shouldLoad: boolean): { keys: Set<string>; checking: boolean } {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<{ keys: Set<string>; checking: boolean }>({
    keys: new Set<string>(),
    checking: false,
  });

  useEffect(() => {
    let cancelled = false;

    if (!shouldLoad || !currentUserId) {
      setState({ keys: new Set<string>(), checking: false });
      return () => {
        cancelled = true;
      };
    }

    const cached = accessCache.get(currentUserId);
    if (cached && !cached.promise) {
      setState({ keys: new Set(cached.keys), checking: false });
      return () => {
        cancelled = true;
      };
    }

    setState((prev) => ({ keys: prev.keys, checking: true }));

    const lookup =
      cached?.promise ??
      Promise.all(
        ACCESS_ROLE_KEYS.map(async (roleKey) => {
          const { data, error } = await supabase.rpc("has_global_role", {
            p_user_id: currentUserId,
            p_role_key: roleKey,
          });
          if (error) throw error;
          return data ? roleKey : null;
        }),
      ).then((results) =>
        new Set<string>(results.filter((roleKey): roleKey is (typeof ACCESS_ROLE_KEYS)[number] => Boolean(roleKey))),
      );

    accessCache.set(currentUserId, { keys: cached?.keys ?? new Set<string>(), promise: lookup });

    lookup
      .then((results) => {
        accessCache.set(currentUserId, { keys: results });
        if (cancelled) return;
        setState({
          keys: new Set(results),
          checking: false,
        });
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn("[role-access] dynamic role lookup failed", error);
        accessCache.set(currentUserId, { keys: new Set<string>() });
        if (!cancelled) setState({ keys: new Set<string>(), checking: false });
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, shouldLoad, supabase]);

  return state;
}
