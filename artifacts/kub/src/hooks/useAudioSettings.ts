"use client";

import { useCallback, useEffect, useState } from "react";
// Relative and with the extension, not `@/lib/micGate`, and neither half is a
// slip. This module is imported by `tests/unit/mic-gate.test.mts` and
// `audio-live-settings.test.mts` in a bare `node --test` process, which
// resolves no bundler alias and no extensionless specifier: `@/lib/micGate`
// fails at load with `Cannot find package '@/lib'` and `../lib/micGate` with
// `Cannot find module`. Both were measured rather than guessed. `./motion.ts`
// is imported this way by half of `lib/` and `allowImportingTsExtensions` is
// already on, so this is the repository's own form for a runtime import that
// has to survive outside the bundler.
import {
  clampMicGateThreshold,
  MIC_ACTIVATION_DEFAULT,
  MIC_GATE_THRESHOLD_DEFAULT,
  MIC_TALK_KEY_DEFAULT,
  micTalkKeyRefusal,
  readMicActivation,
  type MicActivation,
} from "../lib/micGate.ts";
// The same form, and the same reason: read by `node --test` as well.
import {
  CALL_SOUND_DEFAULT,
  NOTIFICATION_SOUND_DEFAULT,
  readCallSoundEnabled,
  readNotificationSoundEnabled,
} from "../lib/callSounds.ts";
// And again, for the same reason.
import { MIC_NO_INPUT_DEFAULT, readMicNoInputEnabled } from "../lib/micNoInput.ts";

export type AudioProcessingMode = "clean" | "raw" | "custom";

export interface AudioSettings {
  micInputGain: number;
  /**
   * Kept so that what is already in storage still parses, and read in exactly
   * one place: `readStoredPlayback` in `lib/playbackVolume.ts`, which inherits
   * it once when the player has no volume of its own.
   *
   * Nothing writes it and nothing else reads it. It used to be applied straight
   * to a voice bubble's `<audio>` element, which the player writes to as well,
   * and the two overwrote each other (D-149). Do not wire it to a control
   * again: the playback bar's slider is the volume.
   */
  voicePlaybackVolume: number;
  processingMode: AudioProcessingMode;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  monitorGain: number;
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  /**
   * How the microphone opens in a call — Discord's «Voice Activity» versus
   * «Push to Talk», plus the state this product has always been in.
   *
   * Absent in stored settings, which is what every value written before
   * 2026-09-18 is, reads as `open`: the capture on the air until somebody
   * presses mute, which is exactly what those builds did. The rule and the
   * reasoning are in `lib/micGate.ts`; nothing about the meaning is decided
   * here.
   */
  micActivation: MicActivation;
  /** The voice-activity threshold as a position, 0..1. See `micGateOpenAt`. */
  micGateThreshold: number;
  /** The push-to-talk key, as a `KeyboardEvent.code`. */
  micTalkKey: string;
  /**
   * Whether a call makes a sound — the ring coming in, the ringback going out.
   *
   * Absent in stored settings, which is what every value written before
   * 2026-09-18 is, reads as **on**: a person who has never seen this setting
   * asked for the product to make a sound, and that request is what this whole
   * change answers. The rule is `lib/callSounds.ts`'s and nothing about the
   * meaning is decided here.
   */
  callSoundEnabled: boolean;
  /**
   * Whether a notification makes a sound.
   *
   * A separate switch from the call's, on purpose: somebody who wants a silent
   * office still wants their telephone to ring.
   */
  notificationSoundEnabled: boolean;
  /**
   * Whether a call warns when the microphone is producing nothing.
   *
   * Discord's «Предупреждение об отсутствии звука», and the only one of its
   * seven advanced voice settings this product can honestly offer in a browser.
   * Absent in stored settings reads as **on**, for the reason
   * `callSoundEnabled` above is given: the person who has never opened this
   * panel is exactly the person who will not know why nobody can hear them.
   *
   * The rule is `lib/micNoInput.ts`'s — including what «nothing» means, which
   * is the whole honesty of the feature — and nothing about it is decided here.
   */
  micNoInputWarning: boolean;
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
  micActivation: MIC_ACTIVATION_DEFAULT,
  micGateThreshold: MIC_GATE_THRESHOLD_DEFAULT,
  micTalkKey: MIC_TALK_KEY_DEFAULT,
  callSoundEnabled: CALL_SOUND_DEFAULT,
  notificationSoundEnabled: NOTIFICATION_SOUND_DEFAULT,
  micNoInputWarning: MIC_NO_INPUT_DEFAULT,
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
    // Each read through `lib/micGate.ts` rather than clamped again here: the
    // rule about what a stored value may be is the same rule the gate obeys,
    // and two copies of it would be two answers to «what does an old settings
    // value mean».
    micActivation: readMicActivation(settings?.micActivation),
    micGateThreshold: clampMicGateThreshold(settings?.micGateThreshold),
    micTalkKey: readTalkKey(settings?.micTalkKey),
    // Each through `lib/callSounds.ts`, for the reason the three above are read
    // through `lib/micGate.ts`: what an absent or hand-edited value means is one
    // rule, and a second copy of it here would be a second answer.
    callSoundEnabled: readCallSoundEnabled(settings?.callSoundEnabled),
    notificationSoundEnabled: readNotificationSoundEnabled(settings?.notificationSoundEnabled),
    // Through `lib/micNoInput.ts` for the reason the five above are read
    // through their own modules: one rule about what an absent value means.
    micNoInputWarning: readMicNoInputEnabled(settings?.micNoInputWarning),
  };
}

/**
 * A stored talk key, or the default.
 *
 * The same refusal the recorder applies, so a value hand-edited into storage —
 * `Escape`, a bare modifier — cannot bind a key the interface would never have
 * offered.
 */
function readTalkKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return MIC_TALK_KEY_DEFAULT;
  return micTalkKeyRefusal(value) === null ? value : MIC_TALK_KEY_DEFAULT;
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
