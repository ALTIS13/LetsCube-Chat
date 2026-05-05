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

function toFiniteNumber(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = toFiniteNumber(value, fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  if (numberValue < min) return min;
  if (numberValue > max) return max;
  return numberValue;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function clampAudioElementVolume(value: unknown): number {
  // HTMLMediaElement.volume accepts only 0..1. Mic input gain is separate and may be above 1.
  return clamp(value, 0, 1, DEFAULT_AUDIO_SETTINGS.voicePlaybackVolume);
}

function parseAudioSettings(value: unknown): Partial<AudioSettings> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Partial<AudioSettings>;
}

function clampPercentGain(value: unknown) {
  // Web Audio microphone gain is app-level amplification and intentionally supports 0..200%.
  return clamp(value, 0, 2, DEFAULT_AUDIO_SETTINGS.micInputGain);
}

function clampPlaybackVolume(value: unknown) {
  // Playback uses an <audio> element for now, so values above 100% are clamped to avoid crashes.
  return clampAudioElementVolume(value);
}

function formatClampedPercent(value: number, max: number) {
  if (!Number.isFinite(value)) return `${Math.round(DEFAULT_AUDIO_SETTINGS.voicePlaybackVolume * 100)}%`;
  return `${Math.round(Math.min(max, Math.max(0, value)) * 100)}%`;
}

export function normalizeAudioSettings(value: unknown): AudioSettings {
  const settings = parseAudioSettings(value);
  return {
    micInputGain: clampPercentGain(settings?.micInputGain),
    voicePlaybackVolume: clampPlaybackVolume(settings?.voicePlaybackVolume),
    noiseSuppression: readBoolean(settings?.noiseSuppression, DEFAULT_AUDIO_SETTINGS.noiseSuppression),
    echoCancellation: readBoolean(settings?.echoCancellation, DEFAULT_AUDIO_SETTINGS.echoCancellation),
    autoGainControl: readBoolean(settings?.autoGainControl, DEFAULT_AUDIO_SETTINGS.autoGainControl),
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
  return formatClampedPercent(value, 2);
}
