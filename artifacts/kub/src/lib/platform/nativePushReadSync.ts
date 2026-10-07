export type ConfirmedNativeChatRead = {
  chatId: string;
  confirmed: ReadonlyArray<{ notificationId: string; messageId: string }>;
};

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
    binding = null;
    if (instanceId) bind();
  };
  // Retirement is observed independently of React rendering or a batched ABA.
  source.subscribe(observe);

  return async (read: ConfirmedNativeChatRead, isCurrent: () => boolean): Promise<void> => {
    observe();
    if (!isCurrent() || !uuid(owner.ownerId) || !Number.isSafeInteger(owner.accountEpoch) || owner.accountEpoch < 0
      || !uuid(read.chatId) || !Array.isArray(read.confirmed) || !read.confirmed.length || read.confirmed.length > 30
      || read.confirmed.some(pair => !pair || !uuid(pair.notificationId) || !uuid(pair.messageId))) return;
    const expected = owner;
    const current = () => { observe(); return owner === expected && isCurrent(); };
    const confirmed = read.confirmed.map(pair => ({ notificationId: pair.notificationId, messageId: pair.messageId }));
    const chatId = read.chatId;
    try {
      capabilities ??= Promise.resolve().then(() => client.getCapabilities()).then(value => {
        const cap = record(value);
        return cap?.protocol === 1 && uuid(cap.instanceId) ? cap.instanceId : null;
      }).catch(() => null);
      const instance = await capabilities;
      if (!instance || !current()) return;
      instanceId = instance;
      if (!await (binding ?? bind()) || !current()) return;
      await client.removeRead({ ...expected, instanceId: instance, chatId, confirmed });
    } catch {
      // A read ACK is authoritative even when presentation cleanup is unavailable.
    }
  };
}
