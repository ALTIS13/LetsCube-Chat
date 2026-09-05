"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { AppRole, DynamicRole, LocationRole, Profile } from "@/types/database";

interface ContactRow {
  phone: string | null;
  phone_verified: boolean;
}
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { BulkSelectControl } from "@/components/ui/BulkSelectControl";
import { InfoHint } from "@/components/settings/InfoHint";
import { clearRoleAccessCache, useIsAdmin, usePermissionAccess } from "@/hooks/useRole";
import { useTaskRouting } from "@/hooks/useTaskRouting";
import { KubBadge, KubButton, KubFilterButton, KubFilterSummary, KubIcon, KubModal, KubNoResults, KubNotice, KubPanel, KubSkeletonRows, type ActiveFilter } from "@/components/kub";
import { BanModal } from "./BanModal";
import { MuteModal } from "./MuteModal";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage, validateAvatarUploadImage } from "@/lib/mediaUpload";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { ProfileRoleSummary } from "@/components/profile/ProfileRoleSummary";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { LOCATION_ROLE_LABEL, mapLocationRoutingError } from "@/lib/locationRouting";
import { getRoleLabel, isCriticalRoleKey, mapRolesPermissionsError } from "@/lib/rolePermissions";
import type { LocationMemberWithProfile, TaskRoutingState } from "@/hooks/useTaskRouting";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { cacheControlFor } from "@/lib/mediaCacheControl";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const roleLabel: Record<AppRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  user: "Пользователь",
};

interface RowState {
  banned: boolean;
  muted: boolean;
}

const fmtAgo = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "только что";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} д назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
};

