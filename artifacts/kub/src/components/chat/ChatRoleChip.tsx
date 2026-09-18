"use client";

import { KubIcon } from "@/components/kub";
import { KUB_ICON_NAMES, type KubIconName } from "@/components/kub/icons";
import { chatRoleColourValue, readChatRoleColour } from "@/lib/chatRolePalette";
import type { ChatRole } from "@/lib/chatRoles";
import { cn } from "@/lib/utils";

/**
 * One tag a group gave somebody (D-215).
 *
 * **The colour reaches the word here, and that is the difference from
 * `ProfileBadgeChip`.** The global badges keep their tone on the border and the
 * dot because D-214 measured the catalogue's own hexes at 1.50–2.06 against a
 * 3:1 floor in the light theme — they were copied from the dark palette and
 * were never checked. `lib/chatRolePalette.ts` is a palette chosen the other
 * way round: every entry is pinned by `tests/unit/chat-role-palette.test.mts`
 * at **4.5:1 as text** on all three surfaces in both themes, which is the
 * threshold a word needs. That is what makes Discord's actual mechanic —
 * a name in its role's colour — available here and not there.
 *
 * A key this build does not know renders plain rather than being dropped. The
 * database constrains the *shape* of the key and knows nothing about which keys
 * exist, so a row seeded by a newer build must still show its name.
 */
export function ChatRoleChip({
  role,
  className,
  onRemove,
}: {
  role: ChatRole;
  className?: string;
  /** When given, the chip carries a control that takes the tag off. */
  onRemove?: () => void;
}) {
  const colour = readChatRoleColour(role.colour);
  const tint = colour ? chatRoleColourValue(colour) : "var(--kub-muted)";
  const icon = role.icon && KUB_ICON_NAMES.has(role.icon) ? (role.icon as KubIconName) : null;

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-semibold",
        className,
      )}
      style={{
        // The border is the tone at 55%, the same recipe `KubBadge` uses for
        // its own tones, so a row of group tags and a row of LETSCUBE badges
        // read as one family rather than two.
        borderColor: `color-mix(in srgb, ${tint} 55%, transparent)`,
        color: tint,
      }}
      data-chat-role-id={role.id}
      data-chat-role-colour={colour ?? ""}
      title={role.name}
    >
      {icon && <KubIcon name={icon} size={11} />}
      <span className="min-w-0 truncate">{role.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Снять роль «${role.name}»`}
          data-testid="chat-role-chip-remove"
          className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--kub-cyan)]"
        >
          <KubIcon name="close" size={10} />
        </button>
      )}
    </span>
  );
}
