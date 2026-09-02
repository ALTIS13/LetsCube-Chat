import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warn" | "danger";

// `title` is omitted from the inherited attributes on purpose: the DOM one is a
// tooltip string, and this component's is a heading node.
interface KubNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: Tone;
  /** A short heading above the body. Optional: most notices are one sentence. */
  title?: ReactNode;
  children: ReactNode;
}

/**
 * An inline notice — the boxed sentence that explains a consequence, a warning
 * or a result, without interrupting like a modal.
 *
 * It exists because the pattern was hand-rolled in dozens of places, and
 * always in the shape that fails: the sentence painted in the tone, on a tint
 * of the same tone. Measured, that pairing came out at 3.74:1 for a warning and
 * 3.98:1 for a success figure, both under the 4.5:1 a sentence needs, and the
 * audit found 76 instances of it across the product.
 *
 * The rule is the one already settled for `KubBadge`: the sentence takes the
 * interface text colour, which is readable on every surface, and the tone lives
 * in the rail and the marker, where the requirement is 3:1. The tint stays but
 * only as a wash — it is no longer asked to sit behind text of its own hue.
 */
const toneClass: Record<Tone, string> = {
  info: "border-[color:color-mix(in_srgb,var(--kub-cyan)_45%,transparent)] bg-[color-mix(in_srgb,var(--kub-cyan)_8%,transparent)]",
  success:
    "border-[color:color-mix(in_srgb,var(--kub-online)_45%,transparent)] bg-[color-mix(in_srgb,var(--kub-online)_8%,transparent)]",
  warn: "border-[color:color-mix(in_srgb,var(--kub-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--kub-warn)_8%,transparent)]",
  danger:
    "border-[color:color-mix(in_srgb,var(--kub-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--kub-danger)_8%,transparent)]",
};

const railClass: Record<Tone, string> = {
  info: "bg-[var(--kub-cyan)]",
  success: "bg-[var(--kub-online)]",
  warn: "bg-[var(--kub-warn)]",
  danger: "bg-[var(--kub-danger)]",
};

export function KubNotice({ tone = "info", title, className, children, ...rest }: KubNoticeProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border py-2 pl-4 pr-3 text-sm leading-relaxed text-[color:var(--kub-text)]",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {/* The rail carries the tone, so meaning survives without relying on the
          sentence being coloured — and it reads at a glance down a long page. */}
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", railClass[tone])} />
      {title && <div className="font-semibold">{title}</div>}
      <div className={cn(title && "mt-0.5 text-[color:var(--kub-muted)]")}>{children}</div>
    </div>
  );
}
