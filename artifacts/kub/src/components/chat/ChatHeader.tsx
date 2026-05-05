"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubTooltip, KubIcon, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatHeaderProps {
  chatId: string;
  chat?: ChatWithLastMessage;
  onSearchOpen?: () => void;
  onInfoOpen?: () => void;
}

export function ChatHeader({ chatId, chat, onSearchOpen, onInfoOpen }: ChatHeaderProps) {
  const { setSelectedChatId, mutedChatIds, toggleMutedChat } = useAppStore();
  const [showMenu, setShowMenu] = useState(false);
  const isMuted = mutedChatIds.includes(chatId);

  const name = chat?.name ?? "Чат";
  const type = chat?.type ?? "private";

  const getSubtitle = () => {
    if (!chat) return "";
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

  const menuItems: Array<{ icon: KubIconName; label: string; danger?: boolean; action: () => void }> = [
    { icon: "search", label: "Поиск в чате", action: () => { setShowMenu(false); onSearchOpen?.(); } },
    { icon: "notifications", label: isMuted ? "Включить уведомления" : "Отключить уведомления", action: () => { toggleMutedChat(chatId); setShowMenu(false); } },
    { icon: "delete", label: "Очистить историю", danger: true, action: () => setShowMenu(false) },
    { icon: "userRemove", label: "Удалить чат", danger: true, action: () => setShowMenu(false) },
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
        {type !== "channel" && (
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
              <div className="absolute right-0 top-10 w-56 rounded-xl shadow-2xl z-50 py-1 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft">
                {menuItems.map(({ icon, label, danger, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className={cn(
                      "flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-[var(--kub-surface-3)]",
                      danger ? "text-[color:var(--kub-danger)]" : "text-[color:var(--kub-text)]"
                    )}
                  >
                    <KubIcon
                      name={icon}
                      size={16}
                      tone={danger ? "danger" : "muted"}
                    />
                    {label}
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
