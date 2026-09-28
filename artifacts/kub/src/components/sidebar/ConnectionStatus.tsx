"use client";

import { KubIcon } from "@/components/kub";
import { useConnectionState } from "@/hooks/useConnectionState";
import { CONNECTION_STATE_TEXT } from "@/lib/connectionState";

/**
 * The connection's words where Telegram puts them (tracker item 53,
 * `lib/connectionState.ts`): in the title's place on a phone, and on a
 * computer in the small plate Telegram Desktop draws at the bottom left of its
 * chat list. Nothing at all while connected.
 *
 * The plate floats rather than taking a line: the list under it must not
 * change size, or every row would be measured again for words that come and
 * go with the network. It is a capsule, so its rim is the glass line, not the
 * sheet edge (`interface-material.md`, the note on floating capsules).
 */
export function ConnectionStatus({ variant }: { variant: "title" | "plate" }) {
  const state = useConnectionState();
  if (state === "online") return null;
  const text = CONNECTION_STATE_TEXT[state];

  if (variant === "title") {
    return (
      <span
        role="status"
        data-testid="connection-status"
        data-connection-state={state}
        className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-[color:var(--kub-muted)]"
      >
        <KubIcon name="spinner" size={14} className="shrink-0 text-[color:var(--kub-cyan)]" />
        <span className="truncate">{text}</span>
      </span>
    );
  }

  return (
    <div
      role="status"
      data-testid="connection-status-plate"
      data-connection-state={state}
      className="pointer-events-none absolute bottom-3 left-3 z-10 hidden items-center gap-2 rounded-full border border-[color:var(--glass-line)] px-3 py-1.5 text-xs font-semibold text-[color:var(--kub-text)] kub-glass-strong md:flex"
    >
      <KubIcon name="spinner" size={13} className="shrink-0 text-[color:var(--kub-cyan)]" />
      {text}
    </div>
  );
}
