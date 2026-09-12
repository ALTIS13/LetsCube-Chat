import { KubIcon } from "@/components/kub";
import type { AttachTab } from "@/lib/attachSheet";
import { ATTACH_TAB_ICONS } from "./attachTypes";

export type AttachPlaceholderTab = Extract<AttachTab, { kind: "placeholder" }>;

/**
 * A tab whose function is not built yet — «Опрос», «Список», «Контакт», in the
 * order the owner named them (2026-09-12): its glyph, its name and one line
 * saying it is coming, so the tab row can be judged with the functions in it
 * before he decides which of them to build. «Музыка» was rendered beside them
 * and he said he does not want it at all, so there is no such tab.
 *
 * Deliberately inert: no button, no field, nothing drawn to look like one. The
 * sheet gives this tab no selection (`attachTabSelection`), so it never shows a
 * caption, a send button or «…», and nothing can be sent from it. The glyph
 * sits on a tint rather than on the accent fill the gallery's entries use,
 * because those are targets and this is not.
 */
export function AttachPlaceholderPanel({ tab }: { tab: AttachPlaceholderTab }) {
  return (
    <div data-attach-placeholder={tab.id} className="flex flex-col items-center px-6 pb-6 pt-4 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] text-[color:var(--kub-accent-text)]"
      >
        <KubIcon name={ATTACH_TAB_ICONS[tab.id]} size={28} />
      </span>
      <h3 className="mt-3 text-[17px] font-semibold text-[color:var(--kub-text)]">{tab.label}</h3>
      <p className="mt-1 text-balance text-[15px] leading-snug text-[color:var(--kub-muted)]">{tab.soon}</p>
    </div>
  );
}
