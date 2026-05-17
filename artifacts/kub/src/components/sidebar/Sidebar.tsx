"use client";

import { useEffect, useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import { SidebarHeader } from "./SidebarHeader";
import { FolderTabs } from "./FolderTabs";
import { ChatList } from "./ChatList";
import { NewChatModal } from "./NewChatModal";
import { FolderEditModal } from "./FolderEditModal";
import { FolderListModal } from "./FolderListModal";
import { SettingsModal } from "./SettingsModal";
import { SidebarSearchResults } from "@/components/search/SidebarSearchResults";
import { useAppStore } from "@/store/app.store";
import { useChats } from "@/hooks/useChats";
import { useFolders } from "@/hooks/useFolders";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import type { Folder } from "@/types/database";

export function Sidebar() {
  // Dev-only mount/unmount counter — должен оставаться 1 в нормальной работе.
  // Если значение скачет — Sidebar ремаунтится из-за нестабильного key/parent.
  useEffect(() => {
    bumpMount("Sidebar");
    return () => bumpUnmount("Sidebar");
  }, []);

  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const mobileSection = useAppStore((s) => s.mobileSection);
  const setMobileSection = useAppStore((s) => s.setMobileSection);
  const { chats, loading, refetch } = useChats();
  const {
    folders,
    folderChats,
    createFolder,
    updateFolder,
    deleteFolder,
    setChatsForFolder,
    canManageFolder,
  } = useFolders();
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | "new" | null>(null);
  const [showFolderList, setShowFolderList] = useState(false);

  // BottomNav (mobile) drives `mobileSection` in the store. We open the matching
  // secondary surface here and close it when the user switches back to "chats".
  useEffect(() => {
    if (mobileSection === "folders") setShowFolderList(true);
  }, [mobileSection]);

  const closeFolderList = () => {
    setShowFolderList(false);
    if (mobileSection === "folders") setMobileSection("chats");
  };

  const closeSettings = () => {
    if (mobileSection === "profile") setMobileSection("chats");
  };

  const hasSearchQuery = searchQuery.trim().length > 0;
  const filtered = useMemo(() => chats.filter((chat) => {
    if (activeFolder === null) return true;
    return folderChats[activeFolder]?.has(chat.id) ?? false;
  }), [chats, activeFolder, folderChats]);

  const tabs = useMemo<{ id: string | null; name: string; emoji: string | null; unread: number; shared: boolean }[]>(() => [
    {
      id: null,
      name: "Все",
      emoji: null,
      unread: chats.reduce((s, c) => s + (c.unread_count ?? 0), 0),
      shared: false,
    },
    ...folders.map((f) => {
      const inFolder = folderChats[f.id] ?? new Set<string>();
      const unread = chats
        .filter((c) => inFolder.has(c.id))
        .reduce((s, c) => s + (c.unread_count ?? 0), 0);
      return {
        id: f.id,
        name: f.name,
        emoji: f.emoji,
        unread,
        shared: f.scope !== "personal",
      };
    }),
  ], [chats, folders, folderChats]);

  return (
    <div className="flex flex-col h-full w-full bg-[var(--kub-surface)]">
      <SidebarHeader onNewChat={() => setShowNewChat(true)} onRefetch={refetch} />
      {!hasSearchQuery && (
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
      )}

      {hasSearchQuery ? (
        <SidebarSearchResults query={searchQuery} />
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <KubIcon name="spinner" size={22} className="text-[color:var(--kub-cyan)]" />
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
          canManage={editingFolder === "new" ? true : canManageFolder(editingFolder)}
        />
      )}
      {showFolderList && (
        <FolderListModal
          onClose={closeFolderList}
          folders={folders}
          folderChats={folderChats}
          activeFolder={activeFolder}
          onSelect={setActiveFolder}
          createFolder={createFolder}
          updateFolder={updateFolder}
          deleteFolder={deleteFolder}
          setChatsForFolder={setChatsForFolder}
          canManageFolder={canManageFolder}
        />
      )}
      {mobileSection === "profile" && <SettingsModal onClose={closeSettings} />}
    </div>
  );
}
