"use client";

import { useState, useMemo } from "react";
import { X, Search, Forward as ForwardIcon } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import type { MessageWithSender } from "@/types/database";

interface ForwardModalProps {
  message: MessageWithSender;
  onClose: () => void;
  onForward: (targetChatId: string) => void | Promise<void>;
}

/**
 * Picker for forwarding a message to one of the user's existing chats.
 * Shows the source chats from the store, filtered by name search.
 */
export function ForwardModal({ message, onClose, onForward }: ForwardModalProps) {
  const { chats } = useAppStore();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    // Forward target cannot be the same chat as the source.
    const pool = chats.filter((c) => c.id !== message.chat_id);
    if (!query.trim()) return pool;
    const q = query.toLowerCase();
    return pool.filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }, [chats, query, message.chat_id]);

  const handlePick = async (id: string) => {
    setBusyId(id);
    try {
      await onForward(id);
    } finally {
      setBusyId(null);
    }
  };

  // Short preview of what is being forwarded.
  const preview = (() => {
    if (message.type === "image") return "🖼 Фото";
    if (message.type === "audio") return "🎤 Голосовое сообщение";
    if (message.type === "video") return "🎬 Видео";
    if (message.type === "file") return `📎 ${message.content ?? "Файл"}`;
    return message.content ?? "";
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--tg-sidebar)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2">
            <ForwardIcon size={15} style={{ color: "var(--tg-accent)" }} />
            <h2 className="font-semibold text-sm" style={{ color: "var(--tg-text)" }}>
              Переслать в…
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* What's being forwarded */}
        <div
          className="mx-3 mt-3 mb-2 rounded-xl px-3 py-2 text-xs"
          style={{
            background: "var(--tg-input)",
            color: "var(--tg-text-secondary)",
            borderLeft: "2px solid var(--tg-accent)",
          }}
        >
          <div className="font-semibold" style={{ color: "var(--tg-accent)" }}>
            {message.sender?.full_name ?? "Сообщение"}
          </div>
          <div className="truncate">{preview}</div>
        </div>

        {/* Search */}
        <div className="px-3">
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: "var(--tg-input)" }}
          >
            <Search size={15} style={{ color: "var(--tg-text-secondary)" }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск чата…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--tg-text)" }}
            />
          </div>
        </div>

        {/* Chat list */}
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: "var(--tg-text-secondary)" }}>
              Чаты не найдены
            </p>
          ) : (
            filtered.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handlePick(chat.id)}
                disabled={busyId !== null}
                className="w-full flex items-center gap-3 px-4 py-2 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                <ChatAvatar chat={chat} size="sm" />
                <div className="text-left min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--tg-text)" }}>
                    {chat.name ?? "Без названия"}
                  </div>
                </div>
                {busyId === chat.id && (
                  <span className="text-xs" style={{ color: "var(--tg-accent)" }}>отправка…</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
