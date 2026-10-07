export type ConfirmedNativeChatRead = {
  chatId: string;
  confirmed: ReadonlyArray<{ notificationId: string; messageId: string }>;
};
export type NativeChatReadStatus = "settled" | "retry" | "retired";
const READ_ATTEMPTS = 4;
const READ_RETRY_MS = 250;

type Owner = { ownerId: string | null; accountEpoch: number };
type Binding = Owner & { instanceId: string; revision: number };
export type NativeChatNotificationsClient = {
  getCapabilities(): Promise<unknown>;
  setOwner(binding: Binding): Promise<unknown>;
  removeRead(input: Binding & ConfirmedNativeChatRead): Promise<unknown>;
};
type OwnerSource = { getOwner(): Owner; subscribe(listener: () => void): () => void };
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Module-lifetime native lease. A bridge reload also retires it on the native side. */
export function createNativeChatReadCleaner(client: NativeChatNotificationsClient, source: OwnerSource) {
  let owner = { ...source.getOwner(), revision: 1 };
  let instanceId: string | null = null;
  let capabilities: Promise<string | null> | null = null;
  let binding: Promise<boolean> | null = null;
  const operations = new Map<string, { waiters: Set<() => boolean>; promise: Promise<NativeChatReadStatus> }>();

  const bind = () => {
    if (!instanceId) return null;
    const input = { ...owner, instanceId };
    let response: Promise<unknown>;
    try { response = client.setOwner(input); } catch { response = Promise.reject(new Error("cleanup_binding_unavailable")); }
    const pending = response.then(value => {
      const ack = record(value);
      return ack?.applied === true && ack.instanceId === input.instanceId && ack.revision === input.revision
        && ack.ownerId === input.ownerId && ack.accountEpoch === input.accountEpoch;
    }).catch(() => false);
    binding = pending;
    void pending.then(applied => { if (!applied && binding === pending) binding = null; });
    return pending;
  };
  const observe = () => {
    const next = source.getOwner();
    if (next.ownerId === owner.ownerId && next.accountEpoch === owner.accountEpoch) return;
    owner = { ...next, revision: owner.revision + 1 };
    operations.clear();
    binding = null;
    if (instanceId) bind();
  };
  // Retirement is observed independently of React rendering or a batched ABA.
  source.subscribe(observe);

  const reconcile = async (read: ConfirmedNativeChatRead, expected: typeof owner, current: () => boolean): Promise<NativeChatReadStatus> => {
    try {
      const pending = capabilities ??= Promise.resolve().then(() => client.getCapabilities()).then(value => {
        const cap = record(value);
        return cap?.protocol === 1 && uuid(cap.instanceId) ? cap.instanceId : null;
      });
      let instance: string | null;
      try { instance = await pending; } catch {
        if (!current()) return "retired";
        if (capabilities === pending) capabilities = null;
        return "retry";
      }
      if (!instance || !current()) return current() ? "retry" : "retired";
      instanceId = instance;
      if (!await (binding ?? bind()) || !current()) return current() ? "retry" : "retired";
      for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
        if (!current()) return "retired";
        const ack = record(await client.removeRead({ ...expected, instanceId: instance, ...read }));
        if (!current()) return "retired";
        if (!ack || (ack.removed !== 0 && ack.removed !== 1) || typeof ack.pending !== "boolean"
          || (ack.pending && ack.removed !== 0)) return "retry";
        if (!ack.pending) return "settled";
        if (attempt + 1 < READ_ATTEMPTS) await new Promise<void>(resolve => setTimeout(resolve, READ_RETRY_MS));
      }
      return "retry";
    } catch {
      // A read ACK is authoritative even when presentation cleanup is unavailable.
      return current() ? "retry" : "retired";
    }
  };

  return async (read: ConfirmedNativeChatRead, isCurrent: () => boolean): Promise<NativeChatReadStatus> => {
    observe();
    if (!isCurrent()) return "retired";
    if (!uuid(owner.ownerId) || !Number.isSafeInteger(owner.accountEpoch) || owner.accountEpoch < 0
      || !uuid(read.chatId) || !Array.isArray(read.confirmed) || !read.confirmed.length || read.confirmed.length > 30
      || read.confirmed.some(pair => !pair || !uuid(pair.notificationId) || !uuid(pair.messageId))) return "retry";
    const expected = owner;
    const current = () => { observe(); return owner === expected && isCurrent(); };
    const confirmed = read.confirmed.map(pair => ({ notificationId: pair.notificationId, messageId: pair.messageId }));
    const key = `${expected.revision}:${read.chatId}:${confirmed.map(pair => `${pair.notificationId}:${pair.messageId}`).sort().join(",")}`;
    let operation = operations.get(key);
    if (!operation) {
      const waiters = new Set([current]);
      const promise = reconcile({ chatId: read.chatId, confirmed }, expected, () => Array.from(waiters).some(check => check()));
      operation = { waiters, promise };
      operations.set(key, operation);
      const started = operation;
      void promise.then(() => { if (operations.get(key) === started) operations.delete(key); });
    } else operation.waiters.add(current);
    try {
      const result = await operation.promise;
      return current() ? result : "retired";
    } finally { operation.waiters.delete(current); }
  };
}
