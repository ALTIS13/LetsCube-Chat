"use client";

import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { KubIcon } from "@/components/kub";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { bottomNavDestinations, type BottomNavDestination } from "@/lib/bottomNavDestinations";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";

export function BottomNav({ onSelect }: { onSelect?: (entry: BottomNavDestination) => void } = {}) {
  const [location, setLocation] = useLocation();
  const { canAccessTasks } = useTaskAccessGate();
  const { mobileSection, setMobileSection } = useAppStore();
  const isOnTasksRoute = location.startsWith("/tasks");
  const nativeAndroid = isNativeAndroid();

  // Which entries exist, and the reason each one does, live in
  // `lib/bottomNavDestinations.ts` — including the three that were taken out,
  // «Поиск» and «Админка» on the owner's instruction of 2026-09-12 and «Папки»
  // with D-120. A list written inline here could only be checked by a
  // screenshot.
  const tabs = bottomNavDestinations(canAccessTasks);

  // The whole entry, not its parts: `route` is the discriminant, and narrowing
  // it here is what proves `setMobileSection` is never handed «tasks».
  const handleTab = (entry: BottomNavDestination) => {
    if (onSelect) {
      onSelect(entry);
      return;
    }
    if (entry.route) {
      setLocation("/tasks");
      return;
    }
    setMobileSection(entry.id);
  };

  return (
    <nav
      aria-label="Навигация"
      // A capsule that floats over the list, and sits in a reserved slot on
      // the profile tab. Telegram's, measured: about 53dp tall and clear by
      // about 40dp, fully rounded, with the content visible past its edges.
      //
      // `absolute`, not `fixed`: a fixed child would be laid out against the
      // viewport and escape the pane column, and on a computer this element
      // still exists in the markup while `md:hidden` keeps it off screen.
      //
      // Android uses the stronger existing material: row text can pass under
      // this floating surface, but must not compete with its tab labels.
      className={cn(
        "absolute inset-x-10 z-20 md:hidden flex items-center justify-around px-2 rounded-full border border-[color:var(--kub-border-color)]",
        // On native Android the gesture area belongs below the floating
        // capsule, not inside it. Web/iOS retain their existing inset padding.
        nativeAndroid
          ? "kub-glass-strong bottom-[calc(var(--kub-bottom-nav-gap)+var(--kub-safe-bottom))]"
          : "kub-glass bottom-[var(--kub-bottom-nav-gap)] pb-safe",
      )}
      style={{
        height: nativeAndroid
          ? "calc(var(--kub-bottom-nav) - var(--kub-safe-bottom))"
          : "var(--kub-bottom-nav)",
      }}
    >
      {tabs.map((entry) => {
        const { id, label, icon } = entry;
        const isActive = entry.route ? isOnTasksRoute : mobileSection === entry.id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleTab(entry)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // `px-1`, not `px-2`, and the padding is the whole fix.
              //
              // D-061: with six tabs at 360px the buttons' base sizes summed to
              // more than the row, so flex shrank them, and a shrunk flex item
              // keeps its padding while its content box collapses — the labels
              // spilled out of their own buttons and ended up 3.2px apart, in a
              // font whose space measures 3.3px. They read as one phrase.
              //
              // Three labels since D-120, and the fit is no longer tight.
              // Measured on the rendered capsule at 360 with Inter loaded — the
              // capsule is 280px wide and 262 inside its own padding, not the
              // 344 an older note here claimed, which was this bar before it
              // became a floating capsule inset 40px from each side:
              //
              //   three: buttons 44 + 62.05 + 52.39 = 158.44, narrowest gap
              //          between two labels 42.53px;
              //   four:  «Папки» back at 46.75 makes 205.19, and the gap falls
              //          to 22.20px.
              //
              // So the padding and the 11px size stay: they are the floor under
              // the gap, and a fourth destination really does walk back towards
              // the 3.2px edge D-061 measured.
              "relative flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] px-1 py-1 rounded-full transition-colors",
              // Telegram marks the chosen tab with a filled rounded capsule
              // behind the icon and its label, not with a dot beneath them.
              isActive
                ? "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] text-[color:var(--kub-accent-text)]"
                : "text-[color:var(--kub-muted)]"
            )}
          >
            <KubIcon name={icon} size={22} />
            <span className="text-[11px] font-semibold uppercase">{label}</span>
            {/* The dot is gone: the filled capsule above says the same thing
                once, and two marks for one state is one too many. */}
          </button>
        );
      })}
    </nav>
  );
}
