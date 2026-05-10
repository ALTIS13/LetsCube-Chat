"use client";

import { useMemo } from "react";
import { KubBadge, KubIcon } from "@/components/kub";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskRouting } from "@/hooks/useTaskRouting";
import { LOCATION_ROLE_LABEL } from "@/lib/locationRouting";
import { getRoleLabel, LEGACY_APP_ROLE_LABEL } from "@/lib/rolePermissions";
import type { DynamicRole, LocationRole, Profile } from "@/types/database";

interface ProfileRoleSummaryProps {
  user: Profile;
  compact?: boolean;
}

export function ProfileRoleSummary({ user, compact = false }: ProfileRoleSummaryProps) {
  const access = useRoleAccess();
  const [dynamicRolesEnabled] = useDynamicRolesEnabledPreference();
  const canReadDynamicRoles = dynamicRolesEnabled && access.isAdmin;
  const canReadLocationSummaries = access.isStaff;
  const dynamicRoles = useDynamicRoles({ enabled: canReadDynamicRoles, includeAssignments: true });
  const routing = useTaskRouting({ enabled: canReadLocationSummaries, includeMembers: true });

  const roleById = useMemo(() => new Map(dynamicRoles.roles.map((role) => [role.id, role])), [dynamicRoles.roles]);
  const locationById = useMemo(() => new Map(routing.locations.map((location) => [location.id, location])), [routing.locations]);
  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const member of routing.members) {
      if (member.profile) map.set(member.profile.id, member.profile);
      if (member.primary_admin) map.set(member.primary_admin.id, member.primary_admin);
    }
    return map;
  }, [routing.members]);

  const globalRoles = useMemo(() => {
    if (!dynamicRoles.available) return [];
    return dynamicRoles.userGlobalRoles
      .filter((assignment) => assignment.user_id === user.id)
      .map((assignment) => roleById.get(assignment.role_id))
      .filter((role): role is DynamicRole => Boolean(role))
      .sort((a, b) => roleRank(a.key) - roleRank(b.key) || getRoleLabel(a).localeCompare(getRoleLabel(b), "ru-RU"));
  }, [dynamicRoles.available, dynamicRoles.userGlobalRoles, roleById, user.id]);

  const memberships = useMemo(() => {
    if (!routing.available) return [];
    return routing.members
      .filter((member) => member.user_id === user.id)
      .map((member) => ({
        member,
        location: locationById.get(member.location_id) ?? null,
        dynamicRole: member.role_id ? roleById.get(member.role_id) ?? null : null,
        primaryAdmin: member.primary_admin ?? (member.primary_admin_id ? profileById.get(member.primary_admin_id) ?? null : null),
      }))
      .sort((a, b) => {
        const left = a.location?.name ?? "";
        const right = b.location?.name ?? "";
        return left.localeCompare(right, "ru-RU");
      });
  }, [locationById, profileById, roleById, routing.available, routing.members, user.id]);

  const fallbackRole = LEGACY_APP_ROLE_LABEL[user.role];
  const hasDynamicContent = dynamicRoles.available && globalRoles.length > 0;
  const hasLocationContent = routing.available && memberships.length > 0;

  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {hasDynamicContent ? (
          globalRoles.slice(0, 2).map((role) => (
            <KubBadge key={role.id} tone={role.key === "tech_admin" || role.key === "owner" ? "pink" : "cyan"} pill>
              {role.key === "tech_admin" && <KubIcon name="settings" size={10} />}
              {getRoleLabel(role)}
            </KubBadge>
          ))
        ) : (
          <KubBadge tone={user.role === "admin" ? "pink" : user.role === "manager" ? "cyan" : "muted"} pill>
            {fallbackRole}
          </KubBadge>
        )}
        {globalRoles.length > 2 && <KubBadge tone="muted" pill>+{globalRoles.length - 2}</KubBadge>}
        {hasLocationContent && <KubBadge tone="muted" pill>{memberships.length} клуб.</KubBadge>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
          Глобальные роли
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hasDynamicContent ? (
            globalRoles.map((role) => (
              <KubBadge key={role.id} tone={role.key === "tech_admin" || role.key === "owner" ? "pink" : "cyan"} pill>
                {role.key === "tech_admin" && <KubIcon name="settings" size={10} />}
                {getRoleLabel(role)}
              </KubBadge>
            ))
          ) : (
            <KubBadge tone={user.role === "admin" ? "pink" : user.role === "manager" ? "cyan" : "muted"} pill>
              {fallbackRole}
            </KubBadge>
          )}
        </div>
        {hasDynamicContent && globalRoles.some((role) => role.key === "tech_admin") && (
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">Доступ: все технические разделы</p>
        )}
        {hasDynamicContent && globalRoles.some((role) => role.key === "owner") && (
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">Доступ: все клубы</p>
        )}
      </section>

      <section>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
          Клубы
        </div>
        {hasLocationContent ? (
          <div className="space-y-1.5">
            {memberships.slice(0, 4).map(({ member, location, dynamicRole, primaryAdmin }) => (
              <div
                key={`${member.location_id}:${member.user_id}`}
                className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/55 px-3 py-2"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[color:var(--kub-text)]">
                    {location?.name ?? "Клуб"}
                  </span>
                  <KubBadge tone={member.role === "staff" ? "cyan" : "pink"} pill>
                    {dynamicRole ? getRoleLabel(dynamicRole) : LOCATION_ROLE_LABEL[member.role as LocationRole]}
                  </KubBadge>
                </div>
                {primaryAdmin && member.role === "staff" && (
                  <div className="mt-1 truncate text-xs text-[color:var(--kub-muted)]">
                    Администратор: {primaryAdmin.full_name ?? primaryAdmin.username ?? "Без имени"}
                  </div>
                )}
              </div>
            ))}
            {memberships.length > 4 && (
              <div className="text-xs text-[color:var(--kub-muted)]">+{memberships.length - 4} клубов</div>
            )}
          </div>
        ) : (
          <div className="text-sm text-[color:var(--kub-muted)]">Клубы не назначены</div>
        )}
      </section>
    </div>
  );
}

function roleRank(key: string): number {
  if (key === "owner") return 0;
  if (key === "tech_admin") return 1;
  if (key === "admin") return 2;
  if (key === "manager") return 3;
  if (key === "user") return 4;
  return 9;
}
