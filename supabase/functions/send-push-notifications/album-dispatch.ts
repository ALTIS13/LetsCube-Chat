type AlbumClaim = {
  id: string;
  subscription_id: string | null;
  device_id: string | null;
  attempt_count: number;
};

type AlbumPayload = Record<string, unknown>;
type AlbumRecheck = {
  status: "deliver" | "read" | "target_inactive" | "foreground" | "not_eligible" | "claim_lost";
  payload: AlbumPayload | null;
};
type AlbumSendResult = { outcome: "sent" | "retry" | "gone" | "release"; error?: string | null };

export type AlbumPushDependencies = {
  uuid: () => string;
  claim: (limit: number, token: string) => Promise<unknown>;
  recheck: (id: string, token: string) => Promise<unknown>;
  send: (claim: AlbumClaim, payload: AlbumPayload) => Promise<AlbumSendResult>;
  ack: (id: string, token: string, outcome: AlbumSendResult["outcome"], error: string | null) => Promise<boolean>;
};

export type AlbumPushSummary = {
  status: "idle" | "ready" | "claim_failed" | "claim_invalid";
  claimed: number;
  sent: number;
  retry: number;
  pruned: number;
  deferred: number;
  failed: number;
  uncertain: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function claimRow(value: unknown): value is AlbumClaim {
  if (!record(value)) return false;
  const web = typeof value.subscription_id === "string" && UUID.test(value.subscription_id);
  const native = typeof value.device_id === "string" && UUID.test(value.device_id);
  return typeof value.id === "string" && UUID.test(value.id) && web !== native &&
    (web ? value.device_id === null : value.subscription_id === null) &&
    Number.isInteger(value.attempt_count) && Number(value.attempt_count) >= 0 && Number(value.attempt_count) < 5;
}

function recheck(value: unknown): AlbumRecheck | null {
  if (!record(value) || typeof value.status !== "string") return null;
  if (value.status === "deliver") {
    if (!record(value.payload)) return null;
    return { status: "deliver", payload: value.payload };
  }
  if (
    value.status === "read" || value.status === "target_inactive" ||
    value.status === "foreground" || value.status === "not_eligible" ||
    value.status === "claim_lost"
  ) return { status: value.status, payload: null };
  return null;
}

function neutralExactMessage(payload: AlbumPayload): boolean {
  const chatId = payload.chatId;
  const messageId = payload.messageId;
  return payload.kind === "message" && payload.title === "LETSCUBE" &&
    payload.body === "Новое сообщение" &&
    typeof chatId === "string" && UUID.test(chatId) &&
    typeof messageId === "string" && UUID.test(messageId) &&
    typeof payload.notificationId === "string" && UUID.test(payload.notificationId) &&
    payload.url === `/?chat=${chatId}&message=${messageId}` &&
    (payload.tag === undefined || payload.tag === `message:chat:${chatId}`);
}

export async function drainAlbumPush(deps: AlbumPushDependencies, requestedLimit: unknown): Promise<AlbumPushSummary> {
  const summary: AlbumPushSummary = {
    status: "idle", claimed: 0, sent: 0, retry: 0, pruned: 0,
    deferred: 0, failed: 0, uncertain: 0,
  };
  const limit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(10, Math.trunc(requestedLimit))) : 10;
  const token = deps.uuid();
  if (!UUID.test(token)) return { ...summary, status: "claim_invalid", failed: 1 };
  let rawRows: unknown;
  try {
    rawRows = await deps.claim(limit, token);
  } catch {
    return { ...summary, status: "claim_failed", failed: 1 };
  }
  if (!Array.isArray(rawRows) || !rawRows.every(claimRow)) {
    return { ...summary, status: "claim_invalid", failed: 1 };
  }
  if (rawRows.length === 0) return summary;
  summary.status = "ready";
  summary.claimed = rawRows.length;
  const seen = new Set<string>();

  for (const row of rawRows as AlbumClaim[]) {
    if (seen.has(row.id)) { summary.failed += 1; continue; }
    seen.add(row.id);
    let rawRecheck: unknown;
    try {
      rawRecheck = await deps.recheck(row.id, token);
    } catch {
      rawRecheck = null;
    }
    const eligible = recheck(rawRecheck);
    if (!eligible) {
      summary.failed += 1;
      try {
        if (!await deps.ack(row.id, token, "release", "invalid_recheck")) summary.uncertain += 1;
      } catch { summary.uncertain += 1; }
      continue;
    }
    if (eligible.status !== "deliver") {
      if (eligible.status === "foreground") summary.deferred += 1;
      else if (eligible.status !== "claim_lost") summary.pruned += 1;
      continue;
    }
    if (!eligible.payload || !neutralExactMessage(eligible.payload)) {
      summary.failed += 1;
      try {
        if (!await deps.ack(row.id, token, "release", "invalid_payload")) summary.uncertain += 1;
      } catch { summary.uncertain += 1; }
      continue;
    }

    let outcome: AlbumSendResult;
    try {
      outcome = await deps.send(row, eligible.payload);
      if (!outcome || !["sent", "retry", "gone", "release"].includes(outcome.outcome)) {
        outcome = { outcome: "release", error: "invalid_send_outcome" };
      }
    } catch {
      outcome = { outcome: "retry", error: "provider_error" };
    }
    let acknowledged = false;
    try {
      acknowledged = await deps.ack(row.id, token, outcome.outcome, outcome.error ?? null);
    } catch { /* The provider may already have accepted the push. */ }
    if (!acknowledged) {
      summary.uncertain += 1;
      continue;
    }
    if (outcome.outcome === "sent") summary.sent += 1;
    else if (outcome.outcome === "retry") summary.retry += 1;
    else if (outcome.outcome === "gone") summary.pruned += 1;
    else summary.deferred += 1;
  }
  return summary;
}
