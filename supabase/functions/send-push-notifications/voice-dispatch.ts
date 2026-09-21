import { buildVoiceFcmMessage, type VoiceFcmMessageEnvelope } from "./voice-payload.ts";

type VoiceResult = "accepted" | "retry" | "invalid_token" | "discarded";
type VoiceStatus = "disabled" | "unauthorized" | "credentials_pending" | "runtime_pending" |
  "provider_auth_failed" | "rpc_failed" | "idle" | "ready" | "budget_exhausted";
export type VoiceSummary = { status: VoiceStatus; claimed: number; accepted: number; retry: number;
  invalid_token: number; discarded: number; stale: number; uncertain: number; suppressed: number };
export type VoiceProviderResponse = { status: number; body?: unknown; retryAfter?: string | null };
export type VoiceDependencies = {
  enabled: () => boolean;
  now: () => number;
  uuid: () => string;
  sleep: (ms: number) => Promise<void>;
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  rpc: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  send: (message: VoiceFcmMessageEnvelope, accessToken: string, signal: AbortSignal) => Promise<VoiceProviderResponse>;
};
type Claim = { event_id: string; push_device_id: string; claim_id: string };
type PendingRetry = { key: string; at: number; expiry: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCURRENCY = 4;
const MAX_LIMIT = 20;
const BUDGET_MS = 20_000;
const SEND_TIMEOUT_MS = 4_000;
const RPC_TIMEOUT_MS = 2_000;
const POLL_MS = 2_000;
const MAX_EMPTY_POLLS = BUDGET_MS / POLL_MS;
const NO_SEND = Symbol("no_send");

export function voiceSummary(status: VoiceStatus): VoiceSummary {
  return { status, claimed: 0, accepted: 0, retry: 0, invalid_token: 0, discarded: 0,
    stale: 0, uncertain: 0, suppressed: 0 };
}

export function isVoiceRequestAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret?.trim()) return false;
  return request.headers.get("x-kub-push-token") === secret ||
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] === secret;
}

/** PostgreSQL timestamptz, with explicit zone. Floor microseconds once, conservatively. */
export function parseVoiceTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second, Number((m[7] ?? "").padEnd(3, "0").slice(0, 3)));
  if (new Date(local).getUTCDate() !== day) return null;
  const zone = m[8];
  const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone.length <= 3 ? 0 : Number(zone.slice(3).replace(":", ""));
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  const time = local - (zone[0] === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute) * 60_000;
  return Number.isSafeInteger(time) && time >= 0 ? time : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isClaim(value: unknown): value is Claim {
  return record(value) && [value.event_id, value.push_device_id, value.claim_id]
    .every((id) => typeof id === "string" && UUID.test(id));
}
function matches(row: Record<string, unknown>, claim: Claim): boolean {
  return row.event_id === claim.event_id && row.push_device_id === claim.push_device_id && row.claim_id === claim.claim_id;
}

function retryHint(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  let ms: number;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else {
    ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toUTCString() !== value) return null;
    ms -= now;
  }
  // SQL accepts an integer; anything beyond this cap is already far beyond a
  // 45-second event. Never shorten a provider delay to fit an event's lifetime.
  return Math.min(2_147_483_647, Math.max(0, Math.ceil(ms)));
}

export function classifyVoiceResponse(response: VoiceProviderResponse, now: number): {
  result: VoiceResult; retryAfterMs: number | null;
} {
  if (response.status >= 200 && response.status < 300) return { result: "accepted", retryAfterMs: null };
  const error = record(response.body) && record(response.body.error) ? response.body.error : null;
  const invalid = Array.isArray(error?.details) && error.details.some((detail: unknown) => record(detail) &&
    detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
    response.status === 404 && detail.errorCode === "UNREGISTERED");
  if (invalid) return { result: "invalid_token", retryAfterMs: null };
  if (response.status === 0 || response.status >= 500 || response.status === 429 || response.status === 401 || response.status === 403) {
    const hint = retryHint(response.retryAfter, now);
    return { result: "retry", retryAfterMs: response.status === 429 ? Math.max(60_000, hint ?? 0) : hint };
  }
  // INVALID_ARGUMENT can describe the envelope, not just the registration.
  // SENDER_ID_MISMATCH follows the retry path: it may be a project-wide config fault.
  return { result: "discarded", retryAfterMs: null };
}

