"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { AppRole, DynamicRole, Profile } from "@/types/database";

interface ContactRow {
  phone: string | null;
  phone_verified: boolean;
}
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useIsAdmin } from "@/hooks/useRole";
import { KubBadge, KubIcon, KubModal, KubPanel } from "@/components/kub";
import { BanModal } from "./BanModal";
import { MuteModal } from "./MuteModal";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, validateAvatarImage } from "@/lib/mediaUpload";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { ProfileRoleSummary } from "@/components/profile/ProfileRoleSummary";
import { useDynamicRoles, useDynamicRolesEnabledPreference } from "@/hooks/useDynamicRoles";
import { getRoleLabel, isCriticalRoleKey } from "@/lib/rolePermissions";

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
  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = useIsAdmin();
  const [dynamicRolesEnabled] = useDynamicRolesEnabledPreference();
  const dynamicRoles = useDynamicRoles({ enabled: dynamicRolesEnabled && isAdmin, includeAssignments: true });
  const [rows, setRows] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Record<string, ContactRow>>({});
  const [stateById, setStateById] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryRaw, setQueryRaw] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [banTarget, setBanTarget] = useState<Profile | null>(null);
  const [muteTarget, setMuteTarget] = useState<Profile | null>(null);
  const [profileTarget, setProfileTarget] = useState<Profile | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(queryRaw.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryRaw]);

  const load = useCallback(async () => {
    setLoading(true);
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
      setRows([]);
      setTotal(0);
    } else {
      setRows((data ?? []) as Profile[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [supabase, query, page]);

  useEffect(() => { load(); }, [load]);

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
      setStateById(next);
      if (Array.isArray(emailsRes.data)) {
        const map: Record<string, string> = {};
        for (const r of emailsRes.data as { id: string; email: string }[]) {
          map[r.id] = r.email;
        }
        setEmails(map);
      }
      const cmap: Record<string, ContactRow> = {};
      for (const c of (contactsRes.data ?? []) as { user_id: string; phone: string | null; phone_verified: boolean }[]) {
        cmap[c.user_id] = { phone: c.phone, phone_verified: c.phone_verified };
      }
      setContacts(cmap);
    });
    return () => { cancelled = true; };
  }, [rows, supabase]);

  const setRole = async (uid: string, role: AppRole) => {
    const { error } = await supabase
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", uid);
    if (error) { showAppAlert(prefixError("Не удалось изменить роль", error), "Ошибка"); return; }
    setRows((rs) => rs.map((r) => (r.id === uid ? { ...r, role } : r)));
  };

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

  const dynamicRolesByUser = useMemo(() => {
    if (!dynamicRoles.available) return new Map<string, DynamicRole[]>();
    const roleById = new Map(dynamicRoles.roles.map((role) => [role.id, role]));
    const byUser = new Map<string, DynamicRole[]>();
    for (const assignment of dynamicRoles.userGlobalRoles) {
      const role = roleById.get(assignment.role_id);
      if (!role || role.scope !== "global" || !role.is_active) continue;
      const current = byUser.get(assignment.user_id) ?? [];
      current.push(role);
      byUser.set(assignment.user_id, current);
    }
    for (const roles of byUser.values()) {
      roles.sort((a, b) => dynamicRoleRank(a.key) - dynamicRoleRank(b.key) || getRoleLabel(a).localeCompare(getRoleLabel(b), "ru-RU"));
    }
    return byUser;
  }, [dynamicRoles.available, dynamicRoles.roles, dynamicRoles.userGlobalRoles]);

  const canSetRole = (target: Profile, newRole: AppRole) => {
    if (target.id === currentUser?.id) return false;
    if (target.role === newRole) return false;
    if (isAdmin) return true;
    if (target.role === "admin" || newRole === "admin") return false;
    return true;
  };

  const canSanction = (target: Profile) =>
    target.id !== currentUser?.id && (isAdmin || target.role !== "admin");

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Пользователи{" "}
          <span className="text-sm font-normal text-[color:var(--kub-muted)]">· {total}</span>
        </h2>
      </div>

      <div className="flex items-center gap-2 rounded-xl px-3 h-10 mb-3 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
        <KubIcon name="search" size={14} tone="muted" />
        <input
          value={queryRaw}
          onChange={(e) => setQueryRaw(e.target.value)}
          placeholder="Поиск по имени, @username или UUID"
          className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
        />
        {queryRaw && (
          <button
            onClick={() => setQueryRaw("")}
            className="p-0.5 rounded hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]"
            aria-label="Очистить"
          >
            <KubIcon name="close" size={14} />
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs mb-3 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}

      <KubPanel className="overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <KubIcon name="spinner" size={20} tone="accent" label="Загрузка" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-sm text-[color:var(--kub-muted)]">
            Никого не найдено
          </div>
        ) : (
          <div>
            {rows.map((u, i) => {
              const st = stateById[u.id] ?? { banned: false, muted: false };
              const isSelf = u.id === currentUser?.id;
              const email = emails[u.id];
              const canMakeAdmin = canSetRole(u, "admin");
              const canMakeManager = canSetRole(u, "manager");
              const canMakeUser = canSetRole(u, "user");
              const canManageSanctions = canSanction(u);
              const hasRoleActions = canMakeAdmin || canMakeManager || canMakeUser;
              const dynamicBadges = dynamicRolesByUser.get(u.id) ?? [];
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
                  className={cn(
                    "flex items-start sm:items-center gap-3 px-3 py-3 transition-colors",
                    "rounded-xl bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] mb-2",
                    "sm:rounded-none sm:bg-transparent sm:border-0 sm:mb-0",
                    i > 0 ? "sm:border-t sm:border-[color:var(--kub-border-color)]" : "",
                    "hover:bg-[var(--kub-surface-3)] sm:hover:bg-[var(--kub-surface-2)]",
                  )}
                >
                  <div className="flex-shrink-0 mt-0.5 sm:mt-0">
                    <UserAvatar user={u} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-semibold truncate text-[color:var(--kub-text)]">
                        {u.full_name ?? "Без имени"}
                      </span>
                      {isSelf && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] text-[color:var(--kub-cyan)]">
                          вы
                        </span>
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
                  </div>

                  <div className="hidden sm:flex flex-wrap items-center gap-1.5 flex-shrink-0">
                    {badges}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-2 rounded-lg hover:bg-[var(--kub-surface-3)] transition-colors text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
                        aria-label="Действия"
                      >
                        <KubIcon name="more" size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => setProfileTarget(u)}>
                        <KubIcon name="eye" size={14} className="mr-2" /> Открыть профиль
                      </DropdownMenuItem>
                      {hasRoleActions && <DropdownMenuSeparator />}
                      {canMakeAdmin && (
                        <DropdownMenuItem onClick={() => setRole(u.id, "admin")}>
                          <KubIcon name="crown" size={14} className="mr-2" /> Сделать администратором
                        </DropdownMenuItem>
                      )}
                      {canMakeManager && (
                        <DropdownMenuItem onClick={() => setRole(u.id, "manager")}>
                          <KubIcon name="admin" size={14} className="mr-2" /> Сделать менеджером
                        </DropdownMenuItem>
                      )}
                      {canMakeUser && (
                        <DropdownMenuItem onClick={() => setRole(u.id, "user")}>
                          <KubIcon name="userCog" size={14} className="mr-2" /> Сделать пользователем
                        </DropdownMenuItem>
                      )}
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
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Предыдущая страница"
            >
              <KubIcon name="chevronLeft" size={16} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
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
          canManageAvatar={isAdmin && profileTarget.role === "user"}
          onAvatarUpdated={(avatarUrl) => {
            setRows((rs) => rs.map((r) => (r.id === profileTarget.id ? { ...r, avatar_url: avatarUrl } : r)));
            setProfileTarget((target) => target ? { ...target, avatar_url: avatarUrl } : target);
          }}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  );
}

function ProfilePreviewModal({
  user, email, contact, state, canManageAvatar, onAvatarUpdated, onClose,
}: {
  user: Profile;
  email?: string;
  contact?: ContactRow;
  state?: RowState;
  canManageAvatar?: boolean;
  onAvatarUpdated?: (avatarUrl: string | null) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fmt = (s: string | null) =>
    s
      ? new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  const updateAvatarUrl = async (avatarUrl: string | null) => {
    setAvatarSaving(true);
    setAvatarError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    setAvatarSaving(false);
    if (error) {
      const message = prefixError("Не удалось обновить аватар пользователя", error);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return false;
    }
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
    const path = avatarUploadPath("user", user.id, file);
    const { data, error } = await supabase.storage
      .from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setAvatarSaving(false);
      const message = prefixError("Не удалось загрузить аватар пользователя", error);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    const { data: publicData } = supabase.storage.from("media").getPublicUrl(data.path);
    setAvatarSaving(false);
    await updateAvatarUrl(publicData.publicUrl);
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
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[color:var(--kub-border-color)] px-2 py-1 text-xs text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-2)]">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--kub-danger)]/30 px-2 py-1 text-xs text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-60"
                >
                  <KubIcon name="delete" size={12} />
                  <span>Сбросить</span>
                </button>
              )}
            </div>
          )}
          {avatarError && (
            <div className="mt-1 text-xs text-[color:var(--kub-danger)]">{avatarError}</div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Роль" value={roleLabel[user.role]} />
        <Field label="Email" value={email ?? "—"} mono copyable />
        <PhoneField phone={contact?.phone ?? null} verified={!!contact?.phone_verified} />
        <Field label="Был в сети" value={fmtAgo(user.online_at)} />
        <Field label="Зарегистрирован" value={fmt(user.created_at)} />
        <Field
          label="Статус"
          value={state?.banned ? "Заблокирован" : state?.muted ? "Замьючен" : "Активен"}
          danger={state?.banned}
          warn={!state?.banned && state?.muted}
        />
      </div>
      <ProfileRoleSummary user={user} />
      {user.bio && (
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">
            О себе
          </div>
          <div className="text-sm text-[color:var(--kub-text)]">{user.bio}</div>
        </div>
      )}
    </KubModal>
  );
}

function Field({ label, value, mono, danger, warn, copyable }: { label: string; value: string; mono?: boolean; danger?: boolean; warn?: boolean; copyable?: boolean }) {
  const onCopy = () => {
    if (!copyable || value === "—") return;
    navigator.clipboard?.writeText(value).catch(() => {});
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--kub-cyan)]">
        {label}
      </div>
      <div
        onClick={onCopy}
        title={copyable && value !== "—" ? "Скопировать" : undefined}
        className={cn(
          mono ? "font-medium break-words text-xs" : "font-medium",
          danger ? "text-[color:var(--kub-danger)]" : warn ? "text-[color:var(--kub-warn)]" : "text-[color:var(--kub-text)]",
          copyable && value !== "—" && "cursor-pointer hover:underline",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PhoneField({ phone, verified }: { phone: string | null; verified: boolean }) {
  const onCopy = () => {
    if (!phone) return;
    navigator.clipboard?.writeText(phone).catch(() => {});
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--kub-cyan)]">
        Телефон
      </div>
      {phone ? (
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
      ) : (
        <div className="font-medium text-[color:var(--kub-text)]">—</div>
      )}
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
