import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { KubIcon } from "./KubIcon";
import { cn } from "@/lib/utils";
import {
  DISABLED_SINK,
  DISABLED_SINK_FILLED,
  FOCUS_RING,
  PRESS_FILLED,
  PRESS_SINK,
  PRESS_SINK_RAISED,
} from "@/lib/controlSurface";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg" | "icon";

interface KubButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-sm gap-2",
  icon: "h-9 w-9 p-0",
};

const variantClass: Record<Variant, string> = {
  primary:
    `text-[color:var(--kub-action-primary-foreground)] font-semibold bg-[var(--kub-action-primary-background)] hover:bg-[var(--kub-action-primary-hover)] kub-glow-soft hover:kub-glow-cyan ${PRESS_FILLED} ${DISABLED_SINK_FILLED}`,
  accent:
    `font-semibold text-[color:var(--kub-action-accent-foreground)] bg-[var(--kub-action-accent-background)] hover:bg-[var(--kub-action-accent-hover)] kub-glow-pink ${PRESS_FILLED} ${DISABLED_SINK_FILLED}`,
  // The secondary button is a step of material, not a box with a line round it.
  // It used to be `--kub-surface-2` plus a border, and `--kub-surface-2` is an
  // absolute token that stopped meaning "one step above" the moment the chrome
  // was raised past it: on a panel the fill went flush and only the border was
  // left doing the work. `--kub-raise-veil` answers "one step above whatever I
  // am laid on", so the same declaration reads on the page, on a panel and
  // inside a menu — and the hover is a second layer of the same veil rather
  // than a different colour (rule 5).
  secondary:
    `text-[color:var(--kub-text)] bg-transparent kub-raise hover:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil)),linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))] ${PRESS_SINK_RAISED} ${DISABLED_SINK_FILLED}`,
  ghost:
    `text-[color:var(--kub-text)] bg-transparent kub-raise-hover ${PRESS_SINK} ${DISABLED_SINK}`,
  danger:
    `font-semibold text-[color:var(--kub-action-danger-foreground)] bg-[var(--kub-action-danger-background)] hover:bg-[var(--kub-action-danger-hover)] ${PRESS_FILLED} ${DISABLED_SINK_FILLED}`,
};

export const KubButton = forwardRef<HTMLButtonElement, KubButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading,
      leftIcon,
      rightIcon,
      fullWidth,
      className,
      children,
      disabled,
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          // `kub-button` carries the coarse-pointer target rule in index.css.
          // See D-015.
          "kub-button kub-interactive inline-flex items-center justify-center rounded-xl transition-all select-none",
          // The focus indicator is an outline, not a ring, on purpose. Tailwind
          // implements `ring` as a box-shadow, and the primary and accent
          // variants below carry `kub-glow-*`, plain classes that set
          // box-shadow outright at the same specificity. Source order decided,
          // the glow won, and the ring was composed and then overwritten: the
          // computed style of a focused button was byte-identical to an
          // unfocused one. An outline is a separate property that a box-shadow
          // cannot overwrite. See D-010. This button is where the argument was
          // found; it is now the whole product's language, in controlSurface.ts.
          FOCUS_RING,
          "disabled:cursor-not-allowed",
          sizeClass[size],
          variantClass[variant],
          fullWidth && "w-full",
          loading && "relative [&>*:not(:last-child)]:invisible",
          className
        )}
        {...rest}
      >
        {/* The spinner is laid over the content rather than swapping into it.
            Replacing `leftIcon` added an icon to a button that had none, and
            dropping `rightIcon` took one away — both change the width, and
            every control beside it moves at the moment a person is reaching
            for one of them. Now the geometry is identical in both states. */}
        {leftIcon}
        {children}
        {rightIcon}
        {loading && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-[inherit]"
          >
            <KubIcon name="spinner" size={size === "lg" ? 18 : 14} />
          </span>
        )}
      </button>
    );
  }
);
KubButton.displayName = "KubButton";
