import { isVoiceUuid } from "./nativeVoiceContract";
import { readMessagePreviewSession, type MessagePreviewBinding } from "./nativeMessagePreviewContract";
import type { MessagePreviewBindingOwner } from "./nativeMessagePreviewBinding";
import type { MessagePreviewVerificationBridge } from "./nativeMessagePreviews";

interface VerificationDependencies {
  bridge: MessagePreviewVerificationBridge;
  currentOwner(): MessagePreviewBindingOwner | null;
  currentBinding(): MessagePreviewBinding | null;
  getSession(): PromiseLike<{ data: { session: unknown }; error: unknown }>;
  publicApiKey(): string;
  now(): number;
  monotonicNow(): number;
}

// One native revision domain, not a per-controller counter reset on remount.
let revision = 0;
let active: { close(): void } | null = null;
function nextRevision(): number | null {
  return revision < Number.MAX_SAFE_INTEGER ? ++revision : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactAck(value: unknown, key: string): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === 1 && Object.hasOwn(value, key);
}
function publicKey(value: string): boolean {
  if (typeof value !== "string" || value.length > 8_192) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
    const part = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return record(claims) && claims.role === "anon";
  } catch { return false; }
}

/** Optional memory-only handoff; verification never supplies consent or capabilities. */
export function createNativeMessagePreviewVerification(deps: VerificationDependencies) {
  type Operation = {
    revision: number; owner: MessagePreviewBindingOwner; binding: MessagePreviewBinding;
    expiresAt: number; monotonicExpiry: number; pendingUntil: number;
  };
  let closed = false;
  let operation: Operation | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    operation = null;
    if (deadline !== null) clearTimeout(deadline);
    if (expiry !== null) clearTimeout(expiry);
    deadline = expiry = null;
  };
  const lease = { close: () => { closed = true; close(); } };
  active?.close();
  active = lease;

  const retire = () => {
    if (closed || active !== lease) return;
    close();
    const ticket = nextRevision();
    if (ticket === null) return;
    try {
      void deps.bridge.clearBinding({ revision: ticket }).then(ack => {
        if (active !== lease || revision !== ticket) return;
        // Unknown ACK remains locally closed, not retirement proof or a retry.
        if (!exactAck(ack, "applied") || ack.applied !== true) return;
      }).catch(() => undefined);
    } catch { /* Optional bridge failures never affect ordinary push/voice. */ }
  };
  const owned = (op: Operation) => !closed && active === lease && operation === op && revision === op.revision;
  const current = (op: Operation): boolean => {
    if (!owned(op) || deps.now() >= op.expiresAt || deps.monotonicNow() >= op.monotonicExpiry
      || deps.monotonicNow() >= op.pendingUntil) return false;
    try {
      const owner = deps.currentOwner(), binding = deps.currentBinding();
      return !!owner && !!binding && owner.recipientId === op.owner.recipientId
        && owner.recipientSessionId === op.owner.recipientSessionId && owner.accountEpoch === op.owner.accountEpoch
        && binding.recipientId === op.binding.recipientId && binding.recipientSessionId === op.binding.recipientSessionId
        && binding.deviceId === op.binding.deviceId;
    } catch { return false; }
  };
  const resume = (op: Operation) => {
    if (current(op)) return true;
    if (owned(op)) retire();
    return false;
  };
  const dispatch = (op: Operation, epoch: string, response: { data: { session: unknown }; error: unknown }) => {
    const session = response.data.session;
    const identity = response.error ? null : readMessagePreviewSession(session, deps.now());
    const key = deps.publicApiKey();
    if (!identity || identity.recipientId !== op.owner.recipientId || identity.recipientSessionId !== op.owner.recipientSessionId
      || !record(session) || !record(session.user) || session.user.is_anonymous === true
      || typeof session.access_token !== "string" || session.access_token.length > 16_384
      || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.access_token) || !publicKey(key)) return null;
    op.expiresAt = identity.expiresAt;
    op.monotonicExpiry = deps.monotonicNow() + identity.expiresAt - deps.now();
    if (!resume(op)) return null;
    return deps.bridge.verifyBinding({ ...op.owner, revision: op.revision, epoch, deviceId: op.binding.deviceId,
      accessToken: session.access_token, publicApiKey: key });
  };
  const verify = async (op: Operation) => {
    try {
      if (!resume(op)) return;
      const owner = { ...op.owner, revision: op.revision };
      const began = await deps.bridge.beginBinding(owner);
      if (!resume(op)) return;
      if (!exactAck(began, "epoch") || typeof began.epoch !== "string" || began.epoch.length < 1
        || began.epoch.length > 256 || began.epoch.trim() !== began.epoch || /[\x00-\x1f\x7f]/.test(began.epoch)) {
        retire(); return;
      }
      let response: { data: { session: unknown }; error: unknown } | null = await deps.getSession();
      if (!resume(op)) return;
      const pending = dispatch(op, began.epoch, response);
      response = null;
      if (!pending) { if (owned(op)) retire(); return; }
      const ack = await pending;
      if (!resume(op)) return;
      if (!exactAck(ack, "verified") || ack.verified !== true) { retire(); return; }
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      op.pendingUntil = Infinity;
      expiry = setTimeout(() => { if (owned(op)) retire(); },
        Math.max(0, Math.min(op.expiresAt - deps.now(), op.monotonicExpiry - deps.monotonicNow())));
    } catch { if (owned(op)) retire(); }
  };

  retire();
  return {
    bindingChanged(binding: MessagePreviewBinding | null): void {
      if (closed || active !== lease) return;
      retire();
      if (!binding) return;
      try {
        const owner = deps.currentOwner();
        if (!owner || !isVoiceUuid(binding.recipientId) || !isVoiceUuid(binding.recipientSessionId) || !isVoiceUuid(binding.deviceId)
          || owner.recipientId !== binding.recipientId || owner.recipientSessionId !== binding.recipientSessionId
          || !Number.isSafeInteger(owner.accountEpoch) || owner.accountEpoch < 0) return;
        const ticket = nextRevision();
        if (ticket === null) return;
        const op: Operation = { revision: ticket, owner: { ...owner }, binding: { ...binding },
          expiresAt: Infinity, monotonicExpiry: Infinity, pendingUntil: deps.monotonicNow() + 10_000 };
        operation = op;
        deadline = setTimeout(() => { if (owned(op)) retire(); }, 10_000);
        void verify(op);
      } catch { retire(); }
    },
    dispose(): void {
      if (active !== lease) { lease.close(); return; }
      retire();
      lease.close();
      active = null;
    },
  };
}
