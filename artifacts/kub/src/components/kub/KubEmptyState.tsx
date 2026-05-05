import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KubEmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: "panel" | "plain";
}

export function KubEmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "plain",
}: KubEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-10 gap-3",
        variant === "panel" && "kub-panel",
        className
      )}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)] text-[color:var(--kub-cyan)] kub-glow-soft">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</h3>
      {description && (
        <p className="text-xs text-[color:var(--kub-muted)] max-w-xs leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
