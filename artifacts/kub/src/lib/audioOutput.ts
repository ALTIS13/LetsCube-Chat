import { DEFAULT_AUDIO_DEVICE_ID } from "@/hooks/useAudioSettings";

type SinkElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export function supportsAudioOutputSelection(): boolean {
  if (typeof HTMLMediaElement === "undefined") return false;
  return "setSinkId" in HTMLMediaElement.prototype;
}

export async function applyAudioOutputDevice(
  element: HTMLMediaElement | null,
  deviceId: string,
): Promise<{ ok: boolean; unsupported?: boolean }> {
  if (!element || deviceId === DEFAULT_AUDIO_DEVICE_ID) return { ok: true };
  const sinkElement = element as SinkElement;
  if (typeof sinkElement.setSinkId !== "function") return { ok: false, unsupported: true };
  try {
    await sinkElement.setSinkId(deviceId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
