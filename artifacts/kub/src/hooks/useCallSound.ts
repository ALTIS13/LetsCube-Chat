"use client";

import { useEffect } from "react";
import {
  notificationSoundAllowed,
  voiceRingSound,
  type CallRingDirection,
  type CallRingState,
} from "@/lib/callSounds";
import {
  playNotificationSound,
  playingCallSound,
  primeCallSoundsOnGesture,
  setVoiceRingSound,
  stopAllCallSounds,
} from "@/lib/callSoundPlayer";
import { getAudioSettings } from "@/hooks/useAudioSettings";
import { useAppStore } from "@/store/app.store";

/**
 * The wiring between the ring's state and the sound it makes.
 *
 * Every rule is `lib/callSounds.ts`'s, where `node --test` can reach it, and
 * every browser fact is `lib/callSoundPlayer.ts`'s. What is here is the third
 * thing neither can be: React's idea of when something changed.
 *
 * ## Driven by state, which is what makes the stop paths free
 *
 * `useVoiceRingSound` is given what the ring **is**, not what just happened to
 * it, and §4a is the reason that matters. Every device the person is signed in
 * on rings, and any of them answering stops the rest — so the ways a ring can
 * end are: answered here, answered on another device, declined here, declined
 * there, cancelled by the caller, run out after forty-five seconds, the whole
 * row gone because somebody hung up, the conversation closed, the tab hidden
 * and the call finished while it was hidden, and the component unmounted.
 *
 * Not one of those is a handler below. `pickVoiceRing` already answers `null`
 * for all of them, `voiceRingSound` turns any state that is not `ringing` into
 * silence, and the effect's own cleanup covers the unmount. A missed event
 * cannot leave a tone running, because nothing here listens for an event.
 */
export function useVoiceRingSound(input: {
  readonly state: CallRingState;
  readonly direction: CallRingDirection | null;
  readonly enabled: boolean;
}): void {
  const { state, direction, enabled } = input;
  useEffect(() => {
    void setVoiceRingSound(voiceRingSound({ state, direction, enabled }));
  }, [state, direction, enabled]);

  // Separate from the effect above and with no dependencies, deliberately. A
  // cleanup that ran on every change of state would stop the ring and start it
  // again on each re-evaluation; this one runs exactly once, when the surface
  // that owns the sound goes away.
  useEffect(() => stopAllCallSounds, []);
}

/**
 * Resume the audio context on any gesture the application already receives.
 *
 * Installed by the one component that is mounted for the whole session rather
 * than at the module's top level: an import with a side effect runs in every
 * test that loads anything downstream of it, and there is no reason for this
 * one to run in a bare `node --test`.
 */
export function useCallSoundPriming(): void {
  useEffect(() => primeCallSoundsOnGesture(), []);
}

/**
 * A notification arrived. Sound it, if it should be sounded.
 *
 * A plain function rather than a hook because the place it is called from is a
 * Realtime callback, not a render. The three refusals are
 * `notificationSoundAllowed`'s and are tested there; what this adds is the two
 * readings that can only be taken here — the setting as it is stored right now,
 * and whether the reader is looking at the conversation the notification is
 * about.
 */
export function playNotificationSoundFor(input: {
  readonly chatId: string | null;
  /** Whether the shell raised an operating-system notification for the same row. */
  readonly osToast: boolean;
}): void {
  const allowed = notificationSoundAllowed({
    enabled: getAudioSettings().notificationSoundEnabled,
    ringing: playingCallSound(),
    chatId: input.chatId,
    openChatId: useAppStore.getState().selectedChatId,
    documentHidden: typeof document !== "undefined" && document.hidden,
    osToast: input.osToast,
  });
  if (allowed) void playNotificationSound();
}
