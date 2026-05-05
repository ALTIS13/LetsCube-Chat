"use client";

import { ArrowLeft, Phone, Video, Search, MoreVertical, Bell, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
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
    // private — check online status
    const other = chat.other_user as { online_at?: string } | undefined;
    if (other?.online_at) {
      const diff = Date.now() - new Date(other.online_at).getTime();
      if (diff < 3 * 60000) return "в сети";
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return `был(а) ${mins} мин назад`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `был(а) ${hours} ч назад`;
      return "был(а) недавно";
    }
    return "";
  };

  const subtitle = getSubtitle();
  const isOnline = subtitle === "в сети";

  const menuItems = [
    { icon: Search, label: "Поиск в чате", action: () => { setShowMenu(false); onSearchOpen?.(); } },
    { icon: Bell, label: isMuted ? "Включить уведомления" : "Отключить уведомления", action: () => { toggleMutedChat(chatId); setShowMenu(false); } },
    { icon: Trash2, label: "Очистить историю", danger: true, action: () => setShowMenu(false) },
    { icon: UserX, label: "Удалить чат", danger: true, action: () => setShowMenu(false) },
  ];

  return (
    <div
      className="flex items-center gap-1 px-2 h-14 flex-shrink-0"
      style={{
        background: "var(--tg-header)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      }}
    >
      <button
        onClick={() => setSelectedChatId(null)}
        className="md:hidden p-2 rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
        style={{ color: "var(--tg-accent)" }}
      >
        <ArrowLeft size={20} />
      </button>

      <button onClick={onInfoOpen} className="flex items-center gap-2.5 flex-1 min-w-0 rounded-lg px-1 py-1 hover:bg-white/5 transition-colors">
        <ChatAvatar
          chat={{ id: chatId, name, avatar_url: chat?.avatar_url ?? null, type }}
          size="sm"
          showOnline={isOnline}
        />
        <div className="text-left min-w-0">
          <div className="text-sm font-semibold truncate leading-tight" style={{ color: "var(--tg-text)" }}>
            {name}
          </div>
          {subtitle && (
            <div
              className="text-xs truncate leading-tight"
              style={{ color: isOnline ? "var(--tg-online)" : "var(--tg-text-secondary)" }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </button>

      <div className="flex items-center">
        {type !== "channel" && (
          <>
            <button className="p-2 rounded-full hover:bg-white/10 transition-colors"
              style={{ color: "var(--tg-text-secondary)" }}>
              <Phone size={18} />
            </button>
            <button className="p-2 rounded-full hover:bg-white/10 transition-colors"
              style={{ color: "var(--tg-text-secondary)" }}>
              <Video size={18} />
            </button>
          </>
        )}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            <MoreVertical size={18} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-10 w-52 rounded-xl overflow-hidden shadow-xl z-50 context-menu">
                {menuItems.map(({ icon: Icon, label, danger, action }) => (
                  <button key={label}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-white/8"
                    style={{ color: danger ? "#ef4444" : "var(--tg-text)" }}
                    onClick={action}>
                    <Icon size={16} />
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
