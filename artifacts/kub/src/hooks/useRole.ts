"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { AppRole } from "@/types/database";

const ACCESS_ROLE_KEYS = ["owner", "tech_admin", "admin", "manager"] as const;
const accessCache = new Map<string, { keys: Set<string>; promise?: Promise<Set<string>> }>();
const permissionCache = new Map<string, { keys: Set<string>; promise?: Promise<Set<string>> }>();

export function clearRoleAccessCache(userId?: string): void {
  if (userId) {
    accessCache.delete(userId);
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) permissionCache.delete(key);
    }
  } else {
    accessCache.clear();
    permissionCache.clear();
  }
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
  const dynamic = useCurrentGlobalRoleAccess(true);
  const dynamicRoleKeys = dynamic.keys;
  const dynamicIsAdmin =
    dynamicRoleKeys.has("owner") ||
    dynamicRoleKeys.has("tech_admin") ||
    dynamicRoleKeys.has("admin");
  const isAdmin = legacyRole === "admin" || dynamicIsAdmin;
  const isStaff = isAdmin || legacyRole === "manager" || dynamicRoleKeys.has("manager");
  return { isAdmin, isStaff, checking: dynamic.checking };
}

export function usePermissionAccess(
  permissionKeys: readonly string[],
  options: { locationId?: string | null; enabled?: boolean; locationOnly?: boolean } = {},
): {
  checking: boolean;
  permissionKeys: Set<string>;
  hasPermission: (permissionKey: string) => boolean;
  hasAnyPermission: (keys: readonly string[]) => boolean;
} {
  const legacyRole = useRole();
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = useMemo(() => createClient(), []);
  const enabled = options.enabled ?? true;
  const locationId = options.locationId ?? null;
  const locationOnly = options.locationOnly === true;
  const keySignature = useMemo(
    () => Array.from(new Set(permissionKeys)).sort().join(","),
    [permissionKeys],
  );
  const [state, setState] = useState<{ keys: Set<string>; checking: boolean }>({
    keys: new Set<string>(),
    checking: Boolean(enabled && currentUserId && keySignature),
  });

  useEffect(() => {
    let cancelled = false;
    const keys = keySignature ? keySignature.split(",").filter(Boolean) : [];

    if (!enabled || !currentUserId || keys.length === 0) {
      setState({ keys: new Set<string>(), checking: false });
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${currentUserId}:${locationOnly ? "location-only" : "global"}:${locationId ?? "global"}:${keySignature}`;
    const cached = permissionCache.get(cacheKey);
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
        keys.map(async (permissionKey) => {
          if (!locationOnly) {
            const globalResult = await supabase.rpc("has_permission", {
              p_user_id: currentUserId,
              p_permission_key: permissionKey,
            });
            if (globalResult.error) throw globalResult.error;
            if (globalResult.data) return permissionKey;
          }

          if (locationId) {
            const locationResult = await supabase.rpc("has_location_permission", {
              p_user_id: currentUserId,
              p_location_id: locationId,
              p_permission_key: permissionKey,
            });
            if (locationResult.error) throw locationResult.error;
            if (locationResult.data) return permissionKey;
          }

          return null;
        }),
      ).then((results) => {
        const allowed = new Set<string>(
          results.filter((permissionKey): permissionKey is string => Boolean(permissionKey)),
        );
        if (allowed.size === 0 && !locationOnly) {
          for (const permissionKey of keys) {
            if (legacyRoleHasPermission(legacyRole, permissionKey)) allowed.add(permissionKey);
          }
        }
        return allowed;
      });

    permissionCache.set(cacheKey, { keys: cached?.keys ?? new Set<string>(), promise: lookup });

    lookup
      .then((results) => {
        permissionCache.set(cacheKey, { keys: results });
        if (!cancelled) {
          setState({ keys: new Set(results), checking: false });
        }
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn("[permission-access] lookup failed", error);
        const fallback = new Set<string>(
          locationOnly ? [] : keys.filter((permissionKey) => legacyRoleHasPermission(legacyRole, permissionKey)),
        );
        permissionCache.set(cacheKey, { keys: fallback });
        if (!cancelled) setState({ keys: fallback, checking: false });
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, enabled, keySignature, legacyRole, locationId, locationOnly, supabase]);

  return {
    checking: state.checking,
    permissionKeys: state.keys,
    hasPermission: (permissionKey: string) => state.keys.has(permissionKey),
    hasAnyPermission: (keys: readonly string[]) => keys.some((permissionKey) => state.keys.has(permissionKey)),
  };
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

function legacyRoleHasPermission(role: AppRole | null, permissionKey: string): boolean {
  if (!role) return false;
  if (role === "admin") {
    return [
      "audit.view",
      "chats.invite",
      "chats.invite_any",
      "chats.manage_invites",
      "chats.manage_roles",
      "chats.moderate",
      "location_members.manage",
      "location_members.view",
      "locations.manage",
      "locations.view",
      "roles.view",
      "tasks.assign",
      "tasks.create",
      "tasks.manage",
      "tasks.manage_admin_tasks",
      "tasks.manage_all_locations",
      "tasks.view",
      "tasks.view_admin_tasks",
      "tasks.view_all_locations",
      "users.assign_roles",
      "users.manage",
      "users.view",
    ].includes(permissionKey);
  }
  if (role === "manager") {
    return [
      "chats.invite",
      "location_members.view",
      "locations.view",
      "tasks.assign",
      "tasks.create",
      "tasks.manage",
      "tasks.view",
      "users.view",
    ].includes(permissionKey);
  }
  return ["chats.invite", "tasks.view"].includes(permissionKey);
}