export function UsersTab() {
  const supabase = createClient();
  const rt = getRealtimeClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = useIsAdmin();
  const phoneAccess = usePermissionAccess(["system.manage"]);
  const [dynamicRolesEnabled] = useDynamicRolesEnabledPreference();
  const dynamicRoles = useDynamicRoles({ enabled: dynamicRolesEnabled && isAdmin, includeAssignments: true });
  const routing = useTaskRouting({ enabled: isAdmin, includeMembers: true });
  const [rows, setRows] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Record<string, ContactRow>>({});
  const [stateById, setStateById] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queryRaw, setQueryRaw] = useState("");
  const [query, setQuery] = useState("");
  const [globalRoleFilter, setGlobalRoleFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [locationRoleFilter, setLocationRoleFilter] = useState("");
  const [primaryAdminFilter, setPrimaryAdminFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showTestAccounts, setShowTestAccounts] = useState(false);
  // The filter panel is collapsed by default. Five selects across the top cost
  // the list the space it needs, and an inactive select looks like an active
  // one — what is actually narrowing the list now lives in the chips below.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkGlobalRoleId, setBulkGlobalRoleId] = useState("");
  const [bulkLocationId, setBulkLocationId] = useState("");
  const [bulkLocationRoleId, setBulkLocationRoleId] = useState("");
  const [bulkPrimaryAdminId, setBulkPrimaryAdminId] = useState("");
  const [bulkSaving, setBulkSaving] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [banTarget, setBanTarget] = useState<Profile | null>(null);
  const [muteTarget, setMuteTarget] = useState<Profile | null>(null);
  const [profileTarget, setProfileTarget] = useState<Profile | null>(null);
  const realtimeChannelIdRef = useRef(`admin-users:${Math.random().toString(36).slice(2)}`);
  const rowsLoadedRef = useRef(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(queryRaw.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryRaw]);

  const load = useCallback(async (options: { background?: boolean } = {}) => {
    const background = options.background === true && rowsLoadedRef.current;
    if (!background) setLoading(true);
    setError(null);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let q = supabase
      .from("profiles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (query) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const safe = query.replace(/[%,()]/g, "");
      const filters = [`full_name.ilike.%${safe}%`, `username.ilike.%${safe}%`];
      if (uuidRe.test(query)) filters.push(`id.eq.${query}`);
      q = q.or(filters.join(","));
    }
    const { data, count, error } = await q;
    if (error) {
      setError(mapPgError(error));
      if (!background) {
        setRows([]);
        setTotal(0);
      }
    } else {
      const nextRows = (data ?? []) as Profile[];
      setRows((current) => profilesSignature(current) === profilesSignature(nextRows) ? current : nextRows);
      setTotal((current) => current === (count ?? 0) ? current : (count ?? 0));
      rowsLoadedRef.current = true;
    }
    setLoading(false);
  }, [supabase, query, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSelectedIds((current) => {
      const rowIds = new Set(rows.map((row) => row.id));
      const next = new Set([...current].filter((id) => rowIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setStateById({});
      setEmails({});
      setContacts({});
      return;
    }
    let cancelled = false;
    const ids = rows.map((r) => r.id);
    const nowIso = new Date().toISOString();
    Promise.all([
      supabase.from("bans").select("user_id").in("user_id", ids).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      supabase.from("mutes").select("user_id").in("user_id", ids).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      supabase.rpc("admin_user_emails", { uids: ids }),
      // RLS on profile_contacts grants SELECT to staff for every row;
      // for non-staff readers it returns only their own row, so admin
      // routing (this tab is staff-only) keeps the query scoped.
      supabase.from("profile_contacts").select("user_id, phone, phone_verified").in("user_id", ids),
    ]).then(([bans, mutes, emailsRes, contactsRes]) => {
      if (cancelled) return;
      const bannedIds = new Set((bans.data ?? []).map((b) => b.user_id));
      const mutedIds = new Set((mutes.data ?? []).map((m) => m.user_id));
      const next: Record<string, RowState> = {};
      ids.forEach((id) => {
        next[id] = { banned: bannedIds.has(id), muted: mutedIds.has(id) };
      });
      setStateById((current) => rowStateRecordSignature(current) === rowStateRecordSignature(next) ? current : next);
      if (Array.isArray(emailsRes.data)) {
        const map: Record<string, string> = {};
        for (const r of emailsRes.data as { id: string; email: string }[]) {
          map[r.id] = r.email;
        }
        setEmails((current) => stringRecordSignature(current) === stringRecordSignature(map) ? current : map);
      }
      const cmap: Record<string, ContactRow> = {};
      for (const c of (contactsRes.data ?? []) as { user_id: string; phone: string | null; phone_verified: boolean }[]) {
        cmap[c.user_id] = { phone: c.phone, phone_verified: c.phone_verified };
      }
      setContacts((current) => contactRecordSignature(current) === contactRecordSignature(cmap) ? current : cmap);
    });
    return () => { cancelled = true; };
  }, [rows, supabase]);

  const unban = async (uid: string) => {
    const { error } = await supabase.from("bans").delete().eq("user_id", uid);
    if (error) { showAppAlert(prefixError("Не удалось снять блокировку", error), "Ошибка"); return; }
    setStateById((s) => ({ ...s, [uid]: { ...s[uid], banned: false } }));
  };

  const unmute = async (uid: string) => {
    const { error } = await supabase.from("mutes").delete().eq("user_id", uid);
    if (error) { showAppAlert(prefixError("Не удалось снять мьют", error), "Ошибка"); return; }
    setStateById((s) => ({ ...s, [uid]: { ...s[uid], muted: false } }));
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const dynamicRoleById = useMemo(
    () => new Map(dynamicRoles.roles.map((role) => [role.id, role])),
    [dynamicRoles.roles],
  );

  const globalRoleOptions = useMemo(
    () => dynamicRoles.roles.filter((role) => role.scope === "global" && role.is_active),
    [dynamicRoles.roles],
  );

  const locationRoleOptions = useMemo(
    () => dynamicRoles.roles.filter((role) => role.scope === "location" && role.is_active),
    [dynamicRoles.roles],
  );

  const locationById = useMemo(
    () => new Map(routing.locations.map((location) => [location.id, location])),
    [routing.locations],
  );

  const locationMembersByUser = useMemo(() => {
    const map = new Map<string, LocationMemberWithProfile[]>();
    for (const member of routing.members) {
      const current = map.get(member.user_id) ?? [];
      current.push(member);
      map.set(member.user_id, current);
    }
    return map;
  }, [routing.members]);

  const locationAdmins = useMemo(
    () => routing.members.filter((member) => isAdminLikeLocationRole(getLocationRoleKey(member, dynamicRoleById))),
    [dynamicRoleById, routing.members],
  );

  const dynamicRolesByUser = useMemo(() => {
    if (!dynamicRoles.available) return new Map<string, DynamicRole[]>();
    const byUser = new Map<string, DynamicRole[]>();
    for (const assignment of dynamicRoles.userGlobalRoles) {
      const role = dynamicRoleById.get(assignment.role_id);
      if (!role || role.scope !== "global" || !role.is_active) continue;
      const current = byUser.get(assignment.user_id) ?? [];
      current.push(role);
      byUser.set(assignment.user_id, current);
    }
    for (const roles of byUser.values()) {
      roles.sort((a, b) => dynamicRoleRank(a.key) - dynamicRoleRank(b.key) || getRoleLabel(a).localeCompare(getRoleLabel(b), "ru-RU"));
    }
    return byUser;
  }, [dynamicRoleById, dynamicRoles.available, dynamicRoles.userGlobalRoles]);

  const filteredRows = useMemo(() => {
    const q = queryRaw.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((user) => {
      const userGlobalRoles = dynamicRolesByUser.get(user.id) ?? [];
      const memberships = locationMembersByUser.get(user.id) ?? [];
      if (q) {
        const haystack = [
          user.full_name,
          user.username,
          user.id,
          emails[user.id],
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ru-RU");
        if (!haystack.includes(q)) return false;
      }
      if (globalRoleFilter) {
        if (!userGlobalRoles.some((role) => role.id === globalRoleFilter)) {
          return false;
        }
      }
      if (locationFilter && !memberships.some((member) => member.location_id === locationFilter)) return false;
      if (locationRoleFilter) {
        const matchesLocationRole = memberships.some((member) => {
          return member.role_id === locationRoleFilter;
        });
        if (!matchesLocationRole) return false;
      }
      if (primaryAdminFilter && !memberships.some((member) => member.primary_admin_id === primaryAdminFilter)) return false;
      const locationRoleKeys = memberships.map((member) => getLocationRoleKey(member, dynamicRoleById));
      const hasWorkerLocation = locationRoleKeys.some(isWorkerLocationRole);
      const hasAdminLocation = locationRoleKeys.some(isAdminLikeLocationRole);
      const hasClientGlobalRole = userGlobalRoles.some((role) => role.key === "user" || role.key === "client");
      const hasAdminGlobalRole = userGlobalRoles.some((role) => ["owner", "tech_admin", "admin"].includes(role.key));
      if (!showTestAccounts && user.is_test_account) return false;
      if (statusFilter === "no_location" && memberships.length > 0) return false;
      if (statusFilter === "no_dynamic_role" && userGlobalRoles.length > 0) return false;
      if (
        statusFilter === "client" &&
        (!(hasClientGlobalRole || (user.role === "user" && userGlobalRoles.length === 0)) || hasWorkerLocation || hasAdminLocation)
      ) return false;
      if (statusFilter === "worker" && !hasWorkerLocation) return false;
      if (statusFilter === "location_admin" && !hasAdminLocation) return false;
      if (statusFilter === "admin" && user.role !== "admin" && !hasAdminGlobalRole) return false;
      if (statusFilter === "tech_admin" && !userGlobalRoles.some((role) => role.key === "tech_admin")) return false;
      return true;
    });
  }, [dynamicRoleById, dynamicRolesByUser, emails, globalRoleFilter, locationFilter, locationMembersByUser, locationRoleFilter, primaryAdminFilter, queryRaw, rows, showTestAccounts, statusFilter]);

  // Hidden, not lost: the count says they are there and one click shows them.
  const hiddenTestAccounts = useMemo(
    () => (showTestAccounts ? 0 : rows.filter((user) => user.is_test_account).length),
    [rows, showTestAccounts],
  );

  const selectedUsers = useMemo(
    () => rows.filter((user) => selectedIds.has(user.id)),
    [rows, selectedIds],
  );

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((user) => selectedIds.has(user.id));

  const canSanction = (target: Profile) =>
    target.id !== currentUser?.id && (isAdmin || target.role !== "admin");

  const refreshAdminData = useCallback(async () => {
    await load({ background: true });
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    const channelName = `${realtimeChannelIdRef.current}:live`;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshAdminData();
      }, 250);
    };

    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_global_roles" }, (payload: { new?: { user_id?: string }; old?: { user_id?: string } }) => {
        clearRoleAccessCache(payload.new?.user_id ?? payload.old?.user_id);
      })
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[admin-users:live]", status);
      });
    registerChannel(channelName);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [isAdmin, refreshAdminData, rt]);

  const toggleUserSelection = (userId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const user of filteredRows) next.delete(user.id);
      } else {
        for (const user of filteredRows) next.add(user.id);
      }
      return next;
    });
  };

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const active: ActiveFilter[] = [];
    const push = (id: string, label: string, clear: () => void) =>
      active.push({ id, label, onRemove: () => { clear(); setPage(0); } });

    if (queryRaw.trim()) push("query", `Поиск: ${queryRaw.trim()}`, () => setQueryRaw(""));
    if (globalRoleFilter) {
      const role = globalRoleOptions.find((item) => item.id === globalRoleFilter);
      push("globalRole", `Роль: ${role ? getRoleLabel(role) : globalRoleFilter}`, () => setGlobalRoleFilter(""));
    }
    if (locationFilter) {
      push("location", `Локация: ${locationById.get(locationFilter)?.name ?? locationFilter}`, () => setLocationFilter(""));
    }
    if (locationRoleFilter) {
      const role = locationRoleOptions.find((item) => item.id === locationRoleFilter);
      push("locationRole", `Роль в локации: ${role ? getRoleLabel(role) : locationRoleFilter}`, () => setLocationRoleFilter(""));
    }
    if (primaryAdminFilter) {
      const member = locationAdmins.find((item) => item.user_id === primaryAdminFilter);
      const name = member?.profile?.full_name ?? member?.profile?.username ?? "Администратор";
      push("primaryAdmin", `Основной админ: ${name}`, () => setPrimaryAdminFilter(""));
    }
    if (statusFilter) {
      push("status", `Статус: ${STATUS_FILTER_LABELS[statusFilter] ?? statusFilter}`, () => setStatusFilter(""));
    }
    return active;
  }, [
    globalRoleFilter,
    globalRoleOptions,
    locationAdmins,
    locationById,
    locationFilter,
    locationRoleFilter,
    locationRoleOptions,
    primaryAdminFilter,
    queryRaw,
    statusFilter,
  ]);

  const clearFilters = () => {
    setQueryRaw("");
    setGlobalRoleFilter("");
    setLocationFilter("");
    setLocationRoleFilter("");
    setPrimaryAdminFilter("");
    setStatusFilter("");
    setPage(0);
  };

  const runBulk = async (
    key: string,
    action: (user: Profile) => PromiseLike<{ error: unknown }>,
    successText: (count: number) => string,
  ) => {
    if (selectedUsers.length === 0) return;
    setBulkSaving(key);
    setBulkError(null);
    setNotice(null);
    let ok = 0;
    let failed = 0;
    let firstError: unknown = null;
    for (const user of selectedUsers) {
      const result = await action(user);
      if (result.error) {
        failed += 1;
        firstError ??= result.error;
      } else {
        ok += 1;
        clearRoleAccessCache(user.id);
      }
    }
    setBulkSaving(null);
    await refreshAdminData();
    if (failed > 0) {
      const friendly = firstError
        ? mapRolesPermissionsError(firstError, mapLocationRoutingError(firstError))
        : "Часть изменений не применена.";
      setBulkError(ok > 0 ? `${successText(ok)}. Не удалось применить: ${failed}. ${friendly}` : friendly);
      return;
    }
    setNotice(successText(ok));
  };

  const bulkAssignGlobalRole = async () => {
    if (!bulkGlobalRoleId) {
      setBulkError("Выберите глобальную роль.");
      return;
    }
    await runBulk(
      "assign-global",
      async (user) => await supabase.rpc("user_assign_global_role", { p_user_id: user.id, p_role_id: bulkGlobalRoleId }),
      (count) => `Роль назначена пользователям: ${count}`,
    );
  };

  const bulkRemoveGlobalRole = async () => {
    if (!bulkGlobalRoleId) {
      setBulkError("Выберите глобальную роль.");
      return;
    }
    const role = dynamicRoleById.get(bulkGlobalRoleId);
    const confirmed = await requestAppConfirm({
      title: "Снять роль у выбранных пользователей?",
      description: role ? `Роль «${getRoleLabel(role)}» будет снята у ${selectedUsers.length} пользователей. Защита последнего владельца или тех. администратора останется на стороне сервера.` : undefined,
      confirmLabel: "Снять роль",
      tone: "danger",
      icon: "shieldOff",
    });
    if (!confirmed) return;
    await runBulk(
      "remove-global",
      async (user) => await supabase.rpc("user_remove_global_role", { p_user_id: user.id, p_role_id: bulkGlobalRoleId }),
      (count) => `Роль снята у пользователей: ${count}`,
    );
  };

  const bulkAssignLocation = async () => {
    if (!bulkLocationId) {
      setBulkError("Выберите локацию.");
      return;
    }
    const selectedDynamicLocationRole = dynamicRoleById.get(bulkLocationRoleId);
    if (dynamicRoles.available && (!selectedDynamicLocationRole || selectedDynamicLocationRole.scope !== "location")) {
      setBulkError("Выберите роль в локации.");
      return;
    }
    await runBulk(
      "assign-location",
      async (user) => {
        const primaryAdminId = bulkPrimaryAdminId || null;
        if (selectedDynamicLocationRole && selectedDynamicLocationRole.scope === "location") {
          return await supabase.rpc("location_member_assign_role", {
            p_location_id: bulkLocationId,
            p_user_id: user.id,
            p_role_id: selectedDynamicLocationRole.id,
            p_primary_admin_id: primaryAdminId,
          });
        }
        return await supabase.rpc("location_member_assign", {
          p_location_id: bulkLocationId,
          p_user_id: user.id,
          p_role: "staff" as LocationRole,
          p_primary_admin_id: primaryAdminId,
        });
      },
      (count) => `Локация назначена пользователям: ${count}`,
    );
  };

  const activeLocationAdmins = useMemo(
    () => locationAdmins.filter((member) => !bulkLocationId || member.location_id === bulkLocationId),
    [bulkLocationId, locationAdmins],
  );

  return (
    <div className="min-w-0 space-y-3 pb-24 sm:pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Пользователи{" "}
          <span className="text-sm font-normal text-[color:var(--kub-muted)]">· {total}</span>
        </h2>
        {isAdmin && (
          <KubButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={toggleVisibleSelection}
            disabled={filteredRows.length === 0}
            leftIcon={<KubIcon name={allVisibleSelected ? "check" : "users"} size={13} />}
          >
            {allVisibleSelected ? "Снять выбор" : "Выбрать видимых"}
          </KubButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
      <div className="kub-field min-w-[220px] flex-1 gap-2 rounded-xl px-3 h-11 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
        <KubIcon name="search" size={14} tone="muted" />
        <input
          value={queryRaw}
          onChange={(e) => setQueryRaw(e.target.value)}
          placeholder="Поиск по имени, @никнейму или ID"
          className="h-full flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
        />
        {queryRaw && (
          <button
            onClick={() => setQueryRaw("")}
            className="kub-icon-action kub-interactive rounded kub-raise-hover text-[color:var(--kub-muted)]"
            aria-label="Очистить"
          >
            <KubIcon name="close" size={14} />
          </button>
        )}
      </div>
        {isAdmin && (
          <KubFilterButton
            count={activeFilters.length}
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            className="h-11"
          />
        )}
      </div>

      {/* The search runs on the server and narrows the whole set; the other
          filters run here and can only see the loaded page. When there is more
          than one page, the line says so rather than implying a search across
          every user. */}
      <KubFilterSummary
        matched={filteredRows.length}
        total={total}
        filters={activeFilters}
        onReset={clearFilters}
        noun="пользователей"
        scopedToPage={total > rows.length}
      />

      {isAdmin && filtersOpen && (
        <KubPanel className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField label="Глобальная роль" hint="Действует во всём приложении: пользователи, задачи, локации, чаты и админ-разделы. Не привязана к локации." value={globalRoleFilter} onChange={setGlobalRoleFilter}>
              <option value="">Все роли</option>
              {globalRoleOptions.map((role) => (
                <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
              ))}
            </SelectField>
            <SelectField label="Локация" value={locationFilter} onChange={setLocationFilter} disabled={!routing.available}>
              <option value="">Все локации</option>
              {routing.locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </SelectField>
            <SelectField label="Роль в локации" hint="Действует только внутри выбранной локации. За её пределами эти права не работают." value={locationRoleFilter} onChange={setLocationRoleFilter} disabled={!routing.available}>
              <option value="">Все роли</option>
              {locationRoleOptions.map((role) => (
                <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
              ))}
            </SelectField>
            <SelectField label="Основной админ" hint="Сотрудник локации, к которому привязан работник: его задачи и вопросы идут к этому администратору." value={primaryAdminFilter} onChange={setPrimaryAdminFilter} disabled={!routing.available}>
              <option value="">Любой</option>
              {locationAdmins.map((member) => (
                <option key={`${member.location_id}:${member.user_id}`} value={member.user_id}>
                  {member.profile?.full_name ?? member.profile?.username ?? "Администратор"} · {locationById.get(member.location_id)?.name ?? "Локация"}
                </option>
              ))}
            </SelectField>
            <SelectField label="Статус" value={statusFilter} onChange={setStatusFilter}>
              <option value="">Любой</option>
              <option value="client">Клиент / пользователь</option>
              <option value="worker">Работники</option>
              <option value="location_admin">Администраторы локаций</option>
              <option value="admin">Администраторы</option>
              <option value="tech_admin">Тех. администратор</option>
              <option value="no_location">Без локации</option>
              <option value="no_dynamic_role">Без динамической роли</option>
            </SelectField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <KubButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowTestAccounts((shown) => !shown)}
              leftIcon={<KubIcon name={showTestAccounts ? "eyeOff" : "eye"} size={13} />}
            >
              {showTestAccounts ? "Скрыть тестовые" : "Показать тестовые"}
            </KubButton>
            <KubButton type="button" variant="ghost" size="sm" onClick={clearFilters} leftIcon={<KubIcon name="close" size={13} />}>
              Очистить фильтры
            </KubButton>
            <KubButton type="button" variant="ghost" size="sm" onClick={() => setFiltersOpen(false)} leftIcon={<KubIcon name="chevronUp" size={13} />}>
              Свернуть
            </KubButton>
            {!routing.available && (
              <span className="text-xs text-[color:var(--kub-muted)]">Локации недоступны или требуют обновления базы данных.</span>
            )}
          </div>
        </KubPanel>
      )}

      {isAdmin && selectedUsers.length > 0 && (
        <div className="kub-glass-strong sticky top-2 z-10 space-y-3 rounded-[14px] border border-[color:var(--kub-cyan)]/45 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <BulkSelectControl
                checked={allVisibleSelected}
                onChange={() => toggleVisibleSelection()}
                label="Выбрать видимых пользователей"
                className="h-7 w-7 rounded-lg"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                  Выбрано: {selectedUsers.length}
                </div>
                <div className="truncate text-[11px] text-[color:var(--kub-muted)]">
                  Пакетно назначайте роли и локации без сброса фильтров.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <KubButton type="button" variant="secondary" size="sm" onClick={toggleVisibleSelection}>
                {allVisibleSelected ? "Снять видимые" : "Выбрать видимые"}
              </KubButton>
              <KubButton type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Очистить
              </KubButton>
            </div>
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <SelectField label="Глобальная роль" hint="Действует во всём приложении: пользователи, задачи, локации, чаты и админ-разделы. Не привязана к локации." value={bulkGlobalRoleId} onChange={setBulkGlobalRoleId} disabled={!dynamicRoles.available}>
              <option value="">Выберите роль</option>
              {globalRoleOptions.map((role) => (
                <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
              ))}
            </SelectField>
            <KubButton type="button" size="sm" onClick={bulkAssignGlobalRole} loading={bulkSaving === "assign-global"} disabled={!bulkGlobalRoleId}>
              Назначить роль
            </KubButton>
            <KubButton type="button" size="sm" variant="danger" onClick={bulkRemoveGlobalRole} loading={bulkSaving === "remove-global"} disabled={!bulkGlobalRoleId}>
              Снять роль
            </KubButton>
          </div>
          <div className="grid gap-2 lg:grid-cols-4">
            <SelectField label="Локация" value={bulkLocationId} onChange={setBulkLocationId} disabled={!routing.available}>
              <option value="">Выберите локацию</option>
              {routing.locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </SelectField>
            <SelectField label="Роль локации" hint="Действует только внутри выбранной локации. За её пределами эти права не работают." value={bulkLocationRoleId} onChange={setBulkLocationRoleId} disabled={!dynamicRoles.available}>
              <option value="">Выберите роль</option>
              {locationRoleOptions.map((role) => (
                <option key={role.id} value={role.id}>{getRoleLabel(role)}</option>
              ))}
            </SelectField>
            <SelectField label="Основной админ" hint="Сотрудник локации, к которому привязан работник: его задачи и вопросы идут к этому администратору." value={bulkPrimaryAdminId} onChange={setBulkPrimaryAdminId} disabled={!bulkLocationId || activeLocationAdmins.length === 0}>
              <option value="">Не назначать</option>
              {activeLocationAdmins.map((member) => (
                <option key={`${member.location_id}:${member.user_id}`} value={member.user_id}>
                  {member.profile?.full_name ?? member.profile?.username ?? "Администратор"}
                </option>
              ))}
            </SelectField>
            <KubButton type="button" size="sm" onClick={bulkAssignLocation} loading={bulkSaving === "assign-location"} disabled={!bulkLocationId}>
              Назначить локацию
            </KubButton>
          </div>
          {bulkError && (
            <KubNotice tone="danger" className="text-xs">
              {bulkError}
            </KubNotice>
          )}
        </div>
      )}

      {notice && (
        <KubNotice tone="info" className="text-xs">
          {notice}
        </KubNotice>
      )}

      {error && (
        <KubNotice tone="danger" className="text-xs mb-3">
          {error}
        </KubNotice>
      )}

      <KubPanel className="overflow-hidden p-0">
        {loading ? (
          <KubSkeletonRows
            count={8}
            label="Загрузка списка пользователей"
            rowClassName="border-b border-[color:var(--kub-border-color)] last:border-b-0"
          />
        ) : filteredRows.length === 0 ? (
          <KubNoResults
            filters={activeFilters}
            onReset={clearFilters}
            noun="пользователей"
            emptyTitle="Пользователей пока нет"
            emptyDescription="Как только кто-то зарегистрируется, он появится здесь."
          />
        ) : (
          <div>
            {filteredRows.map((u, i) => {
              const st = stateById[u.id] ?? { banned: false, muted: false };
              const isSelf = u.id === currentUser?.id;
              const isSelected = selectedIds.has(u.id);
              const email = emails[u.id];
              const canManageSanctions = canSanction(u);
              const dynamicBadges = dynamicRolesByUser.get(u.id) ?? [];
              const memberships = locationMembersByUser.get(u.id) ?? [];
              const locationBadges = memberships.slice(0, 2).map((member) => {
                const location = locationById.get(member.location_id);
                const dynamicLocationRole = member.role_id ? dynamicRoleById.get(member.role_id) : null;
                const primaryAdminName = member.primary_admin?.full_name ?? member.primary_admin?.username ?? null;
                return {
                  key: `${member.location_id}:${member.user_id}`,
                  label: `${location?.name ?? "Локация"} · ${dynamicLocationRole ? getRoleLabel(dynamicLocationRole) : LOCATION_ROLE_LABEL[member.role]}`,
                  primaryAdminName,
                };
              });
              const badges = (
                <>
                  {dynamicBadges.length > 0 ? (
                    <>
                      {dynamicBadges.slice(0, 2).map((role) => (
                        <KubBadge key={role.id} tone={isCriticalRoleKey(role.key) ? "pink" : "cyan"}>
                          {isCriticalRoleKey(role.key) && <KubIcon name="crown" size={10} />}
                          {getRoleLabel(role)}
                        </KubBadge>
                      ))}
                      {dynamicBadges.length > 2 && <KubBadge tone="muted">+{dynamicBadges.length - 2}</KubBadge>}
                    </>
                  ) : (
                    <KubBadge tone={u.role === "admin" ? "pink" : u.role === "manager" ? "cyan" : "muted"}>
                      {u.role === "admin" && <KubIcon name="crown" size={10} />}
                      {roleLabel[u.role]}
                    </KubBadge>
                  )}
                  {st.banned && <KubBadge tone="danger">Бан</KubBadge>}
                  {st.muted && <KubBadge tone="warn">Мьют</KubBadge>}
                </>
              );
              return (
                <div
                  key={u.id}
                  data-testid="admin-user-row"
                  className={cn(
                    "flex items-start sm:items-center gap-3 px-3 py-3 transition-colors",
                    "rounded-xl bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] mb-2",
                    "sm:rounded-none sm:bg-transparent sm:border-0 sm:mb-0",
                    i > 0 ? "sm:border-t sm:border-[color:var(--kub-border-color)]" : "",
                    "kub-raise-hover",
                    isSelected && "border-[color:var(--kub-cyan)]/65 bg-[color-mix(in_srgb,var(--kub-cyan)_8%,var(--kub-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--kub-cyan)_24%,transparent)] sm:bg-[color-mix(in_srgb,var(--kub-cyan)_8%,transparent)]",
                  )}
                >
                  {isAdmin && (
                    <BulkSelectControl
                      checked={isSelected}
                      onChange={() => toggleUserSelection(u.id)}
                      label={`Выбрать пользователя: ${u.full_name ?? u.username ?? "без имени"}`}
                      className="mt-1 sm:mt-0"
                    />
                  )}
                  <div className="flex-shrink-0 mt-0.5 sm:mt-0">
                    <UserAvatar user={u} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-semibold truncate text-[color:var(--kub-text)]">
                        {u.full_name ?? "Без имени"}
                      </span>
                      {isSelf && (
                        <KubBadge tone="cyan" dot={false} className="text-[10px]">
                          вы
                        </KubBadge>
                      )}
                      {u.is_test_account && (
                        <KubBadge tone="muted" dot={false} className="text-[10px]" data-testid="test-account-badge">
                          тест
                        </KubBadge>
                      )}
                    </div>
                    <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[color:var(--kub-muted)]">
                      {u.username ? <span className="truncate max-w-full">@{u.username}</span> : <span>{u.id.slice(0, 8)}…</span>}
                      {email && (
                        <span className="hidden md:inline-flex items-center gap-1 truncate">
                          <KubIcon name="mail" size={11} />
                          {email}
                        </span>
                      )}
                      <span className="hidden lg:inline">· был {fmtAgo(u.online_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 sm:hidden">
                      {badges}
                    </div>
                    {locationBadges.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--kub-muted)]">
                        {locationBadges.map((badge) => (
                          <span key={badge.key} className="rounded-full bg-[var(--kub-inset)] px-2 py-0.5">
                            {badge.label}
                            {badge.primaryAdminName ? ` · админ: ${badge.primaryAdminName}` : ""}
                          </span>
                        ))}
                        {memberships.length > 2 && <span>+{memberships.length - 2} локац.</span>}
                      </div>
                    )}
                  </div>

                  <div className="hidden sm:flex flex-wrap items-center gap-1.5 flex-shrink-0">
                    {badges}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="kub-icon-action kub-interactive rounded-lg kub-raise-hover transition-colors text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
                        aria-label="Действия"
                      >
                        <KubIcon name="more" size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => setProfileTarget(u)}>
                        <KubIcon name="eye" size={14} className="mr-2" /> Открыть профиль
                      </DropdownMenuItem>
                      {canManageSanctions && <DropdownMenuSeparator />}
                      {st.banned && canManageSanctions ? (
                        <DropdownMenuItem onClick={() => unban(u.id)}>
                          <KubIcon name="unban" size={14} className="mr-2" /> Снять блокировку
                        </DropdownMenuItem>
                      ) : !st.banned && canManageSanctions ? (
                        <DropdownMenuItem
                          onClick={() => setBanTarget(u)}
                          className="text-red-500 focus:text-red-500"
                        >
                          <KubIcon name="shieldOff" size={14} className="mr-2" /> Заблокировать…
                        </DropdownMenuItem>
                      ) : null}
                      {st.muted && canManageSanctions ? (
                        <DropdownMenuItem onClick={() => unmute(u.id)}>
                          <KubIcon name="volume" size={14} className="mr-2" /> Снять мьют
                        </DropdownMenuItem>
                      ) : !st.muted && canManageSanctions ? (
                        <DropdownMenuItem onClick={() => setMuteTarget(u)}>
                          <KubIcon name="muted" size={14} className="mr-2" /> Замьютить…
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </KubPanel>

      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-xs text-[color:var(--kub-muted)]">
          <span>
            Стр. {page + 1} из {totalPages} · {PAGE_SIZE} на странице
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="kub-icon-action p-1.5 rounded-lg kub-raise-hover disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Предыдущая страница"
            >
              <KubIcon name="chevronLeft" size={16} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="kub-icon-action p-1.5 rounded-lg kub-raise-hover disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Следующая страница"
            >
              <KubIcon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      )}

      {banTarget && (
        <BanModal
          target={banTarget}
          onClose={() => setBanTarget(null)}
          onSuccess={() => {
            setStateById((s) => ({ ...s, [banTarget.id]: { ...(s[banTarget.id] ?? { banned: false, muted: false }), banned: true } }));
            setBanTarget(null);
          }}
        />
      )}
      {muteTarget && (
        <MuteModal
          target={muteTarget}
          onClose={() => setMuteTarget(null)}
          onSuccess={() => {
            setStateById((s) => ({ ...s, [muteTarget.id]: { ...(s[muteTarget.id] ?? { banned: false, muted: false }), muted: true } }));
            setMuteTarget(null);
          }}
        />
      )}
      {profileTarget && (
        <ProfilePreviewModal
          user={profileTarget}
          email={emails[profileTarget.id]}
          contact={contacts[profileTarget.id]}
          state={stateById[profileTarget.id]}
          routing={routing}
          canManageAvatar={isAdmin || profileTarget.id === currentUser?.id}
          canManagePhone={!phoneAccess.checking && phoneAccess.hasPermission("system.manage")}
          onAvatarUpdated={(avatarUrl) => {
            setRows((rs) => rs.map((r) => (r.id === profileTarget.id ? { ...r, avatar_url: avatarUrl } : r)));
            setProfileTarget((target) => target ? { ...target, avatar_url: avatarUrl } : target);
          }}
          onPhoneRemoved={() => {
            setContacts((current) => ({
              ...current,
              [profileTarget.id]: { phone: null, phone_verified: false },
            }));
          }}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  );
}

function ProfilePreviewModal({
  user, email, contact, state, routing, canManageAvatar, canManagePhone, onAvatarUpdated, onPhoneRemoved, onClose,
}: {
  user: Profile;
  email?: string;
  contact?: ContactRow;
  state?: RowState;
  /** Already loaded by the screen behind the dialog; passed so the dialog does
      not re-query it and grow once the answer arrives. */
  routing: TaskRoutingState;
  canManageAvatar?: boolean;
  canManagePhone?: boolean;
  onAvatarUpdated?: (avatarUrl: string | null) => void;
  onPhoneRemoved?: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [phoneRemoving, setPhoneRemoving] = useState(false);
  const fmt = (s: string | null) =>
    s
      ? new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  const updateAvatarUrl = async (avatarUrl: string | null) => {
    setAvatarSaving(true);
    setAvatarError(null);
    try {
      const rpcResult = await supabase.rpc("admin_update_user_profile", {
        p_user_id: user.id,
        p_avatar_url: avatarUrl,
      });
      if (rpcResult.error) {
        if (isAdminProfileRpcMissing(rpcResult.error)) {
          const { error } = await supabase
            .from("profiles")
            .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
            .eq("id", user.id);
          if (error) throw error;
        } else {
          throw rpcResult.error;
        }
      }
    } catch (error) {
      const message = mapAdminProfileAvatarError(error, "update");
      setAvatarError(message);
      showAppAlert(message, "Аватар не обновлён");
      setAvatarSaving(false);
      return false;
    }
    setAvatarSaving(false);
    onAvatarUpdated?.(avatarUrl);
    return true;
  };

  const handleAvatarChange = async (file: File) => {
    if (!canManageAvatar || avatarSaving) return;
    const validationError = validateAvatarImage(file);
    if (validationError) {
      setAvatarError(validationError);
      showAppAlert(validationError, "Аватар не загружен");
      return;
    }
    setAvatarSaving(true);
    setAvatarError(null);
    const preparedFile = await prepareAvatarImage(file);
    const preparedValidationError = validateAvatarUploadImage(preparedFile);
    if (preparedValidationError) {
      setAvatarError(preparedValidationError);
      showAppAlert(preparedValidationError, "Аватар не загружен");
      setAvatarSaving(false);
      return;
    }
    const path = avatarUploadPath("user", user.id, preparedFile);
    try {
      const { data, error } = await supabase.storage
        .from("media")
        .upload(path, preparedFile, {
          contentType: preparedFile.type,
          upsert: false,
          cacheControl: cacheControlFor(path),
        });
      if (error || !data) throw error ?? new Error("avatar_upload_failed");
      const { data: publicData } = supabase.storage.from("media").getPublicUrl(data.path);
      setAvatarSaving(false);
      await updateAvatarUrl(publicData.publicUrl);
    } catch (error) {
      const message = mapAdminProfileAvatarError(error, "upload");
      setAvatarError(message);
      showAppAlert(message, "Аватар не загружен");
      setAvatarSaving(false);
      return;
    }
  };

  const handleAvatarReset = async () => {
    if (!canManageAvatar || avatarSaving) return;
    const confirmed = await requestAppConfirm({
      title: "Сбросить аватар пользователя?",
      description: "Ссылка на аватар будет очищена. Файл в хранилище не удаляется автоматически.",
      confirmLabel: "Сбросить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    await updateAvatarUrl(null);
  };

  const handlePhoneRemove = async () => {
    if (!canManagePhone || !contact?.phone || phoneRemoving) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить номер пользователя?",
      description: "Номер будет удалён из профиля и данных входа. Для повторного добавления потребуется новое подтверждение.",
      confirmLabel: "Удалить номер",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;

    setPhoneRemoving(true);
    const { data, error } = await supabase.functions.invoke("phone-verification-gateway", {
      body: { action: "admin_remove", target_user_id: user.id },
    });
    setPhoneRemoving(false);
    if (error || data?.ok !== true) {
      showAppAlert("Не удалось удалить номер пользователя. Попробуйте позже.", "Номер не удалён");
      return;
    }
    onPhoneRemoved?.();
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Профиль пользователя"
      size="md"
      contentClassName="px-5 py-5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <UserAvatar user={user} size="lg" />
          {canManageAvatar && (
            <label
              className={cn(
                "absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full",
                "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] shadow-lg",
                avatarSaving && "pointer-events-none opacity-70",
              )}
            >
              <KubIcon name={avatarSaving ? "spinner" : "camera"} size={13} label="Сменить аватар пользователя" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={avatarSaving}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void handleAvatarChange(file);
                }}
              />
            </label>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold truncate text-[color:var(--kub-text)]">
            {user.full_name ?? "Без имени"}
          </div>
          <div className="text-xs truncate text-[color:var(--kub-muted)]">
            {user.username ? `@${user.username}` : user.id}
          </div>
          {canManageAvatar && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[color:var(--kub-border-color)] px-2 py-1 text-xs text-[color:var(--kub-accent-text)] kub-raise-hover">
                <KubIcon name={avatarSaving ? "spinner" : "camera"} size={12} />
                <span>{avatarSaving ? "Сохранение..." : "Сменить аватар"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={avatarSaving}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void handleAvatarChange(file);
                  }}
                />
              </label>
              {user.avatar_url && (
                <button
                  type="button"
                  disabled={avatarSaving}
                  onClick={() => void handleAvatarReset()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--kub-danger)]/30 px-2 py-1 text-xs text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-60"
                >
                  <KubIcon name="delete" size={12} />
                  <span>Сбросить</span>
                </button>
              )}
            </div>
          )}
          {avatarError && (
            <div className="mt-1 text-xs text-[color:var(--kub-danger-text)]">{avatarError}</div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Базовая роль" value={roleLabel[user.role]} />
        <Field label="Эл. почта" value={email ?? "—"} mono copyable />
        <PhoneField
          phone={contact?.phone ?? null}
          verified={!!contact?.phone_verified}
          canRemove={!!canManagePhone}
          removing={phoneRemoving}
          onRemove={() => void handlePhoneRemove()}
        />
        <Field label="Был в сети" value={fmtAgo(user.online_at)} />
        <Field label="Зарегистрирован" value={fmt(user.created_at)} />
        <Field
          label="Статус"
          value={state?.banned ? "Заблокирован" : state?.muted ? "Замьючен" : "Активен"}
          danger={state?.banned}
          warn={!state?.banned && state?.muted}
        />
      </div>
      <ProfileRoleSummary user={user} routing={routing} />
      {user.bio && (
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-accent-text)]">
            О себе
          </div>
          <div className="text-sm text-[color:var(--kub-text)]">{user.bio}</div>
        </div>
      )}
    </KubModal>
  );
}

function mapAdminProfileAvatarError(error: unknown, stage: "upload" | "update"): string {
  if (isAdminProfileRpcMissing(error)) {
    return "Редактирование профиля пользователя требует обновления базы данных.";
  }
  if (isPermissionLikeError(error)) {
    return "Недостаточно прав для изменения профиля.";
  }
  return stage === "upload" ? "Не удалось загрузить аватар." : "Не удалось обновить профиль.";
}

function isAdminProfileRpcMissing(error: unknown): boolean {
  const { text, code } = getErrorFingerprint(error);
  return code === "PGRST202" ||
    text.includes("admin_update_user_profile") ||
    text.includes("could not find the function") ||
    text.includes("function public.admin_update_user_profile");
}

function isPermissionLikeError(error: unknown): boolean {
  const { text, code } = getErrorFingerprint(error);
  return code === "42501" ||
    code === "403" ||
    text.includes("row-level security") ||
    text.includes("row level security") ||
    text.includes("permission denied") ||
    text.includes("not authorized") ||
    text.includes("not allowed") ||
    text.includes("unauthorized");
}

function getErrorFingerprint(error: unknown): { text: string; code: string } {
  if (!error) return { text: "", code: "" };
  if (typeof error === "string") return { text: error.toLowerCase(), code: "" };
  if (typeof error !== "object") return { text: String(error).toLowerCase(), code: "" };
  const record = error as Record<string, unknown>;
  const parts = [record.message, record.details, record.hint, record.name]
    .filter((part): part is string => typeof part === "string");
  return {
    text: parts.join(" ").toLowerCase(),
    code: typeof record.code === "string" ? record.code.toUpperCase() : "",
  };
}

function Field({ label, value, mono, danger, warn, copyable }: { label: string; value: string; mono?: boolean; danger?: boolean; warn?: boolean; copyable?: boolean }) {
  const onCopy = () => {
    if (!copyable || value === "—") return;
    navigator.clipboard?.writeText(value).catch(() => {});
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        {label}
      </div>
      <div
        onClick={onCopy}
        title={copyable && value !== "—" ? "Скопировать" : undefined}
        className={cn(
          mono ? "font-medium break-words text-xs" : "font-medium",
          danger ? "text-[color:var(--kub-danger-text)]" : warn ? "text-[color:var(--kub-warn)]" : "text-[color:var(--kub-text)]",
          copyable && value !== "—" && "cursor-pointer hover:underline",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PhoneField({
  phone,
  verified,
  canRemove,
  removing,
  onRemove,
}: {
  phone: string | null;
  verified: boolean;
  canRemove?: boolean;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const onCopy = () => {
    if (!phone) return;
    navigator.clipboard?.writeText(phone).catch(() => {});
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        Телефон
      </div>
      {phone ? (
        <div className="space-y-1.5">
          <div
            onClick={onCopy}
            title="Скопировать"
            className="font-medium cursor-pointer hover:underline text-[color:var(--kub-text)] flex items-center gap-1.5"
          >
            <span>{phone}</span>
            {verified ? (
              <KubBadge tone="online" dot>OK</KubBadge>
            ) : (
              <KubBadge tone="muted">не подтв.</KubBadge>
            )}
          </div>
          {canRemove && (
            <KubButton
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<KubIcon name="delete" size={12} />}
              loading={removing}
              onClick={onRemove}
              className="h-7 px-2 text-[color:var(--kub-danger-text)]"
            >
              Удалить номер
            </KubButton>
          )}
        </div>
      ) : (
        <div className="font-medium text-[color:var(--kub-text)]">—</div>
      )}
    </div>
  );
}

// The same words the status options use, so a chip never invents a name for a
// filter the panel spells differently.
const STATUS_FILTER_LABELS: Record<string, string> = {
  client: "Клиент / пользователь",
  worker: "Работники",
  location_admin: "Администраторы локаций",
  admin: "Администраторы",
  tech_admin: "Тех. администратор",
  no_location: "Без локации",
  no_dynamic_role: "Без динамической роли",
};

/**
 * A `<div>` around a `<label htmlFor>` rather than a `<label>` around
 * everything, because the caption now carries an explanation and a
 * `<button>` inside a `<label>` is clicked twice: once as itself and once as
 * the label, which opens the select underneath the tooltip.
 */
function SelectField({
  label,
  hint,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  /** Plain-language answer to "what does this word mean", if it needs one. */
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        <label htmlFor={id}>{label}</label>
        {hint && <InfoHint term={label} text={hint} side="top" />}
      </span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2 text-xs text-[color:var(--kub-text)] outline-none disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  );
}

function dynamicRoleRank(key: string): number {
  if (key === "owner") return 0;
  if (key === "tech_admin") return 1;
  if (key === "admin") return 2;
  if (key === "manager") return 3;
  if (key === "user") return 4;
  return 9;
}

function getLocationRoleKey(member: LocationMemberWithProfile, roleById: Map<string, DynamicRole>): string {
  const dynamicRole = member.role_id ? roleById.get(member.role_id) : null;
  if (dynamicRole?.scope === "location") return dynamicRole.key;
  switch (member.role) {
    case "owner":
      return "location_owner";
    case "admin":
      return "location_admin";
    case "manager":
      return "location_manager";
    case "staff":
    default:
      return "location_staff";
  }
}

function isAdminLikeLocationRole(roleKey: string): boolean {
  return roleKey === "location_owner" || roleKey === "location_admin" || roleKey === "location_manager";
}

function isWorkerLocationRole(roleKey: string): boolean {
  return roleKey === "location_staff" || roleKey === "location_manager";
}

function profilesSignature(rows: Profile[]): string {
  return rows
    .map((row) => [row.id, row.full_name ?? "", row.username ?? "", row.avatar_url ?? "", row.role, row.online_at ?? "", row.updated_at ?? ""].join(":"))
    .join("|");
}

function rowStateRecordSignature(record: Record<string, RowState>): string {
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, state]) => `${id}:${state.banned ? 1 : 0}:${state.muted ? 1 : 0}`)
    .join("|");
}

function stringRecordSignature(record: Record<string, string>): string {
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}

function contactRecordSignature(record: Record<string, ContactRow>): string {
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, contact]) => `${id}:${contact.phone ?? ""}:${contact.phone_verified ? 1 : 0}`)
    .join("|");
}
