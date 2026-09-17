import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KubHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  leading?: ReactNode;
  trailing?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
}

export function KubHeader({
  leading,
  trailing,
  title,
  subtitle,
  className,
  children,
  ...rest
}: KubHeaderProps) {
  return (
    <header
      className={cn(
        // A page header is the top of its screen — the tasks and bots pages
        // are the only users — so the status bar's inset is added to its 56px
        // and padded out of its top, and the material runs under the status
        // bar while the row stays the height it was.
        //
        // And the window's own caption strip is added the same way (D-112).
        // The Windows shell draws minimise, maximise and close as
        // `DesktopWindowChrome`, a 2rem overlay that takes no height from the
        // page, so a page that reserves only the hardware inset puts its own
        // top-right control underneath them: measured on “Задачи”, 64% of
        // «+ Новая» did not take a click and pointing at it raised the maximise
        // button's tooltip. The messenger's panes reserve it already
        // (`pt-window-top` in `ChatHeader`, `FolderRail`, `SidebarHeader`); this
        // is the same reservation for the pages that are not the messenger.
        //
        // `--kub-window-caption` is 0px everywhere but the Windows shell, so
        // nothing else moves by a pixel.
        "flex items-center gap-3 px-4 h-[calc(3.5rem+var(--kub-safe-top)+var(--kub-window-caption))] pt-window-top flex-shrink-0",
        // `relative`, no z-index: positioned is enough to lay the shadow over
        // what follows, and a z-index would make this a stacking context that
        // the page's own dialogs would then have to out-rank.
        "kub-glass relative border-b border-[color:var(--kub-border-color)]",
        className
      )}
      {...rest}
    >
      {leading && <div className="flex-shrink-0 flex items-center gap-2">{leading}</div>}
      {(title || subtitle) && (
        <div className="flex-1 min-w-0">
          {title && (
            <div className="text-sm font-semibold text-[color:var(--kub-text)] truncate">
              {title}
            </div>
          )}
          {subtitle && (
            <div className="text-xs text-[color:var(--kub-muted)] truncate">{subtitle}</div>
          )}
        </div>
      )}
      {!title && !subtitle && children && <div className="flex-1 min-w-0">{children}</div>}
      {trailing && <div className="flex-shrink-0 flex items-center gap-1">{trailing}</div>}
    </header>
  );
}
