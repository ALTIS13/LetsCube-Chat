import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";
import { mediaObjectUrls } from "../mediaCache/objectUrls";
import { isManagedMediaAddress } from "../mediaCache/loader";
import { exportLocalMedia, LocalMediaUnavailableError, type LocalMediaBridge } from "./localMediaExport";

interface MediaExportPlugin extends LocalMediaBridge {
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

export async function saveNativeMedia(url: string, fileName: string, options: {
  localUrl?: string;
  mimeType?: string;
  resolveSourceUrl?: () => Promise<string | null>;
} = {}): Promise<NativeMediaSaveResult> {
  if (!canSaveNativeMedia()) throw new Error("native_media_export_unavailable");
  const localUrl = options.localUrl ?? url;
  if (localUrl.startsWith("blob:")) {
    const held = mediaObjectUrls.acquire(localUrl);
    if (!held) throw Error("local_media_export_retired");
    try {
      return await exportLocalMedia(MediaExport, { blob: held.blob, fileName, mimeType: options.mimeType, isCurrent: held.current });
    } catch (error) {
      if (!(error instanceof LocalMediaUnavailableError) || !held.current()
        || typeof navigator === "undefined" || navigator.onLine === false) throw error;
      // Old shells keep their existing HTTPS path only when it is still usable.
      const original = options.resolveSourceUrl ? await options.resolveSourceUrl() : url;
      if (!held.current() || !original || !firstPartySource(original)) throw error;
      return await MediaExport.save({ url: original, fileName });
    } finally { held.release(); }
  }
  return MediaExport.save({ url, fileName });
}

function firstPartySource(address: string): boolean {
  try {
    return isManagedMediaAddress(address, "https://core.letscube.ru") && !new URL(address).hash;
  } catch { return false; }
}
