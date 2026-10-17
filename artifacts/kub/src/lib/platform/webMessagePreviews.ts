import type { BrowserPushSubscriptionLike } from "../browserPushSubscription";

export type WebPreviewLevel = "none" | "sender" | "message";
export type WebPreviewOwner = { userId: string; sessionId: string; accountEpoch: number };
export type WebPreviewContext = {
  preview_v: 1; recipient_id: string; session_id: string; subscription_id: string;
  subscription_fingerprint: string; revision: number; preview_level: WebPreviewLevel;
  installation_consent: boolean; observed_at_epoch_ms: number; expires_at_epoch_ms: number | null;
};
export type WebPreviewEnvelope = { storage_v: 1; context: WebPreviewContext; grant_secret: string };
export type WebPreviewState = {
  record_v: 1; generation: number; intent_id: string; owner: WebPreviewOwner | null;
  state: "retired" | "pending" | "active"; envelope: WebPreviewEnvelope | null;
  accepted_at_epoch_ms: number | null; deadline_at_epoch_ms: number | null;
};
export type WebPreviewToken = Pick<WebPreviewState, "generation" | "intent_id" | "owner">;
export type WebPreviewStore = {
  read(): Promise<WebPreviewState | null>;
  begin(owner: WebPreviewOwner): Promise<WebPreviewToken>;
  retire(): Promise<void>;
  retireUnlessOwner(owner: Pick<WebPreviewOwner, "userId" | "sessionId"> | null): Promise<void>;
  retireIf(token: WebPreviewToken): Promise<void>;
  activate(token: WebPreviewToken, value: WebPreviewEnvelope, started: number, deadline: number, current: () => boolean): Promise<boolean>;
};
export type WebPreviewView = {
  status: "unavailable" | "loading" | "ready" | "saving" | "error";
  savedChoice: WebPreviewLevel | null; effectiveChoice: WebPreviewLevel; installed: boolean; error: string | null;
};
export type WebPreviewSubscription = { subscriptionId: string; fingerprint: string };
type RpcName = "web_message_preview_context" | "web_message_preview_enroll" | "web_message_preview_revoke";
export type WebPreviewPorts = {
  owner(): WebPreviewOwner | null; foreground(): boolean;
  subscription(): Promise<WebPreviewSubscription | null>;
  rpc(name: RpcName, args: Record<string, string | number>): PromiseLike<{ data: unknown; error: unknown }>;
  preference(choice?: WebPreviewLevel): PromiseLike<{ data: unknown; error: unknown }>;
  retireHint?(): void;
  install(token: WebPreviewToken, value: WebPreviewEnvelope, current: () => boolean): Promise<boolean>;
  store: WebPreviewStore; crypto: Pick<Crypto, "getRandomValues" | "subtle">;
  now(): number; changed?(view: WebPreviewView): void;
};

export const WEB_PREVIEW_DATABASE = "letscube-web-message-preview";
export const WEB_PREVIEW_STORE = "state";
export const WEB_PREVIEW_KEY = "current";
export const WEB_PREVIEW_RETIRE_MESSAGE = "LETSCUBE_WEB_PREVIEW_RETIRE";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^v1:[0-9a-f]{64}$/;
const SECRET = /^wpg1_[0-9a-f]{64}$/;
const MAX_TTL = 30 * 24 * 60 * 60 * 1000;
const CONTEXT_KEYS = ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint", "revision", "preview_level", "installation_consent", "observed_at_epoch_ms", "expires_at_epoch_ms"];
const CLOSED: WebPreviewView = { status: "unavailable", savedChoice: null, effectiveChoice: "none", installed: false, error: null };
const FAILURE = "Не удалось подтвердить предпросмотр на этой установке. Повторите выбор.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safe = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const isWebPreviewLevel = (v: unknown): v is WebPreviewLevel => v === "none" || v === "sender" || v === "message";
const sameOwner = (a: WebPreviewOwner | null, b: WebPreviewOwner | null) => !!a && !!b && a.userId === b.userId && a.sessionId === b.sessionId && a.accountEpoch === b.accountEpoch;
const sameToken = (a: WebPreviewToken | null, b: WebPreviewToken) => !!a && a.generation === b.generation && a.intent_id === b.intent_id && sameOwner(a.owner, b.owner);
const validOwner = (v: WebPreviewOwner | null): v is WebPreviewOwner => !!v && UUID.test(v.userId) && UUID.test(v.sessionId) && safe(v.accountEpoch);