export async function withVoiceTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms < 1) throw new Error("voice_deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("voice_timeout")); }, Math.floor(ms));
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

export async function drainVoicePush(deps: VoiceDependencies, requestedLimit: unknown): Promise<VoiceSummary> {
  const summary = voiceSummary("idle");
  if (!deps.enabled()) return voiceSummary("disabled");
  const limit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(requestedLimit))) : MAX_LIMIT;
  const deadline = deps.now() + BUDGET_MS;
  const remaining = () => deadline - deps.now();
  const rpc = (name: string, args: Record<string, unknown>) =>
    withVoiceTimeout((signal) => deps.rpc(name, args, signal), Math.min(RPC_TIMEOUT_MS, remaining()));
  let accessToken: string;
  try {
    accessToken = await withVoiceTimeout((signal) => deps.getAccessToken(signal), Math.min(SEND_TIMEOUT_MS, remaining()));
    if (!accessToken) throw new Error("voice_oauth_empty");
  } catch { summary.status = "provider_auth_failed"; return summary; }
  const waveIds = new Set<string>();
  const attempts = new Map<string, number>();
  const pendingRetries = new Map<string, PendingRetry>();

  async function complete(claim: Claim, result: VoiceResult, hint: number | null, tokenHash: string | null): Promise<boolean> {
    try {
      const accepted = await rpc("voice_push_complete", { p_event_id: claim.event_id,
        p_push_device_id: claim.push_device_id, p_claim_id: claim.claim_id,
        p_result: result, p_retry_after_ms: hint, p_token_hash: tokenHash });
      if (accepted === true) { summary[result]++; return true; }
      if (accepted === false) summary.stale++;
      else summary.uncertain++;
    } catch { summary.uncertain++; }
    return false;
  }

  async function deliver(claim: Claim): Promise<PendingRetry | null> {
    const key = `${claim.event_id}:${claim.push_device_id}`;
    pendingRetries.delete(key);
    if (!deps.enabled() || remaining() <= 0) return null;
    let rows: unknown;
    try { rows = await rpc("voice_push_prepare", { p_event_id: claim.event_id,
      p_push_device_id: claim.push_device_id, p_claim_id: claim.claim_id }); }
    catch { summary.status = "rpc_failed"; return null; }
    if (Array.isArray(rows) && rows.length === 0) { summary.suppressed++; return null; }
    const row = Array.isArray(rows) && rows.length === 1 && record(rows[0]) ? rows[0] : null;
    if (!row || !matches(row, claim)) {
      await complete(claim, "discarded", null, null); return null;
    }
    const started = parseVoiceTimestamp(row.ring_started_at);
    const expiry = parseVoiceTimestamp(row.expires_at);
    const lease = parseVoiceTimestamp(row.claimed_until);
    const tokenHash = typeof row.token_hash === "string" && /^[0-9a-f]{64}$/.test(row.token_hash) ? row.token_hash : null;
    const dto = { ...row, ring_started_at: started, expires_at: expiry };
    if (row.protocol_version !== 1 || started === null || expiry === null || lease === null ||
      lease <= deps.now() || lease > expiry || !tokenHash || typeof row.token !== "string" ||
      !buildVoiceFcmMessage(dto, row.token, deps.now())) {
      await complete(claim, "discarded", null, tokenHash); return null;
    }
    if (!deps.enabled()) { summary.status = "disabled"; return null; }
    if ((attempts.get(key) ?? 0) >= 3) { summary.suppressed++; return null; }
    let outcome: { result: VoiceResult; retryAfterMs: number | null };
    try {
      const token = row.token;
      const response = await withVoiceTimeout((signal) => {
        const now = deps.now();
        const envelope = buildVoiceFcmMessage(dto, token, now);
        if (!deps.enabled() || now >= lease || now >= deadline || !envelope) throw NO_SEND;
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
        return deps.send(envelope, accessToken, signal);
      }, Math.min(SEND_TIMEOUT_MS, lease - deps.now(), expiry - deps.now(), remaining()));
      outcome = classifyVoiceResponse(response, deps.now());
    } catch (error) {
      outcome = error === NO_SEND ? { result: "discarded", retryAfterMs: null } : { result: "retry", retryAfterMs: null };
    }
    const ack = await complete(claim, outcome.result, outcome.retryAfterMs, tokenHash);
    // Ack failure is uncertain at-least-once. Never resend on that same lease.
    const at = deps.now() + Math.max(POLL_MS, outcome.retryAfterMs ?? POLL_MS);
    if (!ack || outcome.result !== "retry" || (attempts.get(key) ?? 0) >= 3 || at >= expiry) return null;
    return { key, at, expiry };
  }

  let emptyPolls = 0;
  while (summary.claimed < limit) {
    if (!deps.enabled()) { summary.status = "disabled"; break; }
    if (remaining() <= 0) { summary.status = "budget_exhausted"; break; }
    const claimId = deps.uuid();
    if (!UUID.test(claimId) || waveIds.has(claimId)) { summary.status = "rpc_failed"; break; }
    waveIds.add(claimId);
    const count = Math.min(CONCURRENCY, limit - summary.claimed);
    let rows: unknown;
    try { rows = await rpc("voice_push_claim", { p_limit: count, p_claim_id: claimId }); }
    catch { summary.status = "rpc_failed"; break; }
    if (!Array.isArray(rows) || rows.length > count || !rows.every((r) => isClaim(r) && r.claim_id === claimId) ||
      new Set(rows.map((r: Claim) => `${r.event_id}:${r.push_device_id}`)).size !== rows.length) {
      summary.status = "rpc_failed"; break;
    }
    summary.claimed += rows.length;
    if (rows.length) {
      if (summary.status === "idle") summary.status = "ready";
      const retries = await Promise.all(rows.map(deliver));
      for (const retry of retries) if (retry) pendingRetries.set(retry.key, retry);
      continue;
    }
    for (const [key, retry] of pendingRetries) if (retry.expiry <= deps.now()) pendingRetries.delete(key);
    if (!pendingRetries.size) break;
    // SQL owns next_attempt_at (including its exponential backoff). Empty
    // retry polls consume time, never the claim budget or a ready-target wave.
    const next = Math.min(...Array.from(pendingRetries.values(), (retry) => retry.at));
    const delay = Math.max(POLL_MS, next - deps.now());
    if (++emptyPolls >= MAX_EMPTY_POLLS || delay >= remaining()) {
      summary.status = "budget_exhausted"; break;
    }
    try { await withVoiceTimeout(() => deps.sleep(delay), remaining()); }
    catch { summary.status = "budget_exhausted"; break; }
  }
  return summary;
}
