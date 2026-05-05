import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KubCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  accent?: "cyan" | "pink" | "none";
}

export const KubCard = forwardRef<HTMLDivElement, KubCardProps>(
  ({ title, subtitle, icon, actions, accent = "cyan", className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border bg-[var(--kub-surface)] border-[color:var(--kub-border-color)] p-4 transition-colors",
          "hover:border-[color:var(--kub-cyan)]/40",
          className
        )}
        {...rest}
      >
        {(title || icon || actions) && (
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0",
                    accent === "cyan" && "bg-[color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] text-[color:var(--kub-cyan)]",
                    accent === "pink" && "bg-[color-mix(in_srgb,var(--kub-pink)_15%,transparent)] text-[color:var(--kub-pink)]",
                    accent === "none" && "bg-[var(--kub-surface-2)] text-[color:var(--kub-text)]"
                  )}
                >
                  {icon}
                </span>
              )}
              <div className="min-w-0">
                {title && (
                  <div className="font-semibold text-sm text-[color:var(--kub-text)] truncate">
                    {title}
                  </div>
                )}
                {subtitle && (
                  <div className="text-xs text-[color:var(--kub-muted)] truncate mt-0.5">
                    {subtitle}
                  </div>
                )}
              </div>
            </div>
            {actions && <div className="flex-shrink-0">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    );
  }
);
KubCard.displayName = "KubCard";