export function readWebPreviewContext(data: unknown, owner: WebPreviewOwner, subscription: WebPreviewSubscription): WebPreviewContext | null {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const v = data[0];
  if (!exact(v, CONTEXT_KEYS) || v.preview_v !== 1 || !validOwner(owner)
    || v.recipient_id !== owner.userId || v.session_id !== owner.sessionId || v.subscription_id !== subscription.subscriptionId
    || !UUID.test(subscription.subscriptionId) || !FINGERPRINT.test(subscription.fingerprint) || v.subscription_fingerprint !== subscription.fingerprint
    || !safe(v.revision) || !isWebPreviewLevel(v.preview_level) || typeof v.installation_consent !== "boolean" || !safe(v.observed_at_epoch_ms, 1)) return null;
  if (v.preview_level === "none") {
    if (v.installation_consent !== false || v.expires_at_epoch_ms !== null) return null;
  } else if (v.installation_consent !== true || !safe(v.expires_at_epoch_ms, 1)
    || v.expires_at_epoch_ms <= v.observed_at_epoch_ms || v.expires_at_epoch_ms - v.observed_at_epoch_ms > MAX_TTL) return null;
  return { ...v } as WebPreviewContext;
}

function envelope(value: unknown, owner: WebPreviewOwner): WebPreviewEnvelope | null {
  if (!record(value) || !exact(value, ["storage_v", "context", "grant_secret"]) || value.storage_v !== 1
    || typeof value.grant_secret !== "string" || !SECRET.test(value.grant_secret) || !record(value.context)) return null;
  const c = value.context;
  const context = readWebPreviewContext([c], owner, { subscriptionId: String(c.subscription_id), fingerprint: String(c.subscription_fingerprint) });
  return context && context.preview_level !== "none" ? { storage_v: 1, context, grant_secret: value.grant_secret } : null;
}

export function readWebPreviewState(value: unknown): WebPreviewState | null {
  if (!record(value) || !exact(value, ["record_v", "generation", "intent_id", "owner", "state", "envelope", "accepted_at_epoch_ms", "deadline_at_epoch_ms"])
    || value.record_v !== 1 || !safe(value.generation, 1) || typeof value.intent_id !== "string" || !UUID.test(value.intent_id)
    || !["retired", "pending", "active"].includes(String(value.state))) return null;
  const owner = value.owner as WebPreviewOwner | null;
  if (owner !== null && (!record(owner) || !exact(owner, ["userId", "sessionId", "accountEpoch"]) || !validOwner(owner))) return null;
  if (value.state !== "active") {
    if (value.envelope !== null || value.accepted_at_epoch_ms !== null || value.deadline_at_epoch_ms !== null || (value.state === "pending" && !owner)) return null;
    return { ...value, owner: owner ? { ...owner } : null } as WebPreviewState;
  }
  if (!owner || !safe(value.accepted_at_epoch_ms, 1) || !safe(value.deadline_at_epoch_ms, 1)
    || value.deadline_at_epoch_ms <= value.accepted_at_epoch_ms || value.deadline_at_epoch_ms - value.accepted_at_epoch_ms > MAX_TTL) return null;
  const grant = envelope(value.envelope, owner);
  return grant ? { ...value, owner: { ...owner }, envelope: grant } as WebPreviewState : null;
}

