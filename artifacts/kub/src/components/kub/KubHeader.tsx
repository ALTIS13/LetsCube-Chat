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
        "flex items-center gap-3 px-4 h-14 flex-shrink-0",
        "bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]",
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
