"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { useSignOut } from "@/hooks/useUser";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubLogo, KubTooltip, type KubIconName } from "@/components/kub";
import { SettingsModal } from "./SettingsModal";
import { NewGroupModal } from "./NewGroupModal";
import { NotificationBell } from "./NotificationBell";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  onNewChat?: () => void;
  onRefetch?: () => void;
}

export function SidebarHeader({ onNewChat, onRefetch }: SidebarHeaderProps) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const currentUser = useAppStore((s) => s.currentUser);
  const userId = currentUser?.id ?? null;
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const mobileSection = useAppStore((s) => s.mobileSection);
  const setMobileSection = useAppStore((s) => s.setMobileSection);
  // Облегчённый хук без эффектов: не дублируем подписку на сессию и
  // realtime-канал `profile-self` (Task #48). Полный `useUser()` смонтирован
  // один раз — в `App.tsx`.
  const signOut = useSignOut();
  const isStaff = useIsManagerOrAdmin();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const iconButtonClass =
    "h-9 w-9 shrink-0 rounded-lg transition-colors hover:bg-[var(--kub-surface-2)] inline-flex items-center justify-center";

  // BottomNav's "Поиск" tab is a one-shot: when mobileSection becomes 'search',
  // focus the search input and immediately reset the section back to 'chats'.
  useEffect(() => {
    if (mobileSection !== "search") return;
    searchInputRef.current?.focus();
    setMobileSection("chats");
  }, [mobileSection, setMobileSection]);

  const openSavedMessages = async () => {
    setMenuOpen(false);
    if (!userId) return;
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    // After the chat-INSERT lockdown (20260504_tasks_update_and_chat_lockdown.sql)
    // direct INSERT of `type='private'` rows is blocked — only
    // `open_or_create_private_chat` may create them, and it refuses
    // self-chats. So Saved Messages is now a single-member 'group',
    // which the regular INSERT policy still permits. We accept any
    // pre-existing "Избранное" row regardless of type so users with
    // legacy private rows aren't locked out.
    const { data: existing } = await supabase
      .from("chats")
      .select("id")
      .eq("created_by", userId)
      .eq("name", "Избранное")
      .limit(1)
      .maybeSingle();
    if (existing) { setSelectedChatId(existing.id); return; }
    const { data: chat, error: chatErr } = await supabase
      .from("chats")
      .insert({ type: "group", name: "Избранное", created_by: userId })
      .select("id").single();
    if (chatErr || !chat) return;
    // The `add_chat_creator_as_owner` trigger inserts the owner row,
    // so this is a no-op safety net.
    await supabase
      .from("chat_members")
      .upsert({ chat_id: chat.id, user_id: userId, role: "owner" }, { onConflict: "chat_id,user_id" });
    setSelectedChatId(chat.id);
    onRefetch?.();
  };

  type MenuItem = {
    icon: KubIconName;
    label: string;
    danger?: boolean;
    accent?: boolean;
    note?: string;
    action: () => void | Promise<void>;
  };

  const menuItems: MenuItem[] = [
    { icon: "group",    label: "Новая группа", action: () => { setMenuOpen(false); setShowNewGroup(true); } },
    { icon: "bookmark", label: "Избранное",    action: openSavedMessages },
    { icon: "tasks",    label: "Задачи",       accent: true, action: () => { setMenuOpen(false); setLocation("/tasks"); } },
    { icon: "settings", label: "Настройки",    action: () => { setMenuOpen(false); setShowSettings(true); } },
    ...(isStaff
      ? [{ icon: "shield" as const, label: "Админ-панель", accent: true, action: () => { setMenuOpen(false); setLocation("/admin"); } } satisfies MenuItem]
      : []),
    { icon: "help",   label: "Помощь", action: () => { setMenuOpen(false); window.open("https://github.com", "_blank"); } },
    { icon: "logout", label: "Выйти",  danger: true, action: async () => { setMenuOpen(false); await signOut(); } },
  ];

  return (
    <div className="flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} onRefetch={onRefetch} />}

      {/* Brand strip */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <KubLogo size={26} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold tracking-wide text-[color:var(--kub-text)]">КУБ</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]/80">Cyber Arena</div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 px-3 pb-2.5">
        {isSearchFocused || searchQuery ? (
          <button
            onClick={() => { setSearchQuery(""); setIsSearchFocused(false); }}
            className={cn(iconButtonClass, "text-[color:var(--kub-cyan)]")}
            aria-label="Очистить поиск"
          >
            <KubIcon name="close" size={18} />
          </button>
        ) : (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="h-9 w-9 shrink-0 rounded-lg transition-colors hover:bg-[var(--kub-surface-2)] flex items-center justify-center p-1"
              aria-label="Меню"
            >
              {currentUser ? (
                <UserAvatar user={currentUser} size="sm" />
              ) : (
                <span className="p-1 text-[color:var(--kub-muted)]">
                  <KubIcon name="menu" size={18} />
                </span>
              )}
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-12 w-64 rounded-xl shadow-2xl z-50 py-1 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft">
                  {currentUser && (
                    <div className="flex items-center gap-3 px-4 py-3 mb-1 border-b border-[color:var(--kub-border-color)]">
                      <UserAvatar user={currentUser} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate text-[color:var(--kub-text)]">
                          {currentUser.full_name ?? "Пользователь"}
                        </div>
                        <div className="text-xs truncate text-[color:var(--kub-muted)]">
                          {currentUser.username ? `@${currentUser.username}` : "Без имени пользователя"}
                        </div>
                      </div>
                    </div>
                  )}
                  {menuItems.map(({ icon, label, danger, accent, action, note }) => (
                    <button
                      key={label}
                      className={cn(
                        "flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-[var(--kub-surface-3)]",
                        danger
                          ? "text-[color:var(--kub-danger)]"
                          : accent
                            ? "text-[color:var(--kub-cyan)]"
                            : "text-[color:var(--kub-text)]"
                      )}
                      onClick={action}
                    >
                      <KubIcon
                        name={icon}
                        size={16}
                        className={cn(
                          danger
                            ? "text-[color:var(--kub-danger)]"
                            : accent
                              ? "text-[color:var(--kub-cyan)]"
                              : "text-[color:var(--kub-muted)]"
                        )}
                      />
                      <span className="flex-1 text-left">{label}</span>
                      {note && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--kub-cyan)]">
                          {note}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 h-9 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Поиск чатов…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => !searchQuery && setIsSearchFocused(false)}
            className="min-w-0 flex-1 truncate bg-transparent text-sm outline-none text-[color:var(--kub-text)]"
          />
          {searchQuery && (
            <button className="shrink-0" onClick={() => setSearchQuery("")} aria-label="Очистить">
              <KubIcon name="close" size={12} className="text-[color:var(--kub-muted)]" />
            </button>
          )}
        </div>

        {!isSearchFocused && !searchQuery && (
          <>
            <NotificationBell />
            <KubTooltip label="Новый чат" side="bottom">
              <button
                onClick={onNewChat}
                className={cn(iconButtonClass, "text-[color:var(--kub-cyan)]")}
                aria-label="Новый чат"
              >
                <KubIcon name="edit" size={17} />
              </button>
            </KubTooltip>
          </>
        )}
      </div>
    </div>
  );
}
