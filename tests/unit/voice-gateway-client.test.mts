import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VOICE_GATEWAY_TOKEN_PATH,
  readVoiceTokenResponse,
  voiceGatewayRefusalText,
  voiceTokenEndpoint,
  voiceTokenRequestBody,
  type VoiceGatewayRefusalCode,
} from "../../artifacts/kub/src/lib/voiceGateway.ts";

/**
 * The client's half of the voice gateway contract.
 *
 * The Edge Function is somebody else's file and is tested by
 * `voice-gateway-token.test.mjs`. What is held here is the other side: that the
 * client asks at the right path with the right body, that every answer the
 * function can give turns into either a grant or a sentence, and that the two
 * halves still agree — the last test reads the function's own source and fails
 * if it grows a refusal this client would show as «Сервер ответил неожиданно».
 */

const SUPABASE = "https://core.letscube.ru";
const CHANNEL = "33333333-3333-4333-8333-000000000001";

test("the endpoint is the function path on the configured Supabase host", () => {
  assert.equal(voiceTokenEndpoint(SUPABASE), `${SUPABASE}/functions/v1/voice-gateway/token`);
  // A configured URL with a trailing slash — which a hand-typed Coolify
  // variable often has — must not produce a double slash Kong would 404.
  assert.equal(voiceTokenEndpoint(`${SUPABASE}///`), `${SUPABASE}/functions/v1/voice-gateway/token`);
  assert.equal(VOICE_GATEWAY_TOKEN_PATH, "/functions/v1/voice-gateway/token");
});

test("the body carries exactly channelId", () => {
  assert.deepEqual(voiceTokenRequestBody(CHANNEL), { channelId: CHANNEL });
  // The room name is derived from the channel id by the gateway and is never
  // sent by the client (section 3.4), so the body has exactly one key.
  assert.deepEqual(Object.keys(voiceTokenRequestBody(CHANNEL)), ["channelId"]);
});

test("a grant needs both halves, whatever the status says", () => {
  const good = readVoiceTokenResponse(200, {
    ok: true,
    url: "wss://voice.letscube.ru",
    room: "vc_x",
    identity: "u",
    token: "jwt.value.here",
    canPublish: true,
  });
  assert.deepEqual(good, { ok: true, grant: { url: "wss://voice.letscube.ru", token: "jwt.value.here", canPublish: true } });

  // A 200 with nothing usable is a refusal. Without this branch the hook would
  // hand an empty URL to the SDK and the person would watch «Подключаемся…»
  // until a socket timeout, which is a silent failure by another name.
  assert.deepEqual(readVoiceTokenResponse(200, { ok: true, url: "wss://x" }), { ok: false, code: "malformed" });
  assert.deepEqual(readVoiceTokenResponse(200, { token: "t" }), { ok: false, code: "malformed" });
  assert.deepEqual(readVoiceTokenResponse(200, { url: "  ", token: "  " }), { ok: false, code: "malformed" });
  assert.deepEqual(readVoiceTokenResponse(200, null), { ok: false, code: "malformed" });
  assert.deepEqual(readVoiceTokenResponse(200, "not json"), { ok: false, code: "malformed" });
});

test("canPublish defaults to true and is only false when the gateway says so", () => {
  const grant = (payload: Record<string, unknown>) => {
    const outcome = readVoiceTokenResponse(200, { url: "wss://x", token: "t", ...payload });
    assert.equal(outcome.ok, true);
    return outcome.ok ? outcome.grant : null;
  };
  assert.equal(grant({})?.canPublish, true);
  assert.equal(grant({ canPublish: true })?.canPublish, true);
  assert.equal(grant({ canPublish: false })?.canPublish, false);
  // Anything that is not the literal `true` is not a grant to publish: a
  // truthy string from a future gateway must not silently become permission.
  assert.equal(grant({ canPublish: "yes" })?.canPublish, false);
  assert.equal(grant({ canPublish: null })?.canPublish, false);
});

test("every refusal the function can send has a category", () => {
  const cases: Array<[number, string, VoiceGatewayRefusalCode]> = [
    [400, "invalid_request", "malformed"],
    [404, "not_found", "unavailable"],
    [405, "method_not_allowed", "malformed"],
    [401, "unauthorized", "unauthenticated"],
    [403, "banned", "forbidden"],
    [403, "not_a_member", "forbidden"],
    [404, "channel_not_found", "not_found"],
    [409, "channel_full", "channel_full"],
    [503, "not_configured", "disabled"],
    [503, "unavailable", "unavailable"],
    [503, "voice_unavailable", "unavailable"],
    // Slice 5. `voice_disabled` is the kill switch; `voice_at_capacity` is the
    // server-wide cap, and it is deliberately not `channel_full` -- the room
    // may be empty and the reader must not go looking for somebody to remove.
    [503, "voice_disabled", "disabled"],
    [503, "voice_at_capacity", "at_capacity"],
    [429, "rate_limited", "rate_limited"],
  ];
  for (const [status, wire, expected] of cases) {
    assert.deepEqual(
      readVoiceTokenResponse(status, { ok: false, error: wire }),
      { ok: false, code: expected },
      `${status} ${wire}`,
    );
  }
});

