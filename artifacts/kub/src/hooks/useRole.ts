"use client";

import { useMemo } from "react";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { useAppStore } from "@/store/app.store";
import type { AppRole, DynamicRole } from "@/types/database";

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
  const dynamic = useCurrentGlobalRoleAccess(legacyRole !== "admin");
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
  const [dynamicRolesEnabled] = useDynamicRolesEnabledPreference();
  const dynamicRoles = useDynamicRoles({ enabled: shouldLoad && dynamicRolesEnabled, includeAssignments: true });

  return useMemo(() => {
    const checking = shouldLoad && dynamicRolesEnabled && dynamicRoles.loading && !dynamicRoles.checked;
    if (!currentUserId || !dynamicRoles.available) return { keys: new Set<string>(), checking };
    const rolesById = new Map(dynamicRoles.roles.map((role) => [role.id, role]));
    const keys = new Set(
      dynamicRoles.userGlobalRoles
        .filter((assignment) => assignment.user_id === currentUserId)
        .map((assignment) => rolesById.get(assignment.role_id))
        .filter((role): role is DynamicRole => {
          if (!role) return false;
          return role.scope === "global" && role.is_active;
        })
        .map((role) => role.key),
    );
    return { keys, checking };
  }, [currentUserId, dynamicRoles.available, dynamicRoles.checked, dynamicRoles.loading, dynamicRoles.roles, dynamicRoles.userGlobalRoles, dynamicRolesEnabled, shouldLoad]);
}
