"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import {
  ROLES_PERMISSIONS_REQUIRED_MESSAGE,
  ROLES_PERMISSIONS_STORAGE_EVENT,
  getRolesPermissionsEnabled,
  isRolesPermissionsMissingError,
  mapRolesPermissionsError,
  setRolesPermissionsEnabled,
} from "@/lib/rolePermissions";
import type { DynamicRole, Permission, RolePermission, UserGlobalRole } from "@/types/database";

interface UseDynamicRolesOptions {
  enabled?: boolean;
  includeAssignments?: boolean;
}

export interface DynamicRolesState {
  available: boolean;
  checked: boolean;
  loading: boolean;
  error: string | null;
  roles: DynamicRole[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  userGlobalRoles: UserGlobalRole[];
  refetch: () => Promise<void>;
}

export function useDynamicRoles(options: UseDynamicRolesOptions = {}): DynamicRolesState {
  const enabled = options.enabled ?? true;
  const includeAssignments = options.includeAssignments ?? false;
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<DynamicRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [userGlobalRoles, setUserGlobalRoles] = useState<UserGlobalRole[]>([]);

  const load = useCallback(async () => {
    if (!enabled) {
      setAvailable(false);
      setChecked(true);
      setLoading(false);
      setError(null);
      setRoles([]);
      setPermissions([]);
      setRolePermissions([]);
      setUserGlobalRoles([]);
      return;
    }

    setLoading(true);
    setError(null);

    const rolesQuery = supabase
      .from("roles")
      .select("*")
      .order("scope", { ascending: true })
      .order("is_system", { ascending: false })
      .order("name", { ascending: true });
    const permissionsQuery = supabase
      .from("permissions")
      .select("*")
      .order("category", { ascending: true, nullsFirst: false })
      .order("key", { ascending: true });
    const rolePermissionsQuery = supabase
      .from("role_permissions")
      .select("*");
    const userRolesQuery = includeAssignments
      ? supabase.from("user_global_roles").select("*")
      : null;

    const [rolesRes, permissionsRes, rolePermissionsRes, userRolesRes] = await Promise.all([
      rolesQuery,
      permissionsQuery,
      rolePermissionsQuery,
      userRolesQuery ?? Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = rolesRes.error ?? permissionsRes.error ?? rolePermissionsRes.error ?? userRolesRes.error;
    if (firstError) {
      if (isRolesPermissionsMissingError(firstError)) {
        setError(ROLES_PERMISSIONS_REQUIRED_MESSAGE);
        setRolesPermissionsEnabled(false);
      } else {
        setError(mapRolesPermissionsError(firstError));
        if (import.meta.env.DEV) console.warn("[dynamic-roles] load failed", firstError);
      }
      setAvailable(false);
      setRoles([]);
      setPermissions([]);
      setRolePermissions([]);
      setUserGlobalRoles([]);
      setChecked(true);
      setLoading(false);
      return;
    }

    setAvailable(true);
    setRoles((rolesRes.data ?? []) as DynamicRole[]);
    setPermissions((permissionsRes.data ?? []) as Permission[]);
    setRolePermissions((rolePermissionsRes.data ?? []) as RolePermission[]);
    setUserGlobalRoles((userRolesRes.data ?? []) as UserGlobalRole[]);
    setChecked(true);
    setLoading(false);
  }, [enabled, includeAssignments, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !available) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 250);
    };
    const channelName = "dynamic-roles";
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "roles" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "permissions" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "role_permissions" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_global_roles" }, debounced)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[dynamic-roles]", status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [available, enabled, load, rt]);

  return { available, checked, loading, error, roles, permissions, rolePermissions, userGlobalRoles, refetch: load };
}

export function useDynamicRolesEnabledPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => getRolesPermissionsEnabled());

  useEffect(() => {
    const sync = () => setEnabledState(getRolesPermissionsEnabled());
    window.addEventListener(ROLES_PERMISSIONS_STORAGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ROLES_PERMISSIONS_STORAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setRolesPermissionsEnabled(next);
    setEnabledState(next);
  }, []);

  return [enabled, setEnabled];
}
