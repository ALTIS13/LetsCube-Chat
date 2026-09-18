"use client";

import { useCallback, useEffect, useState } from "react";
import { currentVoiceRoom } from "@/hooks/useVoiceCall";
import {
  chosenVoiceVolume,
  normalizeVoiceVolume,
  readStoredVoiceVolumes,
  voiceVolumesAfter,
  VOICE_VOLUME_EVENT,
  VOICE_VOLUME_STORAGE_KEY,
} from "@/lib/voiceVolume";

/**
 * Where a listener's per-person volumes are kept, and the one place that writes
 * them.
 *
 * Every decision is in `lib/voiceVolume.ts`, which `node --test` reads; what is
 * here is the two things that are not decisions — the browser's storage and the
 * live room — and the subscription that keeps an open slider in step with
 * another tab.
 *
 * The shape follows `useAudioSettings`: a key, a normalizer that owns every
 * malformed value, a guarded read, and a write that dispatches a `CustomEvent`
 * so components in this document hear it (a `storage` event only fires in the
 * *other* tabs, which is the trap that pattern exists to avoid).
 *
 * **Storage is not the only writer.** `createLiveKitRoom` seeds itself from the
 * same key when a room is built, because nothing here is guaranteed to be
 * mounted while a call runs. So a chosen volume reaches the SFU by two paths:
 * this one while a slider is being dragged, and the seam's own read on the next
 * join. They cannot disagree — both go through `readStoredVoiceVolumes`.
 *
 * One limit, stated rather than hidden: a volume chosen in **another tab** is
 * stored and drawn here, but does not reach a call already running in this one
 * until it is rejoined. The room's map is seeded at construction and only this
 * document's own presses push into it. The tab that is not in the call has no
 * transport to push to anyway, so nothing is lost beyond the delay.
 */

/** Every chosen volume, by user id. Empty where storage is unreadable. */
export function getVoiceVolumes(): ReadonlyMap<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    return readStoredVoiceVolumes(window.localStorage.getItem(VOICE_VOLUME_STORAGE_KEY));
  } catch {
    // Access itself throws in a private window with site data blocked. A
    // listener whose choices cannot be read hears everybody at the default.
    return new Map();
  }
}

/**
 * Turn one person down, or back up, for this listener alone.
 *
 * Stored **and** pushed, in that order. Storage first because it is the answer
 * that has to survive the room being rejoined and the tab being closed; the
 * room second because it is the one that can fail — there may be no call, and
 * the seam's own copy of the value is what makes a rejoin correct anyway.
 *
 * Nobody is told. There is no request, no table and no event beyond this
 * document: the person turned down cannot discover it, which is the difference
 * between this and everything in `lib/voiceModeration.ts`.
 */
export function setVoiceParticipantVolume(userId: string, volume: number): void {
  const next = normalizeVoiceVolume(volume);
  if (typeof window !== "undefined") {
    try {
      const record = voiceVolumesAfter(
        window.localStorage.getItem(VOICE_VOLUME_STORAGE_KEY),
        userId,
        next,
      );
      window.localStorage.setItem(VOICE_VOLUME_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Unwritable storage costs the choice its persistence and nothing else:
      // the push below still moves the audio for this call.
    }
    window.dispatchEvent(
      new CustomEvent<{ userId: string; volume: number }>(VOICE_VOLUME_EVENT, {
        detail: { userId, volume: next },
      }),
    );
  }
  // Fire and forget, and `catch` rather than `void` alone: the seam's method
  // answers nothing, so a rejection here would be an unhandled one — and a
  // volume that could not be applied is not a reason to interrupt a call.
  currentVoiceRoom()
    ?.setParticipantVolume(userId, next)
    .catch(() => {});
}

/**
 * The loudness chosen for one person, as a **number** rather than the map.
 *
 * The same reason `useVoiceSpeaking` hands out a boolean: a component given the
 * whole map re-renders whenever anybody's volume changes, and the row that
 * cares is the one being dragged. `null` for the user id answers the default,
 * so a surface with nothing open still has a value to draw.
 */
export function useVoiceParticipantVolume(userId: string | null): number {
  const [volume, setVolume] = useState<number>(() => chosenVoiceVolume(getVoiceVolumes(), userId));

  useEffect(() => {
    setVolume(chosenVoiceVolume(getVoiceVolumes(), userId));
    if (!userId) return;
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; volume?: number }>).detail;
      if (!detail || detail.userId !== userId) return;
      setVolume(normalizeVoiceVolume(detail.volume));
    };
    const onStorage = (event: StorageEvent) => {
      // Another tab. The key is compared rather than trusted, because a
      // `storage` event fires for every key in the same origin.
      if (event.key !== VOICE_VOLUME_STORAGE_KEY) return;
      setVolume(chosenVoiceVolume(getVoiceVolumes(), userId));
    };
    window.addEventListener(VOICE_VOLUME_EVENT, onLocalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VOICE_VOLUME_EVENT, onLocalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  return volume;
}

/** The setter, bound to one person, for a control that draws one row. */
export function useSetVoiceParticipantVolume(userId: string | null): (volume: number) => void {
  return useCallback(
    (volume: number) => {
      if (!userId) return;
      setVoiceParticipantVolume(userId, volume);
    },
    [userId],
  );
}
