import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { KubButton } from "./KubButton";
import { KubIcon } from "./KubIcon";
import { KubPanel } from "./KubPanel";

interface KubCreateSectionProps {
  /** The action, as a person would say it: "Новая локация", "Создать инвайт". */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One line under the heading, when the form needs explaining. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Hidden entirely when the viewer may not create anything. */
  disabled?: boolean;
}

/**
 * A creation form that is closed until someone wants it.
 *
 * Three staff screens kept their creation form permanently expanded in a left
 * column — locations, invites and roles — and in each one the list a person had
 * actually come to look at started below the fold. Creating is the occasional
 * act; reading the list is the constant one, and the layout had them the wrong
 * way round.
 *
 * Opening it moves focus to the first field. Without that the form appears
 * somewhere below the button and a keyboard user has to hunt for it, which is
 * the usual reason a disclosure is worse than the thing it replaced.
 */
export function KubCreateSection({
  label,
  open,
  onOpenChange,
  description,
  children,
  className,
  disabled = false,
}: KubCreateSectionProps) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      first?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  if (disabled) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <KubButton
        type="button"
        variant={open ? "secondary" : "primary"}
        size="sm"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        leftIcon={<KubIcon name={open ? "close" : "create"} size={13} />}
      >
        {open ? "Отмена" : label}
      </KubButton>

      {open && (
        <KubPanel id={panelId} ref={panelRef} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">{label}</h3>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {description}
              </p>
            )}
          </div>
          {children}
        </KubPanel>
      )}
    </div>
  );
}
