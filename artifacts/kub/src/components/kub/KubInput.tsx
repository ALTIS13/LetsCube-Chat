import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KubInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  errorId?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  containerClassName?: string;
}

export const KubInput = forwardRef<HTMLInputElement, KubInputProps>(
  ({ label, hint, error, errorId, leftIcon, rightSlot, containerClassName, className, id, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium tracking-wide text-[color:var(--kub-muted)] uppercase"
          >
            {label}
          </label>
        )}
        <div
          className={cn(
            "group flex items-center gap-2 rounded-xl px-3 h-11 transition-all",
            "bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]",
            "focus-within:border-[color:var(--kub-cyan)]",
            "focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]",
            error && "border-[color:var(--kub-danger)] focus-within:border-[color:var(--kub-danger)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-danger)_18%,transparent)]"
          )}
        >
          {leftIcon && (
            <span className="text-[color:var(--kub-muted)] group-focus-within:text-[color:var(--kub-cyan)] transition-colors flex-shrink-0">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              // `h-full` is what makes the whole visual field tappable. The
              // wrapper is 44px and the input sat at its intrinsic 20px in the
              // middle of it, so a tap 4px below the field's top edge landed on
              // nothing at all — 24px of a control that looks tappable did not
              // respond. See D-013.
              "h-full flex-1 bg-transparent outline-none text-sm text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]",
              className
            )}
            {...rest}
          />
          {rightSlot}
        </div>
        {error ? (
          <p id={errorId} className="text-xs text-[color:var(--kub-danger-text)]">{error}</p>
        ) : hint ? (
          <p className="text-xs text-[color:var(--kub-muted)]">{hint}</p>
        ) : null}
      </div>
    );
  }
);
KubInput.displayName = "KubInput";
