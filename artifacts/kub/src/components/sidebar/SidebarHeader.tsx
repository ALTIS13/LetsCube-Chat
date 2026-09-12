"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { useSignOut } from "@/hooks/useUser";
import { useTheme } from "@/hooks/useTheme";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { useHint } from "@/hooks/useHint";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubBrandLogo, KubHint, KubIcon, KubTooltip, type KubIconName } from "@/components/kub";
import { SettingsModal } from "./SettingsModal";
import { NewGroupModal } from "./NewGroupModal";
import { NotificationBell } from "./NotificationBell";
import { cn } from "@/lib/utils";
import { openSavedMessagesChat } from "@/lib/savedMessages";
import { openSupportWindow } from "@/lib/supportWindowEvents";

interface SidebarHeaderProps {
  onNewChat?: () => void;
  onRefetch?: () => void;
  /** The list has scrolled, so the phone's search row is tucked away. */
  searchTucked?: boolean;
  /** Bring it back, from the magnifier this header shows in its place. */
  onUntuckSearch?: () => void;
}

export function SidebarHeader({ onNewChat, onRefetch, searchTucked, onUntuckSearch }: SidebarHeaderProps) {
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
  const { resolvedTheme } = useTheme();
  const isStaff = useIsManagerOrAdmin();
  const { canAccessTasks } = useTaskAccessGate();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Never while a person is searching: the field may not go out from under
  // the cursor, and a query has to keep the box it was typed into.
  const tuck = Boolean(searchTucked) && !searchQuery && !isSearchFocused;
  // Administration on the main screen, for whoever has just been given it.
  // Phone only: on a computer it is a row in the side list already.
  //
  // The width belongs in the condition, not only in the button's class. With
  // `md:hidden` alone the button vanished but the popover still opened,
  // anchored to a `display: none` box, and radix portalled the plate over the
  // chat list where it swallowed the pointer — a drag retried twenty times
  // and timed out against it on 2026-09-12. `useIsMobile` is the product's
  // own signal and matches the same 768 the class does.
  const isPhone = useIsMobile();
  const adminHint = useHint("admin-entry", { enabled: isStaff && isPhone });
  const iconButtonClass =
    "kub-icon-action kub-interactive h-9 w-9 shrink-0 rounded-lg transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]";

  // Search commands use `mobileSection='search'` as a one-shot focus signal.
  useEffect(() => {
    if (mobileSection !== "search") return;
    searchInputRef.current?.focus();
    setMobileSection("chats");
  }, [mobileSection, setMobileSection]);

  // Ctrl/Cmd+K, which belongs to this field rather than to any panel.
  //
  // It lived in `GlobalSearchPalette` until 2026-09-12 and was already written
  // to prefer this field: the handler called `focusSidebarSearchInput()` first
  // and only opened the palette when that returned false. The palette was
  // deleted with the phone's «Поиск» tab, so the half that ran on a computer
  // moved here and the fallback has nothing left to fall back to.
  //
  // The guards are the ones that half carried, kept rather than reasoned about
  // again: below 768 it does nothing, and it clears the query before focusing.
  // `preventDefault` now happens only once the field is actually reachable, so
  // where the shortcut does nothing the browser keeps its own Ctrl+K.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      if (window.innerWidth < 768) return;
      const input = searchInputRef.current;
      if (!input || input.offsetParent === null) return;
      event.preventDefault();
      setSearchQuery("");
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchQuery]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  // Shared with the desktop side list, which offers the same row. The body
  // moved to `lib/savedMessages.ts` unchanged: two copies of a chat-creation
  // path already narrowed once by an RLS lockdown is what drifts.
  const openSavedMessages = async () => {
    setMenuOpen(false);
    await openSavedMessagesChat({ userId, setSelectedChatId, onRefetch });
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
    { icon: "bot",      label: "Мои боты",     action: () => { setMenuOpen(false); setLocation("/bots"); } },
    ...(canAccessTasks
      ? [{ icon: "tasks" as const, label: "Задачи", accent: true, action: () => { setMenuOpen(false); setLocation("/tasks"); } } satisfies MenuItem]
      : []),
    { icon: "settings", label: "Настройки",    action: () => { setMenuOpen(false); setShowSettings(true); } },
    ...(isStaff
      ? [{ icon: "shield" as const, label: "Админ-панель", accent: true, action: () => { setMenuOpen(false); setLocation("/admin"); } } satisfies MenuItem]
      : []),
    // "Помощь" used to open github.com in a new tab — a placeholder that
    // survived into production. The product has its own support desk, staffed
    // through the admin support queue, and a signed-in person reaches it in a
    // window they can move rather than by leaving the screen they are asking
    // about. The /support route stays for guests.
    { icon: "help",   label: "Помощь", action: () => { setMenuOpen(false); openSupportWindow(); } },
    { icon: "logout", label: "Выйти",  danger: true, action: async () => { setMenuOpen(false); await signOut(); } },
  ];

  return (
    // This is the top of the window at every width since 2026-09-12: the
    // application's top bar used to be above it from `md` and carried the
    // inset, and there is no bar now. So it pads both of them out of its own
    // top — the status bar and the Dynamic Island of the installed iPhone app,
    // and the Windows app's own caption buttons — and the column's material
    // runs under all of it, because the glass is a layer on the column rather
    // than a fill on this box.
    <div className="flex-shrink-0 border-b border-[color:var(--kub-border-color)] pt-window-top">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} onRefetch={onRefetch} />}

      <div
        // Two lines on a phone and one from `md`. The field is the only item
        // that wraps, so the title line keeps the row's own height and the
        // search row sits under it — Telegram's arrangement on Android. From
        // `md` the row is exactly what it was, which is what keeps this
        // header's bottom edge level with the chat header's (a contract
        // `unified-interface-chrome` measures to within a pixel).
        className="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pb-1.5 min-h-[var(--kub-control-row-height)] md:h-[var(--kub-control-row-height)] md:min-h-0 md:flex-nowrap md:pb-0"
        data-testid="sidebar-control-row"
      >
        <KubBrandLogo
          variant="mark"
          tone={resolvedTheme === "light" ? "dark" : "light"}
          // At every width since 2026-09-12. On a computer the application's
          // top bar no longer has to be the only place the mark appears, and
          // the owner took this one detail from option B: without it the logo
          // is nowhere on a computer once the list column is the top row.
          className="mr-0.5 h-8 w-8 shrink-0"
          imgClassName="h-8 w-8"
          alt="LETSCUBE"
        />
        {isSearchFocused || searchQuery ? (
          <button
            onClick={() => { setSearchQuery(""); setIsSearchFocused(false); }}
            className={cn(iconButtonClass, "text-[color:var(--kub-cyan)]")}
            aria-label="Очистить поиск"
          >
            <KubIcon name="close" size={18} />
          </button>
        ) : (
          // Below `md` only. From `md` this button is the first thing on the
          // folder rail, where `FiltersMenu::_menu` puts it in Telegram
          // Desktop, and it opens the side list as a layer rather than this
          // dropdown. See `FolderRail` and `SideMenuLayer`.
          <div className="relative shrink-0 md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="kub-icon-action kub-interactive h-9 w-9 shrink-0 rounded-lg transition-colors kub-raise-hover p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
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
                <div
                  role="menu"
                  data-kub-menu="true"
                  // `-strong`, because this covers the chat list it opens over.
                  // The glow and shadow-2xl are gone: both set box-shadow, and
                  // whichever won would have replaced the material's own.
                  //
                  // Held sideways a phone is 393px tall and this menu is
                  // taller, and with `overflow-hidden` its last item — «Выйти» —
                  // was cut off on the home indicator with no way to reach it.
                  // It is capped to the screen the hardware leaves, less the
                  // 8.5rem above it at its lowest (the top bar, the row, the
                  // 48px drop), and scrolls; on a desktop the cap is far taller
                  // than the menu and changes nothing.
                  className="kub-glass-strong absolute left-0 top-12 w-64 rounded-xl z-50 py-1 max-h-[calc(100dvh-var(--kub-safe-top)-var(--kub-safe-bottom)-8.5rem)] overflow-y-auto border border-[color:var(--kub-border-color)]"
                >
                  {currentUser && (
                    <div className="flex items-center gap-3 px-4 py-3 mb-1 border-b border-[color:var(--kub-rule)]">
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
                        "flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors kub-raise-hover",
                        danger
                          ? "text-[color:var(--kub-danger-text)]"
                          : accent
                            ? "text-[color:var(--kub-accent-text)]"
                            : "text-[color:var(--kub-text)]"
                      )}
                      onClick={action}
                    >
                      <KubIcon
                        name={icon}
                        size={16}
                        className={cn(
                          danger
                            ? "text-[color:var(--kub-danger-text)]"
                            : accent
                              ? "text-[color:var(--kub-accent-text)]"
                              : "text-[color:var(--kub-muted)]"
                        )}
                      />
                      <span className="flex-1 text-left">{label}</span>
                      {note && (
                        <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">
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

        {/* --kub-inset, not --kub-surface-2. The panel behind this field is now
            translucent chrome that composites above --kub-surface-2, so the
            field went flush with it — measured at rgb(11,33,58) inside a panel
            of rgb(13,33,58), which is a hollow outline rather than a well.
            --kub-inset is the token for what a field is cut into. */}
        {/* Below `md` only, and it carries no meaning: it takes the slack the
            search field used to take on this line, so the bell, the pencil and
            the magnifier sit on the right edge instead of bunching against the
            logo. From `md` it is gone and the field stretches the row again. */}
        <div aria-hidden="true" className="min-w-0 flex-1 md:hidden" />

        {/* The wrapper is what collapses, never the field. A field whose own
            box goes to zero stops being visible to the four specs that
            assert it; a field inside a clipped wrapper keeps its box and
            its visibility, which was measured rather than assumed. */}
        <div
          className={cn(
            "order-last w-full min-w-0 basis-full transition-[max-height,opacity] duration-200 md:order-none md:w-auto md:basis-auto md:flex-1",
            tuck
              ? "max-h-0 overflow-hidden opacity-0 md:max-h-none md:overflow-visible md:opacity-100"
              : "max-h-12 opacity-100",
          )}
        >
        <div className="kub-field min-w-0 flex-1 gap-2 rounded-lg px-3 h-9 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)] transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            ref={searchInputRef}
            data-testid="sidebar-search-input"
            type="text"
            placeholder="Поиск людей, чатов, сообщений или +номера…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => !searchQuery && setIsSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                setSearchQuery("");
              }
            }}
            className="h-full min-w-0 flex-1 truncate bg-transparent text-sm outline-none text-[color:var(--kub-text)]"
          />
          {searchQuery && (
            <button className="kub-icon-action kub-interactive shrink-0 rounded-md text-[color:var(--kub-muted)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]" onClick={() => setSearchQuery("")} aria-label="Очистить">
              <KubIcon name="close" size={12} className="text-[color:var(--kub-muted)]" />
            </button>
          )}
        </div>
        </div>

        {/* In the field's place while it is tucked, and named «Поиск»: this
            is the phone's way back to search now that the tab is gone. */}
        {tuck && (
          <button
            type="button"
            onClick={() => {
              onUntuckSearch?.();
              window.requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            className={cn(iconButtonClass, "md:hidden text-[color:var(--kub-muted)]")}
            aria-label="Поиск"
          >
            <KubIcon name="search" size={18} />
          </button>
        )}

        {!isSearchFocused && !searchQuery && (
          <>
            {/* Administration, on the main screen and marked while the hint
                that introduces it is unread. A 36px button, which is what the
                ring needs: the same ring around an 18px glyph in the settings
                row could not be seen in either theme. `md:hidden`, because a
                computer keeps administration in the side list and a second
                entry beside it would be one more thing drawn twice. */}
            {isStaff && (
              <KubHint
                open={adminHint.visible}
                onDismiss={adminHint.dismiss}
                side="bottom"
                align="end"
                // Below the whole header block, not just below the shield.
                // Measured at 390 on 2026-09-12: the shield's foot is at 36
                // and the block — title line, search row, folder strip —
                // ends at 124, so 88 is what clears it. At 8 the plate came
                // down over the search field and the filters. Where it lands
                // instead is the list, which is content; Telegram overlays
                // content too, and never a field.
                sideOffset={88}
                text="Управление сообществом живёт здесь: пользователи, баны и мьюты."
              >
                <button
                  type="button"
                  onClick={() => setLocation("/admin")}
                  aria-label="Управление"
                  className={cn(
                    iconButtonClass,
                    "md:hidden",
                    adminHint.visible
                      ? "kub-glow-pink bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)]"
                      : "text-[color:var(--kub-muted)]",
                  )}
                >
                  <KubIcon name="shield" size={18} />
                </button>
              </KubHint>
            )}
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
