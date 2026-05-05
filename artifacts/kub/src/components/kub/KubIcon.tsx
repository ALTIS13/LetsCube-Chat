"use client";

import * as React from "react";
import type { IconWeight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { KUB_ICONS, type KubIconName } from "./icons";

export type KubIconTone =
  | "default"
  | "accent"
  | "pink"
  | "muted"
  | "danger"
  | "warn"
  | "online"
  | "inverse"
  | "currentColor";

const toneClass: Record<KubIconTone, string> = {
  default: "text-[color:var(--kub-text)]",
  accent: "text-[color:var(--kub-cyan)]",
  pink: "text-[color:var(--kub-pink)]",
  muted: "text-[color:var(--kub-muted)]",
  danger: "text-[color:var(--kub-danger)]",
  warn: "text-[color:var(--kub-warn)]",
  online: "text-[color:var(--kub-online)]",
  inverse: "text-[color:var(--kub-bg)]",
  currentColor: "",
};

export interface KubIconProps {
  name: KubIconName;
  size?: number;
  weight?: IconWeight;
  tone?: KubIconTone;
  className?: string;
  /**
   * If provided, the icon is wrapped in a `role="img"` element with this
   * accessible name (and a visually hidden text fallback). Use for icon-only
   * standalone graphics. Icon-only buttons should put `aria-label` on the
   * button itself instead.
   */
  label?: string;
  /** Add `animate-spin` (used for the spinner). */
  spin?: boolean;
}

export const KubIcon = React.forwardRef<SVGSVGElement, KubIconProps>(function KubIcon(
  { name, size = 20, weight, tone = "currentColor", className, label, spin },
  ref,
) {
  const entry = KUB_ICONS[name];
  const Icon = entry.Icon;
  const w: IconWeight = weight ?? entry.weight ?? "bold";
  const isSpinner = name === "spinner" || spin;

  const svg = (
    <Icon
      ref={ref}
      size={size}
      weight={w}
      className={cn(toneClass[tone], isSpinner && "animate-spin", className)}
      aria-hidden={label ? "true" : undefined}
    />
  );

  if (label) {
    return (
      <span role="img" aria-label={label} className="inline-flex">
        {svg}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return svg;
});
