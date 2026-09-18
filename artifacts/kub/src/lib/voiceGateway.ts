/**
 * The voice gateway, as a contract rather than as a call.
 *
 * The gateway itself is a black box: `supabase/functions/voice-gateway/` is
 * another agent's half of slice 2, and nothing in this module knows how it
 * mints a token. What lives here is the shape of the conversation — the path,
 * the request body, and how every answer it can give turns into either a grant
 * or a sentence a person reads. That makes the seam one module wide, which is
 * what lets a test stub it: `tests/unit/voice-gateway.test.mts` drives the
 * parsing, and `tests/e2e/voice-call.spec.ts` route-mocks the endpoint.
 *
 * This module imports nothing, deliberately: the Supabase client reads
 * `import.meta.env` at load and pulls supabase-js in behind it, neither of
 * which a `node --test` process has. The fetch itself is in `hooks/`.
 *
 * The contract, as coded against (section 3.4 of the voice proposal):
 *
 *   POST {SUPABASE_URL}/functions/v1/voice-gateway/token
 *   Authorization: Bearer <the caller's Supabase access token>
 *   apikey: <the publishable key, which Kong wants on every function call>
 *   { "channelId": "<uuid>" }
 *
 *   200 { "ok": true, "url": "wss://…", "room": "vc_<uuid>",
 *         "identity": "<user id>", "token": "<a LiveKit join token>",
 *         "expiresAt": <seconds>, "canPublish": <bool>,
 *         "maxParticipants": <number> }
 *
 *   otherwise an ordinary HTTP error with { "ok": false, "error": "<code>" }.
 *
 * Read off `supabase/functions/voice-gateway/index.ts` as it stood on
 * 2026-09-13, not inferred from the proposal: the refusal field is `error`
 * rather than `code`, and there are nine of them. Only `url`, `token` and
 * `canPublish` are used here — `room` and `identity` are the gateway's own
 * derivation from `channelId` and the caller's `sub`, and a client that read
 * them back would be trusting a value it already knows.
 */

/** The path under the function host. The base is the Supabase URL the app already has. */
export const VOICE_GATEWAY_TOKEN_PATH = "/functions/v1/voice-gateway/token";

/** What a successful mint hands back: where to connect and what to say. */
export interface VoiceTokenGrant {
  /** The LiveKit signalling URL. Chosen by the gateway, never by the client. */
  url: string;
  token: string;
  /**
   * Whether this token may publish, computed by the gateway from the caller's
   * `chat_members.role` against `voice_channels.speak_role` and from whether
   * they are muted (section 3.7). The SFU enforces it whatever the client does,
   * so the only thing reading it buys is telling the person the truth instead
   * of letting them press a mute control over a microphone that was never
   * publishing. A gateway that does not say defaults to true, which is what
   * every token in slice 2 carries.
   */
  canPublish: boolean;
}

/**
 * Why a token was not minted.
 *
 * These are the interface's categories, not the gateway's wire codes — several
 * wire codes map to one of these because they mean the same thing to the person
 * reading the capsule. `unavailable` and `network` are kept apart because one is
 * "the server answered badly" and the other is "nothing answered", and only the
 * second is worth suggesting a person check their connection over.
 */
export type VoiceGatewayRefusalCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "channel_full"
  | "disabled"
  | "rate_limited"
  | "unavailable"
  | "malformed"
  | "network"
  /**
   * The moderation routes' own refusals (2026-09-18), kept apart from
   * `forbidden` because each names a rule the reader can act on rather than a
   * door that is shut.
   *
   * «Вы не модератор этой группы» and «Владельца нельзя заглушить» are
   * different sentences, and collapsing them into one would be the mistake
   * D-165 records: a card that says «недоступно» about a rule it knows.
   */
  | "not_a_moderator"
  | "self_not_allowed"
  | "target_is_owner"
  | "target_not_in_room";

export type VoiceTokenOutcome =
  | { ok: true; grant: VoiceTokenGrant }
  | { ok: false; code: VoiceGatewayRefusalCode };

