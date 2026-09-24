import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";

interface MediaExportPlugin {
  save(input: { url: string; fileName: string }): Promise<{ saved: boolean }>;
}

const MediaExport = registerPlugin<MediaExportPlugin>("MediaExport");

export function canSaveNativeMedia(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("MediaExport");
}

export async function saveNativeMedia(url: string, fileName: string): Promise<boolean> {
  if (!canSaveNativeMedia()) throw new Error("native_media_export_unavailable");
  const result = await MediaExport.save({ url, fileName });
  return result.saved;
}
