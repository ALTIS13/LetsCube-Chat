"use client";

import { useMemo, useState } from "react";
import { KubBadge, KubIcon, KubStableSkeleton } from "@/components/kub";
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
  const [showAllClubs, setShowAllClubs] = useState(false);
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
  // While the routing data is in flight the component knew nothing about this
  // person's locations — and said "Локации не назначены", which is a claim
  // rather than a gap. It was also a 20px line that became ~114px of cards a
  // moment later, so the dialog grew while it was being read.
  const locationsUnknown = routing.loading && memberships.length === 0;
  const visibleMemberships = showAllClubs ? memberships : memberships.slice(0, 3);

  if (compact) {
    const primaryMembership = memberships[0] ?? null;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {hasDynamicContent ? (
          globalRoles.slice(0, 2).map((role) => (
            <KubBadge key={role.id} tone={roleTone(role.key)} pill>
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
        {primaryMembership && (
          <KubBadge tone="muted" pill>
            {getLocationRoleDisplay(primaryMembership.dynamicRole, primaryMembership.member.role)}
          </KubBadge>
        )}
        {memberships.length > 1 && <KubBadge tone="muted" pill>+{locationCountLabel(memberships.length - 1)}</KubBadge>}
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
              <KubBadge key={role.id} tone={roleTone(role.key)} pill>
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
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">Доступ: все локации</p>
        )}
      </section>

      <section>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
          Локации
        </div>
        {hasLocationContent ? (
          <div className="space-y-1.5">
            {visibleMemberships.map(({ member, location, dynamicRole, primaryAdmin }) => (
              <div
                key={`${member.location_id}:${member.user_id}`}
                className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/55 px-3 py-2"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[color:var(--kub-text)]">
                    {location?.name ?? "Локация"}
                  </span>
                  <KubBadge tone={isStaffMembership(member.role, dynamicRole?.key) ? "cyan" : "pink"} pill>
                    {getLocationRoleDisplay(dynamicRole, member.role)}
                  </KubBadge>
                </div>
                {primaryAdmin && isStaffMembership(member.role, dynamicRole?.key) && (
                  <div className="mt-1 truncate text-xs text-[color:var(--kub-muted)]">
                    Администратор: {primaryAdmin.full_name ?? primaryAdmin.username ?? "Без имени"}
                  </div>
                )}
              </div>
            ))}
            {memberships.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllClubs((value) => !value)}
                className="text-xs font-semibold text-[color:var(--kub-cyan)] hover:underline"
              >
                {showAllClubs ? "Свернуть локации" : `Показать ещё ${locationCountLabel(memberships.length - 3)}`}
              </button>
            )}
          </div>
        ) : locationsUnknown ? (
          // Shaped like the cards it will be replaced by, so the dialog is
          // already close to its final height.
          <div className="space-y-1.5" aria-busy="true" aria-label="Загрузка локаций" role="status">
            {[0, 1].map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/55 px-3 py-2"
              >
                <KubStableSkeleton width="42%" height="0.875rem" />
                <KubStableSkeleton width="5.5rem" height="1.125rem" rounded="full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-[color:var(--kub-muted)]">Локации не назначены</div>
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

function roleTone(key: string): "pink" | "cyan" {
  return key === "tech_admin" || key === "owner" ? "pink" : "cyan";
}

function getLocationRoleDisplay(role: DynamicRole | null | undefined, legacyRole: LocationRole): string {
  return role ? getRoleLabel(role) : LOCATION_ROLE_LABEL[legacyRole] ?? "Участник локации";
}

function isStaffMembership(legacyRole: LocationRole, dynamicRoleKey?: string): boolean {
  return legacyRole === "staff" || dynamicRoleKey === "location_staff";
}

function locationCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? "локаций" : last === 1 ? "локация" : last >= 2 && last <= 4 ? "локации" : "локаций";
  return `${count} ${noun}`;
}
