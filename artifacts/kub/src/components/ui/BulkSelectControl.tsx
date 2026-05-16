"use client";

import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";

interface BulkSelectControlProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}

export function BulkSelectControl({ checked, onChange, label, className }: BulkSelectControlProps) {
  return (
    <label
      className={cn(
        "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-all",
        "focus-within:ring-2 focus-within:ring-[color:var(--kub-cyan)]/40",
        checked
          ? "border-[color:var(--kub-cyan)] bg-[color:var(--kub-cyan)] text-[color:var(--kub-bg)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_16%,transparent)]"
          : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-transparent hover:border-[color:var(--kub-cyan)]/50 hover:text-[color:var(--kub-muted)]",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      title={label}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
        aria-label={label}
      />
      <KubIcon name="check" size={15} />
    </label>
  );
}
