"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubModal, KubIcon, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { prefixError } from "@/lib/errors";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatHeaderProps {
  chatId: string;
  chat?: ChatWithLastMessage;
  onSearchOpen?: () => void;
  onInfoOpen?: () => void;
  onClearForMe?: () => Promise<{ ok: boolean; error: string | null }>;
}

export function ChatHeader({ chatId, chat, onSearchOpen, onInfoOpen, onClearForMe }: ChatHeaderProps) {
  const { chats, setChats, setSelectedChatId, setMessages, mutedChatIds, toggleMutedChat, currentUser } = useAppStore();
  const supabase = createClient();
  const [showMenu, setShowMenu] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    setDeleteError(null);

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
      setDeleteError(prefixError("Не удалось удалить групповой чат", error));
      return;
    }

    if (!data) {
      setDeleteError("Недостаточно прав для удаления этого чата.");
      return;
    }

    setMessages(chatId, []);
    setChats(chats.filter((item) => item.id !== chatId));
    setSelectedChatId(null);
    setDeleteGroupOpen(false);
    setShowMenu(false);
  };

  const handlePinToggle = async () => {
    if (!chat) return;
    const rpcName = isPinned ? "unpin_chat" : "pin_chat";
    const { error } = await supabase.rpc(rpcName, { p_chat_id: chatId });
    if (error) {
      showAppAlert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error), "Ошибка");
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
    const confirmed = await requestAppConfirm({
      title,
      description: body,
      confirmLabel: "Очистить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    const result = await onClearForMe();
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось очистить историю у себя.", "Ошибка");
      return;
    }
    const clearedAt = new Date().toISOString();
    setMessages(chatId, []);
    setChats(chats.map((item) =>
      item.id === chatId
        ? { ...item, last_message: undefined, unread_count: 0, cleared_at: clearedAt }
        : item
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId });
    setShowMenu(false);
  };

  const handleHidePrivateChat = async () => {
    if (!canHidePrivateChat) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить чат у себя?",
      description: "Чат исчезнет только из вашего списка. У собеседника история останется.",
      confirmLabel: "Удалить у себя",
      tone: "danger",
      icon: "logout",
    });
    if (!confirmed) return;
    const { error } = await supabase.rpc("hide_private_chat", { p_chat_id: chatId });
    if (error) {
      showAppAlert(prefixError("Не удалось удалить чат у себя", error), "Ошибка");
      return;
    }
    setMessages(chatId, []);
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
      ? [{
          icon: "userRemove" as KubIconName,
          label: "Удалить групповой чат",
          danger: true,
          disabled: deletingChat,
          action: () => {
            setShowMenu(false);
            setDeleteError(null);
            setDeleteGroupOpen(true);
          },
        }]
      : []),
  ];

  return (
    <>
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
                className="fixed inset-x-3 bottom-3 z-50 max-h-[min(70vh,480px)] overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] py-1 shadow-2xl kub-glow-soft sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-10 sm:w-60"
              >
                {menuItems.map(({ icon, label, danger, disabled, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    disabled={disabled}
                    className={cn(
                      "flex min-w-0 items-center gap-3 w-full px-4 py-2.5 text-left text-sm whitespace-nowrap transition-colors hover:bg-[var(--kub-surface-3)] disabled:cursor-not-allowed disabled:opacity-60",
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
    <KubModal
      open={deleteGroupOpen}
      onClose={() => {
        if (!deletingChat) setDeleteGroupOpen(false);
      }}
      title="Удалить групповой чат?"
      description="Это действие нельзя отменить. Чат и история исчезнут у всех участников."
      icon={<KubIcon name="userRemove" size={18} tone="danger" />}
      size="sm"
      mobileSheet={false}
      footer={(
        <>
          <button
            type="button"
            onClick={() => setDeleteGroupOpen(false)}
            disabled={deletingChat}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleDeleteGroup}
            disabled={deletingChat}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[color:var(--kub-danger)] px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {deletingChat ? "Удаляем..." : "Удалить"}
          </button>
        </>
      )}
    >
      {deleteError ? (
        <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger)]">
          {deleteError}
        </div>
      ) : (
        <p className="text-sm text-[color:var(--kub-muted)]">
          После удаления группа исчезнет у всех участников.
        </p>
      )}
    </KubModal>
    </>
  );
}
