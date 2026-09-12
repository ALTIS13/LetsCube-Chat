import { KubIcon, type KubIconName } from "@/components/kub";
import { selectionNumber } from "@/lib/attachSheet";
import { FOCUS_RING } from "@/lib/controlSurface";
import { formatAttachmentSize } from "@/lib/stagedAttachments";
import { cn } from "@/lib/utils";
import { AttachSelectionCircle } from "./AttachSelectionCircle";
import type { AttachPick } from "./attachTypes";

export interface AttachFileSource {
  id: "file" | "library-original";
  title: string;
  subtitle: string;
  icon: KubIconName;
  onPress: () => void;
}

interface AttachFilePanelProps {
  sources: AttachFileSource[];
  picks: AttachPick[];
  selected: string[];
  onToggle: (id: string) => void;
  reserveBottom: boolean;
}

/** The grouped rows of the glass capsule look: one card, hairlines between the rows. */
const GROUP = "mx-3 overflow-hidden rounded-[1.375rem] border border-[color:var(--glass-line)] kub-raise";
const ROW =
  "kub-interactive relative flex min-h-[3.75rem] w-full items-center gap-3 px-4 py-2 text-left transition-colors kub-raise-hover";

/**
 * «Файл»: where a file can come from, as Telegram lists it, and what was picked
 * from there. Everything on this tab goes as it is — a file, or a photo or video
 * from the gallery without compression — so its send button has no menu.
 *
 * Telegram also lists recently sent files. LETSCUBE keeps no such list for a
 * person, and a page cannot read the device's, so the rows stop at the sources.
 */
export function AttachFilePanel({ sources, picks, selected, onToggle, reserveBottom }: AttachFilePanelProps) {
  return (
    <div className={cn("flex flex-col gap-4 pt-1", reserveBottom && "pb-24")}>
      <div className={GROUP} data-attach-file-sources="">
        {sources.map((source, index) => (
          <button
            key={source.id}
            type="button"
            onClick={source.onPress}
            data-attach-entry={source.id}
            className={cn(ROW, FOCUS_RING, index > 0 && "border-t border-[color:var(--kub-rule)]")}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[color:var(--kub-accent-text)]">
              <KubIcon name={source.icon} size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-[color:var(--kub-accent-text)]">{source.title}</span>
              <span className="block truncate text-[13px] text-[color:var(--kub-muted)]">{source.subtitle}</span>
            </span>
          </button>
        ))}
      </div>

      {picks.length > 0 && (
        <div className={GROUP} role="group" aria-label="Выбранные файлы" data-attach-file-picks="">
          {picks.map((pick, index) => {
            const number = selectionNumber(selected, pick.id);
            const size = formatAttachmentSize(pick.file.size);
            return (
              <button
                key={pick.id}
                type="button"
                role="checkbox"
                aria-checked={number !== null}
                aria-label={`${pick.file.name || "Файл"}, ${size}`}
                onClick={() => onToggle(pick.id)}
                className={cn(ROW, FOCUS_RING, index > 0 && "border-t border-[color:var(--kub-rule)]")}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--kub-inset)] text-[color:var(--kub-accent-text)]">
                  {pick.kind === "image" && pick.url ? (
                    <img src={pick.url} alt="" draggable={false} className="h-full w-full object-cover" />
                  ) : (
                    <KubIcon name={pick.kind === "video" ? "video" : "file"} size={22} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[color:var(--kub-text)]">{pick.file.name || "Файл"}</span>
                  <span className="block text-[13px] tabular-nums text-[color:var(--kub-muted)]">{size}</span>
                </span>
                <AttachSelectionCircle number={number} over="sheet" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
