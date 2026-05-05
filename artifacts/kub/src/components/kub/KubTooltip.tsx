import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KubTooltipProps {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  className?: string;
}

const sideClass = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

export function KubTooltip({ label, side = "top", children, className }: KubTooltipProps) {
  return (
    <span className={cn("relative inline-flex group", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium",
          "bg-[var(--kub-surface-3)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)]",
          "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
          sideClass[side]
        )}
      >
        {label}
      </span>
    </span>
  );
}
