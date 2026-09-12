import type { KubIconName } from "@/components/kub";
import type { AttachTabId } from "@/lib/attachSheet";
import type { IncomingFilesSource } from "@/lib/mediaCompression";

/** Each tab's glyph, in the tab row and on a placeholder's panel. */
export const ATTACH_TAB_ICONS: Record<AttachTabId, KubIconName> = {
  gallery: "image",
  file: "file",
  location: "mapPin",
  poll: "poll",
  checklist: "checklist",
  contact: "contact",
};

export type AttachPickKind = "image" | "video" | "file";

/** Something picked into the sheet, waiting to be selected and sent. */
export interface AttachPick {
  id: string;
  file: File;
  kind: AttachPickKind;
  /** An object URL for a photo or a video; revoked when the sheet closes. */
  url: string | null;
  source: IncomingFilesSource;
}

export function attachPickKind(file: File): AttachPickKind {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "file";
}

/**
 * A step of material that is aimed at: resting one veil above what it lies on,
 * and a second veil under the pointer, so the hover never goes flush with the
 * rest (rule 5 of docs/operations/interface-material.md; KubButton's secondary).
 */
export const RAISED_TARGET =
  "kub-raise hover:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil)),linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))]";
