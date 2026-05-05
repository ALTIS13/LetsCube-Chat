"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubBadge, KubButton, KubIcon, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useAuditLogs, type AuditFilters } from "@/hooks/useAuditLogs";
import { useIsAdmin } from "@/hooks/useRole";
import type {
  AuditAction,
  AuditLogWithActor,
  Json,
  Profile,
} from "@/types/database";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const ACTION_LABEL: Record<AuditAction, string> = {
  role_change: "Смена роли",
  ban_issued: "Выдан бан",
  ban_lifted: "Снят бан",
  mute_issued: "Выдан мьют",
  mute_lifted: "Снят мьют",
  chat_member_added: "Добавлен участник",
  chat_member_role_changed: "Изменена роль участника",
  chat_member_removed: "Удалён участник",
  folder_deleted: "Удалена папка",
  task_status_change: "Смена статуса задачи",
  message_deleted_by_staff: "Удалено сообщение",
};

const ACTION_OPTIONS: AuditAction[] = [
  "role_change",
  "ban_issued",
  "ban_lifted",
  "mute_issued",
  "mute_lifted",
  "chat_member_added",
  "chat_member_role_changed",
  "chat_member_removed",
  "folder_deleted",
  "task_status_change",
  "message_deleted_by_staff",
];

const ROLE_RU: Record<string, string> = {
  admin: "администратора",
  manager: "менеджера",
  user: "пользователя",
};

const CHAT_ROLE_RU: Record<string, string> = {
  owner: "владельца",
  admin: "администратора",
  member: "участника",
};

