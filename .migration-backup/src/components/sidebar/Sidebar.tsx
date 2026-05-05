"use client";

import { useState } from "react";
import { SidebarHeader } from "./SidebarHeader";
import { FolderTabs } from "./FolderTabs";
import { ChatList } from "./ChatList";
import { NewChatModal } from "./NewChatModal";
import { FolderEditModal } from "./FolderEditModal";
import { useAppStore } from "@/store/app.store";
import { useChats } from "@/hooks/useChats";
import { useFolders } from "@/hooks/useFolders";
import { Loader2 } from "lucide-react";
import type { Folder } from "@/types/database";

export function Sidebar() {
  const { selectedChatId, setSelectedChatId, searchQuery } = useAppStore();
  const { chats, loading, refetch } = useChats();
  const {
    folders,
    folderChats,
    createFolder,
    updateFolder,
    deleteFolder,
    setChatsForFolder,
  } = useFolders();
  // activeFolder = null → "Все" tab; otherwise — id of a custom folder.
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  // Editing state for FolderEditModal: null = closed, "new" = create mode,
  // Folder object = edit-existing mode.
  const [editingFolder, setEditingFolder] = useState<Folder | "new" | null>(null);

  const filtered = chats.filter((chat) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        chat.name?.toLowerCase().includes(q) ||
        chat.last_message?.content?.toLowerCase().includes(q)
      );
    }
    if (activeFolder === null) return true; // "Все"
    return folderChats[activeFolder]?.has(chat.id) ?? false;
  });

  // Build the tab list: "Все" first, then custom folders in their stored order.
  // Each tab carries the rolled-up unread count for chats inside it.
  const tabs: { id: string | null; name: string; emoji: string | null; unread: number }[] = [
    {
      id: null,
      name: "Все",
      emoji: null,
      unread: chats.reduce((s, c) => s + (c.unread_count ?? 0), 0),
    },
    ...folders.map((f) => {
      const inFolder = folderChats[f.id] ?? new Set<string>();
      const unread = chats
        .filter((c) => inFolder.has(c.id))
        .reduce((s, c) => s + (c.unread_count ?? 0), 0);
      return { id: f.id, name: f.name, emoji: f.emoji, unread };
    }),
  ];

  return (
    <div className="flex flex-col h-full w-full" style={{ background: "var(--tg-sidebar)" }}>
      <SidebarHeader onNewChat={() => setShowNewChat(true)} onRefetch={refetch} />
      <FolderTabs
        folders={tabs}
        activeFolder={activeFolder}
        onFolderChange={setActiveFolder}
        onCreate={() => setEditingFolder("new")}
        onEdit={(id) => {
          const target = folders.find((f) => f.id === id);
          if (target) setEditingFolder(target);
        }}
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--tg-text-secondary)" }} />
        </div>
      ) : (
        <ChatList
          chats={filtered}
          selectedChatId={selectedChatId}
          onChatSelect={setSelectedChatId}
        />
      )}

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} onRefetch={refetch} />
      )}
      {editingFolder !== null && (
        <FolderEditModal
          folder={editingFolder === "new" ? null : editingFolder}
          onClose={() => setEditingFolder(null)}
          folderChats={folderChats}
          createFolder={createFolder}
          updateFolder={updateFolder}
          deleteFolder={deleteFolder}
          setChatsForFolder={setChatsForFolder}
        />
      )}
    </div>
  );
}