export function createWebPreviewStore(factory: IDBFactory, randomId: () => string = () => crypto.randomUUID()): WebPreviewStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(WEB_PREVIEW_DATABASE, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(WEB_PREVIEW_STORE)) r.result.createObjectStore(WEB_PREVIEW_STORE); };
    r.onerror = r.onblocked = () => { opening = null; reject(new Error("WEB_PREVIEW_STORAGE_UNAVAILABLE")); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = null; }; resolve(r.result); };
  });
  async function transact<T>(mode: IDBTransactionMode, work: (old: WebPreviewState | null, store: IDBObjectStore) => T): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(WEB_PREVIEW_STORE, mode), store = tx.objectStore(WEB_PREVIEW_STORE), r = store.get(WEB_PREVIEW_KEY);
      let value: T;
      r.onsuccess = () => { try { value = work(readWebPreviewState(r.result), store); } catch { tx.abort(); } };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(new Error("WEB_PREVIEW_STORAGE_UNAVAILABLE"));
    });
  }
  const next = (old: WebPreviewState | null, owner: WebPreviewOwner | null, state: "retired" | "pending"): WebPreviewState => {
    if (state === "pending" && old?.generation === Number.MAX_SAFE_INTEGER) throw new Error("WEB_PREVIEW_EXHAUSTED");
    const intent_id = randomId(); if (!UUID.test(intent_id)) throw new Error("WEB_PREVIEW_INTENT_REFUSED");
    return { record_v: 1, generation: Math.min((old?.generation ?? 0) + 1, Number.MAX_SAFE_INTEGER), intent_id, owner: owner ? { ...owner } : null,
      state, envelope: null, accepted_at_epoch_ms: null, deadline_at_epoch_ms: null };
  };
  const put = (store: IDBObjectStore, value: WebPreviewState) => store.put(value, WEB_PREVIEW_KEY);
  return {
    read: () => transact("readonly", old => old),
    begin: owner => transact("readwrite", (old, store) => { if (!validOwner(owner)) throw new Error("WEB_PREVIEW_OWNER_REFUSED"); const value = next(old, owner, "pending"); put(store, value); return value; }),
    retire: () => transact("readwrite", (old, store) => { put(store, next(old, null, "retired")); }),
    retireUnlessOwner: owner => transact("readwrite", (old, store) => { if (!owner || old?.owner?.userId !== owner.userId || old?.owner?.sessionId !== owner.sessionId) put(store, next(old, null, "retired")); }),
    retireIf: token => transact("readwrite", (old, store) => { if (sameToken(old, token)) put(store, next(old, null, "retired")); }),
    activate: (token, value, started, deadline, current) => transact("readwrite", (old, store) => {
      if (!current() || !sameToken(old, token) || old?.state !== "pending" || !token.owner) return false;
      const active = readWebPreviewState({ ...old, state: "active", envelope: value, accepted_at_epoch_ms: started, deadline_at_epoch_ms: deadline });
      if (!active) return false; put(store, active); return true;
    }),
  };
}

const preference = (data: unknown, owner: WebPreviewOwner): WebPreviewLevel | null => {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0]) || !exact(data[0], ["user_id", "preview_level"])) return null;
  return data[0].user_id === owner.userId && isWebPreviewLevel(data[0].preview_level) ? data[0].preview_level : null;
};
const sameGrant = (a: WebPreviewContext, b: WebPreviewContext) => a.recipient_id === b.recipient_id && a.session_id === b.session_id
  && a.subscription_id === b.subscription_id && a.subscription_fingerprint === b.subscription_fingerprint && a.revision === b.revision
  && a.preview_level === b.preview_level && a.installation_consent === b.installation_consent && a.expires_at_epoch_ms === b.expires_at_epoch_ms;

