"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { KubIcon, KubTooltip, type KubIconName } from "@/components/kub";
import { useNotifications } from "@/hooks/useNotifications";
import { createClient } from "@/lib/supabase/client";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { showAppAlert } from "@/lib/appDialogs";
import { cn } from "@/lib/utils";
import { acceptGroupInvite, declineGroupInvite, parseGroupInvitePayload } from "@/lib/groupInvites";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import type { GroupInviteStatus } from "@/lib/groupInvites";
import type { Notification } from "@/types/database";

type NotificationTarget =
  | { kind: "chat"; chatId: string }
  | { kind: "message"; chatId: string; messageId: string }
  | { kind: "tasks"; taskId?: string }
  | { kind: "admin" }
  | { kind: "group_invite"; status: GroupInviteStatus; chatId?: string }
  | null;

type NotificationDisplay = {
  icon: KubIconName;
  title: string;
  body: string;
  typeLabel: string;
};

const TEXT_LIMIT = 140;
const PANEL_MARGIN = 8;
const DESKTOP_PANEL_WIDTH = 430;
const MIN_PANEL_WIDTH = 280;
const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 520;

type NotificationPanelStyle = Pick<CSSProperties, "left" | "top" | "width" | "maxHeight">;

export function NotificationBell() {
  const [, setLocation] = useLocation();
  const { items, unreadCount, loading, error, markRead, markAllRead, refresh } = useNotifications();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [inviteStatuses, setInviteStatuses] = useState<Record<string, GroupInviteStatus>>({});
  const [panelStyle, setPanelStyle] = useState<NotificationPanelStyle | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePanelPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const anchor = buttonRef.current;
    if (!anchor) return;

    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const anchorRect = anchor.getBoundingClientRect();
    const isMobile = viewportWidth < 640;
    const safeWidth = Math.max(0, viewportWidth - PANEL_MARGIN * 2);
    const width = Math.min(Math.max(MIN_PANEL_WIDTH, isMobile ? safeWidth : DESKTOP_PANEL_WIDTH), safeWidth);

    const desiredLeft = isMobile
      ? viewportLeft + PANEL_MARGIN
      : viewportLeft + anchorRect.right - width;
    const minLeft = viewportLeft + PANEL_MARGIN;
    const maxLeft = viewportLeft + viewportWidth - width - PANEL_MARGIN;
    const left = Math.min(Math.max(desiredLeft, minLeft), Math.max(minLeft, maxLeft));

    const preferredTop = viewportTop + anchorRect.bottom + 8;
    const spaceBelow = viewportTop + viewportHeight - preferredTop - PANEL_MARGIN;
    const canFlipAbove = spaceBelow < 260 && anchorRect.top > viewportHeight / 2;
    const desiredMaxHeight = Math.min(MAX_PANEL_HEIGHT, viewportHeight - PANEL_MARGIN * 2);
    let top = preferredTop;
    let maxHeight = Math.min(desiredMaxHeight, spaceBelow);

    if (canFlipAbove) {
      maxHeight = Math.min(desiredMaxHeight, anchorRect.top - PANEL_MARGIN * 2);
      top = viewportTop + anchorRect.top - maxHeight - 8;
    }

    if (maxHeight < MIN_PANEL_HEIGHT) {
      top = viewportTop + PANEL_MARGIN;
      maxHeight = Math.min(desiredMaxHeight, viewportHeight - PANEL_MARGIN * 2);
    }

    setPanelStyle({
      left,
      top: Math.max(viewportTop + PANEL_MARGIN, top),
      width,
      maxHeight: Math.max(MIN_PANEL_HEIGHT, maxHeight),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    let frame = 0;
    const schedulePositionUpdate = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePanelPosition);
    };
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.visualViewport?.addEventListener("resize", schedulePositionUpdate);
    window.visualViewport?.addEventListener("scroll", schedulePositionUpdate);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      window.visualViewport?.removeEventListener("resize", schedulePositionUpdate);
      window.visualViewport?.removeEventListener("scroll", schedulePositionUpdate);
    };
  }, [open, updatePanelPosition]);

  const handleNotificationClick = async (item: Notification) => {
    if (!item.read_at) await markRead(item.id);
    const target = navigateTarget(item, inviteStatuses);

    if (target?.kind === "chat" || target?.kind === "message") {
      setOpen(false);
      const opened = await safeOpenChat(target.chatId);
      if (opened && target.kind === "message") {
        window.setTimeout(() => requestChatMessageJump(target.chatId, target.messageId), 150);
      }
      if (opened) setLocation("/");
      return;
    }

    if (target?.kind === "tasks") {
      setOpen(false);
      setLocation(target.taskId ? `/tasks?task=${encodeURIComponent(target.taskId)}` : "/tasks");
      return;
    }

    if (target?.kind === "admin") {
      setOpen(false);
      setLocation("/admin");
      return;
    }

    if (target?.kind === "group_invite") {
      if (target.status === "accepted" && target.chatId) {
        setOpen(false);
        const opened = await safeOpenChat(target.chatId);
        if (opened) setLocation("/");
        return;
      }
      showInviteStatusNotice(target.status);
    }
  };

  const handleAcceptInvite = async (item: Notification) => {
    const payload = parseGroupInvitePayload(item.payload);
    if (!payload.invite_id) {
      showAppAlert("Приглашение недоступно.", "Приглашение");
      return;
    }
    setBusyInviteId(payload.invite_id);
    const result = await acceptGroupInvite(supabase, payload.invite_id);
    setBusyInviteId(null);

    if (!result.ok) {
      showAppAlert(result.message, "Приглашение");
      return;
    }

    setInviteStatuses((current) => ({ ...current, [payload.invite_id!]: "accepted" }));
    await markRead(item.id);
    dispatchChatsRefresh({ reason: "chat-notification", chatId: result.data });
    await refresh();
    const opened = await safeOpenChat(result.data);
    if (opened) {
      setOpen(false);
      setLocation("/");
    } else {
      showAppAlert("Приглашение принято. Чат появится после обновления списка.", "Приглашение", "checkCircle");
    }
  };

  const handleDeclineInvite = async (item: Notification) => {
    const payload = parseGroupInvitePayload(item.payload);
    if (!payload.invite_id) {
      showAppAlert("Приглашение недоступно.", "Приглашение");
      return;
    }
    setBusyInviteId(payload.invite_id);
    const result = await declineGroupInvite(supabase, payload.invite_id);
    setBusyInviteId(null);

    if (!result.ok) {
      showAppAlert(result.message, "Приглашение");
      return;
    }

    setInviteStatuses((current) => ({ ...current, [payload.invite_id!]: "declined" }));
    await markRead(item.id);
    await refresh();
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <KubTooltip label="Уведомления" side="bottom">
        <button
          ref={buttonRef}
          onClick={() => {
            if (!open) updatePanelPosition();
            setOpen((v) => !v);
          }}
          className={cn(
            "relative h-9 w-9 shrink-0 rounded-lg transition-colors hover:bg-[var(--kub-surface-2)]",
            "inline-flex items-center justify-center",
            unreadCount > 0 ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]",
          )}
          aria-label="Уведомления"
          aria-expanded={open}
        >
          <KubIcon name="notifications" size={17} />
          {unreadCount > 0 && (
            <span className={cn(
              "absolute -top-0.5 -right-0.5 h-[16px] min-w-[16px] px-1",
              "rounded-full text-center text-[10px] font-bold leading-[16px]",
              "bg-[color:var(--kub-cyan)] text-[color:var(--kub-bg)]",
              "shadow-[0_0_0_2px_var(--kub-bg)]",
            )}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </KubTooltip>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={panelStyle ?? undefined}
          className={cn(
            "fixed z-[60] flex max-w-[calc(100vw-16px)] flex-col",
            "overflow-hidden rounded-2xl border border-[color:var(--kub-border-color)]",
            "bg-[var(--kub-surface)] shadow-2xl kub-glow-soft",
          )}
          data-kub-popover="true"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--kub-border-color)] px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">Уведомления</div>
              <div className="text-[11px] text-[color:var(--kub-muted)]">
                {unreadCount > 0 ? `${unreadCount} непрочит.` : "Все прочитаны"}
              </div>
            </div>
            <button
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-cyan)] transition-colors hover:bg-[var(--kub-surface-2)] disabled:cursor-not-allowed disabled:text-[color:var(--kub-muted)]"
            >
              Прочитать все
            </button>
          </div>

          {error && (
            <div className="mx-3 mt-3 rounded-xl border border-[color:var(--kub-danger)]/35 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger)]">
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && items.length === 0 ? (
              <NotificationState icon="spinner" title="Загрузка уведомлений" body="Обновляем последние события." />
            ) : items.length === 0 ? (
              <NotificationState icon="notifications" title="Уведомлений пока нет" body="Новые события появятся здесь." />
            ) : (
              <div className="space-y-1.5">
                {items.map((item) => {
                  const payload = parseGroupInvitePayload(item.payload);
                  const effectiveStatus = payload.invite_id
                    ? inviteStatuses[payload.invite_id] ?? payload.status
                    : payload.status;
                  return (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      inviteStatus={effectiveStatus}
                      busyInviteId={busyInviteId}
                      onClick={() => void handleNotificationClick(item)}
                      onAccept={() => void handleAcceptInvite(item)}
                      onDecline={() => void handleDeclineInvite(item)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function NotificationItem({
  item,
  inviteStatus,
  busyInviteId,
  onClick,
  onAccept,
  onDecline,
}: {
  item: Notification;
  inviteStatus?: GroupInviteStatus;
  busyInviteId: string | null;
  onClick: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const unread = !item.read_at;
  const display = formatNotification(item, inviteStatus);
  const invitePayload = parseGroupInvitePayload(item.payload);
  const isPendingInvite = item.kind === "group_invite" && (inviteStatus ?? invitePayload.status ?? "pending") === "pending";
  const inviteBusy = Boolean(invitePayload.invite_id && busyInviteId === invitePayload.invite_id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "group max-w-full rounded-xl border px-3 py-3 text-left transition-colors",
        "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)]",
        unread && "border-[color-mix(in_srgb,var(--kub-cyan)_45%,var(--kub-border-color))] bg-[color-mix(in_srgb,var(--kub-cyan)_7%,var(--kub-surface-2))]",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          unread
            ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-cyan)]"
            : "bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]",
        )}>
          <KubIcon name={display.icon} size={17} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[color:var(--kub-text)] [overflow-wrap:anywhere]">
                {display.title}
              </div>
              <div className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-[color:var(--kub-muted)] [overflow-wrap:anywhere]">
                {display.body}
              </div>
            </div>
            {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[color:var(--kub-cyan)]" />}
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--kub-muted)]">
            <span>{display.typeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRelative(item.created_at)}</span>
            {!unread && (
              <>
                <span aria-hidden="true">·</span>
                <span>Прочитано</span>
              </>
            )}
          </div>

          {isPendingInvite && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept();
                }}
                disabled={inviteBusy}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Принять
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDecline();
                }}
                disabled={inviteBusy}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-[color:var(--kub-border-color)] px-3 text-xs font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отклонить
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationState({ icon, title, body }: { icon: KubIconName; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]">
        <KubIcon name={icon} size={20} />
      </div>
      <div className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</div>
      <div className="mt-1 max-w-64 text-xs leading-snug text-[color:var(--kub-muted)]">{body}</div>
    </div>
  );
}

function payloadString(p: unknown, key: string): string | undefined {
  if (!p || typeof p !== "object") return undefined;
  const value = (p as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatNotification(item: Notification, inviteStatus?: GroupInviteStatus): NotificationDisplay {
  const title = payloadString(item.payload, "title");
  const chatName = payloadString(item.payload, "chat_name");
  const reason = payloadString(item.payload, "reason");
  const actor = payloadString(item.payload, "actor_name") ?? payloadString(item.payload, "inviter_name");
  const sender = payloadString(item.payload, "sender_name");
  const preview = payloadString(item.payload, "preview");
  const body = sanitizeBody(
    preview ??
    payloadString(item.payload, "body") ??
    payloadString(item.payload, "message") ??
    payloadString(item.payload, "content") ??
    payloadString(item.payload, "text"),
  );

  switch (item.kind) {
    case "task_assigned":
      return {
        icon: "tasks",
        typeLabel: "Задача",
        title: "Новая задача",
        body: title ? `«${truncateText(title)}» назначена вам` : "Вам назначена задача.",
      };
    case "task_waiting_confirmation":
      return {
        icon: "tasks",
        typeLabel: "Задача",
        title: "Ожидает подтверждения",
        body: title ? `«${truncateText(title)}» ждёт подтверждения` : "Задача ждёт подтверждения.",
      };
    case "task_confirmed":
      return {
        icon: "checkCircle",
        typeLabel: "Задача",
        title: "Задача подтверждена",
        body: title ? `«${truncateText(title)}» подтверждена` : "Задача подтверждена.",
      };
    case "task_rejected":
      return {
        icon: "reject",
        typeLabel: "Задача",
        title: "Задача отклонена",
        body: title ? `«${truncateText(title)}» отклонена` : "Задача отклонена.",
      };
    case "chat_added":
      return {
        icon: "chatRect",
        typeLabel: "Чат",
        title: "Новый чат",
        body: chatName ? `Вас добавили в «${truncateText(chatName)}»` : "Вас добавили в чат.",
      };
    case "group_invite": {
      const invite = parseGroupInvitePayload(item.payload);
      const status = inviteStatus ?? invite.status ?? "pending";
      return {
        icon: "group",
        typeLabel: "Приглашение",
        title: groupInviteTitle(status),
        body: groupInviteBody(status, actor, invite.chat_name),
      };
    }
    case "mute_issued":
      return {
        icon: "muted",
        typeLabel: "Система",
        title: "Выдан мут",
        body: reason ? truncateText(reason) : "Ограничение применено к вашему аккаунту.",
      };
    case "ban_issued":
      return {
        icon: "ban",
        typeLabel: "Система",
        title: "Аккаунт заблокирован",
        body: reason ? truncateText(reason) : "Доступ ограничен администратором.",
      };
    default:
      if (item.kind.includes("message")) {
        return {
          icon: "chatBubble",
          typeLabel: "Сообщение",
          title: sender ? truncateText(sender) : "Новое сообщение",
          body: chatName && body
            ? `${truncateText(chatName, 54)}: ${truncateText(body)}`
            : body || "Откройте чат, чтобы посмотреть сообщение.",
        };
      }
      if (item.kind.includes("task")) {
        return {
          icon: "tasks",
          typeLabel: "Задача",
          title: "Обновление задачи",
          body: title ? truncateText(title) : body || "Есть изменение по задаче.",
        };
      }
      if (item.kind.includes("chat")) {
        return {
          icon: "chatRect",
          typeLabel: "Чат",
          title: "Обновление чата",
          body: chatName ? truncateText(chatName) : body || "Есть изменение в чате.",
        };
      }
      return {
        icon: "notifications",
        typeLabel: "Система",
        title: "Новое уведомление",
        body: body || "Откройте уведомление, чтобы посмотреть детали.",
      };
  }
}

function navigateTarget(item: Notification, localStatuses: Record<string, GroupInviteStatus>): NotificationTarget {
  switch (item.kind) {
    case "task_assigned":
    case "task_waiting_confirmation":
    case "task_confirmed":
    case "task_rejected": {
      const taskId = payloadString(item.payload, "task_id");
      return { kind: "tasks", taskId };
    }
    case "chat_added":
    case "mute_issued": {
      const chatId = payloadString(item.payload, "chat_id");
      return chatId ? { kind: "chat", chatId } : null;
    }
    case "group_invite": {
      const payload = parseGroupInvitePayload(item.payload);
      const status = payload.invite_id ? localStatuses[payload.invite_id] ?? payload.status ?? "pending" : payload.status ?? "pending";
      return { kind: "group_invite", status, chatId: payload.chat_id };
    }
    case "ban_issued":
      return { kind: "admin" };
    default: {
      const chatId = payloadString(item.payload, "chat_id");
      const messageId = payloadString(item.payload, "message_id");
      if (chatId && messageId && item.kind.includes("message")) return { kind: "message", chatId, messageId };
      if (chatId) return { kind: "chat", chatId };
      const taskId = payloadString(item.payload, "task_id");
      if (taskId || item.kind.includes("task")) return { kind: "tasks", taskId };
      return null;
    }
  }
}

function showInviteStatusNotice(status: GroupInviteStatus) {
  if (status === "pending") return;
  const message =
    status === "accepted"
      ? "Приглашение уже принято."
      : status === "declined"
        ? "Приглашение отклонено."
        : status === "cancelled"
          ? "Приглашение уже недоступно."
          : "Срок действия приглашения истёк.";
  showAppAlert(message, "Приглашение");
}

function groupInviteTitle(status: GroupInviteStatus): string {
  switch (status) {
    case "accepted":
      return "Приглашение принято";
    case "declined":
      return "Приглашение отклонено";
    case "cancelled":
      return "Приглашение недоступно";
    case "expired":
      return "Приглашение истекло";
    default:
      return "Приглашение в группу";
  }
}

function groupInviteBody(status: GroupInviteStatus, inviter?: string, chatName?: string): string {
  const actor = inviter ? truncateText(inviter, 48) : "Администратор";
  const chat = chatName ? `«${truncateText(chatName, 70)}»` : "группу";
  if (status === "accepted") return `Вы вступили в ${chat}.`;
  if (status === "declined") return `Вы отклонили приглашение в ${chat}.`;
  if (status === "cancelled") return `Приглашение в ${chat} отменено или недоступно.`;
  if (status === "expired") return `Приглашение в ${chat} больше не активно.`;
  return `${actor} приглашает вас в ${chat}.`;
}

function sanitizeBody(value?: string): string {
  if (!value) return "";
  const withoutMediaUrls = value.replace(/https?:\/\/\S+/gi, (url) => {
    if (/\.(png|jpe?g|webp|gif|mp4|mov|mp3|wav|ogg|pdf|zip)(\?|$)/i.test(url)) return "вложение";
    return "ссылка";
  });
  return truncateText(withoutMediaUrls.replace(/\s+/g, " ").trim());
}

function truncateText(value: string, limit = TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
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
