export type BrowserPushSubscriptionLike = {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | ArrayBufferView | null };
  toJSON: () => {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
};

export type BrowserPushSubscriptionRecord = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  platform: string | null;
  is_active: true;
  last_seen_at: string;
  updated_at: string;
};

export function applicationServerKeyMatches(
  subscription: BrowserPushSubscriptionLike,
  configuredPublicKey: string,
): boolean | null {
  const currentKey = subscription.options?.applicationServerKey;
  if (!currentKey) return null;

  const current =
    currentKey instanceof ArrayBuffer
      ? new Uint8Array(currentKey)
      : new Uint8Array(
          currentKey.buffer,
          currentKey.byteOffset,
          currentKey.byteLength,
        );
  const configured = urlBase64ToUint8Array(configuredPublicKey);
  if (current.byteLength !== configured.byteLength) return false;
  return current.every((byte, index) => byte === configured[index]);
}

export function browserSubscriptionRecord(
  subscription: BrowserPushSubscriptionLike,
  userId: string,
  userAgent: string,
  platform: string | null,
): BrowserPushSubscriptionRecord {
  const json = subscription.toJSON();
  const now = new Date().toISOString();
  return {
    user_id: userId,
    endpoint: json.endpoint || subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    user_agent: userAgent,
    platform,
    is_active: true,
    last_seen_at: now,
    updated_at: now,
  };
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1)
    output[index] = raw.charCodeAt(index);
  return output;
}
