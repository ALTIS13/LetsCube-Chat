import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";

export type MessagePreviewVerificationOwner = {
  revision: number;
  recipientId: string;
  recipientSessionId: string;
  accountEpoch: number;
};
export interface MessagePreviewVerificationBridge {
  beginBinding(input: MessagePreviewVerificationOwner): Promise<unknown>;
  verifyBinding(input: MessagePreviewVerificationOwner & {
    epoch: string; deviceId: string; accessToken: string; publicApiKey: string;
  }): Promise<unknown>;
  clearBinding(input: { revision: number }): Promise<unknown>;
}
interface MessagePreviewsPlugin extends MessagePreviewVerificationBridge { getCapabilities(): Promise<unknown> }
let bridge: MessagePreviewsPlugin | null = null;

export function nativeMessagePreviewsAvailable(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("MessagePreviews");
}

function verificationPlugin(): MessagePreviewsPlugin {
  if (!nativeMessagePreviewsAvailable()) throw new Error("native verification unavailable");
  return bridge ??= registerPlugin<MessagePreviewsPlugin>("MessagePreviews");
}

export const nativeMessagePreviewVerificationBridge: MessagePreviewVerificationBridge = {
  beginBinding: async input => verificationPlugin().beginBinding(input),
  verifyBinding: async input => verificationPlugin().verifyBinding(input),
  clearBinding: async input => verificationPlugin().clearBinding(input),
};

export async function readNativeMessagePreviewCandidate(): Promise<unknown> {
  if (!nativeMessagePreviewsAvailable()) return null;
  try {
    bridge ??= registerPlugin<MessagePreviewsPlugin>("MessagePreviews");
    return await bridge.getCapabilities();
  } catch { return null; }
}