export function createWebMessagePreviewClient(ports: WebPreviewPorts) {
  let operation = 0, canRestore = true, view: WebPreviewView = { ...CLOSED };
  const publish = (next: WebPreviewView) => { view = next; ports.changed?.({ ...next }); };
  const current = (owner: WebPreviewOwner, op: number) => op === operation && sameOwner(owner, ports.owner()) && ports.foreground();
  const deny = () => { ++operation; publish({ ...view, effectiveChoice: "none", installed: false }); };
  const retirementHint = () => { try { (ports.retireHint ?? hintWebMessagePreviewRetirement)(); } catch { /* Durable denial is still required. */ } };
  const retire = () => { canRestore = false; retirementHint(); deny(); return ports.store.retire().then(() => true, () => false); };
  const usable = (v: WebPreviewState, owner: WebPreviewOwner) => v.state === "active" && v.owner?.userId === owner.userId && v.owner.sessionId === owner.sessionId
    && v.envelope && v.accepted_at_epoch_ms !== null && v.deadline_at_epoch_ms !== null && ports.now() >= v.accepted_at_epoch_ms && ports.now() < v.deadline_at_epoch_ms;
  async function refresh(): Promise<void> {
    const owner = ports.owner(), op = ++operation;
    if (!validOwner(owner) || !ports.foreground()) { publish({ ...CLOSED }); return; }
    publish({ ...view, status: "loading", effectiveChoice: "none", installed: false, error: null });
    try {
      const own = () => current(owner, op);
      const sub = await ports.subscription(); if (!own()) return;
      if (!sub) {
        const held = await ports.store.read(); if (!own()) return;
        if (held) await ports.store.retireIf(held);
        if (own()) publish({ ...CLOSED }); return;
      }
      const result = await ports.preference(); if (!own()) return;
      const choice = result.error ? null : preference(result.data, owner); if (choice === null) throw new Error();
      const stored = await ports.store.read(); if (!own()) return;
      const context = await ports.rpc("web_message_preview_context", { p_subscription_id: sub.subscriptionId }); if (!own()) return;
      const c = context.error ? null : readWebPreviewContext(context.data, owner, sub); if (!c) throw new Error();
      let live = canRestore && !!stored && !!usable(stored, owner) && stored.envelope !== null && sameGrant(stored.envelope.context, c) && choice === c.preview_level;
      if (live && stored?.envelope) { live = await ports.install(stored, stored.envelope, own); if (!own()) return; }
      if (stored?.state === "active" && !live) { await ports.store.retireIf(stored); if (!own()) return; }
      publish({ status: "ready", savedChoice: choice, effectiveChoice: live ? choice : "none", installed: live, error: null });
    } catch { if (current(owner, op)) publish({ ...view, status: "error", effectiveChoice: "none", installed: false, error: FAILURE }); }
  }
  async function setChoice(choice: WebPreviewLevel): Promise<boolean> {
    const owner = ports.owner();
    if (!isWebPreviewLevel(choice) || !validOwner(owner) || !ports.foreground()) return false;
    const op = ++operation, own = () => current(owner, op);
    publish({ ...view, status: "saving", effectiveChoice: "none", installed: false, error: null });
    let token: WebPreviewToken | null = null;
    try {
      canRestore = false;
      retirementHint();
      // Both operations start durable denial before any remote/auth/provider await.
      if (choice === "none") await ports.store.retire();
      else token = await ports.store.begin(owner);
      if (!own()) throw new Error();
      const sub = await ports.subscription(); if (!own()) throw new Error();
      if (!sub) throw new Error();
      const written = await ports.preference(choice); if (!own()) throw new Error();
      if (written.error || preference(written.data, owner) !== choice) throw new Error();
      publish({ ...view, savedChoice: choice });
      // The preference writer may itself retire a grant and advance revision.
      const context = await ports.rpc("web_message_preview_context", { p_subscription_id: sub.subscriptionId }); if (!own()) throw new Error();
      const before = context.error ? null : readWebPreviewContext(context.data, owner, sub); if (!before) throw new Error();
      if (choice === "none") {
        const reply = await ports.rpc("web_message_preview_revoke", { p_subscription_id: sub.subscriptionId, p_expected_revision: before.revision });
        if (!own()) throw new Error();
        const retired = reply.error ? null : readWebPreviewContext(reply.data, owner, sub);
        if (!retired || retired.preview_level !== "none" || retired.revision !== Math.min(before.revision + 1, Number.MAX_SAFE_INTEGER)) throw new Error();
        publish({ status: "ready", savedChoice: choice, effectiveChoice: "none", installed: false, error: null }); return true;
      }
      if (!token || before.revision === Number.MAX_SAFE_INTEGER) throw new Error();
      const random = ports.crypto.getRandomValues(new Uint8Array(32));
      const secret = "wpg1_" + Array.from(random, b => b.toString(16).padStart(2, "0")).join(""); random.fill(0);
      const digest = await ports.crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); if (!own()) throw new Error();
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const started = ports.now();
      const enrolled = await ports.rpc("web_message_preview_enroll", { p_subscription_id: sub.subscriptionId, p_expected_revision: before.revision,
        p_subscription_fingerprint: sub.fingerprint, p_preview_level: choice, p_grant_hash: hash, p_ttl_seconds: 2592000 });
      if (!own()) throw new Error();
      const ack = enrolled.error ? null : readWebPreviewContext(enrolled.data, owner, sub);
      if (!ack || ack.revision !== before.revision + 1 || ack.preview_level !== choice || ack.installation_consent !== true || ack.expires_at_epoch_ms === null) throw new Error();
      const deadline = started + ack.expires_at_epoch_ms - ack.observed_at_epoch_ms;
      if (ports.now() < started || ports.now() >= deadline) throw new Error();
      const value: WebPreviewEnvelope = { storage_v: 1, context: ack, grant_secret: secret };
      const applied = await ports.store.activate(token, value, started, deadline, own); if (!own()) throw new Error();
      const durable = await ports.store.read(); if (!own()) throw new Error();
      if (!applied || !durable || !sameToken(durable, token) || !usable(durable, owner) || !durable.envelope
        || durable.envelope.grant_secret !== secret || !sameGrant(durable.envelope.context, ack)) throw new Error();
      if (!await ports.install(token, value, own) || !own()) throw new Error();
      const installed = await ports.store.read();
      if (!own() || !installed || !sameToken(installed, token) || !usable(installed, owner)) throw new Error();
      canRestore = true;
      publish({ status: "ready", savedChoice: choice, effectiveChoice: choice, installed: true, error: null }); return true;
    } catch {
      if (token) { try { await ports.store.retireIf(token); } catch { /* No local storage admission on failure. */ } }
      if (own()) publish({ ...view, status: "error", effectiveChoice: "none", installed: false, error: FAILURE });
      return false;
    }
  }
  return { refresh, setChoice, retire, invalidate: deny,
    invalidateRetirement: () => { canRestore = false; deny(); }, view: () => ({ ...view }) };
}

