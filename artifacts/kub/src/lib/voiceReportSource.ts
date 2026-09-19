"use client";

import { DEFAULT_AUDIO_DEVICE_ID, getAudioSettings } from "@/hooks/useAudioSettings";
import {
  currentVoiceRoom,
  voiceAudioEverBlockedSnapshot,
  voiceCallSnapshot,
  voiceJoinJournalSnapshot,
  voiceSelfIdSnapshot,
} from "@/hooks/useVoiceCall";
import { getBuildMetadata } from "@/lib/monitoring";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";
import type { VoiceHealth, VoiceHealthSample } from "@/lib/voiceConnectionHealth";
import { buildVoiceReport, type VoiceReportInput } from "@/lib/voiceConnectionReport";

/** A device the person actually picked, or `null` for the system default. */
function chosenDevice(deviceId: string): string | null {
  const held = deviceId.trim();
  return held && held !== DEFAULT_AUDIO_DEVICE_ID ? held : null;
}

/**
 * Everything the connection report needs, collected from the running
 * application.
 *
 * The split from `lib/voiceConnectionReport.ts` is the same one this feature
 * makes everywhere: that module is the words and the arithmetic and imports
 * nothing, so `node --test` drives every line of it against inputs a test
 * controls; this one is the seven places the facts actually live, and it is
 * the part a test cannot reach without a browser. Keeping the gathering here
 * is what stops the report's *shape* being a thing only Playwright can check.
 *
 * ## No second sampler, deliberately
 *
 * The readings come in as an argument, from the ring `useVoiceHealth` is
 * already filling while the panel is open. Nothing here calls `sampleHealth`.
 *
 * That is not only tidiness. A reading taken on a press would land at an
 * irregular distance from the last scheduled one, and every rate in
 * `lib/voiceConnectionHealth.ts` is a movement divided by the window between
 * two readings — so an extra sample a few milliseconds after its predecessor
 * divides by a near-zero window, which is the exact hazard `useVoiceHealth`'s
 * own overlap guard exists for. The report therefore prints how many readings
 * it is made of and lets the reader judge, rather than manufacturing one more.
 */
export function collectVoiceReportInput(input: {
  readonly samples: readonly VoiceHealthSample[];
  readonly health: VoiceHealth | null;
  /**
   * The per-report hashing salt and the report's own name.
   *
   * Passed in rather than generated here so that a test can pin both and read
   * the whole file back byte for byte. See `voiceReportIdentity`.
   */
  readonly salt: string;
  readonly reportId: string;
}): VoiceReportInput {
  const call = voiceCallSnapshot();
  const build = getBuildMetadata();
  const audio = getAudioSettings();
  const transport = currentVoiceRoom();

  return {
    at: Date.now(),
    salt: input.salt,
    reportId: input.reportId,
    app: {
      version: build.version,
      // `getBuildMetadata` answers the string «unknown» where the build carried
      // no commit; the report's own convention for «not known» is a dash, so
      // the translation happens here rather than in two vocabularies.
      commit: build.commit && build.commit !== "unknown" ? build.commit : null,
      shell: `${getCurrentDistributionTarget()} · ${build.environment}`,
      userAgent: typeof navigator === "undefined" ? "—" : navigator.userAgent,
    },
    call: {
      phase: call.phase,
      channelId: call.channelId,
      canPublish: call.canPublish,
      micMuted: call.micMuted,
      deafened: call.deafened,
      speechRevoked: call.speechRevoked,
      audioEverBlocked: voiceAudioEverBlockedSnapshot(),
      audioBlockedNow: call.audioBlocked,
      outputDeviceRefused: call.outputDeviceRefused,
      refusal: call.refusal,
      // The identity the gateway minted the token with — read from the one
      // place it comes from, never from `participants[0]`. That entry is the
      // local one only as a property of `report()`'s ordering, which
      // `useVoiceCall.ts` says at its own `selfUserId` in as many words; a
      // report that named the wrong person in the «you» line would be wrong
      // silently and would stay wrong. Hashed by the report, like every other
      // account identifier in it.
      identity: voiceSelfIdSnapshot(),
      participants: call.participants.map((who) => ({
        userId: who.userId,
        muted: who.muted,
        canSpeak: who.canSpeak,
        audioSource: who.audioSource,
        // `name` is deliberately not read. It is the one field of
        // `VoiceParticipant` that carries a person, and a report that has to be
        // edited before it can be sent is a report nobody sends.
      })),
    },
    devices: {
      // `"default"` is a real device id in the Web Audio spec and it is this
      // product's stored value for «whatever the system is using». It has to
      // reach the report as `null` rather than as a hash, because a hash of it
      // would be one identifier shared by everybody who has never chosen a
      // device — a line that reads as a choice where none was made, and the one
      // hash in the file that really would be correlatable across reports.
      input: chosenDevice(audio.selectedInputDeviceId),
      output: chosenDevice(audio.selectedOutputDeviceId),
    },
    journal: voiceJoinJournalSnapshot(),
    transport: transport?.describeConnection() ?? null,
    health: input.health,
    samples: input.samples,
  };
}

/**
 * A fresh salt and a fresh name for one report.
 *
 * The salt is 128 bits of randomness and **never leaves this page**: it is what
 * makes the participant hashes in the report impossible to recompute against a
 * list of user ids, and impossible to line up with the hashes in a second
 * report. `reportId` is separate and is printed, so two reports about one
 * evening can be told apart by the person reading them.
 *
 * `crypto.getRandomValues` where there is one, and `Math.random` where there is
 * not. The fallback is stated rather than hidden: it is not cryptographic, and
 * on a platform that lacks `crypto` the hashes in the report are weaker than
 * they read. Every shell this product ships on has it — the check exists for a
 * test process and for an old WebView, not as a real branch.
 */
export function voiceReportIdentity(): { salt: string; reportId: string } {
  const bytes = new Uint32Array(5);
  const source = typeof crypto === "undefined" ? null : crypto;
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 0xffffffff);
  const word = (index: number) => bytes[index].toString(36);
  return {
    salt: `${word(0)}${word(1)}${word(2)}${word(3)}`,
    reportId: word(4).slice(0, 6).padStart(6, "0"),
  };
}

/** The report, as a string ready for the clipboard. */
export function makeVoiceReport(input: {
  readonly samples: readonly VoiceHealthSample[];
  readonly health: VoiceHealth | null;
}): string {
  const { salt, reportId } = voiceReportIdentity();
  return buildVoiceReport(collectVoiceReportInput({ ...input, salt, reportId }));
}
