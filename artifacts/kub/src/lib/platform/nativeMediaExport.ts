import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";

interface MediaExportPlugin {
  save(input: { url: string; fileName: string }): Promise<NativeMediaSaveResult>;
}

export interface NativeMediaSaveResult {
  saved: boolean;
  /** Present when Android saved directly to LETSCUBE's gallery album. */
  location?: "Pictures/LETSCUBE" | "Movies/LETSCUBE";
}

const MediaExport = registerPlugin<MediaExportPlugin>("MediaExport");

export function canSaveNativeMedia(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("MediaExport");
}

export async function saveNativeMedia(url: string, fileName: string): Promise<NativeMediaSaveResult> {
  if (!canSaveNativeMedia()) throw new Error("native_media_export_unavailable");
  return MediaExport.save({ url, fileName });
}
