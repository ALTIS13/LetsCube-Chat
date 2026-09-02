import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { browserTimers, createAsyncAction } from "@/lib/asyncAction";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { KubButton } from "./KubButton";
import { KubIcon } from "./KubIcon";

interface KubAsyncButtonProps {
  /** The label. It never changes, which is the point — see below. */
  children: ReactNode;
  onRun: () => Promise<unknown>;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg" | "icon";
  disabled?: boolean;
  className?: string;
  /** Announced when the action succeeds; also the tooltip on the tick. */
  successLabel?: string;
  fullWidth?: boolean;
}

const RESULT_ICON: Record<"success" | "error", "check" | "alert"> = {
  success: "check",
  error: "alert",
};

/**
 * A button whose state is visible without its geometry moving.
 *
 * The usual pattern swaps the label — "Сохранить" becomes "Сохранение…" —
 * which changes the button's width, and every control beside it shifts at the
 * exact moment a person is reaching for one of them. Here the label is fixed
 * and the state lives in the leading slot, which is reserved at all times so
 * its presence or absence changes nothing.
 *
 * The machine behind it refuses to overlap: a double-click on save sends one
 * save, not two.
 */
export function KubAsyncButton({
  children,
  onRun,
  variant = "primary",
  size = "md",
  disabled = false,
  className,
  successLabel = "Готово",
  fullWidth = false,
}: KubAsyncButtonProps) {
  const action = useMemo(
    () => createAsyncAction(browserTimers, { reducedMotion: prefersReducedMotion() }),
    [],
  );
  const phase = useSyncExternalStore(action.subscribe, action.phase, action.phase);

  useEffect(() => () => action.dispose(), [action]);

  return (
    <KubButton
      type="button"
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={phase === "loading"}
      onClick={() => void action.run(onRun)}
      className={className}
      leftIcon={
        // Always rendered, at a fixed size, so the settled result appearing
        // changes nothing about the button's width. The loading spinner is not
        // drawn here — `KubButton` overlays that without touching geometry.
        <span aria-hidden="true" className={cn("inline-flex h-3.5 w-3.5 items-center justify-center")}>
          {(phase === "success" || phase === "error") && (
            <KubIcon name={RESULT_ICON[phase]} size={13} />
          )}
        </span>
      }
    >
      {children}
      <span className="sr-only" aria-live="polite">
        {phase === "success" ? successLabel : phase === "error" ? "Не удалось" : ""}
      </span>
    </KubButton>
  );
}
