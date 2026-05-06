"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubTooltip, KubIcon, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { prefixError } from "@/lib/errors";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatHeaderProps {
  chatId: string;
  chat?: ChatWithLastMessage;
  onSearchOpen?: () => void;
  onInfoOpen?: () => void;
  onClearForMe?: () => Promise<{ ok: boolean; error: string | null }>;
}

export function ChatHeader({ chatId, chat, onSearchOpen, onInfoOpen, onClearForMe }: ChatHeaderProps) {
  const { chats, setChats, setSelectedChatId, mutedChatIds, toggleMutedChat, currentUser } = useAppStore();
  const supabase = createClient();
  const [showMenu, setShowMenu] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const isMuted = mutedChatIds.includes(chatId);

  const display = chat
    ? getChatDisplayInfo(chat, currentUser?.id ?? null)
    : { title: "Чат", subtitle: "", typeLabel: "Чат", isSaved: false };
  const name = display.title;
  const type = chat?.type ?? "private";
  const isGroup = !display.isSaved && (type === "group" || type === "channel");
  const myRole =
    (chat?.members?.find((member) => member.user_id === currentUser?.id)?.role as
      | "owner"
      | "admin"
      | "member"
      | undefined) ?? null;
  const canDeleteGroup = isGroup && myRole === "owner";
  const canHidePrivateChat = !!chat && chat.type === "private" && !display.isSaved;
  const isPinned = Boolean(chat?.is_pinned);

  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShowMenu(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMenu]);

  const handleDeleteGroup = async () => {
    if (!canDeleteGroup || deletingChat) return;
    if (!confirm("Удалить групповой чат?\n\nЭто действие нельзя отменить.")) return;

    setDeletingChat(true);
    const { data, error } = await supabase
      .from("chats")
      .delete()
      .eq("id", chatId)
      .select("id")
      .maybeSingle();
    setDeletingChat(false);

    if (error) {
      console.error("delete group chat failed:", error);
      alert(prefixError("Недостаточно прав для удаления этого чата", error));
      return;
    }

    if (!data) {
      alert("Недостаточно прав для удаления этого чата.");
      return;
    }

    setChats(chats.filter((item) => item.id !== chatId));
    setSelectedChatId(null);
    setShowMenu(false);
  };

  const handlePinToggle = async () => {
    if (!chat) return;
    const rpcName = isPinned ? "unpin_chat" : "pin_chat";
    const { error } = await supabase.rpc(rpcName, { p_chat_id: chatId });
    if (error) {
      alert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error));
      return;
    }
    setChats(chats.map((item) =>
      item.id === chatId
        ? { ...item, is_pinned: !isPinned, pinned_at: isPinned ? null : new Date().toISOString() }
        : item
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId });
    setShowMenu(false);
  };

  const handleClearForMe = async () => {
    if (!onClearForMe) return;
    const title = display.isSaved ? "Очистить избранное у себя?" : "Очистить историю у себя?";
    const body = "Сообщения будут скрыты только для вас. У других участников они останутся.";
    if (!confirm(`${title}\n\n${body}`)) return;
    const result = await onClearForMe();
    if (!result.ok) {
      alert(result.error ?? "Не удалось очистить историю у себя.");
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId });
    setShowMenu(false);
  };

  const handleHidePrivateChat = async () => {
    if (!canHidePrivateChat) return;
    if (!confirm("Удалить чат у себя?\n\nЧат исчезнет только из вашего списка. У собеседника история останется.")) return;
    const { error } = await supabase.rpc("hide_private_chat", { p_chat_id: chatId });
    if (error) {
      alert(prefixError("Не удалось удалить чат у себя", error));
      return;
    }
    setChats(chats.filter((item) => item.id !== chatId));
    setSelectedChatId(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId });
    setShowMenu(false);
  };

  const getSubtitle = () => {
    if (!chat) return "";
    if (display.isSaved) return display.subtitle;
    if (type === "channel") return `${(chat.members?.length ?? 0) || "?"} подписчиков`;
    if (type === "group") return `${chat.members?.length ?? 0} участников`;
    const other = chat.other_user as { online_at?: string } | undefined;
    if (other?.online_at) {
      const diff = Date.now() - new Date(other.online_at).getTime();
      if (diff < 3 * 60_000) return "в сети";
      const mins = Math.floor(diff / 60_000);
      if (mins < 60) return `был(а) ${mins} мин назад`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `был(а) ${hours} ч назад`;
      return "был(а) недавно";
    }
    return "";
  };

  const subtitle = getSubtitle();
  const isOnline = subtitle === "в сети";

  const menuItems: Array<{ icon: KubIconName; label: string; danger?: boolean; disabled?: boolean; action: () => void }> = [
    { icon: "search", label: "Поиск в чате", action: () => { setShowMenu(false); onSearchOpen?.(); } },
    { icon: isPinned ? "pinOff" : "pin", label: isPinned ? "Открепить чат" : "Закрепить чат", action: handlePinToggle },
    { icon: "notifications", label: isMuted ? "Включить уведомления" : "Отключить уведомления", action: () => { toggleMutedChat(chatId); setShowMenu(false); } },
    ...(onClearForMe
      ? [{ icon: "delete" as KubIconName, label: display.isSaved ? "Очистить избранное у себя" : "Очистить историю у себя", danger: true, action: handleClearForMe }]
      : []),
    ...(canHidePrivateChat
      ? [{ icon: "logout" as KubIconName, label: "Удалить чат у себя", danger: true, action: handleHidePrivateChat }]
      : []),
    ...(canDeleteGroup
      ? [{ icon: "userRemove" as KubIconName, label: "Удалить групповой чат", danger: true, disabled: deletingChat, action: handleDeleteGroup }]
      : []),
  ];

  return (
    <div className="flex items-center gap-1 px-2 h-14 flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]">
      <button
        onClick={() => setSelectedChatId(null)}
        className="md:hidden p-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors flex-shrink-0 text-[color:var(--kub-cyan)]"
        aria-label="Назад"
      >
        <KubIcon name="back" size={20} />
      </button>

      <button
        onClick={onInfoOpen}
        className="flex items-center gap-2.5 flex-1 min-w-0 rounded-lg px-1.5 py-1 hover:bg-[var(--kub-surface-2)] transition-colors"
      >
        <ChatAvatar
          chat={{ id: chatId, name, avatar_url: chat?.avatar_url ?? null, type }}
          size="sm"
          showOnline={isOnline}
          isSaved={display.isSaved}
        />
        <div className="text-left min-w-0">
          <div className="text-sm font-semibold truncate leading-tight text-[color:var(--kub-text)]">
            {name}
          </div>
          {subtitle && (
            <div className={cn(
              "text-xs truncate leading-tight",
              isOnline ? "text-[color:var(--kub-online)]" : "text-[color:var(--kub-muted)]"
            )}>
              {subtitle}
            </div>
          )}
        </div>
      </button>

      <div className="flex items-center gap-0.5">
        {type !== "channel" && !display.isSaved && (
          <>
            <KubTooltip label="Аудио-вызов" side="bottom">
              <button
                aria-label="Аудио-вызов"
                className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]"
              >
                <KubIcon name="phone" size={18} />
              </button>
            </KubTooltip>
            <KubTooltip label="Видео-вызов" side="bottom">
              <button
                aria-label="Видео-вызов"
                className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]"
              >
                <KubIcon name="video" size={18} />
              </button>
            </KubTooltip>
          </>
        )}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
            aria-label="Ещё"
          >
            <KubIcon name="more" size={18} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div
                role="menu"
                data-kub-menu="true"
                className="absolute right-0 top-10 w-60 rounded-xl shadow-2xl z-50 py-1 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft"
              >
                {menuItems.map(({ icon, label, danger, disabled, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    disabled={disabled}
                    className={cn(
                      "flex min-w-0 items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-[var(--kub-surface-3)] disabled:cursor-not-allowed disabled:opacity-60",
                      danger ? "text-[color:var(--kub-danger)]" : "text-[color:var(--kub-text)]"
                    )}
                  >
                    <KubIcon
                      name={icon}
                      size={16}
                      tone={danger ? "danger" : "muted"}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {disabled && label === "Удалить групповой чат" ? "Удаление..." : label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
