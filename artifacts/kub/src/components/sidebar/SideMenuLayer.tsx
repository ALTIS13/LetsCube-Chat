"use client";

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

import { KubGlassLayer, KubIcon, KubSwitch, type KubIconName } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useSignOut } from "@/hooks/useUser";
import { useTheme } from "@/hooks/useTheme";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { FOCUS_RING } from "@/lib/controlSurface";
import { getBuildMetadata } from "@/lib/monitoring";
import { getDesktopBridge } from "@/lib/platform/desktop";
import { getVisibleReleaseVersion } from "@/lib/releaseVersionLabel";
import { openSupportWindow } from "@/lib/supportWindowEvents";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";

/**
 * The side list, as a layer over the window.
 *
 * `Window::MainMenu` in Telegram Desktop is declared `final : public
 * Ui::LayerWidget` — not a column and not a dropdown anchored under a button.
 * That is the finding the owner's «на windows удобно в боковом списке
 * выпадающем по надобности» asks for: it costs no width while it is closed, and
 * it is where administration lives on a computer.
 *
 * It opens from the button at the top of the folder rail, which is where
 * `FiltersMenu::_menu` sits.
 *
 * Two notes on the material.
 *
 *  - This is a **covering** surface, so `--glass-fill-strong` — the same fill
 *    the avatar dropdown it replaces already wore. No new sheet is stacked on
 *    the desktop: one dropdown's glass became one layer's glass.
 *  - The fill is a `KubGlassLayer` leaf rather than a filter on the panel, so
 *    the panel is not a containing block for the `fixed` dialogs its rows open
 *    (rule 3), and the row over the layer is positioned so tree order paints it
 *    on top without a z-index (rules 3 and 12).
 */

interface SideMenuLayerProps {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenNewGroup: () => void;
  onOpenSaved: () => void;
}

type Row = {
  icon: KubIconName;
  label: string;
  accent?: boolean;
  danger?: boolean;
  action: () => void;
};

export function SideMenuLayer({ onClose, onOpenSettings, onOpenNewGroup, onOpenSaved }: SideMenuLayerProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const [, setLocation] = useLocation();
  const signOut = useSignOut();
  const { resolvedTheme, setTheme } = useTheme();
  const isStaff = useIsManagerOrAdmin();
  const { canAccessTasks } = useTaskAccessGate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // The layer takes the keyboard when it opens, so Tab walks its own rows and
  // not the list behind it.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const go = (path: string) => () => {
    onClose();
    setLocation(path);
  };

  const rows: Row[] = [
    // Today this and «Настройки» land on the same surface: a person's own
    // profile is the first block of the settings dialog and there is no
    // self-profile view to open. Giving them separate destinations is the
    // profile stage's work — one component that re-dresses itself — and is
    // deliberately not done here.
    { icon: "profile", label: "Мой профиль", action: () => { onClose(); onOpenSettings(); } },
    { icon: "bookmark", label: "Избранное", action: () => { onClose(); onOpenSaved(); } },
    { icon: "group", label: "Новая группа", action: () => { onClose(); onOpenNewGroup(); } },
    { icon: "bot", label: "Мои боты", action: go("/bots") },
    ...(canAccessTasks ? [{ icon: "tasks" as const, label: "Задачи", accent: true, action: go("/tasks") } satisfies Row] : []),
    ...(isStaff ? [{ icon: "shield" as const, label: "Управление", accent: true, action: go("/admin") } satisfies Row] : []),
    { icon: "settings", label: "Настройки", action: () => { onClose(); onOpenSettings(); } },
    { icon: "help", label: "Помощь", action: () => { onClose(); openSupportWindow(); } },
    { icon: "logout", label: "Выйти", danger: true, action: async () => { onClose(); await signOut(); } },
  ];

  // The installed version first, the bundle's second — the pair
  // `ReleaseDistributionSection` already reads. In the Windows app the two
  // differ, and the one a person means by «версия» is the one they installed.
  // A development build has neither, and `getVisibleReleaseVersion` refuses
  // «0.0.0», so the line is simply absent there rather than saying nothing.
  const versionLabel = getVisibleReleaseVersion(getDesktopBridge()?.version ?? getBuildMetadata().version);

  return (
    <>
      {/* The way out, and the reason the layer costs no width while closed. */}
      <div
        className="fixed inset-0 z-40"
        data-testid="side-menu-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Боковое меню"
        tabIndex={-1}
        data-kub-menu="true"
        data-testid="side-menu-layer"
        // The layer is pinned to the window's top edge, so its rows start clear
        // of whatever takes that edge — the iPad's status bar, and the Windows
        // app's own caption buttons, which the application's top bar used to
        // stand between this and (rule 13). It is a strip at the left, so it
        // never reaches those buttons; what it would otherwise reach is the
        // drag region beside them.
        className="fixed inset-y-0 left-0 z-50 flex w-[19rem] max-w-[85vw] flex-col border-r border-[color:var(--kub-border-color)] outline-none"
      >
        <KubGlassLayer strong />
        <div className="relative flex min-h-0 flex-1 flex-col pt-window-top pb-safe">
          {currentUser && (
            <div className="flex shrink-0 items-center gap-3 border-b border-[color:var(--kub-rule)] px-4 py-4">
              <UserAvatar user={currentUser} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">
                  {currentUser.full_name ?? "Пользователь"}
                </div>
                <div className="truncate text-xs text-[color:var(--kub-muted)]">
                  {currentUser.username ? `@${currentUser.username}` : "Без имени пользователя"}
                </div>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {rows.map(({ icon, label, accent, danger, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => void action()}
                data-testid="side-menu-row"
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors kub-raise-hover",
                  FOCUS_RING,
                  danger
                    ? "text-[color:var(--kub-danger-text)]"
                    : accent
                      ? "text-[color:var(--kub-accent-text)]"
                      : "text-[color:var(--kub-text)]",
                )}
              >
                <KubIcon
                  name={icon}
                  size={16}
                  className={cn(
                    danger
                      ? "text-[color:var(--kub-danger-text)]"
                      : accent
                        ? "text-[color:var(--kub-accent-text)]"
                        : "text-[color:var(--kub-muted)]",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="shrink-0 border-t border-[color:var(--kub-rule)] px-4 py-3">
            <label className="flex items-center gap-3 text-sm text-[color:var(--kub-text)]">
              <KubIcon name="themeDark" size={16} className="text-[color:var(--kub-muted)]" />
              <span className="min-w-0 flex-1 truncate">Ночной режим</span>
              <KubSwitch
                checked={resolvedTheme === "dark"}
                onCheckedChange={(next) => setTheme(next ? "dark" : "light")}
                aria-label="Ночной режим"
                data-testid="side-menu-night-mode"
              />
            </label>
            {versionLabel && (
              <p
                data-testid="side-menu-version"
                className="mt-3 text-[11px] text-[color:var(--kub-muted)]"
              >
                {versionLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
