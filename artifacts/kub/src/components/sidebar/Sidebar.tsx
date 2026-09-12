"use client";

import { useEffect, useMemo, useState } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { SidebarHeader } from "./SidebarHeader";
import { FolderTabs } from "./FolderTabs";
import { FolderRail } from "./FolderRail";
import { SideMenuLayer } from "./SideMenuLayer";
import { ChatList } from "./ChatList";
import { NewChatModal } from "./NewChatModal";
import { NewGroupModal } from "./NewGroupModal";
import { FolderEditModal } from "./FolderEditModal";
import { FolderListModal } from "./FolderListModal";
import { SettingsModal } from "./SettingsModal";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { openSavedMessagesChat } from "@/lib/savedMessages";
import { SidebarSearchResults } from "@/components/search/SidebarSearchResults";
import { ChatSearchPanel } from "@/components/search/ChatSearchPanel";
import { useIsMobile } from "@/hooks/use-mobile";
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
  // Phone only in effect: the header keeps the field in its control row from
  // `md`, so this flag changes nothing on a computer.
  const [searchTucked, setSearchTucked] = useState(false);
  // The computer's side list, and the surface it opens. It is owned here rather
  // than in `SidebarHeader` because from `md` the button that opens it lives on
  // the folder rail, not in the list's header.
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);

  const editFolder = (id: string) => {
    const target = folders.find((f) => f.id === id);
    if (target) setEditingFolder(target);
  };

  // BottomNav (mobile) drives `mobileSection` in the store. We open the matching
  // secondary surface here and close it when the user switches back to "chats".
  useEffect(() => {
    if (mobileSection === "folders") setShowFolderList(true);
  }, [mobileSection]);

  const closeFolderList = () => {
    setShowFolderList(false);
    if (mobileSection === "folders") setMobileSection("chats");
  };

  const hasSearchQuery = searchQuery.trim().length > 0;
  // In-chat search, as a state of this column from `md`.
  //
  // Three conditions, each load-bearing. Not on a phone: below `md` this column
  // is hidden rather than unmounted, so without the width the panel would be
  // mounted behind the conversation, running its own query and jumping the
  // chat — and the phone has its own form in the pane. Only for the chat that
  // is actually open, so a search left behind in another chat cannot show its
  // results beside a different conversation. And the typed global query wins,
  // because that is the field the person is in the middle of using; clearing it
  // comes back here.
  const chatSearch = useAppStore((s) => s.chatSearch);
  const isPhone = useIsMobile();
  const chatSearchOpen =
    !isPhone && chatSearch !== null && chatSearch.chatId === selectedChatId;

  // Settings, the same way, since D-160. From `md` it is this column's body;
  // below `md` there is no column on screen and it stays the full-screen sheet
  // `SettingsModal` has always been. The phone's «Профиль» tab opens the same
  // screen, which is why both flags are read here.
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const closeSettingsPanel = useAppStore((s) => s.closeSettings);
  const openSettingsPanel = useAppStore((s) => s.openSettings);
  const settingsColumnOpen = !isPhone && settingsOpen;
  const settingsSheetOpen = isPhone && (settingsOpen || mobileSection === "profile");

  const closeSettingsSheet = () => {
    closeSettingsPanel();
    if (mobileSection === "profile") setMobileSection("chats");
  };

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
    // The column is a plain box; the material is the layer below, because this
    // subtree opens dialogs and a frosted ancestor would lay them out against
    // the column instead of the viewport. See KubGlassLayer.
    //
    // `kub-glass`, not `-strong`: the column holds the chat list, it does not
    // cover it. Everything inside stays flat — the list rows in particular, a
    // blur each on a list that scrolls is the one place this material costs
    // real frames.
    //
    // From `md` the tab bar is gone and this column runs to the bottom of the
    // screen, so it keeps the home indicator's inset clear itself; below `md`
    // the tab bar underneath does that.
    <div className="relative flex h-full w-full flex-col md:pb-safe">
      <KubGlassLayer />
      {/* One in-flow child, sized exactly as the four used to be, so the layer
          has a sibling to sit behind and the column's own layout is unchanged.
          The dialogs stay outside it — they are `fixed` and take no space. */}
      <div className="relative flex min-h-0 flex-1">
        {/* From `md` only, and inside this column's own glass rather than
            behind a second sheet: the rail and the list are two blocks of one
            surface, told apart by a hairline (rule 11). */}
        <FolderRail
          folders={tabs}
          activeFolder={activeFolder}
          onFolderChange={setActiveFolder}
          onCreate={() => setEditingFolder("new")}
          onEdit={editFolder}
          onOpenSideMenu={() => setSideMenuOpen(true)}
          sideMenuOpen={sideMenuOpen}
        />

        <div className="kub-chat-list-column relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* What a strip of avatars has no room for. The rules in index.css
              fade and close this as `--kub-chat-list-narrow` goes to 1, so the
              list keeps narrowing continuously instead of switching mode. */}
          <div data-kub-list-chrome="" className="relative shrink-0">
            <SidebarHeader
              onNewChat={() => setShowNewChat(true)}
              onRefetch={refetch}
              searchTucked={searchTucked}
              onUntuckSearch={() => setSearchTucked(false)}
            />
            {/* Below `md` only. The folder rail above is `hidden … md:flex`,
                so without this gate the same folders were drawn twice from
                `md` upward — once down the rail and once across this strip,
                which is what the owner saw on the computer on 2026-09-12.
                The gate is here rather than on the component because a phone
                renders this strip at whatever width it has; `FolderTabs`
                itself must stay width-agnostic. `PublicPreviewCapturePage`
                now carries the same gate at its own mount site, so the
                published product images show one folder surface too. */}
            {!hasSearchQuery && (
              <div className="md:hidden">
                <FolderTabs
                  folders={tabs}
                  activeFolder={activeFolder}
                  onFolderChange={setActiveFolder}
                  onCreate={() => setEditingFolder("new")}
                  onEdit={editFolder}
                />
              </div>
            )}
          </div>

          {hasSearchQuery ? (
            <SidebarSearchResults query={searchQuery} />
          ) : settingsColumnOpen ? (
            <SettingsPanel />
          ) : chatSearchOpen && chatSearch ? (
            <ChatSearchPanel chatId={chatSearch.chatId} />
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center">
              <KubIcon name="spinner" size={22} className="text-[color:var(--kub-cyan)]" />
            </div>
          ) : (
            <ChatList
              chats={filtered}
              selectedChatId={selectedChatId}
              onChatSelect={setSelectedChatId}
              onScrollStateChange={setSearchTucked}
            />
          )}
        </div>
      </div>

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
      {showNewGroup && (
        <NewGroupModal onClose={() => setShowNewGroup(false)} onRefetch={refetch} />
      )}
      {/* Below `md` only. From `md` the same screen is this column's body, and
          mounting both would run two copies of the settings state side by side. */}
      {settingsSheetOpen && <SettingsModal onClose={closeSettingsSheet} />}

      {/* `Ui::LayerWidget`, not a column and not a dropdown: it costs no width
          while it is closed, which is the whole of «удобно в боковом списке
          выпадающем по надобности». */}
      {sideMenuOpen && (
        <SideMenuLayer
          onClose={() => setSideMenuOpen(false)}
          onOpenSettings={openSettingsPanel}
          onOpenNewGroup={() => setShowNewGroup(true)}
          onOpenSaved={() => {
            void openSavedMessagesChat({ userId, setSelectedChatId, onRefetch: refetch });
          }}
        />
      )}
    </div>
  );
}
