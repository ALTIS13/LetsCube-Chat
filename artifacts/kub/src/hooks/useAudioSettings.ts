"use client";

import { useCallback, useEffect, useState } from "react";

export interface AudioSettings {
  micInputGain: number;
  voicePlaybackVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const AUDIO_SETTINGS_STORAGE_KEY = "kub:audio-settings:v1";
export const AUDIO_SETTINGS_EVENT = "kub:audio-settings-change";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  micInputGain: 1,
  voicePlaybackVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeAudioSettings(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    micInputGain: clamp(value?.micInputGain ?? DEFAULT_AUDIO_SETTINGS.micInputGain, 0, 2),
    voicePlaybackVolume: clamp(value?.voicePlaybackVolume ?? DEFAULT_AUDIO_SETTINGS.voicePlaybackVolume, 0, 2),
    noiseSuppression: value?.noiseSuppression ?? DEFAULT_AUDIO_SETTINGS.noiseSuppression,
    echoCancellation: value?.echoCancellation ?? DEFAULT_AUDIO_SETTINGS.echoCancellation,
    autoGainControl: value?.autoGainControl ?? DEFAULT_AUDIO_SETTINGS.autoGainControl,
  };
}

export function getAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_AUDIO_SETTINGS;
  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    return normalizeAudioSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

function saveAudioSettings(next: AudioSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<AudioSettings>(AUDIO_SETTINGS_EVENT, { detail: next }));
}

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>(() => getAudioSettings());

  useEffect(() => {
    const handleLocalChange = (event: Event) => {
      const custom = event as CustomEvent<AudioSettings>;
      setSettings(normalizeAudioSettings(custom.detail ?? getAudioSettings()));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === AUDIO_SETTINGS_STORAGE_KEY) setSettings(getAudioSettings());
    };
    window.addEventListener(AUDIO_SETTINGS_EVENT, handleLocalChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(AUDIO_SETTINGS_EVENT, handleLocalChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<AudioSettings>) => {
    const next = normalizeAudioSettings({ ...getAudioSettings(), ...patch });
    setSettings(next);
    saveAudioSettings(next);
  }, []);

  const resetSettings = useCallback(() => {
    const next = DEFAULT_AUDIO_SETTINGS;
    setSettings(next);
    saveAudioSettings(next);
  }, []);

  return { settings, updateSettings, resetSettings };
}

export function formatAudioPercent(value: number) {
  return `${Math.round(clamp(value, 0, 2) * 100)}%`;
}
