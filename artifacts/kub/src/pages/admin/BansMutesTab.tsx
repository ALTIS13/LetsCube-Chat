"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubIcon, KubPanel, type KubIconName } from "@/components/kub";
import type { AuditAction, AuditLogWithActor, Ban, Mute, Profile, Chat } from "@/types/database";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { prefixError } from "@/lib/errors";
import { showAppAlert } from "@/lib/appDialogs";
import { useAuditLogs } from "@/hooks/useAuditLogs";

type BanRow = Ban & {
  user?: Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> | null;
  issuer?: Pick<Profile, "full_name" | "username"> | null;
};

type MuteRow = Mute & {
  user?: Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> | null;
  issuer?: Pick<Profile, "full_name" | "username"> | null;
  chat?: Pick<Chat, "id" | "name"> | null;
};

const fmt = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "бессрочно";

const SANCTION_AUDIT_ACTIONS: AuditAction[] = [
  "ban_issued",
  "ban_lifted",
  "mute_issued",
  "mute_lifted",
];

export function BansMutesTab() {
  const supabase = createClient();
  const [bans, setBans] = useState<BanRow[]>([]);
  const [mutes, setMutes] = useState<MuteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [bansOpen, setBansOpen] = useState(true);
  const [mutesOpen, setMutesOpen] = useState(true);
  const nowMs = Date.now();
  const auditFilters = useMemo(() => ({ actions: SANCTION_AUDIT_ACTIONS }), []);
  const audit = useAuditLogs(auditFilters, 20);

  const load = useCallback(async () => {
    setLoading(true);
    const [bansRes, mutesRes] = await Promise.all([
      supabase
        .from("bans")
        .select("*, user:profiles!bans_user_id_fkey(id,full_name,username,avatar_url), issuer:profiles!bans_issued_by_fkey(full_name,username)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("mutes")
        .select("*, user:profiles!mutes_user_id_fkey(id,full_name,username,avatar_url), issuer:profiles!mutes_issued_by_fkey(full_name,username), chat:chats!mutes_chat_id_fkey(id,name)")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const bansData = (bansRes.data ?? []) as unknown;
    const mutesData = (mutesRes.data ?? []) as unknown;
    setBans(bansData as BanRow[]);
    setMutes(mutesData as MuteRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const visibleBans = showExpired ? bans : bans.filter(isActiveSanction);
  const visibleMutes = showExpired ? mutes : mutes.filter(isActiveSanction);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 500);
    };
    const channel = supabase
      .channel("admin-bans-mutes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bans" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "mutes" }, debouncedLoad)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const removeBan = async (id: string) => {
    const { error } = await supabase.from("bans").delete().eq("id", id);
    if (error) { showAppAlert(prefixError("Не удалось снять блокировку", error), "Ошибка"); return; }
    setBans((b) => b.filter((x) => x.id !== id));
  };

  const removeMute = async (id: string) => {
    const { error } = await supabase.from("mutes").delete().eq("id", id);
    if (error) { showAppAlert(prefixError("Не удалось снять мьют", error), "Ошибка"); return; }
    setMutes((m) => m.filter((x) => x.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Блокировки и мьюты
        </h2>
        <label className="flex items-center gap-2 text-xs cursor-pointer text-[color:var(--kub-muted)]">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={(e) => setShowExpired(e.target.checked)}
            className="accent-[color:var(--kub-cyan)]"
          />
          Показать истёкшие
        </label>
      </div>

      <CollapsibleSection
        title={showExpired ? "Баны" : "Активные баны"}
        icon="shieldOff"
        accentVar="--kub-danger"
        count={visibleBans.length}
        open={bansOpen}
        setOpen={setBansOpen}
      >
        {visibleBans.length === 0 ? (
          <Empty text={showExpired ? "Банов не найдено" : "Активных банов нет"} />
        ) : (
          visibleBans.map((b) => {
            const expired = isExpiredSanction(b, nowMs);
            return (
              <RowCard
                key={b.id}
                user={b.user as Profile | null | undefined}
                fallbackId={b.user_id}
                expired={!!expired}
                reason={b.reason}
                meta={`${b.issuer?.full_name ?? "—"} · ${fmt(b.created_at)} → ${fmt(b.expires_at)}`}
                onRemove={() => removeBan(b.id)}
              />
            );
          })
        )}
      </CollapsibleSection>

      <div className="h-3" />

      <CollapsibleSection
        title={showExpired ? "Мьюты" : "Активные мьюты"}
        icon="muted"
        accentVar="--kub-warn"
        count={visibleMutes.length}
        open={mutesOpen}
        setOpen={setMutesOpen}
      >
        {visibleMutes.length === 0 ? (
          <Empty text={showExpired ? "Мьютов не найдено" : "Активных мьютов нет"} />
        ) : (
          visibleMutes.map((m) => {
            const expired = isExpiredSanction(m, nowMs);
            return (
              <RowCard
                key={m.id}
                user={m.user as Profile | null | undefined}
                fallbackId={m.user_id}
                expired={!!expired}
                reason={m.reason}
                meta={`${m.chat ? `в «${m.chat.name ?? m.chat.id.slice(0, 8)}»` : "везде"} · ${m.issuer?.full_name ?? "—"} · ${fmt(m.created_at)} → ${fmt(m.expires_at)}`}
                onRemove={() => removeMute(m.id)}
              />
            );
          })
        )}
      </CollapsibleSection>

      {showExpired && (
        <>
          <div className="h-3" />
          <SanctionsHistory audit={audit} />
        </>
      )}
    </div>
  );
}

function SanctionsHistory({ audit }: { audit: ReturnType<typeof useAuditLogs> }) {
  const totalPages = Math.max(1, Math.ceil(audit.total / audit.pageSize));
  return (
    <KubPanel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[color:var(--kub-border-color)]">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] border border-[color:var(--kub-cyan)]/30">
          <KubIcon name="audit" size={13} tone="accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[color:var(--kub-text)]">Журнал санкций</div>
          <div className="text-[11px] text-[color:var(--kub-muted)]">
            Последние действия по банам и мьютам, включая снятые и истёкшие ограничения
          </div>
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          {audit.total}
        </span>
      </div>

      {audit.loading ? (
        <div className="flex items-center justify-center py-10">
          <KubIcon name="spinner" size={18} tone="accent" label="Загрузка" />
        </div>
      ) : audit.rows.length === 0 ? (
        <Empty text="История санкций пока пуста" />
      ) : (
        <div>
          {audit.rows.map((row) => (
            <SanctionHistoryRow key={row.id} row={row} />
          ))}
        </div>
      )}

      {!audit.loading && audit.total > audit.pageSize && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[color:var(--kub-border-color)] text-xs text-[color:var(--kub-muted)]">
          <span>Стр. {audit.page + 1} из {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              disabled={audit.page === 0}
              onClick={() => audit.setPage(Math.max(0, audit.page - 1))}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Предыдущая страница"
            >
              <KubIcon name="chevronLeft" size={16} />
            </button>
            <button
              disabled={audit.page + 1 >= totalPages}
              onClick={() => audit.setPage(audit.page + 1)}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Следующая страница"
            >
              <KubIcon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      )}
    </KubPanel>
  );
}

function SanctionHistoryRow({ row }: { row: AuditLogWithActor }) {
  const target = row.targetProfile;
  const chat = row.targetChat;
  const actor = row.actor;
  const reason = auditString(row, "reason");
  const expires = auditString(row, "expires_at");
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-t border-[color:var(--kub-border-color)]">
      {target ? (
        <UserAvatar user={target} size="sm" />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-[var(--kub-surface-2)]" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[color:var(--kub-text)]">
            {sanctionActionLabel(row.action as AuditAction)}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
            {fmt(row.created_at)}
          </span>
        </div>
        <div className="text-xs mt-0.5 break-words text-[color:var(--kub-text)]">
          К пользователю: {profileLabel(target, auditString(row, "target_user_id") ?? auditString(row, "user_id") ?? row.target_id)}
        </div>
        <div className="text-[11px] mt-1 break-words text-[color:var(--kub-muted)]">
          Назначил: {profileLabel(actor, row.actor_id)}
          {chat && <> · Чат: {chat.name ?? chat.id.slice(0, 8)}</>}
          {reason && <> · Причина: {reason}</>}
          {expires && <> · До: {fmt(expires)}</>}
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title, icon, accentVar, count, open, setOpen, children,
}: {
  title: string;
  icon: KubIconName;
  accentVar: string;
  count: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const accent = `var(${accentVar})`;
  return (
    <KubPanel className="overflow-hidden p-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 h-12 text-left hover:bg-[var(--kub-surface-2)] transition-colors"
      >
        <KubIcon name={open ? "chevronDown" : "chevronRight"} size={16} tone="muted" />
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 38%, transparent)` }}
        >
          <KubIcon name={icon} size={13} tone="default" />
        </div>
        <div className="flex-1 text-sm font-bold text-[color:var(--kub-text)]">
          {title}
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          {count}
        </span>
      </button>
      {open && <div>{children}</div>}
    </KubPanel>
  );
}

function isActiveSanction(row: Pick<Ban | Mute, "expires_at">): boolean {
  return !isExpiredSanction(row, Date.now());
}

function isExpiredSanction(row: Pick<Ban | Mute, "expires_at">, nowMs: number): boolean {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() <= nowMs);
}

function RowCard({
  user, fallbackId, expired, reason, meta, onRemove,
}: {
  user: Profile | null | undefined;
  fallbackId: string;
  expired: boolean;
  reason: string;
  meta: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-t border-[color:var(--kub-border-color)]">
      {user ? (
        <UserAvatar user={user as Profile} size="sm" />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-[var(--kub-surface-2)]" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[color:var(--kub-text)]">
          {user?.full_name ?? fallbackId.slice(0, 8)}
          {user?.username && (
            <span className="ml-2 text-xs font-normal text-[color:var(--kub-muted)]">
              @{user.username}
            </span>
          )}
          {expired && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
              истёк
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5 break-words text-[color:var(--kub-text)]">{reason}</div>
        <div className="text-[11px] mt-1 break-words text-[color:var(--kub-muted)]">{meta}</div>
      </div>
      <button
        onClick={onRemove}
        aria-label="Снять ограничение"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-[var(--kub-surface-2)] flex-shrink-0 text-[color:var(--kub-cyan)]"
      >
        <KubIcon name="rotate" size={12} />
        Снять
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-sm text-[color:var(--kub-muted)]">
      {text}
    </div>
  );
}

function sanctionActionLabel(action: AuditAction): string {
  switch (action) {
    case "ban_issued":
      return "Выдан бан";
    case "ban_lifted":
      return "Бан снят";
    case "mute_issued":
      return "Выдан мьют";
    case "mute_lifted":
      return "Мьют снят";
    default:
      return "Санкция";
  }
}

function profileLabel(profile: Pick<Profile, "id" | "full_name" | "username"> | null | undefined, fallbackId?: string | null): string {
  if (profile) return profile.full_name ?? (profile.username ? `@${profile.username}` : "Пользователь");
  return fallbackId ? "Пользователь не найден" : "не указан";
}

function auditString(row: AuditLogWithActor, key: string): string | null {
  const payload = row.diff;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
