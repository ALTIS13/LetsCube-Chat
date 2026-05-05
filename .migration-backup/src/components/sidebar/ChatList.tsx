"use client";

import { ChatListItem } from "./ChatListItem";
import { useAppStore } from "@/store/app.store";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatListProps {
  chats: ChatWithLastMessage[];
  selectedChatId: string | null;
  onChatSelect: (id: string) => void;
}

export function ChatList({ chats, selectedChatId, onChatSelect }: ChatListProps) {
  const { mutedChatIds } = useAppStore();

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 py-12">
        <div className="text-5xl">💬</div>
        <p className="text-sm" style={{ color: "var(--tg-text-secondary)" }}>
          Чаты не найдены
        </p>
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
