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
          // **No paint on the button.** It is the 44px target a finger
          // needs, not a surface: the track inside it is the switch. The
          // disabled inset and its sink veil used to sit here, so an
          // unavailable switch drew a hard dark square around itself —
          // 44 by 44 in the dark theme, which is what the owner saw on
          // the settings screen (D-137). The same two paints are on the
          // track below, where the switch actually is. Deliberately not
          // `disabled:opacity-*`: `control-vocabulary.test.mjs` refuses a
          // faded disabled control by name, and it is right to — fading
          // says «loading», the inset says «not yours to press».
          "disabled:cursor-not-allowed",
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
            // Unavailable reads as unavailable, and it did not before:
            // the track kept its accent whatever `disabled` said, so a
            // switch nobody could press looked exactly like one that was
            // on. The inset and the sink veil are the product's own words
            // for «not yours to press», and they belong on the thing that
            // is the switch rather than on the box around it.
            "group-disabled/switch:border-[color:var(--kub-border-color)]",
            "group-disabled/switch:bg-[var(--kub-inset)]",
            "group-disabled/switch:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
          )}
        >
          <span
            data-testid="kub-switch-thumb"
            className={cn(
              "block h-5 w-5 rounded-full bg-[var(--kub-text)] shadow-sm transition-transform",
              // The thumb keeps its position — the stored value is still
              // worth reading — and loses its brightness, so the switch
              // says «this is on, and not yours to change» rather than
              // «this is on».
              "group-disabled/switch:bg-[color:var(--kub-muted)] group-disabled/switch:shadow-none",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </span>
      </button>
    );
  },
);

KubSwitch.displayName = "KubSwitch";
