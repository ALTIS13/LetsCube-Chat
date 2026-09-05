import { useEffect, useRef, type ReactNode } from "react";
import { KubIcon } from "./KubIcon";
import { cn } from "@/lib/utils";

interface KubModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  contentClassName?: string;
  scrollBody?: boolean;
  /**
   * On viewports smaller than `sm` (640px), render the modal as a full-screen
   * sheet (covers the whole viewport, no rounded corners, no border, sticky
   * header). On `sm+` viewports the modal is centered as a dialog.
   *
   * Defaults to `true`. Pass `false` only when you need a centered dialog at
   * every breakpoint — but on <sm that means the dialog will still get full
   * viewport width since the centered shell collapses to the screen edges.
   */
  mobileSheet?: boolean;
}

const sizeClass = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
  // For a dialog that carries a form rather than a question. Settings at `lg`
  // squeezed a two-column form into 672px on a 1440px screen and pushed the
  // phone section below the fold.
  xl: "sm:max-w-4xl",
};

export function KubModal({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  className,
  contentClassName,
  scrollBody = true,
  mobileSheet = true,
}: KubModalProps) {
  const pointerStartedInsideRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "kub-modal-overlay fixed inset-0 z-50 flex bg-[color:var(--kub-bg)]/75 backdrop-blur-sm",
        mobileSheet
          ? "items-stretch justify-stretch p-0 sm:items-center sm:justify-center sm:p-4"
          : "items-center justify-center p-4"
      )}
      onPointerDown={(e) => {
        pointerStartedInsideRef.current = e.target !== e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (pointerStartedInsideRef.current) {
          pointerStartedInsideRef.current = false;
          return;
        }
        onClose();
      }}
    >
      <div
        className={cn(
          // A dialog covers whatever it was opened from, so `-strong`. Both
          // `shadow-2xl` and `kub-glow-soft` are dropped: each sets box-shadow,
          // and the material already carries its own.
          "kub-modal-panel kub-glass-strong w-full flex flex-col border-[color:var(--kub-border-color)]",
          mobileSheet
            ? "h-full max-h-screen rounded-none border-0 pb-safe sm:h-auto sm:max-h-[85vh] sm:rounded-2xl sm:border sm:pb-0"
            : "rounded-2xl border max-h-[85vh]",
          sizeClass[size],
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        {(title || icon) && (
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] text-[color:var(--kub-cyan)] flex-shrink-0">
                  {icon}
                </span>
              )}
              <div className="min-w-0">
                {title && (
                  <h2 className="text-base font-semibold text-[color:var(--kub-text)] truncate">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="text-xs text-[color:var(--kub-muted)] mt-0.5">{description}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="kub-interactive flex-shrink-0 p-1.5 rounded-lg text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] kub-raise-hover transition-colors"
              aria-label="Закрыть"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        <div
          data-testid="kub-modal-body"
          className={cn(
            "flex-1 min-h-0 px-4 sm:px-5 py-4",
            scrollBody ? "overflow-y-auto" : "overflow-y-hidden",
            contentClassName,
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 flex-shrink-0 border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
