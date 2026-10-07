import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";

interface MessagePreviewsPlugin { getCapabilities(): Promise<unknown> }
let bridge: MessagePreviewsPlugin | null = null;

export function nativeMessagePreviewsAvailable(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("MessagePreviews");
}

export async function readNativeMessagePreviewCandidate(): Promise<unknown> {
  if (!nativeMessagePreviewsAvailable()) return null;
  try {
    bridge ??= registerPlugin<MessagePreviewsPlugin>("MessagePreviews");
    return await bridge.getCapabilities();
  } catch { return null; }
}
