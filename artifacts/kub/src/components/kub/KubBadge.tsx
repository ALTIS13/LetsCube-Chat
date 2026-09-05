import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "cyan" | "pink" | "muted" | "online" | "danger" | "warn";

interface KubBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  pill?: boolean;
  /** Defaults to a dot on every coloured tone; see the note below. */
  dot?: boolean;
  children: ReactNode;
}

/**
 * A status chip.
 *
 * The label used to be painted in the tone and set on an 18% tint of the same
 * tone, which is the pairing that fails: measured across the three surfaces the
 * badge sits on, that combination ranged from 3.17:1 to 5.55:1, and the audit
 * caught "Активна" at 2.62:1. See D-011 and the register's audit pass.
 *
 * Removing the tint alone was not enough — on `--kub-surface-3` the tone as text
 * still measures 4.05:1 (cyan), 4.18:1 (pink) and 3.82:1 (danger), all under the
 * 4.5:1 a label needs. So the label takes the interface text colour, which
 * passes on every surface, and the tone moves to the dot and the border, where
 * the requirement is 3:1 and every tone clears it.
 *
 * That makes the dot load-bearing rather than decorative: with a neutral label,
 * a thin border would be the only carrier of meaning left. It is therefore on by
 * default for coloured tones, and it also means status is never signalled by
 * colour alone — there is a dot, a border and a word.
 */
const borderClass: Record<Tone, string> = {
  cyan: "border-[color:color-mix(in_srgb,var(--kub-cyan)_55%,transparent)]",
  pink: "border-[color:color-mix(in_srgb,var(--kub-pink)_55%,transparent)]",
  muted: "border-[color:var(--kub-border-color)]",
  online: "border-[color:color-mix(in_srgb,var(--kub-online)_55%,transparent)]",
  danger: "border-[color:color-mix(in_srgb,var(--kub-danger)_55%,transparent)]",
  warn: "border-[color:color-mix(in_srgb,var(--kub-warn)_55%,transparent)]",
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
  dot,
  className,
  children,
  ...rest
}: KubBadgeProps) {
  const showDot = dot ?? tone !== "muted";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 text-[12px] font-semibold text-[color:var(--kub-text)]",
        pill ? "rounded-full" : "rounded-md",
        borderClass[tone],
        className,
      )}
      {...rest}
    >
      {showDot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}
