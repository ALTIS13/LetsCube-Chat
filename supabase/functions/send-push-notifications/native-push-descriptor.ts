export type NativePushDescriptor = Readonly<{
  id: string;
  user_id: string;
  platform: "android" | "ios" | "windows";
  provider: "fcm" | "apns" | "wns";
  token: string;
  app_version: string | null;
  session_id: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function snapshotNativePushDescriptor(value: unknown): NativePushDescriptor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID.test(row.id) ||
    typeof row.user_id !== "string" || !UUID.test(row.user_id) ||
    (row.platform !== "android" && row.platform !== "ios" && row.platform !== "windows") ||
    (row.provider !== "fcm" && row.provider !== "apns" && row.provider !== "wns") ||
    typeof row.token !== "string" || row.token.length === 0 ||
    (row.app_version !== null && typeof row.app_version !== "string") ||
    (row.session_id !== null && (typeof row.session_id !== "string" || !UUID.test(row.session_id)))) return null;
  return Object.freeze({ id: row.id.toLowerCase(), user_id: row.user_id.toLowerCase(),
    platform: row.platform, provider: row.provider, token: row.token, app_version: row.app_version,
    session_id: row.session_id === null ? null : row.session_id.toLowerCase() });
}

export async function nativePushDescriptorFingerprint(descriptor: NativePushDescriptor): Promise<string> {
  const encoder = new TextEncoder();
  // Fixed seven fields; -1: is typed SQL NULL, distinct from the empty-string 0:.
  const parts = [descriptor.id, descriptor.user_id, descriptor.platform, descriptor.provider,
    descriptor.token, descriptor.app_version, descriptor.session_id].flatMap(value => {
    if (value === null) return [encoder.encode("-1:")];
    const bytes = encoder.encode(value);
    return [encoder.encode(`${bytes.byteLength}:`), bytes];
  });
  const framed = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { framed.set(part, offset); offset += part.byteLength; }
  const digest = await crypto.subtle.digest("SHA-256", framed);
  return "v1:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function nativePushRetirementUrl(supabaseUrl: string, descriptor: NativePushDescriptor): URL {
  const url = new URL("/rest/v1/user_push_devices", supabaseUrl);
  for (const key of ["id", "user_id", "platform", "provider", "token", "app_version", "session_id"] as const) {
    url.searchParams.set(key, descriptor[key] === null ? "is.null" : `eq.${descriptor[key]}`);
  }
  return url;
}
