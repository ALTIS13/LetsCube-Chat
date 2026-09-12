import { KubIcon, type KubIconName } from "@/components/kub";
import { attachGalleryArrangement, selectionNumber } from "@/lib/attachSheet";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";
import { AttachSelectionCircle } from "./AttachSelectionCircle";
import { RAISED_TARGET, type AttachPick } from "./attachTypes";

export interface AttachGalleryEntry {
  id: "camera" | "library";
  label: string;
  icon: KubIconName;
  onPress: () => void;
}

interface AttachGalleryPanelProps {
  entries: AttachGalleryEntry[];
  picks: AttachPick[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Room kept under the grid for the send capsule that floats over it. */
  reserveBottom: boolean;
}

/**
 * «Галерея», the tab the sheet opens on.
 *
 * Telegram fills this with the phone's recent photos, the camera a tall cell at
 * the top left. A web page cannot list the photos, so the gallery starts from
 * the two ways in the system offers — the camera and the photo library — and
 * what is picked comes back into the grid, selected and numbered, the way
 * Telegram's grid looks once something is chosen. Nothing here starts a camera:
 * the camera tile opens the phone's own camera when it is tapped.
 *
 * How the two actions are laid out is `attachGalleryArrangement`: before
 * anything is picked they are two large tiles, and once something is picked
 * they are the first two cells of the grid.
 *
 * The two entries are targets and keep an edge in the rule tone (rule 11 of
 * docs/operations/interface-material.md). Photographed in the light theme, the
 * white glass rim vanished on the near-white sheet and the veil alone left the
 * cells within a few values of it.
 */
export function AttachGalleryPanel({ entries, picks, selected, onToggle, reserveBottom }: AttachGalleryPanelProps) {
  const arrangement = attachGalleryArrangement(picks.length);

  if (arrangement === "tiles") {
    return (
      <div data-attach-gallery="empty" data-attach-arrangement="tiles" className="grid grid-cols-2 gap-3 px-3 pt-1">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={entry.onPress}
            data-attach-entry={entry.id}
            className={cn(
              "kub-interactive flex aspect-square flex-col items-center justify-center gap-3 rounded-[1.75rem] border border-[color:var(--kub-rule)] text-[color:var(--kub-text)] transition-colors",
              RAISED_TARGET,
              FOCUS_RING,
            )}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]">
              <KubIcon name={entry.icon} size={26} />
            </span>
            <span className="text-[15px] font-semibold">{entry.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      data-attach-gallery="picked"
      data-attach-arrangement="grid"
      className={cn("grid grid-cols-3 gap-1.5 px-3", reserveBottom && "pb-24")}
    >
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={entry.onPress}
          data-attach-entry={entry.id}
          className={cn(
            "kub-interactive flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-[color:var(--kub-rule)] text-[color:var(--kub-text)] transition-colors",
            RAISED_TARGET,
            FOCUS_RING,
          )}
        >
          <KubIcon name={entry.icon} size={30} tone="accent" />
          <span className="text-[13px] font-medium">{entry.label}</span>
        </button>
      ))}
      {picks.map((pick, index) => {
        const number = selectionNumber(selected, pick.id);
        const noun = pick.kind === "video" ? "Видео" : "Фото";
        return (
          <button
            key={pick.id}
            type="button"
            role="checkbox"
            aria-checked={number !== null}
            aria-label={`${noun} ${index + 1}`}
            data-attach-pick={pick.kind}
            onClick={() => onToggle(pick.id)}
            className={cn(
              "kub-interactive relative aspect-square overflow-hidden rounded-2xl bg-[var(--kub-inset)]",
              FOCUS_RING,
            )}
          >
            {pick.kind === "image" && pick.url ? (
              <img src={pick.url} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : pick.kind === "video" && pick.url ? (
              <video src={pick.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[color:var(--kub-muted)]">
                <KubIcon name="file" size={28} />
              </span>
            )}
            {pick.kind === "video" && (
              <span className="absolute bottom-1.5 left-1.5 flex h-6 items-center gap-1 rounded-full bg-black/55 px-2 text-[11px] font-semibold text-white">
                <KubIcon name="video" size={12} />
                Видео
              </span>
            )}
            <span className="absolute right-1.5 top-1.5">
              <AttachSelectionCircle number={number} over="photo" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
