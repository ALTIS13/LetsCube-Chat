"use client";

import { useCallback, useEffect, useState } from "react";

export type AudioProcessingMode = "clean" | "raw" | "custom";

export interface AudioSettings {
  micInputGain: number;
  voicePlaybackVolume: number;
  processingMode: AudioProcessingMode;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  monitorGain: number;
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
}

export const AUDIO_SETTINGS_STORAGE_KEY = "kub:audio-settings:v1";
export const AUDIO_SETTINGS_EVENT = "kub:audio-settings-change";
export const DEFAULT_AUDIO_DEVICE_ID = "default";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  micInputGain: 1,
  voicePlaybackVolume: 1,
  processingMode: "clean",
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  monitorGain: 0.8,
  selectedInputDeviceId: DEFAULT_AUDIO_DEVICE_ID,
  selectedOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID,
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

function readProcessingMode(value: unknown, fallback: AudioProcessingMode): AudioProcessingMode {
  return value === "clean" || value === "raw" || value === "custom" ? value : fallback;
}

function readDeviceId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : DEFAULT_AUDIO_DEVICE_ID;
}

export function clampAudioElementVolume(value: unknown): number {
  // HTMLMediaElement.volume accepts only 0..1. Mic input gain is separate and may be above 1.
  return clamp(value, 0, 1, DEFAULT_AUDIO_SETTINGS.voicePlaybackVolume);
}

export function applyLiveAudioGain(parameter: { value: number } | null, value: number): void {
  if (!parameter || !Number.isFinite(value)) return;
  parameter.value = value;
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

function clampMonitorGain(value: unknown) {
  return clamp(value, 0, 1, DEFAULT_AUDIO_SETTINGS.monitorGain);
}

function formatClampedPercent(value: number, max: number) {
  if (!Number.isFinite(value)) return `${Math.round(DEFAULT_AUDIO_SETTINGS.voicePlaybackVolume * 100)}%`;
  return `${Math.round(Math.min(max, Math.max(0, value)) * 100)}%`;
}

export function normalizeAudioSettings(value: unknown): AudioSettings {
  const settings = parseAudioSettings(value);
  const echoCancellation = readBoolean(settings?.echoCancellation, DEFAULT_AUDIO_SETTINGS.echoCancellation);
  const noiseSuppression = readBoolean(settings?.noiseSuppression, DEFAULT_AUDIO_SETTINGS.noiseSuppression);
  const autoGainControl = readBoolean(settings?.autoGainControl, DEFAULT_AUDIO_SETTINGS.autoGainControl);
  return {
    micInputGain: clampPercentGain(settings?.micInputGain),
    voicePlaybackVolume: clampPlaybackVolume(settings?.voicePlaybackVolume),
    processingMode: readProcessingMode(
      settings?.processingMode,
      inferProcessingMode(echoCancellation, noiseSuppression, autoGainControl),
    ),
    noiseSuppression,
    echoCancellation,
    autoGainControl,
    monitorGain: clampMonitorGain(settings?.monitorGain),
    selectedInputDeviceId: readDeviceId(settings?.selectedInputDeviceId),
    selectedOutputDeviceId: readDeviceId(settings?.selectedOutputDeviceId),
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
    const current = getAudioSettings();
    const next = normalizeAudioSettings(applyAudioSettingsPatch(current, patch));
    setSettings(next);
    saveAudioSettings(next);
    return next;
  }, []);

  const resetSettings = useCallback(() => {
    const next = DEFAULT_AUDIO_SETTINGS;
    setSettings(next);
    saveAudioSettings(next);
    return next;
  }, []);

  return { settings, updateSettings, resetSettings };
}

export function formatAudioPercent(value: number) {
  return formatClampedPercent(value, 2);
}

export function buildAudioTrackConstraints(settings: AudioSettings, includeAdvanced = true): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
    ...(settings.selectedInputDeviceId !== DEFAULT_AUDIO_DEVICE_ID
      ? { deviceId: { exact: settings.selectedInputDeviceId } }
      : null),
    ...(includeAdvanced ? {
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    } : null),
  };
}

export function settingsForProcessingMode(mode: Exclude<AudioProcessingMode, "custom">): Pick<AudioSettings, "processingMode" | "echoCancellation" | "noiseSuppression" | "autoGainControl"> {
  const enabled = mode === "clean";
  return {
    processingMode: mode,
    echoCancellation: enabled,
    noiseSuppression: enabled,
    autoGainControl: enabled,
  };
}

export function inferProcessingMode(
  echoCancellation: boolean,
  noiseSuppression: boolean,
  autoGainControl: boolean,
): AudioProcessingMode {
  if (echoCancellation && noiseSuppression && autoGainControl) return "clean";
  if (!echoCancellation && !noiseSuppression && !autoGainControl) return "raw";
  return "custom";
}

function applyAudioSettingsPatch(current: AudioSettings, patch: Partial<AudioSettings>): Partial<AudioSettings> {
  if (patch.processingMode === "clean" || patch.processingMode === "raw") {
    return { ...current, ...patch, ...settingsForProcessingMode(patch.processingMode) };
  }

  const merged = { ...current, ...patch };
  if (
    "echoCancellation" in patch ||
    "noiseSuppression" in patch ||
    "autoGainControl" in patch
  ) {
    merged.processingMode = inferProcessingMode(
      Boolean(merged.echoCancellation),
      Boolean(merged.noiseSuppression),
      Boolean(merged.autoGainControl),
    );
  }
  return merged;
}
