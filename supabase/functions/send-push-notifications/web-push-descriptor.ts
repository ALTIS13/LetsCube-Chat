export type WebPushDescriptor = Readonly<{
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function snapshotWebPushDescriptor(value: unknown): WebPushDescriptor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" || !UUID.test(row.id) ||
    typeof row.user_id !== "string" || !UUID.test(row.user_id) ||
    typeof row.endpoint !== "string" || row.endpoint.length === 0 ||
    typeof row.p256dh !== "string" || row.p256dh.length === 0 ||
    typeof row.auth !== "string" || row.auth.length === 0
  ) return null;
  return Object.freeze({
    id: row.id.toLowerCase(), user_id: row.user_id.toLowerCase(),
    endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth,
  });
}

export async function webPushDescriptorFingerprint(descriptor: WebPushDescriptor): Promise<string> {
  const encoder = new TextEncoder();
  const parts = [descriptor.id, descriptor.user_id, descriptor.endpoint, descriptor.p256dh, descriptor.auth]
    .flatMap(value => {
      const bytes = encoder.encode(value);
      return [encoder.encode(`${bytes.byteLength}:`), bytes];
    });
  const framed = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { framed.set(part, offset); offset += part.byteLength; }
  const digest = await crypto.subtle.digest("SHA-256", framed);
  return "v1:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
