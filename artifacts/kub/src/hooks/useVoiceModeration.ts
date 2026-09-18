"use client";

import { useCallback, useState } from "react";
import { createClient, getSupabasePublicUrl, getSupabasePublishableKey } from "@/lib/supabase/client";
import { showActionFeedback } from "@/lib/actionFeedback";
import {
  readVoiceModerationResponse,
  voiceForceMuteRequestBody,
  voiceGatewayRefusalText,
  voiceModerationEndpoint,
  voiceRemoveRequestBody,
  type VoiceModerationOutcome,
} from "@/lib/voiceGateway";
import {
  voiceModerationFeedback,
  voiceModerationRoute,
  type VoiceModerationAction,
} from "@/lib/voiceModeration";

/**
 * Silencing and disconnecting somebody who is already in a voice room (D-221).
 *
 * The rules are `lib/voiceModeration.ts` and the wire is `lib/voiceGateway.ts`;
 * both are pure and tested without a browser. What is here is the request and
 * — the part that took the most care — **what the interface is allowed to claim
 * afterwards.**
 *
 * ## Why a success has to be read, not assumed
 *
 * Lifting a silence does not grant permission to speak. The gateway recomputes
 * what a fresh token would grant that person: their role against the channel's
 * `speak_role`, and any staff mute from `public.mutes`. So somebody below the
 * channel's speaking role stays unable to publish, the answer says so in
 * `canPublish`, and «снова может говорить» would be a sentence about something
 * that did not happen. The third branch of `said()` exists for exactly that
 * case and reads as a warning rather than a success.
 *
 * ## Why it reports at all
 *
 * Because the screen often cannot. A moderator acting on a room **this client
 * is connected to** sees the row change, through the SFU. A moderator acting on
 * any other room sees nothing at all: `voice_participants` carries presence and
 * nothing else, so there is no permission to redraw from. Without a line saying
 * what happened, the only difference between a silence that worked and one that
 * failed would be the absence of a complaint later.
 */

export interface VoiceModerationSubject {
  readonly userId: string;
  /** How the interface already names them, for the sentence. */
  readonly name: string;
}

export interface VoiceModerationRequest {
  readonly channelId: string;
  readonly target: VoiceModerationSubject;
  readonly action: VoiceModerationAction;
}

/** Which row is mid-flight, so the menu can say so and refuse a second press. */
export interface VoiceModerationBusy {
  readonly userId: string;
  readonly action: VoiceModerationAction;
}

export interface VoiceModerationController {
  readonly busy: VoiceModerationBusy | null;
  /** True when the gateway said it did the thing. */
  moderate: (request: VoiceModerationRequest) => Promise<boolean>;
}

/**
 * The call, in the one place that makes it.
 *
 * `apikey` beside the bearer token because Kong wants it on every function call
 * on this deployment — the same pair `requestVoiceToken` sends. A `fetch` that
 * throws is reported as status 0, this client's convention for «nothing
 * answered».
 */
async function callModerationRoute(request: VoiceModerationRequest): Promise<VoiceModerationOutcome> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { ok: false, code: "unauthenticated" };

  const route = voiceModerationRoute(request.action);
  const body =
    route === "remove"
      ? voiceRemoveRequestBody(request.channelId, request.target.userId)
      : voiceForceMuteRequestBody(
          request.channelId,
          request.target.userId,
          request.action === "silence",
        );

  try {
    const response = await fetch(voiceModerationEndpoint(getSupabasePublicUrl(), route), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        apikey: getSupabasePublishableKey(),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return readVoiceModerationResponse(response.status, payload);
  } catch {
    return readVoiceModerationResponse(0, null);
  }
}

export function useVoiceModeration(): VoiceModerationController {
  const [busy, setBusy] = useState<VoiceModerationBusy | null>(null);

  const moderate = useCallback(async (request: VoiceModerationRequest) => {
    // One at a time. Two silences in flight against one room would race, and
    // the second answer would overwrite the first line with a stale one.
    setBusy({ userId: request.target.userId, action: request.action });
    try {
      const outcome = await callModerationRoute(request);
      // The sentence is decided in the pure module, which a `node --test`
      // process can load — this one imports React and the Supabase client and
      // so cannot be tested at all. That split is the lesson `voiceChannel.ts`
      // records at its own head: a rule inside a `"use client"` module is a
      // rule with no test.
      const said = voiceModerationFeedback(
        request.action,
        request.target.name,
        outcome.ok
          ? { ok: true, canSpeak: outcome.canSpeak }
          : { ok: false, refusalText: voiceGatewayRefusalText(outcome.code) },
      );
      showActionFeedback({
        ...said,
        // Keyed per person per action, so pressing twice replaces the line
        // rather than stacking a second copy beside it.
        key: `voice-moderation:${request.action}:${request.target.userId}`,
      });
      return outcome.ok;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, moderate };
}