test("the body's reason beats the status, and the status is the fallback", () => {
  // A 503 that names `not_configured` is «отключены», not «недоступен»: the
  // status is a coarse summary and the gateway is the authority on why.
  assert.deepEqual(readVoiceTokenResponse(503, { error: "not_configured" }), { ok: false, code: "disabled" });
  assert.deepEqual(readVoiceTokenResponse(503, { error: "unavailable" }), { ok: false, code: "unavailable" });

  // A reason this client has never heard of falls back to the status rather
  // than to «unknown», so the gateway can grow one without a client deploy.
  assert.deepEqual(readVoiceTokenResponse(403, { error: "some_future_reason" }), { ok: false, code: "forbidden" });
  assert.deepEqual(readVoiceTokenResponse(429, {}), { ok: false, code: "rate_limited" });
  assert.deepEqual(readVoiceTokenResponse(500, null), { ok: false, code: "unavailable" });
  assert.deepEqual(readVoiceTokenResponse(418, null), { ok: false, code: "malformed" });

  // Status 0 is this client's convention for «fetch threw»: there was nothing
  // to read, which is a different thing to say than «the server answered».
  assert.deepEqual(readVoiceTokenResponse(0, null), { ok: false, code: "network" });
});

test("each category is a distinct Russian sentence, and none names a status code", () => {
  const codes: VoiceGatewayRefusalCode[] = [
    "unauthenticated",
    "forbidden",
    "not_found",
    "channel_full",
    "at_capacity",
    "disabled",
    "rate_limited",
    "unavailable",
    "malformed",
    "network",
  ];
  const seen = new Set<string>();
  for (const code of codes) {
    const text = voiceGatewayRefusalText(code);
    assert.match(text, /[А-Яа-яЁё]/, code);
    assert.match(text, /\.$/, `${code} must be a sentence`);
    assert.doesNotMatch(text, /\d{3}/, `${code} must not print a status code`);
    seen.add(text);
  }
  // `malformed` and `unknown` share a sentence by design; every other category
  // is something different for the reader to do.
  assert.equal(seen.size, codes.length);
});

test("the function's own refusals are all known to this client", () => {
  // The two halves of slice 2 are written by two agents at once. This reads the
  // function's source rather than a description of it, so a tenth refusal added
  // there shows up here as a failure instead of as «Сервер ответил неожиданно»
  // in front of a person.
  const source = readFileSync("supabase/functions/voice-gateway/index.ts", "utf8");
  // Only what actually reaches the wire. `missing_token` is an internal value
  // inside the webhook's verification result that is turned into `unauthorized`
  // before it is sent, and a scan that counted it would be asking this client
  // to recognise a string no response ever carries.
  // Widened on 2026-09-18, and the widening is itself a finding. The
  // moderation routes put their refusals in `moderation.mjs` as
  // `{ error: "...", status: 403 }` rather than through `jsonResponse`, so the
  // original scan read none of them: six new wire codes went straight past a
  // guard written to catch exactly that, and it stayed green. Both files now,
  // and both shapes.
  const moderation = readFileSync("supabase/functions/voice-gateway/moderation.mjs", "utf8");
  // Widened again on 2026-09-18, for the same reason and with the same lesson.
  // Slice 5's kill switch answers from `admission.mjs`, in `moderationRefusal`'s
  // `{ error, status }` shape, and `index.ts` returns that object rather than a
  // literal -- so `voice_disabled` appears in neither file this scan already
  // read. Three sources now.
  const admission = readFileSync("supabase/functions/voice-gateway/admission.mjs", "utf8");
  const statusShape = /error:\s*"([a-z_]+)",\s*status:\s*\d{3}/g;
  const wire = new Set(
    [
      ...source.matchAll(/(?:jsonResponse\(request,|plainJson\()\s*\{\s*ok:\s*false,\s*error:\s*"([a-z_]+)"/g),
      ...source.matchAll(statusShape),
      ...moderation.matchAll(new RegExp(statusShape.source, "g")),
      ...admission.matchAll(new RegExp(statusShape.source, "g")),
    ].map((match) => match[1]),
  );
  assert.ok(wire.size >= 8, `expected the function to name several refusals, found ${wire.size}`);
  // The control for the widening: if the scan stops reading the moderation
  // file, these six vanish from the set and the assertion below passes over
  // them in silence — which is what it did before.
  for (const added of [
    "not_a_moderator",
    "self_not_allowed",
    "target_is_owner",
    "target_protected",
    "target_not_a_member",
    "participant_not_in_room",
    // The control for the third source. Drop `admission.mjs` from the list
    // above and this one vanishes from the set, which is what the two previous
    // widenings both discovered the hard way.
    "voice_disabled",
    // And this one is the control for `index.ts` itself: it is the only wire
    // code the concurrency cap can send.
    "voice_at_capacity",
  ]) {
    assert.ok(wire.has(added), `the scan does not see «${added}», so it reads only part of the function`);
  }

  const client = readFileSync("artifacts/kub/src/lib/voiceGateway.ts", "utf8");
  const mapped = new Set(
      // Any category, not the nine that existed when this was written. That
      // alternation was the other half of the blindness: a code mapped onto a
      // NEW category counted as unmapped too, so the two halves cancelled and
      // the test passed over both.
    [...client.matchAll(/^\s{2}([a-z_]+):\s*"([a-z_]+)",$/gm)]
      .map((match) => match[1]),
  );
  const unmapped = [...wire].filter((code) => !mapped.has(code));
  assert.deepEqual(unmapped, [], `the gateway sends refusals this client does not recognise: ${unmapped.join(", ")}`);
});
