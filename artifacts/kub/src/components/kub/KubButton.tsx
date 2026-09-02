import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { KubIcon } from "./KubIcon";
import { cn } from "@/lib/utils";

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
    "text-[color:var(--kub-action-primary-foreground)] font-semibold bg-[var(--kub-action-primary-background)] hover:bg-[var(--kub-action-primary-hover)] kub-glow-soft hover:kub-glow-cyan disabled:bg-[var(--kub-surface-3)] disabled:text-[color:var(--kub-muted)] disabled:shadow-none",
  accent:
    "text-white font-semibold bg-[var(--kub-pink)] hover:brightness-110 kub-glow-pink disabled:bg-[var(--kub-surface-3)] disabled:text-[color:var(--kub-muted)] disabled:shadow-none",
  secondary:
    "text-[color:var(--kub-text)] bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] border border-[color:var(--kub-border-color)]",
  ghost:
    "text-[color:var(--kub-text)] bg-transparent hover:bg-[var(--kub-surface-2)]",
  danger:
    "text-white font-semibold bg-[var(--kub-danger)] hover:brightness-110 disabled:opacity-50",
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
          "inline-flex items-center justify-center rounded-xl transition-all duration-150 select-none",
          // The focus indicator is an outline, not a ring, on purpose. Tailwind
          // implements `ring` as a box-shadow, and the primary and accent
          // variants below carry `kub-glow-*`, plain classes that set
          // box-shadow outright at the same specificity. Source order decided,
          // the glow won, and the ring was composed and then overwritten: the
          // computed style of a focused button was byte-identical to an
          // unfocused one. An outline is a separate property that a box-shadow
          // cannot overwrite. See D-010.
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          "disabled:cursor-not-allowed",
          sizeClass[size],
          variantClass[variant],
          fullWidth && "w-full",
          className
        )}
        {...rest}
      >
        {loading ? (
          <KubIcon name="spinner" size={size === "lg" ? 18 : 14} />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);
KubButton.displayName = "KubButton";
