"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { useNotifications } from "@/hooks/useNotifications";
import { KubIcon, KubTooltip } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/database";

/**
 * Bell button + popover for in-app notifications (Task #32).
 *
 * Lives in `SidebarHeader`. Shows an unread badge sourced from
 * `useNotifications()`; clicking opens a popover with the latest 30
 * items. Each item renders a Russian title built from `kind` +
 * `payload`, the relative time, and (when applicable) a "Прочитано"
 * marker. Clicking an item marks it read and navigates to the
 * related entity.
 */
export function NotificationBell() {
  const [, setLocation] = useLocation();
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) await markRead(n.id);
    setOpen(false);
    const target = navigateTarget(n);
    if (target?.kind === "chat" && target.chatId) {
      setSelectedChatId(target.chatId);
    } else if (target?.kind === "tasks") {
      setLocation("/tasks");
    } else if (target?.kind === "admin") {
      setLocation("/admin");
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <KubTooltip label="Уведомления" side="bottom">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "relative h-9 w-9 shrink-0 rounded-lg transition-colors hover:bg-[var(--kub-surface-2)]",
            "inline-flex items-center justify-center",
            unreadCount > 0 ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]",
          )}
          aria-label="Уведомления"
        >
          <KubIcon name="notifications" size={17} />
          {unreadCount > 0 && (
            <span className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1",
              "rounded-full text-[10px] font-bold leading-[16px] text-center",
              "bg-[color:var(--kub-cyan)] text-[color:var(--kub-bg)]",
              "shadow-[0_0_0_2px_var(--kub-bg)]",
            )}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </KubTooltip>

      {open && (
        <div className={cn(
          "absolute right-0 top-12 z-50 w-[340px] max-w-[calc(100vw-1rem)]",
          "rounded-xl shadow-2xl overflow-hidden",
          "bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft",
        )}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--kub-border-color)]">
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Уведомления</div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] font-medium text-[color:var(--kub-cyan)] hover:underline"
              >
                Отметить все как прочитанные
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[color:var(--kub-muted)]">
                Загрузка…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-[color:var(--kub-muted)]">
                Уведомлений пока нет
              </div>
            ) : (
              items.map((n) => (
                <NotificationItem key={n.id} item={n} onClick={() => handleClick(n)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ item, onClick }: { item: Notification; onClick: () => void }) {
  const text = formatNotification(item);
  const unread = !item.read_at;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 flex items-start gap-3",
        "border-b border-[color:var(--kub-border-color)] last:border-b-0",
        "transition-colors hover:bg-[var(--kub-surface-3)]",
        unread && "bg-[color-mix(in_srgb,var(--kub-cyan)_6%,transparent)]",
      )}
    >
      <div className={cn(
        "mt-1 flex-shrink-0 w-2 h-2 rounded-full",
        unread ? "bg-[color:var(--kub-cyan)]" : "bg-transparent",
      )} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[color:var(--kub-text)] leading-snug">{text}</div>
        <div className="mt-1 text-[11px] text-[color:var(--kub-muted)] flex items-center gap-2">
          <span>{formatRelative(item.created_at)}</span>
          {!unread && <span>· Прочитано</span>}
        </div>
      </div>
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function payloadString(p: unknown, key: string): string | undefined {
  if (!p || typeof p !== "object") return undefined;
  const v = (p as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function formatNotification(n: Notification): string {
  const title = payloadString(n.payload, "title");
  const chatName = payloadString(n.payload, "chat_name");
  const reason = payloadString(n.payload, "reason");
  switch (n.kind) {
    case "task_assigned":
      return title ? `Новая задача: «${title}»` : "Вам назначена задача";
    case "task_waiting_confirmation":
      return title ? `Задача «${title}» ждёт подтверждения` : "Задача ждёт подтверждения";
    case "task_confirmed":
      return title ? `Задача «${title}» подтверждена` : "Задача подтверждена";
    case "task_rejected":
      return title ? `Задача «${title}» отклонена` : "Задача отклонена";
    case "chat_added":
      return chatName ? `Вас добавили в чат «${chatName}»` : "Вас добавили в чат";
    case "mute_issued":
      return reason ? `Вам выдан мут: ${reason}` : "Вам выдан мут";
    case "ban_issued":
      return reason ? `Вы заблокированы: ${reason}` : "Вы заблокированы";
    default:
      return "Новое уведомление";
  }
}

function navigateTarget(n: Notification): { kind: "chat" | "tasks" | "admin"; chatId?: string } | null {
  switch (n.kind) {
    case "task_assigned":
    case "task_waiting_confirmation":
    case "task_confirmed":
    case "task_rejected":
      return { kind: "tasks" };
    case "chat_added": {
      const chatId = payloadString(n.payload, "chat_id");
      return chatId ? { kind: "chat", chatId } : null;
    }
    case "mute_issued": {
      const chatId = payloadString(n.payload, "chat_id");
      return chatId ? { kind: "chat", chatId } : null;
    }
    case "ban_issued":
      // Bans don't have a per-row screen — surface the admin panel
      // for staff and the profile/settings entry point for everyone
      // else (which is where account status is shown).
      return { kind: "admin" };
    default:
      return null;
  }
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} дн назад`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
