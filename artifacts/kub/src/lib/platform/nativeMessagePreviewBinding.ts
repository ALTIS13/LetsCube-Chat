import { isVoiceUuid, verifiedNativeVoiceBinding, type NativeVoiceBinding } from "./nativeVoiceContract.ts";
import type { MessagePreviewBinding } from "./nativeMessagePreviewContract.ts";

export type MessagePreviewBindingOwner = NativeVoiceBinding & { accountEpoch: number };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Pair ACK remains the existing eight-argument contract, never a device capability. */
export function messagePreviewRegistrationAck(data: unknown, expected: NativeVoiceBinding): boolean {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])
    || Object.keys(data[0]).length !== 2 || !Object.hasOwn(data[0], "recipient_id")
    || !Object.hasOwn(data[0], "recipient_session_id")) return false;
  return verifiedNativeVoiceBinding(data, expected) !== null;
}

/** SQL btrim removes edge ASCII spaces, not JavaScript's wider whitespace set. */
export function messagePreviewRegistrationHash(token: string, hash: string | null): string | null {
  return typeof token === "string" && token.length > 0 && token[0] !== " " && token.at(-1) !== " "
    && typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

export function parseMessagePreviewDeviceBinding(data: unknown, expected: NativeVoiceBinding): MessagePreviewBinding | null {
  const keys = ["binding_v", "recipient_id", "session_id", "device_id"];
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const row = data[0];
  if (Object.keys(row).length !== 4 || !keys.every(key => Object.hasOwn(row, key))
    || row.binding_v !== 1 || !isVoiceUuid(row.recipient_id) || !isVoiceUuid(row.session_id) || !isVoiceUuid(row.device_id)
    || row.recipient_id !== expected.recipientId || row.session_id !== expected.recipientSessionId) return null;
  return { recipientId: row.recipient_id, recipientSessionId: row.session_id, deviceId: row.device_id };
}
