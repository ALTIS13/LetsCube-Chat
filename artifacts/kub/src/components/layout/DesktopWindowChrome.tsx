"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";

import { KubIcon } from "@/components/kub";
import { getDesktopBridge, isDesktopApp } from "@/lib/platform/desktop";
import { cn } from "@/lib/utils";

/**
 * Window chrome for the surfaces the messenger shell does not cover.
 *
 * The Tauri window is built with `decorations: false`, so the application draws
 * its own title bar. That bar lives in `AppTopBar`, which is rendered only by
 * `MainLayout` — the authenticated messenger. Every other surface therefore had
 * no window controls and, worse, no drag region: on the login screen the window
 * could not be minimised, closed, or even moved. Confirmed by dragging it and
 * watching it stay put. See D-016.
 *
 * This renders nothing outside the Windows shell, and nothing where `AppTopBar`
 * is already present, so the messenger keeps exactly one title bar.
 */
export function DesktopWindowChrome({ suppressed = false }: { suppressed?: boolean }) {
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
    if (!desktop || suppressed) return;
    void refreshMaximized();
    window.addEventListener("resize", refreshMaximized);
    return () => window.removeEventListener("resize", refreshMaximized);
  }, [desktop, suppressed, refreshMaximized]);

  if (!desktop || suppressed) return null;

  const run = (action: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    void action(bridge).catch(() => undefined);
  };

  const startDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    run((bridge) => bridge.startDragging());
  };

  const toggleMaximize = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    run(async (bridge) => {
      await bridge.toggleMaximize();
      await refreshMaximized();
    });
  };

  return (
    <header
      data-testid="desktop-window-chrome"
      className="fixed inset-x-0 top-0 z-50 flex h-8 select-none items-center justify-end bg-transparent"
      onMouseDown={startDrag}
      onDoubleClick={toggleMaximize}
    >
      {/* The glyphs mirror AppTopBar's so the two bars cannot drift apart. */}
      <Control label="Свернуть" onClick={() => run((bridge) => bridge.minimize())}>
        <span className="h-px w-3 bg-current" aria-hidden="true" />
      </Control>
      <Control
        label={maximized ? "Восстановить размер" : "Развернуть"}
        onClick={() =>
          run(async (bridge) => {
            await bridge.toggleMaximize();
            await refreshMaximized();
          })
        }
      >
        <span className="relative h-3.5 w-3.5" aria-hidden="true">
          <span className={cn("absolute border border-current", maximized ? "left-0 top-1 h-2.5 w-2.5" : "inset-0")} />
          {maximized && <span className="absolute right-0 top-0 h-2.5 w-2.5 border border-current" />}
        </span>
      </Control>
      <Control label="Свернуть в область уведомлений" danger onClick={() => run((bridge) => bridge.closeToTray())}>
        <KubIcon name="close" size={15} tone="currentColor" />
      </Control>
    </header>
  );
}

function Control({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 items-center justify-center text-[color:var(--kub-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kub-cyan)]",
        danger
          ? "hover:bg-[var(--kub-danger)] hover:text-white"
          : "kub-raise-hover hover:text-[color:var(--kub-text)]",
      )}
    >
      {children}
    </button>
  );
}
