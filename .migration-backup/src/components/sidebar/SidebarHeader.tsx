"use client";

import { useState } from "react";
import { Search, Menu, X, Edit, Settings, Users, Bookmark, HelpCircle, Moon, LogOut } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { useUser } from "@/hooks/useUser";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { SettingsModal } from "./SettingsModal";
import { NewGroupModal } from "./NewGroupModal";

interface SidebarHeaderProps {
  onNewChat?: () => void;
  onRefetch?: () => void;
}

export function SidebarHeader({ onNewChat, onRefetch }: SidebarHeaderProps) {
  const { searchQuery, setSearchQuery, currentUser, setSelectedChatId } = useAppStore();
  const { signOut } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  const openSavedMessages = async () => {
    setMenuOpen(false);
    if (!currentUser) return;
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    // Find existing saved-messages chat
    const { data: existing } = await supabase
      .from("chats")
      .select("id")
      .eq("type", "private")
      .eq("created_by", currentUser.id)
      .eq("name", "Избранное")
      .limit(1)
      .single();
    if (existing) { setSelectedChatId(existing.id); return; }
    // Create one
    const { data: chat } = await supabase
      .from("chats")
      .insert({ type: "private", name: "Избранное", created_by: currentUser.id })
      .select("id").single();
    if (!chat) return;
    await supabase.from("chat_members").insert({ chat_id: chat.id, user_id: currentUser.id, role: "owner" });
    setSelectedChatId(chat.id);
    onRefetch?.();
  };

  const menuItems = [
    { icon: Users,      label: "Новая группа",    action: () => { setMenuOpen(false); setShowNewGroup(true); } },
    { icon: Bookmark,   label: "Избранное",       action: openSavedMessages },
    { icon: Settings,   label: "Настройки",       action: () => { setMenuOpen(false); setShowSettings(true); } },
    { icon: Moon,       label: "Тёмная тема",     action: () => setMenuOpen(false), note: "Вкл" },
    { icon: HelpCircle, label: "Помощь",          action: () => { setMenuOpen(false); window.open("https://github.com", "_blank"); } },
    { icon: LogOut,     label: "Выйти",           danger: true, action: async () => { setMenuOpen(false); await signOut(); } },
  ];

  return (
    <div className="flex-shrink-0">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} onRefetch={onRefetch} />}

      <div className="flex items-center gap-2 px-3 py-2 h-14">
        {isSearchFocused || searchQuery ? (
          <button
            onClick={() => { setSearchQuery(""); setIsSearchFocused(false); }}
            className="p-2 rounded-full transition-colors hover:bg-white/10"
            style={{ color: "var(--tg-accent)" }}
          >
            <X size={20} />
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-full transition-colors hover:bg-white/10 overflow-hidden flex items-center justify-center"
            >
              {currentUser ? (
                <UserAvatar user={currentUser} size="sm" />
              ) : (
                <div className="p-2" style={{ color: "var(--tg-text-secondary)" }}>
                  <Menu size={20} />
                </div>
              )}
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute left-0 top-11 w-60 rounded-xl shadow-xl z-50 py-1 overflow-hidden"
                  style={{ background: "#243447", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {currentUser && (
                    <div className="flex items-center gap-3 px-4 py-3 mb-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <UserAvatar user={currentUser} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: "var(--tg-text)" }}>
                          {currentUser.full_name ?? "Пользователь"}
                        </div>
                        <div className="text-xs truncate" style={{ color: "var(--tg-text-secondary)" }}>
                          {currentUser.username ? `@${currentUser.username}` : "Без имени пользователя"}
                        </div>
                      </div>
                    </div>
                  )}
                  {menuItems.map(({ icon: Icon, label, danger, action, note }) => (
                    <button
                      key={label}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                      style={{ color: danger ? "#ef4444" : "var(--tg-text)" }}
                      onClick={action}
                    >
                      <Icon size={17} style={{ color: danger ? "#ef4444" : "var(--tg-text-secondary)" }} />
                      <span className="flex-1 text-left">{label}</span>
                      {note && <span className="text-xs" style={{ color: "var(--tg-accent)" }}>{note}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div
          className="flex-1 flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors"
          style={{ background: "var(--tg-input)" }}
        >
          <Search size={15} style={{ color: "var(--tg-text-secondary)" }} />
          <input
            type="text"
            placeholder="Поиск"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => !searchQuery && setIsSearchFocused(false)}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--tg-text)" }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}>
              <X size={13} style={{ color: "var(--tg-text-secondary)" }} />
            </button>
          )}
        </div>

        {!isSearchFocused && !searchQuery && (
          <button
            onClick={onNewChat}
            className="p-2 rounded-full transition-colors hover:bg-white/10"
            style={{ color: "var(--tg-accent)" }}
          >
            <Edit size={19} />
          </button>
        )}
      </div>
    </div>
  );
}
