"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubModal } from "@/components/kub";
import type { MessageWithSender } from "@/types/database";
import { forwardDraftTitle } from "@/lib/messageActions";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";

interface ForwardModalProps {
  /** One message or several, in the order they will arrive. */
  messages: MessageWithSender[];
  onClose: () => void;
  onForward: (targetChatId: string) => void | Promise<void>;
}

function messagePreview(message: MessageWithSender): string {
  if (message.type === "image") return "🖼 Фото";
  if (message.type === "audio") return "🎤 Голосовое сообщение";
  if (message.type === "video") return "🎬 Видео";
  if (message.type === "file") return `📎 ${message.content ?? "Файл"}`;
  return message.content ?? "";
}

/**
 * Where to forward: the first step of Telegram's flow. Choosing a chat does
 * not send anything yet — the chat opens with the messages waiting above its
 * composer, where a comment can be added (`MessageInput`'s forward bar).
 */
export function ForwardModal({ messages, onClose, onForward }: ForwardModalProps) {
  const chats = useAppStore((state) => state.chats);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const sourceChatId = messages[0]?.chat_id;

  const filtered = useMemo(() => {
    const pool = chats.filter((c) => c.id !== sourceChatId);
    if (!query.trim()) return pool;
    const q = query.toLowerCase();
    return pool.filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }, [chats, query, sourceChatId]);

  const handlePick = async (id: string) => {
    setBusyId(id);
    try { await onForward(id); }
    finally { setBusyId(null); }
  };

  const first = messages[0];
  const several = messages.length > 1;
  const senders = [...new Set(messages.map((message) => messageActorDisplayName(resolveMessageActor(message))))];

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Переслать в…"
      icon={<KubIcon name="forward" size={15} />}
      size="sm"
      contentClassName="px-4 pt-3 pb-2 space-y-3"
    >
      {first && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[var(--kub-surface-2)] border-l-2 border-[color:var(--kub-cyan)]">
          <div className="font-semibold text-[color:var(--kub-accent-text)]">
            {several ? forwardDraftTitle(messages.length) : messageActorDisplayName(resolveMessageActor(first))}
          </div>
          <div className="truncate text-[color:var(--kub-muted)]">
            {several ? senders.join(", ") : messagePreview(first)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
        <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск чата…"
          className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
        />
      </div>

      <div className="max-h-72 overflow-y-auto -mx-4 px-1 py-1">
        {filtered.length === 0 ? (
          <p className="text-center text-sm py-8 text-[color:var(--kub-muted)]">Чаты не найдены</p>
        ) : (
          filtered.map((chat) => (
            <button
              key={chat.id}
              onClick={() => handlePick(chat.id)}
              disabled={busyId !== null}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              <ChatAvatar chat={chat} size="sm" />
              <div className="text-left min-w-0 flex-1">
                <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
                  {chat.name ?? "Без названия"}
                </div>
              </div>
              {busyId === chat.id && (
                <span className="text-xs text-[color:var(--kub-accent-text)]">отправка…</span>
              )}
            </button>
          ))
        )}
      </div>
    </KubModal>
  );
}
