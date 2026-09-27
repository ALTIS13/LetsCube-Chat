"use client";

import { useEffect, useState } from "react";
import { DEFAULT_AUDIO_DEVICE_ID } from "@/hooks/useAudioSettings";
import type { AudioDeviceChoice } from "@/lib/audioSettingsSurface";

export interface AudioDeviceList {
  inputs: AudioDeviceChoice[];
  outputs: AudioDeviceChoice[];
  /** Whether the browser is hiding device names until the microphone is allowed. */
  namesHidden: boolean;
}

/**
 * The microphones and outputs the browser will name, read once.
 *
 * `enumerateDevices()` answers before permission is granted — with blank ids
 * and blank labels — and the replacements are the ones the settings screen has
 * always printed, so the two surfaces that list devices say the same words.
 * `null` where the browser offers no enumeration at all.
 */
export async function readAudioDevices(): Promise<AudioDeviceList | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind, fallback: string): AudioDeviceChoice[] =>
    devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        deviceId: device.deviceId || `${DEFAULT_AUDIO_DEVICE_ID}-${index}`,
        label: device.label || `${fallback} ${index + 1}`,
      }));
  return {
    inputs: pick("audioinput", "Микрофон"),
    outputs: pick("audiooutput", "Устройство вывода"),
    namesHidden: devices.some((device) => device.kind === "audioinput" && !device.label),
  };
}

/**
 * The same list, kept current while `enabled` — a menu that is open, say.
 *
 * Read on demand rather than for the life of the application: the list is
 * wanted for the seconds a device menu is open, and a `devicechange` listener
 * for hours would be a cost with nobody reading it.
 */
export function useAudioDevices(enabled: boolean): AudioDeviceList | null {
  const [list, setList] = useState<AudioDeviceList | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = () => {
      void readAudioDevices()
        .then((next) => {
          if (live) setList(next);
        })
        .catch(() => {
          if (live) setList(null);
        });
    };
    read();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    media?.addEventListener?.("devicechange", read);
    return () => {
      live = false;
      media?.removeEventListener?.("devicechange", read);
    };
  }, [enabled]);
  return list;
}
