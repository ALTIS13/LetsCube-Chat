"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/app.store";
import { useAnyLocationPermissionAccess, usePermissionAccess } from "@/hooks/useRole";
import { useTaskRouting } from "@/hooks/useTaskRouting";

export const TASK_ACCESS_PERMISSION_KEYS = [
  "system.manage",
  "tasks.view",
  "tasks.create",
  "tasks.assign",
  "tasks.manage",
  "tasks.view_admin_tasks",
  "tasks.manage_admin_tasks",
  "tasks.view_all_locations",
  "tasks.manage_all_locations",
] as const;

export const TASK_VIEW_PERMISSION_KEYS = [
  "system.manage",
  "tasks.view",
  "tasks.view_admin_tasks",
  "tasks.view_all_locations",
  "tasks.manage",
  "tasks.manage_all_locations",
] as const;

export const TASK_CREATE_PERMISSION_KEYS = [
  "system.manage",
  "tasks.create",
  "tasks.manage",
  "tasks.manage_admin_tasks",
  "tasks.manage_all_locations",
] as const;

export const TASK_CLAIM_PERMISSION_KEYS = [
  "system.manage",
  "tasks.claim",
  "tasks.assign",
  "tasks.create",
  "tasks.manage",
  "tasks.manage_all_locations",
] as const;

export const TASK_ADMIN_VIEW_PERMISSION_KEYS = [
  "system.manage",
  "tasks.view_admin_tasks",
  "tasks.manage_admin_tasks",
  "tasks.view_all_locations",
  "tasks.manage_all_locations",
] as const;

export const TASK_DELETE_PERMISSION_KEYS = [
  "system.manage",
  "tasks.manage_all_locations",
  "tasks.delete",
] as const;

export const TASK_BULK_DELETE_PERMISSION_KEYS = [
  "system.manage",
  "tasks.manage_all_locations",
  "tasks.bulk_delete",
  "tasks.delete",
] as const;

export const TASK_RESTORE_PERMISSION_KEYS = [
  "system.manage",
  "tasks.manage_all_locations",
  "tasks.restore",
] as const;

type LocationMembership = {
  user_id: string;
  location_id: string;
};

export function useTaskAccessGate(): {
  canAccessTasks: boolean;
  checking: boolean;
  locationIds: string[];
};
export function useTaskAccessGate(options: { enabled?: boolean }): {
  canAccessTasks: boolean;
  checking: boolean;
  locationIds: string[];
};
export function useTaskAccessGate(options?: { enabled?: boolean }): {
  canAccessTasks: boolean;
  checking: boolean;
  locationIds: string[];
} {
  const currentUser = useAppStore((s) => s.currentUser);
  const enabled = options?.enabled ?? true;
  const globalTaskAccess = usePermissionAccess(TASK_ACCESS_PERMISSION_KEYS, {
    enabled: Boolean(currentUser) && enabled,
  });
  const routing = useTaskRouting({ enabled: Boolean(currentUser) && enabled, includeMembers: true });
  const locationIds = useMemo(
    () => (currentUser ? getUserTaskLocationIds(routing.members, currentUser.id) : []),
    [currentUser, routing.members],
  );
  const locationTaskAccess = useAnyLocationPermissionAccess(TASK_ACCESS_PERMISSION_KEYS, locationIds, {
    enabled: enabled && routing.available && locationIds.length > 0,
  });

  const canAccessTasks =
    globalTaskAccess.hasAnyPermission(TASK_VIEW_PERMISSION_KEYS) ||
    locationTaskAccess.hasAnyPermission(TASK_VIEW_PERMISSION_KEYS);
  const checking =
    globalTaskAccess.checking ||
    (Boolean(currentUser) && routing.loading && !routing.checked) ||
    locationTaskAccess.checking;

  return { canAccessTasks, checking, locationIds };
}

export function getUserTaskLocationIds(
  members: readonly LocationMembership[],
  userId: string,
): string[] {
  return Array.from(
    new Set(
      members
        .filter((member) => member.user_id === userId)
        .map((member) => member.location_id)
        .filter(Boolean),
    ),
  ).sort();
}
