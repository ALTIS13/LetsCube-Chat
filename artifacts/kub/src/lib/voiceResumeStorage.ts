/**
 * Where the voice-resume record is kept, and the one thing two callers share.
 *
 * Split from `lib/voiceResume.ts` so that module can stay free of every browser
 * API and be read directly by `node --test`, and split from
 * `components/chat/VoiceResumeNotice.tsx` because `AppUpdateBanner` needs one
 * of these functions and importing a component for a helper is how a bundle
 * acquires a cycle.
 *
 * `localStorage` rather than `sessionStorage`: a crashed tab is one of the
 * cases, and it takes its session storage with it. Every access is guarded —
 * site data blocked in a private window **throws** on access rather than
 * answering null, which `getAudioSettings` learned first. A browser that cannot
 * remember never comes back by itself, and that is the safe failure: the other
 * direction opens a microphone.
 */

import {
  VOICE_RESUME_KEY,
  parseVoiceResumeRecord,
  serializeVoiceResumeRecord,
  type VoiceResumeRecord,
} from "@/lib/voiceResume";

export function readVoiceResume(): VoiceResumeRecord | null {
  try {
    return parseVoiceResumeRecord(window.localStorage.getItem(VOICE_RESUME_KEY));
  } catch {
    return null;
  }
}

export function writeVoiceResume(record: VoiceResumeRecord): void {
  try {
    window.localStorage.setItem(VOICE_RESUME_KEY, serializeVoiceResumeRecord(record));
  } catch {
    // Nothing to do: a browser that cannot remember simply does not return.
  }
}

export function clearVoiceResume(): void {
  try {
    window.localStorage.removeItem(VOICE_RESUME_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Says that the product itself is about to take the page away.
 *
 * The only thing that turns an `unplanned` record into an `interrupted` one,
 * and therefore the only thing that can make a return happen without anybody
 * pressing anything. Called immediately before a reload the product decided on
 * — today that is `AppUpdateBanner`, both its quiet restart and its button.
 *
 * Does nothing when there is no live record, which is the normal case: the
 * overwhelming majority of updates are taken by somebody who is not in a call.
 */
export function markVoiceResumeInterrupted(): void {
  const record = readVoiceResume();
  if (!record) return;
  // The timestamp is refreshed too. The window runs from when the call was last
  // known to be up, and it was up a moment ago — reusing a heartbeat that could
  // be fifty-nine seconds old would spend a minute of the five on nothing.
  writeVoiceResume({ ...record, cause: "interrupted", at: Date.now() });
}
