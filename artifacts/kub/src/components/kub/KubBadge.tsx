import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "cyan" | "pink" | "muted" | "online" | "danger" | "warn";

interface KubBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  pill?: boolean;
  dot?: boolean;
  children: ReactNode;
}

const toneClass: Record<Tone, string> = {
  cyan: "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-cyan)] border-[color:var(--kub-cyan)]/30",
  pink: "bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)] border-[color:var(--kub-pink)]/30",
  muted: "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border-[color:var(--kub-border-color)]",
  online: "bg-[color-mix(in_srgb,var(--kub-online)_18%,transparent)] text-[color:var(--kub-online)] border-[color:var(--kub-online)]/30",
  danger: "bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)] text-[color:var(--kub-danger)] border-[color:var(--kub-danger)]/30",
  warn: "bg-[color-mix(in_srgb,var(--kub-warn)_18%,transparent)] text-[color:var(--kub-warn)] border-[color:var(--kub-warn)]/30",
};

const dotClass: Record<Tone, string> = {
  cyan: "bg-[var(--kub-cyan)]",
  pink: "bg-[var(--kub-pink)]",
  muted: "bg-[color:var(--kub-muted)]",
  online: "bg-[var(--kub-online)]",
  danger: "bg-[var(--kub-danger)]",
  warn: "bg-[var(--kub-warn)]",
};

export function KubBadge({
  tone = "cyan",
  pill = false,
  dot = false,
  className,
  children,
  ...rest
}: KubBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border",
        pill ? "rounded-full" : "rounded-md",
        toneClass[tone],
        className
      )}
      {...rest}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}
