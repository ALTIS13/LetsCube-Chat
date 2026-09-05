import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { KubIcon } from "./KubIcon";

interface KubHelpNotesProps {
  /** Stable key for remembering this block's state, e.g. "roles". */
  id: string;
  /** The toggle's wording, phrased as the question it answers. */
  label: string;
  children: ReactNode;
  className?: string;
}

const STORAGE_PREFIX = "kub.help.collapsed.";

function readCollapsed(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) === "1";
  } catch {
    // A private window, cleared site data or a browser blocking storage: the
    // notes simply show, which is the safe direction for an explanation.
    return false;
  }
}

function writeCollapsed(id: string, collapsed: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) window.localStorage.setItem(STORAGE_PREFIX + id, "1");
    else window.localStorage.removeItem(STORAGE_PREFIX + id);
  } catch {
    // Not being able to remember is not a reason to refuse the toggle.
  }
}

/**
 * Explanatory notes that stay out of the way once they have been read.
 *
 * The roles screen carried three explainer cards across the top on every visit
 * — about 130px before the list of roles began — and they say the same thing
 * every time. Deleting them would cost a first-time administrator real help, so
 * they open by default and stay closed once someone has closed them.
 *
 * The preference is per browser and per person, which is the right scope: it is
 * a statement about what one reader already knows, not about the product.
 */
export function KubHelpNotes({ id, label, children, className }: KubHelpNotesProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      writeCollapsed(id, !current);
      return !current;
    });
  }, [id]);

  return (
    <div className={cn("space-y-3", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className={cn(
          "kub-button kub-interactive inline-flex items-center gap-1.5 rounded-lg px-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
          "text-[color:var(--kub-accent-text)] hover:underline",
        )}
      >
        <KubIcon name={collapsed ? "chevronDown" : "chevronUp"} size={13} />
        {label}
      </button>
      {!collapsed && children}
    </div>
  );
}
