"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubBadge, KubButton, KubIcon, KubInput, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useTaskRouting, useTaskRoutingEnabledPreference } from "@/hooks/useTaskRouting";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import {
  LOCATION_ROLE_LABEL,
  LOCATION_ROUTING_REQUIRED_MESSAGE,
  mapLocationRoutingError,
} from "@/lib/locationRouting";
import { getRoleLabel, mapRolesPermissionsError } from "@/lib/rolePermissions";
import type { Location, LocationRole, Profile } from "@/types/database";
import { cn } from "@/lib/utils";

const LOCATION_ROLES: LocationRole[] = ["owner", "admin", "manager", "staff"];

export function LocationsTab() {
  const supabase = createClient();
  const [routingProbeEnabled, setRoutingProbeEnabled] = useTaskRoutingEnabledPreference();
  const [rolesEnabled] = useDynamicRolesEnabledPreference();
  const routing = useTaskRouting({ enabled: routingProbeEnabled, includeMembers: true });
  const dynamicRoles = useDynamicRoles({ enabled: rolesEnabled, includeAssignments: false });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createAddress, setCreateAddress] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignRole, setAssignRole] = useState<LocationRole>("staff");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assignPrimaryAdminId, setAssignPrimaryAdminId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedLocation = useMemo(
    () => routing.locations.find((location) => location.id === selectedId) ?? routing.locations[0] ?? null,
    [routing.locations, selectedId],
  );

  useEffect(() => {
    if (!selectedLocation) return;
    setSelectedId(selectedLocation.id);
    setEditName(selectedLocation.name);
    setEditDescription(selectedLocation.description ?? "");
    setEditAddress(selectedLocation.address ?? "");
    setEditActive(selectedLocation.is_active);
  }, [selectedLocation]);

  useEffect(() => {
    if (!routing.available) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn("[locations] profiles failed", error);
          return;
        }
        setProfiles((data ?? []) as Profile[]);
      });
    return () => {
      cancelled = true;
    };
  }, [routing.available, supabase]);

  const selectedMembers = useMemo(() => {
    if (!selectedLocation) return [];
    return routing.members
      .filter((member) => member.location_id === selectedLocation.id)
      .sort((a, b) => {
        const roleOrder = roleRank(a.role) - roleRank(b.role);
        if (roleOrder !== 0) return roleOrder;
        return getProfileName(a.profile).localeCompare(getProfileName(b.profile), "ru-RU");
      });
  }, [routing.members, selectedLocation]);

  const locationAdmins = useMemo(
    () => selectedMembers.filter((member) => ["owner", "admin", "manager"].includes(member.role)),
    [selectedMembers],
  );

  const roleById = useMemo(
    () => new Map(dynamicRoles.roles.map((role) => [role.id, role])),
    [dynamicRoles.roles],
  );

  const dynamicLocationRoles = useMemo(
    () => dynamicRoles.roles.filter((role) => role.scope === "location" && role.is_active),
    [dynamicRoles.roles],
  );

  const selectedDynamicRole = useMemo(
    () => dynamicLocationRoles.find((role) => role.id === assignRoleId) ?? null,
    [assignRoleId, dynamicLocationRoles],
  );

  useEffect(() => {
    if (!dynamicRoles.available || dynamicLocationRoles.length === 0 || assignRoleId) return;
    const staffRole = dynamicLocationRoles.find((role) => role.key === "location_staff") ?? dynamicLocationRoles[0];
    setAssignRoleId(staffRole.id);
  }, [assignRoleId, dynamicLocationRoles, dynamicRoles.available]);

  const availableProfiles = useMemo(() => {
    if (!selectedLocation) return profiles;
    const memberIds = new Set(selectedMembers.map((member) => member.user_id));
    return profiles.filter((profile) => !memberIds.has(profile.id));
  }, [profiles, selectedLocation, selectedMembers]);

  const runAction = useCallback(async (key: string, fn: () => PromiseLike<{ error: unknown; data?: unknown }>, success: string) => {
    setSaving(key);
    setNotice(null);
    setError(null);
    const result = await fn();
    setSaving(null);
    if (result.error) {
      setError(dynamicRoles.available ? mapRolesPermissionsError(result.error, mapLocationRoutingError(result.error)) : mapLocationRoutingError(result.error));
      return false;
    }
    setNotice(success);
    await routing.refetch();
    return true;
  }, [routing]);

  const createLocation = async () => {
    if (!createName.trim()) {
      setError("Нужно указать название локации.");
      return;
    }
    const ok = await runAction(
      "create",
      () => supabase.rpc("location_create", {
        p_name: createName.trim(),
        p_description: createDescription.trim() || null,
        p_address: createAddress.trim() || null,
      }),
      "Локация создана.",
    );
    if (ok) {
      setCreateName("");
      setCreateDescription("");
      setCreateAddress("");
    }
  };

  const saveLocation = async () => {
    if (!selectedLocation) return;
    if (!editName.trim()) {
      setError("Нужно указать название локации.");
      return;
    }
    await runAction(
      "save-location",
      () => supabase.rpc("location_update", {
        p_location_id: selectedLocation.id,
        p_name: editName.trim(),
        p_description: editDescription.trim() || null,
        p_address: editAddress.trim() || null,
        p_is_active: editActive,
      }),
      "Локация обновлена.",
    );
  };

  const archiveLocation = async () => {
    if (!selectedLocation) return;
    await runAction(
      "archive-location",
      () => supabase.rpc("location_archive", { p_location_id: selectedLocation.id }),
      "Локация архивирована.",
    );
  };

  const assignMember = async () => {
    if (!selectedLocation || !assignUserId) {
      setError("Выберите пользователя и локацию.");
      return;
    }
    await runAction(
      "assign-member",
      () => dynamicRoles.available && selectedDynamicRole
        ? supabase.rpc("location_member_assign_role", {
            p_location_id: selectedLocation.id,
            p_user_id: assignUserId,
            p_role_id: selectedDynamicRole.id,
            p_primary_admin_id: selectedDynamicRole.key === "location_staff" ? assignPrimaryAdminId || null : null,
          })
        : supabase.rpc("location_member_assign", {
            p_location_id: selectedLocation.id,
            p_user_id: assignUserId,
            p_role: assignRole,
            p_primary_admin_id: assignRole === "staff" ? assignPrimaryAdminId || null : null,
          }),
      "Назначение сохранено.",
    );
    setAssignUserId("");
    setAssignPrimaryAdminId("");
    setAssignRole("staff");
    if (dynamicRoles.available) {
      const staffRole = dynamicLocationRoles.find((role) => role.key === "location_staff") ?? dynamicLocationRoles[0] ?? null;
      setAssignRoleId(staffRole?.id ?? "");
    }
  };

  const removeMember = async (userId: string) => {
    if (!selectedLocation) return;
    await runAction(
      `remove-${userId}`,
      () => supabase.rpc("location_member_remove", {
        p_location_id: selectedLocation.id,
        p_user_id: userId,
      }),
      "Пользователь удалён из локации.",
    );
  };

  if (routingProbeEnabled && routing.loading && !routing.checked) {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  if (!routingProbeEnabled || !routing.available) {
    return (
      <KubPanel className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]">
            <KubIcon name="mapPin" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[color:var(--kub-text)]">Локации</h2>
            <p className="mt-1 text-sm leading-relaxed text-[color:var(--kub-muted)]">
              {routingProbeEnabled ? routing.error ?? LOCATION_ROUTING_REQUIRED_MESSAGE : LOCATION_ROUTING_REQUIRED_MESSAGE}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Существующее создание и обновление задач остаётся доступным без маршрутизации по локациям.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <KubButton
                variant="secondary"
                size="sm"
                leftIcon={<KubIcon name="rotate" size={13} />}
                onClick={() => {
                  setRoutingProbeEnabled(true);
                  void routing.refetch();
                }}
                loading={routingProbeEnabled && routing.loading}
              >
                Проверить обновление базы
              </KubButton>
              {routingProbeEnabled && (
                <KubButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setRoutingProbeEnabled(false)}
                >
                  Скрыть проверку
                </KubButton>
              )}
            </div>
          </div>
        </div>
      </KubPanel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[color:var(--kub-text)]">Локации</h2>
          <p className="text-sm text-[color:var(--kub-muted)]">
            Настройте локации, их администраторов и работников перед созданием повторяющихся задач.
          </p>
        </div>
        <KubButton
          variant="secondary"
          size="sm"
          leftIcon={<KubIcon name="rotate" size={13} />}
          onClick={() => void routing.refetch()}
          loading={routing.loading}
        >
          Обновить
        </KubButton>
      </div>

      {(notice || error) && (
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            error
              ? "border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)]"
              : "border-[color:var(--kub-online)]/30 bg-[color-mix(in_srgb,var(--kub-online)_12%,transparent)] text-[color:var(--kub-online)]",
          )}
        >
          {error ?? notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <KubPanel className="space-y-3">
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Новая локация</h3>
            <KubInput label="Название" value={createName} onChange={(event) => setCreateName(event.target.value)} />
            <KubInput label="Адрес" value={createAddress} onChange={(event) => setCreateAddress(event.target.value)} />
            <textarea
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              rows={3}
              placeholder="Описание"
              className="w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
            />
            <KubButton
              variant="primary"
              size="sm"
              onClick={() => void createLocation()}
              loading={saving === "create"}
              leftIcon={<KubIcon name="create" size={13} />}
            >
              Создать
            </KubButton>
          </KubPanel>

          <KubPanel padded={false} className="overflow-hidden">
            <div className="border-b border-[color:var(--kub-border-color)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
              Список локаций
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {routing.locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => setSelectedId(location.id)}
                  className={cn(
                    "flex w-full min-w-0 items-center justify-between gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--kub-surface-2)]",
                    selectedLocation?.id === location.id && "bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
                      {location.name}
                    </span>
                    <span className="block truncate text-xs text-[color:var(--kub-muted)]">
                      {location.address || "Адрес не указан"}
                    </span>
                  </span>
                  <KubBadge tone={location.is_active ? "online" : "muted"} pill>
                    {location.is_active ? "Активна" : "Архив"}
                  </KubBadge>
                </button>
              ))}
              {routing.locations.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-[color:var(--kub-muted)]">
                  Локации ещё не созданы.
                </div>
              )}
            </div>
          </KubPanel>
        </div>

        <div className="space-y-3">
          {selectedLocation ? (
            <>
              <KubPanel className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">
                      Настройки локации
                    </h3>
                    <p className="text-xs text-[color:var(--kub-muted)]">
                      Эти поля будут использоваться при маршрутизации задач.
                    </p>
                  </div>
                  <KubBadge tone={editActive ? "online" : "muted"} pill>
                    {editActive ? "Активна" : "Архив"}
                  </KubBadge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <KubInput label="Название" value={editName} onChange={(event) => setEditName(event.target.value)} />
                  <KubInput label="Адрес" value={editAddress} onChange={(event) => setEditAddress(event.target.value)} />
                </div>
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={3}
                  placeholder="Описание"
                  className="w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                />
                <label className="flex items-center gap-2 text-sm text-[color:var(--kub-text)]">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(event) => setEditActive(event.target.checked)}
                    className="h-4 w-4 accent-[var(--kub-cyan)]"
                  />
                  Локация активна
                </label>
                <div className="flex flex-wrap gap-2">
                  <KubButton
                    variant="primary"
                    size="sm"
                    onClick={() => void saveLocation()}
                    loading={saving === "save-location"}
                    leftIcon={<KubIcon name="check" size={13} />}
                  >
                    Сохранить
                  </KubButton>
                  <KubButton
                    variant="secondary"
                    size="sm"
                    onClick={() => void archiveLocation()}
                    loading={saving === "archive-location"}
                    disabled={!selectedLocation.is_active}
                    leftIcon={<KubIcon name="folder" size={13} />}
                  >
                    Архивировать
                  </KubButton>
                </div>
              </KubPanel>

              <KubPanel className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">Назначения</h3>
                  <p className="text-xs text-[color:var(--kub-muted)]">
                    Работнику можно назначить основного администратора локации.
                  </p>
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_auto]">
                  <select
                    value={assignUserId}
                    onChange={(event) => setAssignUserId(event.target.value)}
                    className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                  >
                    <option value="">Выберите пользователя</option>
                    {availableProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{getProfileName(profile)}</option>
                    ))}
                  </select>
                  {dynamicRoles.available && dynamicLocationRoles.length > 0 ? (
                    <select
                      value={assignRoleId}
                      onChange={(event) => setAssignRoleId(event.target.value)}
                      className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    >
                      {dynamicLocationRoles.map((role) => (
                        <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={assignRole}
                      onChange={(event) => setAssignRole(event.target.value as LocationRole)}
                      className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    >
                      {LOCATION_ROLES.map((role) => (
                        <option key={role} value={role}>{LOCATION_ROLE_LABEL[role]}</option>
                      ))}
                    </select>
                  )}
                  <select
                    value={assignPrimaryAdminId}
                    onChange={(event) => setAssignPrimaryAdminId(event.target.value)}
                    disabled={
                      (dynamicRoles.available && selectedDynamicRole
                        ? selectedDynamicRole.key !== "location_staff"
                        : assignRole !== "staff")
                      || locationAdmins.length === 0
                    }
                    className="h-10 min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)] disabled:opacity-50"
                  >
                    <option value="">Основной администратор</option>
                    {locationAdmins.map((member) => (
                      <option key={member.user_id} value={member.user_id}>{getProfileName(member.profile)}</option>
                    ))}
                  </select>
                  <KubButton
                    variant="primary"
                    size="sm"
                    onClick={() => void assignMember()}
                    loading={saving === "assign-member"}
                    leftIcon={<KubIcon name="userPlus" size={13} />}
                  >
                    Назначить
                  </KubButton>
                </div>

                <div className="overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]">
                  {selectedMembers.map((member) => {
                    const dynamicRole = member.role_id ? roleById.get(member.role_id) ?? null : null;
                    return (
                    <div
                      key={`${member.location_id}:${member.user_id}`}
                      className="grid gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {member.profile ? (
                          <UserAvatar user={member.profile} size="sm" />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
                            <KubIcon name="user" size={14} />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
                            {getProfileName(member.profile)}
                          </span>
                          {member.profile?.username && (
                            <span className="block truncate text-xs text-[color:var(--kub-muted)]">
                              @{member.profile.username}
                            </span>
                          )}
                        </span>
                      </div>
                      <KubBadge tone={member.role === "staff" ? "cyan" : "pink"} pill>
                        {dynamicRole ? getRoleLabel(dynamicRole) : LOCATION_ROLE_LABEL[member.role]}
                      </KubBadge>
                      <span className="min-w-0 truncate text-xs text-[color:var(--kub-muted)]">
                        {member.primary_admin
                          ? `Основной администратор: ${getProfileName(member.primary_admin)}`
                          : member.role === "staff"
                            ? "Основной администратор не назначен"
                            : "Административная роль"}
                      </span>
                      <KubButton
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeMember(member.user_id)}
                        loading={saving === `remove-${member.user_id}`}
                        leftIcon={<KubIcon name="userRemove" size={13} />}
                      >
                        Убрать
                      </KubButton>
                    </div>
                  );})}
                  {selectedMembers.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-[color:var(--kub-muted)]">
                      В этой локации пока нет назначенных пользователей.
                    </div>
                  )}
                </div>
              </KubPanel>
            </>
          ) : (
            <KubPanel>
              <div className="text-sm text-[color:var(--kub-muted)]">Выберите или создайте локацию.</div>
            </KubPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function getProfileName(profile: Profile | null | undefined): string {
  return profile?.full_name?.trim() || profile?.username?.trim() || "Пользователь";
}

function roleRank(role: LocationRole): number {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "manager":
      return 2;
    case "staff":
      return 3;
    default:
      return 9;
  }
}
