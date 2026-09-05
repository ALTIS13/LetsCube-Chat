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
          // The button is the target, the inner span is the track. They used to
          // be the same element, which fixed the target at the track's 24px —
          // under the 44px a finger needs. Separating them keeps the switch
          // looking exactly as designed while `.kub-switch` gives a coarse
          // pointer a full-height target around it.
          "kub-switch group/switch relative inline-flex shrink-0 items-center",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          "disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
          className,
        )}
        {...rest}
      >
        <span
          className={cn(
            "flex h-6 w-11 items-center overflow-hidden rounded-full border p-0.5 transition-colors",
            checked
              ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_35%,transparent)]"
              : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]",
          )}
        >
          <span
            data-testid="kub-switch-thumb"
            className={cn(
              "block h-5 w-5 rounded-full bg-[var(--kub-text)] shadow-sm transition-transform",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </span>
      </button>
    );
  },
);

KubSwitch.displayName = "KubSwitch";