const TASK_STATUS_RU: Record<string, string> = {
  new: "новая",
  assigned: "назначена",
  accepted: "принята",
  in_progress: "в работе",
  waiting_confirmation: "ждёт подтверждения",
  confirmed: "подтверждена",
  rejected: "отклонена",
  cancelled: "отменена",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function actorName(p?: Profile | null, fallbackId?: string | null): string {
  if (p) return p.full_name ?? (p.username ? `@${p.username}` : p.id.slice(0, 8));
  if (fallbackId) return fallbackId.slice(0, 8) + "…";
  return "Система";
}

function jsonStr(payload: Json | null | undefined, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const v = (payload as Record<string, unknown>)[key];
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function describe(row: AuditLogWithActor): string {
  const p = row.diff as Record<string, unknown> | null;
  const get = (k: string) => (p && typeof p === "object" ? (p[k] as unknown) : null);
  const actor = actorName(row.actor, row.actor_id);
  switch (row.action) {
    case "role_change": {
      const from = ROLE_RU[String(get("from") ?? "")] ?? String(get("from") ?? "—");
      const to   = ROLE_RU[String(get("to") ?? "")] ?? String(get("to") ?? "—");
      return `${actor} изменил роль с ${from} на ${to}`;
    }
    case "ban_issued": {
      const reason = jsonStr(row.diff, "reason");
      return reason
        ? `${actor} выдал бан · «${reason}»`
        : `${actor} выдал бан`;
    }
    case "ban_lifted":
      return `${actor} снял бан`;
    case "mute_issued": {
      const reason = jsonStr(row.diff, "reason");
      return reason
        ? `${actor} выдал мьют · «${reason}»`
        : `${actor} выдал мьют`;
    }
    case "mute_lifted":
      return `${actor} снял мьют`;
    case "chat_member_added":
      return `${actor} добавил участника`;
    case "chat_member_role_changed": {
      const from = CHAT_ROLE_RU[String(get("from") ?? "")] ?? String(get("from") ?? "—");
      const to   = CHAT_ROLE_RU[String(get("to") ?? "")] ?? String(get("to") ?? "—");
      return `${actor} изменил роль участника с ${from} на ${to}`;
    }
    case "chat_member_removed":
      return `${actor} удалил участника`;
    case "folder_deleted": {
      const name = jsonStr(row.diff, "name") ?? "(без названия)";
      const scope = String(get("scope") ?? "");
      const scopeRu = scope === "shared" ? "общую" : scope === "system" ? "системную" : "";
      return `${actor} удалил ${scopeRu ? scopeRu + " " : ""}папку «${name}»`;
    }
    case "task_status_change": {
      const from = TASK_STATUS_RU[String(get("from") ?? "")] ?? String(get("from") ?? "—");
      const to   = TASK_STATUS_RU[String(get("to") ?? "")] ?? String(get("to") ?? "—");
      const title = jsonStr(row.diff, "title");
      return title
        ? `${actor} перевёл задачу «${title}»: ${from} → ${to}`
        : `${actor} сменил статус задачи: ${from} → ${to}`;
    }
    case "message_deleted_by_staff":
      return `${actor} удалил чужое сообщение`;
    default:
      return `${actor}: ${row.action}`;
  }
}

export function AuditTab() {
  const supabase = createClient();
  const isAdmin = useIsAdmin();

  // ── filters ──────────────────────────────────────────────────────────────
  const [actorQueryRaw, setActorQueryRaw] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [actorOptions, setActorOptions] = useState<Profile[]>([]);
  const [actorPicked, setActorPicked] = useState<Profile | null>(null);
  const [actionsSel, setActionsSel] = useState<AuditAction[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setActorQuery(actorQueryRaw.trim()), SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [actorQueryRaw]);

  // Resolve actor search → profile list (only when no profile is picked).
  useEffect(() => {
    if (actorPicked || actorQuery.length === 0) {
      setActorOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Strip every PostgREST `.or()` separator and every Postgres
      // `ilike` wildcard so a user typing `_` or `[abc]` doesn't get
      // unexpected matches and so a `,` / `(` / `)` doesn't break the
      // `.or(...)` filter parser.
      const safe = actorQuery.replace(/[%_,()[\]]/g, "");
      const { data } = await supabase
        .from("profiles")
        .select("id,full_name,username,avatar_url,role,bio,online_at,created_at,updated_at")
        .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`)
        .limit(8);
      if (!cancelled) setActorOptions((data ?? []) as Profile[]);
    })();
    return () => { cancelled = true; };
  }, [supabase, actorQuery, actorPicked]);

  const filters: AuditFilters = useMemo(
    () => ({
      actorId: actorPicked?.id ?? null,
      actions: actionsSel.length > 0 ? actionsSel : null,
      fromIso: fromDate ? new Date(fromDate + "T00:00:00").toISOString() : null,
      toIso:   toDate   ? new Date(toDate   + "T23:59:59.999").toISOString() : null,
    }),
    [actorPicked, actionsSel, fromDate, toDate],
  );

  const { rows, total, loading, error, page, pageSize, setPage, refresh } =
    useAuditLogs(filters, PAGE_SIZE);

  if (!isAdmin) {
    return (
      <KubPanel className="text-center py-16 px-6">
        <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-3 bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)] border border-[color:var(--kub-cyan)]/30">
          <KubIcon name="shield" size={22} tone="accent" />
        </div>
        <div className="text-sm font-semibold text-[color:var(--kub-text)]">
          Журнал доступен только администраторам
        </div>
        <div className="text-xs mt-1 text-[color:var(--kub-muted)]">
          Менеджеры не имеют доступа к аудит-логу
        </div>
      </KubPanel>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleAction = (a: AuditAction) => {
    setActionsSel((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const resetFilters = () => {
    setActorPicked(null);
    setActorQueryRaw("");
    setActorQuery("");
    setActionsSel([]);
    setFromDate("");
    setToDate("");
  };

  const hasActiveFilters = !!actorPicked || actionsSel.length > 0 || !!fromDate || !!toDate;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Журнал действий{" "}
          <span className="text-sm font-normal text-[color:var(--kub-muted)]">· {total}</span>
        </h2>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"
          aria-label="Обновить"
        >
          <KubIcon name="rotate" size={13} /> Обновить
        </button>
      </div>

      <KubPanel className="p-3 mb-3 space-y-2.5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div className="relative">
            <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">Действующее лицо</div>
            {actorPicked ? (
              <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-cyan)]/40">
                <UserAvatar user={actorPicked} size="sm" />
                <span className="flex-1 text-sm truncate text-[color:var(--kub-text)]">
                  {actorPicked.full_name ?? actorPicked.username ?? actorPicked.id.slice(0, 8)}
                </span>
                <button
                  onClick={() => { setActorPicked(null); setActorQueryRaw(""); }}
                  className="p-1 rounded hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]"
                  aria-label="Сбросить"
                >
                  <KubIcon name="close" size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)]">
                <KubIcon name="search" size={13} tone="muted" />
                <input
                  value={actorQueryRaw}
                  onChange={(e) => setActorQueryRaw(e.target.value)}
                  placeholder="Имя или @username"
                  className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
                />
              </div>
            )}
            {!actorPicked && actorOptions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl py-1 max-h-72 overflow-y-auto bg-[var(--kub-surface)] border border-[color:var(--kub-border-color)] shadow-lg">
                {actorOptions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setActorPicked(p); setActorQueryRaw(""); setActorOptions([]); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--kub-surface-2)] text-left"
                  >
                    <UserAvatar user={p} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate text-[color:var(--kub-text)]">
                        {p.full_name ?? "Без имени"}
                      </div>
                      <div className="text-[11px] truncate text-[color:var(--kub-muted)]">
                        {p.username ? `@${p.username}` : p.id.slice(0, 8)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">Тип события</div>
            <button
              onClick={() => setActionsOpen((v) => !v)}
              aria-expanded={actionsOpen}
              className="w-full flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] hover:border-[color:var(--kub-cyan)]/60 text-left"
            >
              <span className="flex-1 text-sm truncate text-[color:var(--kub-text)]">
                {actionsSel.length === 0
                  ? "Все типы"
                  : actionsSel.length === 1
                    ? ACTION_LABEL[actionsSel[0]]
                    : `Выбрано: ${actionsSel.length}`}
              </span>
              <KubIcon name={actionsOpen ? "chevronUp" : "chevronDown"} size={13} tone="muted" />
            </button>
            {actionsOpen && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl py-1 max-h-72 overflow-y-auto bg-[var(--kub-surface)] border border-[color:var(--kub-border-color)] shadow-lg">
                {ACTION_OPTIONS.map((a) => {
                  const checked = actionsSel.includes(a);
                  return (
                    <button
                      key={a}
                      onClick={() => toggleAction(a)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--kub-surface-2)] text-left"
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border",
                          checked
                            ? "bg-[var(--kub-cyan)] border-[color:var(--kub-cyan)]"
                            : "border-[color:var(--kub-border-color)]",
                        )}
                      >
                        {checked && <KubIcon name="check" size={10} tone="default" />}
                      </span>
                      <span className="text-sm text-[color:var(--kub-text)]">{ACTION_LABEL[a]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">Дата с</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-sm text-[color:var(--kub-text)] focus:outline-none focus:border-[color:var(--kub-cyan)]"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">Дата по</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-sm text-[color:var(--kub-text)] focus:outline-none focus:border-[color:var(--kub-cyan)]"
            />
          </div>
          <div className="flex items-end">
            <KubButton
              variant="secondary"
              size="md"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              fullWidth
              leftIcon={<KubIcon name="close" size={13} />}
            >
              Сбросить фильтры
            </KubButton>
          </div>
        </div>
      </KubPanel>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs mb-3 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}

      <KubPanel className="overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <KubIcon name="spinner" size={20} tone="accent" label="Загрузка" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-3 bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)] border border-[color:var(--kub-cyan)]/30">
              <KubIcon name="audit" size={22} tone="accent" />
            </div>
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Записей не найдено</div>
            <div className="text-xs mt-1 text-[color:var(--kub-muted)]">
              {hasActiveFilters ? "Попробуйте сбросить фильтры" : "Здесь появятся действия администраторов"}
            </div>
          </div>
        ) : (
          <div>
            {rows.map((r, i) => {
              const isOpen = !!expanded[r.id];
              return (
                <div
                  key={r.id}
                  className={cn(
                    "px-3 py-3",
                    i > 0 && "border-t border-[color:var(--kub-border-color)]",
                  )}
                >
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                    className="w-full flex items-start gap-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {r.actor ? (
                        <UserAvatar user={r.actor} size="sm" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
                          <KubIcon name="settings" size={14} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <KubBadge tone="cyan">
                          {ACTION_LABEL[r.action as AuditAction] ?? r.action}
                        </KubBadge>
                        <span className="text-[11px] text-[color:var(--kub-muted)]">
                          {fmtDateTime(r.created_at)}
                        </span>
                      </div>
                      <div className="text-sm mt-1 text-[color:var(--kub-text)] break-words">
                        {describe(r)}
                      </div>
                    </div>
                    <KubIcon
                      name={isOpen ? "chevronUp" : "chevronDown"}
                      size={14}
                      tone="muted"
                      className="mt-1 flex-shrink-0"
                    />
                  </button>
                  {isOpen && (
                    <div className="mt-3 sm:ml-12 rounded-xl p-3 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] space-y-1.5 text-xs">
                      <KvRow label="ID записи" value={r.id} mono />
                      <KvRow label="Тип объекта" value={r.target_kind} />
                      <KvRow label="ID объекта" value={r.target_id ?? "—"} mono />
                      <KvRow label="Действующее лицо" value={actorName(r.actor, r.actor_id)} />
                      <div>
                        <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">
                          Данные изменения
                        </div>
                        <pre className="font-mono text-[11px] whitespace-pre-wrap break-words rounded-lg p-2 bg-[var(--kub-surface)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]">
{JSON.stringify(r.diff, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </KubPanel>

      {!loading && total > pageSize && (
        <div className="flex items-center justify-between mt-3 text-xs text-[color:var(--kub-muted)]">
          <span>Стр. {page + 1} из {totalPages} · {pageSize} на странице</span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(Math.max(0, page - 1))}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Предыдущая страница"
            >
              <KubIcon name="chevronLeft" size={16} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(page + 1)}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-2)] disabled:opacity-30 hover:text-[color:var(--kub-cyan)]"
              aria-label="Следующая страница"
            >
              <KubIcon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <div className="sm:w-32 flex-shrink-0 text-[10px] uppercase tracking-wider pt-0.5 text-[color:var(--kub-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "flex-1 min-w-0 break-words text-[color:var(--kub-text)]",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </div>
    </div>
  );
}
