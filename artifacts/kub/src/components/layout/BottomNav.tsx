"use client";

import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { KubIcon, type KubIconName } from "@/components/kub";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { cn } from "@/lib/utils";

type SectionId = "chats" | "folders" | "profile" | "tasks";

interface Tab {
  id: SectionId;
  label: string;
  icon: KubIconName;
}

export function BottomNav() {
  const [location, setLocation] = useLocation();
  const { canAccessTasks } = useTaskAccessGate();
  const { mobileSection, setMobileSection } = useAppStore();
  const isOnTasksRoute = location.startsWith("/tasks");

  // Four, on the owner's instruction of 2026-09-12. Search left because the
  // list header already carries a real search field at every width, and
  // administration because it has five other entries; neither was a second
  // destination, both were a second door to the same one.
  const tabs: Tab[] = [
    { id: "chats",   label: "Чаты",    icon: "chatBubble" },
    { id: "folders", label: "Папки",   icon: "folderAdd" },
    { id: "profile", label: "Профиль", icon: "user" },
    ...(canAccessTasks ? [{ id: "tasks" as const, label: "Задачи", icon: "tasks" as KubIconName }] : []),
  ];

  const handleTab = (id: SectionId) => {
    if (id === "tasks") {
      setLocation("/tasks");
      return;
    }
    setMobileSection(id);
  };

  return (
    <nav
      aria-label="Навигация"
      // A capsule that floats over the list rather than a bar the list sits
      // on. Telegram's, measured: about 53dp tall and clear of each side by
      // about 40dp, fully rounded, with the content visible past its edges.
      //
      // `absolute`, not `fixed`: a fixed child would be laid out against the
      // viewport and escape the pane column, and on a computer this element
      // still exists in the markup while `md:hidden` keeps it off screen.
      //
      // `justify-around` and `kub-glass` stay on the element. `shell-glass`
      // pins that pair, and its reason holds: this is chrome that content
      // sits on and that opens nothing.
      className="kub-glass absolute inset-x-10 bottom-[var(--kub-bottom-nav-gap)] z-20 md:hidden flex items-center justify-around px-2 pb-safe rounded-full border border-[color:var(--kub-border-color)]"
      // The row is 56px and the home indicator is extra, not a share of it.
      // Tailwind boxes are `border-box`, so with a flat `height: 56px` the
      // safe-area padding this bar asks for would have been taken out of the
      // tabs rather than added below them — six labels and their icons into
      // 22px on an iPhone. The height carries the inset so the padding has
      // somewhere to go; both read the `--kub-safe-bottom` token, which is 0px
      // on a phone without an inset, on Android and in the desktop shell, so
      // there this is the same 56px bar it was.
      //
      // The number now lives in `--kub-bottom-nav` because the panes reserve
      // the same height below themselves, and two copies of one number drift.
      style={{ height: "var(--kub-bottom-nav)" }}
    >
      {tabs.map(({ id, label, icon }) => {
        const isActive =
          id === "tasks" ? isOnTasksRoute : mobileSection === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleTab(id)}
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
              // Four labels since 2026-09-12, and the fit is no longer tight:
              // measured in Inter at 600/11px uppercase, «Чаты» 32.03, «Папки»
              // 40.50, «Профиль» 56.75 and «Задачи» 48.50 total 177.78px
              // against 344px of row. The padding and the 11px size stay
              // anyway: they are the floor under the gap, and a longer word or
              // a fifth tab would walk back towards the same edge.
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