function publicKey(value: string): boolean {
  if (typeof value !== "string" || value.length > 8192) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return false;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return record(claims) && claims.role === "anon";
  } catch { return false; }
}

export function installWebMessagePreview(worker: Pick<ServiceWorker, "postMessage">, token: WebPreviewToken,
  value: WebPreviewEnvelope, key: string, current: () => boolean): Promise<boolean> {
  if (!publicKey(key) || !current()) return Promise.resolve(false);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (ok: boolean) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(ok && current()); };
    const timer = setTimeout(() => finish(false), 2000);
    channel.port1.onmessage = event => {
      const ack: unknown = event.data;
      finish(record(ack) && exact(ack, ["type", "ok", "generation", "intent_id", "installed"])
        && ack.type === "LETSCUBE_WEB_PREVIEW_RESULT" && ack.ok === true && ack.installed === true
        && ack.generation === token.generation && ack.intent_id === token.intent_id);
    };
    channel.port1.onmessageerror = () => finish(false);
    try {
      worker.postMessage({ type: "LETSCUBE_WEB_PREVIEW_INSTALL", v: 1, generation: token.generation,
        intent_id: token.intent_id, context: value.context, public_key: key }, [channel.port2]);
    } catch { finish(false); }
  });
}

export async function webPreviewSubscriptionFingerprint(subscription: BrowserPushSubscriptionLike, id: string, userId: string): Promise<string | null> {
  const json = subscription.toJSON();
  if (!UUID.test(id) || !UUID.test(userId) || json.endpoint !== subscription.endpoint) return null;
  const fields = [id, userId, json.endpoint, json.keys?.p256dh, json.keys?.auth];
  if (fields.some(v => typeof v !== "string" || v.length === 0 || v.length > 8192)) return null;
  const encoder = new TextEncoder();
  const framed = (fields as string[]).map(v => `${encoder.encode(v).length}:${v}`).join("");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(framed));
  return "v1:" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

let browserStore: WebPreviewStore | null = null;
let currentRuntime: ReturnType<typeof createWebMessagePreviewClient> | null = null;
let observedIdentity: { userId: string; sessionId: string | null } | null | undefined;
export function webPreviewStore(): WebPreviewStore {
  return browserStore ??= createWebPreviewStore(indexedDB);
}
export function bindWebMessagePreviewRuntime(runtime: ReturnType<typeof createWebMessagePreviewClient>): () => void {
  currentRuntime = runtime;
  return () => { if (currentRuntime === runtime) currentRuntime = null; };
}
export function hintWebMessagePreviewRetirement(): void {
  try { navigator.serviceWorker?.controller?.postMessage({ type: WEB_PREVIEW_RETIRE_MESSAGE, v: 1 }); } catch { /* Denial-only hint; IDB is authoritative. */ }
}
export function retireWebMessagePreviews(): Promise<boolean> {
  currentRuntime?.invalidateRetirement();
  hintWebMessagePreviewRetirement();
  try { return webPreviewStore().retire().then(() => true, () => false); } catch { return Promise.resolve(false); }
}
export async function retireWebMessagePreviewsForSubscription(subscription: BrowserPushSubscriptionLike, userId: string, current: () => boolean): Promise<boolean> {
  try {
    if (!current()) return false;
    const stored = await webPreviewStore().read();
    if (!current()) return false;
    if (!stored || stored.state === "retired") return true;
    const c = stored.envelope?.context;
    const fingerprint = c ? await webPreviewSubscriptionFingerprint(subscription, c.subscription_id, userId) : null;
    if (!current()) return false;
    if (c && stored.owner?.userId === userId && fingerprint === c.subscription_fingerprint) return true;
    return retireWebMessagePreviews();
  } catch { return false; }
}
export function observeWebMessagePreviewIdentity(identity: { userId: string; sessionId: string | null } | null): void {
  // Preserve acknowledged same-session installation consent across a cold page
  // restore, but never carry it into a new session, even for the same UID.
  if (observedIdentity !== undefined && observedIdentity?.userId === identity?.userId && observedIdentity?.sessionId === identity?.sessionId) return;
  observedIdentity = identity ? { userId: identity.userId, sessionId: identity.sessionId } : null;
  currentRuntime?.invalidate();
  hintWebMessagePreviewRetirement();
  try {
    const owner = identity?.sessionId ? { userId: identity.userId, sessionId: identity.sessionId } : null;
    void webPreviewStore().retireUnlessOwner(owner).catch(() => {});
  } catch { /* Missing/evicted IDB is never positive admission. */ }
}