/** The endpoint, from the Supabase URL the client is already configured with. */
export function voiceTokenEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}${VOICE_GATEWAY_TOKEN_PATH}`;
}

/** The body, as one object, so the field name has exactly one spelling in the client. */
export function voiceTokenRequestBody(channelId: string): { channelId: string } {
  return { channelId };
}

/**
 * The wire codes the gateway may name, mapped onto the interface's categories.
 *
 * The body's code wins over the HTTP status wherever it names one of these,
 * because the status is a coarse summary and the gateway is the authority on
 * why. A code nobody here recognises falls back to the status, which is the
 * behaviour that keeps this client working when the gateway grows a reason it
 * did not have on the day this was written.
 */
const WIRE_CODES: Record<string, VoiceGatewayRefusalCode> = {
  // The eleven the gateway can send today, read off its own source.
  invalid_request: "malformed",
  // The route, not the channel: the function answered but does not have this
  // path, which is an older deploy or a wrong URL — nothing the reader can act
  // on, and emphatically not «канал больше не существует».
  not_found: "unavailable",
  method_not_allowed: "malformed",
  unauthorized: "unauthenticated",
  not_configured: "disabled",
  unavailable: "unavailable",
  voice_unavailable: "unavailable",
  banned: "forbidden",
  not_a_member: "forbidden",
  channel_not_found: "not_found",
  channel_full: "channel_full",
  // Named by the proposal but not yet sent, and cheap to accept early: slice 5
  // adds the kill switch and the rate limit, and a client that has to be
  // redeployed to read them would delay both.
  voice_disabled: "disabled",
  rate_limited: "rate_limited",
  // The moderation routes, added with them on 2026-09-18. Mapped rather than
  // left to the status on purpose: 403 covers «you may not» and «that person
  // may not be touched», and those are not the same thing to read.
  not_a_moderator: "not_a_moderator",
  self_not_allowed: "self_not_allowed",
  target_is_owner: "target_is_owner",
  // Two shapes of «there is nobody there to act on», one from the matrix and
  // one from the SFU answering `not_found`. One sentence for both, because the
  // difference is ours and not the reader's.
  target_not_a_member: "target_not_in_room",
  participant_not_in_room: "target_not_in_room",
  // The gateway refuses a role its own code does not know rather than guessing.
  // Nothing the reader can do about it, so it reads as «недоступно».
  target_protected: "forbidden",
};

function statusRefusal(status: number): VoiceGatewayRefusalCode {
  if (status === 0) return "network";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "channel_full";
  if (status === 429) return "rate_limited";
  if (status === 503) return "disabled";
  if (status >= 500) return "unavailable";
  return "malformed";
}

function readCode(payload: unknown): VoiceGatewayRefusalCode | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const field of ["code", "error"] as const) {
    const value = record[field];
    if (typeof value === "string" && value in WIRE_CODES) return WIRE_CODES[value];
  }
  return null;
}

/**
 * One answer from the gateway, read.
 *
 * A 200 carrying no usable pair is a refusal and not a grant. That branch is
 * the one worth having a test for: without it the hook would hand an empty URL
 * to LiveKit and the person would watch «Подключаемся…» until a socket timeout,
 * which is the same experience as a silent failure and is what this slice's
 * rules forbid. `status: 0` is the caller's convention for «fetch threw» —
 * there was no response to read.
 */
export function readVoiceTokenResponse(status: number, payload: unknown): VoiceTokenOutcome {
  if (status === 200 || status === 201) {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const url = typeof record?.url === "string" ? record.url.trim() : "";
    const token = typeof record?.token === "string" ? record.token.trim() : "";
    const canPublish = record?.canPublish === undefined ? true : record.canPublish === true;
    if (url && token) return { ok: true, grant: { url, token, canPublish } };
    return { ok: false, code: "malformed" };
  }
  return { ok: false, code: readCode(payload) ?? statusRefusal(status) };
}

/**
 * What a refusal means to a person.
 *
 * Every one of these is a full sentence, because the capsule shows it on its
 * own and a fragment beside a channel name reads as a caption rather than as an
 * explanation. None of them names a status code: a number is the one thing the
 * reader can do nothing with.
 */
export function voiceGatewayRefusalText(code: VoiceGatewayRefusalCode): string {
  switch (code) {
    case "unauthenticated":
      return "Сессия истекла, войдите заново.";
    case "forbidden":
      return "Нет доступа к этому голосовому чату.";
    case "not_found":
      return "Голосовой чат уже завершён.";
    case "channel_full":
      return "В голосовом чате уже максимум участников.";
    case "disabled":
      return "Голосовые чаты сейчас отключены.";
    case "rate_limited":
      return "Слишком много попыток, подождите немного.";
    case "not_a_moderator":
      return "Заглушать и отключать участников могут владелец и администраторы.";
    case "self_not_allowed":
      // Not «нет доступа»: the person may leave whenever they like, and the
      // control that does it is two buttons away. Saying they are forbidden
      // would be false about the thing they were trying to do.
      return "Себя заглушить нельзя — выйдите из канала, если нужно.";
    case "target_is_owner":
      return "Владельца группы нельзя заглушить или отключить.";
    case "target_not_in_room":
      return "Этот участник уже не в голосовом канале.";
    case "network":
      return "Нет связи с сервером, проверьте подключение.";
    case "unavailable":
      return "Сервер голосовых чатов недоступен.";
    default:
      return "Сервер ответил неожиданно, попробуйте ещё раз.";
  }
}
