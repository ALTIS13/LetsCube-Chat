"use client";

import { useEffect } from "react";
import { ChatListItem } from "./ChatListItem";
import { useAppStore } from "@/store/app.store";
import { KubEmptyState, KubIcon } from "@/components/kub";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatListProps {
  chats: ChatWithLastMessage[];
  selectedChatId: string | null;
  onChatSelect: (id: string) => void;
}

export function ChatList({ chats, selectedChatId, onChatSelect }: ChatListProps) {
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);

  // Dev-only mount/unmount счётчик для проверки стабильности (Task #48).
  useEffect(() => {
    bumpMount("ChatList");
    return () => bumpUnmount("ChatList");
  }, []);

  if (chats.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <KubEmptyState
          icon={<KubIcon name="chats" size={24} />}
          title="Чаты не найдены"
          description="Начните новую переписку или измените запрос поиска."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {chats.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={{ ...chat, is_muted: mutedChatIds.includes(chat.id) }}
          isSelected={selectedChatId === chat.id}
          onClick={() => onChatSelect(chat.id)}
        />
      ))}
    </div>
  );
}
