"use client";

import { useMemo, useState } from "react";
import { KubBadge, KubIcon, KubStableSkeleton } from "@/components/kub";
import { KUB_ICON_NAMES, type KubIconName } from "@/components/kub/icons";
import { ProfileBadgeChip } from "@/components/profile/ProfileBadgeChip";
import { InfoHint } from "@/components/settings/InfoHint";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { useProfileBadges } from "@/hooks/useProfileBadges";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskRouting, type TaskRoutingState } from "@/hooks/useTaskRouting";
import { LOCATION_ROLE_LABEL } from "@/lib/locationRouting";
import { projectProfileBadges, hiddenBadgeCount } from "@/lib/profileBadges";
import { getRoleLabel, LEGACY_APP_ROLE_LABEL } from "@/lib/rolePermissions";
import type { DynamicRole, LocationRole, Profile } from "@/types/database";

interface ProfileRoleSummaryProps {
  /** Supplied by a parent that already has it loaded; otherwise fetched here. */
  routing?: TaskRoutingState;
  user: Profile;
  compact?: boolean;
}

/** How many chips the compact strip has room for beside a name. */
const COMPACT_BADGE_LIMIT = 2;

export function ProfileRoleSummary({ user, compact = false, routing: routingProp }: ProfileRoleSummaryProps) {
  const [showAllClubs, setShowAllClubs] = useState(false);
  const access = useRoleAccess();
  // The badges anybody may see (D-180). Until today this component was switched
  // off for everyone but an administrator, because reading somebody else's role
  // meant reading `roles`, and that policy admits only your own rows. The RPC
  // behind this hook returns presentation fields and nothing else, so an
  // ordinary member finally sees who they are talking to.
  const badgeIds = useMemo(() => [user.id], [user.id]);
  const badges = useProfileBadges(badgeIds);
  const worn = useMemo(
    () => projectProfileBadges(badges.rows.get(user.id) ?? [], user.id, { knownIcons: KUB_ICON_NAMES }),
    [badges.rows, user.id],
  );
  // The medals, for the «Достижения» section of the full form. The same answer
  // feeds the compact strip, so opening a card and opening the administration
  // panel's dialog cost one round trip between them rather than two (D-180).
  const medals = useMemo(() => worn.filter((badge) => badge.kind === "achievement"), [worn]);
  const [dynamicRolesEnabled] = useDynamicRolesEnabledPreference();
  const canReadDynamicRoles = dynamicRolesEnabled && access.isAdmin;
  const canReadLocationSummaries = access.isStaff;
  const dynamicRoles = useDynamicRoles({ enabled: canReadDynamicRoles, includeAssignments: true });
  // When the parent already has this loaded, take it. Fetching again meant a
  // duplicate query on every dialog open, and — because the section renders a
  // placeholder while it waits — the dialog grew by about 56px each time it was
  // opened. The hook still runs when nothing is passed, so the other call sites
  // are unchanged.
  const ownRouting = useTaskRouting({
    enabled: canReadLocationSummaries && !routingProp,
    includeMembers: true,
  });
  const routing = routingProp ?? ownRouting;

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
    // What is worn wins the strip: it is the same fact the administrator's view
    // shows, read through a door everybody has. Where somebody wears nothing the
    // card keeps exactly what it showed before rather than going blank, so no
    // surface loses a line it used to have.
    if (worn.length > 0) {
      const shown = worn.slice(0, COMPACT_BADGE_LIMIT);
      const hidden = hiddenBadgeCount(worn.length, COMPACT_BADGE_LIMIT);
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="profile-badges">
          {shown.map((badge) => (
            <ProfileBadgeChip key={`${badge.kind}:${badge.key}`} badge={badge} />
          ))}
          {hidden > 0 && (
            <KubBadge tone="muted" pill>
              +{hidden}
            </KubBadge>
          )}
          {primaryMembership && (
            <KubBadge tone="muted" pill>
              {getLocationRoleDisplay(primaryMembership.dynamicRole, primaryMembership.member.role)}
            </KubBadge>
          )}
        </div>
      );
    }
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
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
          Глобальные роли
          <InfoHint
            term="Глобальные роли"
            className="normal-case tracking-normal"
            text="Роль, которая действует во всём LETSCUBE, а не в какой-то одной локации. Именно она решает, какие разделы человек может открыть."
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hasDynamicContent ? (
            globalRoles.map((role) => {
              const badge = (
                <KubBadge tone={roleTone(role.key)} pill>
                  {role.key === "tech_admin" && <KubIcon name="settings" size={10} />}
                  {getRoleLabel(role)}
                </KubBadge>
              );
              const note = ROLE_ACCESS_NOTE[role.key];
              // What the role actually lets someone do used to be two fixed
              // lines under the list, present only for `owner` and
              // `tech_admin` and silent about the rest. Attached to the badge
              // it costs no height and covers every role that has an answer.
              return note ? (
                <InfoHint
                  key={role.id}
                  term={getRoleLabel(role)}
                  text={note}
                  className="no-underline"
                >
                  {badge}
                </InfoHint>
              ) : (
                <span key={role.id}>{badge}</span>
              );
            })
          ) : (
            <KubBadge tone={user.role === "admin" ? "pink" : user.role === "manager" ? "cyan" : "muted"} pill>
              {fallbackRole}
            </KubBadge>
          )}
        </div>
      </section>

      {/* D-180, and the «за что получил медальку» half of what the owner asked
          for. It is a section rather than a strip because a medal's whole point
          is the sentence beside it — «Ветеран» alone says nothing, «В LETSCUBE
          больше года» is the answer to «за что».

          Absent when somebody holds none, never «Достижений нет»: the settings
          screen already draws an empty state for your own achievements, where
          it is an invitation; on somebody else's card it would be a verdict on
          a person. The same reasoning keeps the locations section's «Локации не
          назначены» off a card that simply does not know yet.

          The share line the design sketched — «у 12% участников» — is not here,
          and deliberately: `describeAchievementShare` needs holders and
          eligible, which `profile_badges` does not return and could not without
          a second read of `achievement_stats` on every card open. */}
      {medals.length > 0 && (
        <section data-testid="profile-achievements">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
            Достижения
            <InfoHint
              term="Достижения"
              className="normal-case tracking-normal"
              text="Отметки за то, что человек уже сделал в LETSCUBE: сколько времени он здесь и что успел. Прав они не дают."
            />
          </div>
          <div className="space-y-1.5">
            {medals.map((badge) => (
              <div
                key={badge.key}
                data-achievement-key={badge.key}
                className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 kub-raise"
              >
                {badge.icon && KUB_ICON_NAMES.has(badge.icon) && (
                  // Outline and muted, which is section 4.5's whole separation
                  // of the families: a standing is a rank and is coloured, a
                  // medal is earned and is not. Shape first, tone second, so
                  // colour is never the only thing telling them apart.
                  <KubIcon
                    name={badge.icon as KubIconName}
                    size={18}
                    weight="regular"
                    tone="muted"
                    className="flex-shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">{badge.title}</div>
                  {badge.detail && (
                    <div className="text-xs text-[color:var(--kub-muted)]">{badge.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
          Локации
          <InfoHint
            term="Локации"
            className="normal-case tracking-normal"
            text="Точки, к которым человек прикреплён. В каждой у него своя роль — сотрудник видит рабочие разделы этой локации, участник только состоит в ней."
          />
        </div>
        {hasLocationContent ? (
          <div className="space-y-1.5">
            {visibleMemberships.map(({ member, location, dynamicRole, primaryAdmin }) => (
              <div
                key={`${member.location_id}:${member.user_id}`}
                className="rounded-xl px-3 py-2 kub-raise"
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
                className="text-xs font-semibold text-[color:var(--kub-accent-text)] hover:underline"
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
                className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 kub-raise"
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

/**
 * What each role actually lets someone do, in the words of the person reading
 * it rather than the permission keys behind it.
 */
const ROLE_ACCESS_NOTE: Record<string, string> = {
  owner: "Полный доступ: все локации, все разделы и настройки приложения.",
  tech_admin:
    "Технические разделы целиком: обновления, боты, диагностика и служебные настройки.",
  admin: "Управление людьми: пользователи, приглашения, баны и мьюты.",
  manager: "Рабочие разделы и задачи тех локаций, к которым человек прикреплён.",
  user: "Обычный доступ: переписка и собственный профиль, без служебных разделов.",
};

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
