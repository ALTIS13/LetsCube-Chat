/**
 * Mute and deafen as a person's own standing choice, not a property of one call.
 *
 * Tracker item 40. Discord's panel at the foot of the channel list carries a
 * microphone and a pair of headphones that work whether or not you are in a
 * call, and what you set there is what the next call starts with. Ours were
 * controls of the call alone: they existed only on the capsule and the call
 * bar, every join started unmuted and hearing, and every leave forgot.
 *
 * The rule lives here, where `node --test` reaches it; `hooks/useVoiceCall.ts`
 * holds the value, persists it and pushes it at the transport. Two booleans,
 * and the distinction between them is the whole of the design:
 *
 *  - `muted` is the microphone **as the person set it**, and deafening does not
 *    touch it. So undeafening gives back exactly the microphone somebody had —
 *    muted if they had muted it first, open if not — which is what the call's
 *    own `mutedBeforeDeafened` did for the length of one call and what this
 *    now does across calls and reloads.
 *  - `deafened` silences the room and, while it is on, the microphone too:
 *    somebody who cannot hear the room cannot hear themselves being asked to
 *    stop talking. That is `micMutedBy`, the one place the two meet.
 *
 * A moderator's silence is **not** in here and must never be written here: it
 * is somebody else's decision about this call (`lib/micSilence.ts`), and
 * persisting it would carry one room's sanction into every call after it.
 */

export interface VoiceSelfAudio {
  /** The microphone as the person set it, independent of deafening. */
  readonly muted: boolean;
  /** Whether the person has stopped hearing the room. */
  readonly deafened: boolean;
}

export const VOICE_SELF_AUDIO_STORAGE_KEY = "letscube:voice-self-audio:v1";

export const VOICE_SELF_AUDIO_DEFAULT: VoiceSelfAudio = Object.freeze({ muted: false, deafened: false });

/**
 * What storage holds, read back.
 *
 * Anything that is not the shape — nothing stored, a value from a future
 * version, a string somebody edited by hand — reads as the default: open and
 * hearing, which is what every build before this one did on every join.
 */
export function readVoiceSelfAudio(raw: string | null): VoiceSelfAudio {
  if (raw === null) return VOICE_SELF_AUDIO_DEFAULT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return VOICE_SELF_AUDIO_DEFAULT;
  }
  if (typeof value !== "object" || value === null) return VOICE_SELF_AUDIO_DEFAULT;
  const record = value as Record<string, unknown>;
  return {
    muted: record.muted === true,
    deafened: record.deafened === true,
  };
}

export function writeVoiceSelfAudio(self: VoiceSelfAudio): string {
  return JSON.stringify({ muted: self.muted, deafened: self.deafened });
}

/** Whether the microphone is off because of the person's own choices. */
export function micMutedBy(self: VoiceSelfAudio): boolean {
  return self.muted || self.deafened;
}

/**
 * The headphones, set.
 *
 * Only `deafened` moves. The microphone the person set stays what it was, so
 * the press that brings the room back brings back their microphone as they
 * left it rather than opening one they had closed.
 */
export function chooseHeadphones(self: VoiceSelfAudio, deafened: boolean): VoiceSelfAudio {
  return { muted: self.muted, deafened };
}

/**
 * The microphone, set.
 *
 * Turning it on while deafened gives back the room as well: the press means
 * «I want to talk», and a microphone opened for somebody still unable to hear
 * the room is the state deafening exists to prevent — which is what the call's
 * own controls did until this change. Turning it off leaves deafening alone.
 */
export function chooseMicrophone(self: VoiceSelfAudio, muted: boolean): VoiceSelfAudio {
  if (!muted) return { muted: false, deafened: false };
  return { muted: true, deafened: self.deafened };
}
