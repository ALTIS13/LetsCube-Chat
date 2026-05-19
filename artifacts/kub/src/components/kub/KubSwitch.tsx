import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface KubSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const KubSwitch = forwardRef<HTMLButtonElement, KubSwitchProps>(
  ({ checked, onCheckedChange, className, disabled, onClick, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !disabled) onCheckedChange?.(!checked);
        }}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full border p-0.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--kub-bg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_35%,transparent)]"
            : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]",
          className,
        )}
        {...rest}
      >
        <span
          data-testid="kub-switch-thumb"
          className={cn(
            "block h-5 w-5 rounded-full bg-[var(--kub-text)] shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);

KubSwitch.displayName = "KubSwitch";
