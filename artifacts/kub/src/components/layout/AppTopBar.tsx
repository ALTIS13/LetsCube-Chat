"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { KubBrandLogo, KubIcon } from "@/components/kub";
import { useTheme } from "@/hooks/useTheme";
import { getDesktopBridge, isDesktopApp } from "@/lib/platform/desktop";
import { cn } from "@/lib/utils";

export function AppTopBar() {
  const { resolvedTheme } = useTheme();
  const desktop = isDesktopApp();
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      setMaximized(await bridge.isMaximized());
    } catch {
      setMaximized(false);
    }
  }, []);

  useEffect(() => {
    if (!desktop) return;
    void refreshMaximized();
    window.addEventListener("resize", refreshMaximized);
    return () => window.removeEventListener("resize", refreshMaximized);
  }, [desktop, refreshMaximized]);

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!desktop || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    runWindowAction((bridge) => bridge.startDragging());
  };

  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!desktop || (event.target as HTMLElement).closest("button")) return;
    runWindowAction(async (bridge) => {
      await bridge.toggleMaximize();
      await refreshMaximized();
    });
  };

  const runWindowAction = (action: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    void action(bridge).catch(() => undefined);
  };

  return (
    <header
      className={cn(
        // The bar opens nothing, so it can wear the material directly. It is
        // `relative` and deliberately has no z-index: a z-index would make it a
        // stacking context that every dialog in the product then has to beat,
        // and being positioned is already enough to put its shadow over the
        // panes below.
        "kub-glass relative hidden h-[var(--kub-app-topbar-height)] shrink-0 select-none items-center border-b border-[color:var(--kub-border-color)] md:flex",
        desktop ? "pl-3" : "px-3",
      )}
      data-testid="app-top-bar"
      data-desktop-runtime={desktop ? "windows" : "web"}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div data-testid="authenticated-shell-brand" className="flex min-w-0 flex-1 items-center">
        <KubBrandLogo
          variant="horizontal"
          tone={resolvedTheme === "light" ? "dark" : "light"}
          className="h-7 w-[161px] shrink-0"
          imgClassName="h-full w-full"
          alt="LETSCUBE"
        />
      </div>
      {desktop && (
        <div className="flex h-full shrink-0 items-stretch" data-testid="desktop-window-controls">
          <WindowControlButton label="Свернуть" onClick={() => runWindowAction((bridge) => bridge.minimize())}>
            <span className="h-px w-3 bg-current" aria-hidden="true" />
          </WindowControlButton>
          <WindowControlButton
            label={maximized ? "Восстановить размер" : "Развернуть"}
            onClick={() => runWindowAction(async (bridge) => {
              await bridge.toggleMaximize();
              await refreshMaximized();
            })}
          >
            <span className="relative h-3.5 w-3.5" aria-hidden="true">
              <span className={cn("absolute border border-current", maximized ? "left-0 top-1 h-2.5 w-2.5" : "inset-0")} />
              {maximized && <span className="absolute right-0 top-0 h-2.5 w-2.5 border border-current" />}
            </span>
          </WindowControlButton>
          <WindowControlButton
            label="Свернуть в область уведомлений"
            danger
            onClick={() => runWindowAction((bridge) => bridge.closeToTray())}
          >
            <KubIcon name="close" size={15} tone="currentColor" />
          </WindowControlButton>
        </div>
      )}
    </header>
  );
}

function WindowControlButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 items-center justify-center text-[color:var(--kub-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--kub-cyan)]",
        danger
          ? "hover:bg-[var(--kub-danger)] hover:text-white"
          : "hover:bg-[var(--kub-surface-3)] hover:text-[color:var(--kub-text)]",
      )}
    >
      {children}
    </button>
  );
}
