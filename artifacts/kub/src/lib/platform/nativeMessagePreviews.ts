import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";
import { isMessagePreviewChoice, readQaMessagePreviewChoiceContext,
  type MessagePreviewChoice, type QaMessagePreviewChoiceOwner, type QaMessagePreviewChoiceContext } from "./nativeMessagePreviewContract";

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
interface MessagePreviewsPlugin extends MessagePreviewVerificationBridge {
  getCapabilities(): Promise<unknown>;
  getQaUserChoiceContext(input: QaMessagePreviewChoiceOwner): Promise<unknown>;
  beginQaUserChoice(input: { contextId: string; revision: number }): Promise<unknown>;
  confirmQaUserChoice(input: { contextId: string; revision: number; choice: MessagePreviewChoice }): Promise<unknown>;
  retireQaUserChoice(input: { contextId: string; expectedIntentRevision: number; revision: number }): Promise<unknown>;
}
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

export type QaMessagePreviewChoiceAck = Readonly<{ applied: boolean }>;
export type QaMessagePreviewChoiceReply = Readonly<{ qa_choice_v: 0 }>
  | Readonly<QaMessagePreviewChoiceContext & { qa_choice_v: 1; purpose: "consent-only" }>;
const QA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function qaUuid(value: unknown): value is string { return typeof value === "string" && QA_UUID.test(value); }
function qaRevision(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function qaShape(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
async function qaCall(invoke: (plugin: MessagePreviewsPlugin) => Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE !== "true" || !nativeMessagePreviewsAvailable()) return null;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2_000); });
    return await Promise.race([Promise.resolve().then(() => invoke(verificationPlugin())), timeout]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
function qaAck(value: unknown): QaMessagePreviewChoiceAck | null {
  return qaShape(value, ["applied"]) && typeof value.applied === "boolean" ? Object.freeze({ applied: value.applied }) : null;
}
// Null means UNKNOWN, including a lost reply after an action that may have applied.
export const nativeMessagePreviewQaChoiceBridge = {
  async getQaUserChoiceContext(input: QaMessagePreviewChoiceOwner): Promise<QaMessagePreviewChoiceReply | null> {
    if (!qaShape(input, ["recipientId", "recipientSessionId", "deviceId", "accountEpoch"])
      || !qaUuid(input.recipientId) || !qaUuid(input.recipientSessionId) || !qaUuid(input.deviceId) || !qaRevision(input.accountEpoch)) return null;
    const captured = Object.freeze({ ...input });
    const value = await qaCall(plugin => plugin.getQaUserChoiceContext(captured));
    if (qaShape(value, ["qa_choice_v"]) && value.qa_choice_v === 0) return Object.freeze({ qa_choice_v: 0 });
    const context = readQaMessagePreviewChoiceContext(value, captured, Date.now());
    return context ? Object.freeze({ qa_choice_v: 1, purpose: "consent-only", ...context }) : null;
  },
  async beginQaUserChoice(input: { contextId: string; revision: number }): Promise<QaMessagePreviewChoiceAck | null> {
    if (!qaShape(input, ["contextId", "revision"]) || !qaUuid(input.contextId) || !qaRevision(input.revision) || input.revision === 0) return null;
    const captured = Object.freeze({ ...input });
    return qaAck(await qaCall(plugin => plugin.beginQaUserChoice(captured)));
  },
  async confirmQaUserChoice(input: { contextId: string; revision: number; choice: MessagePreviewChoice }): Promise<QaMessagePreviewChoiceAck | null> {
    if (!qaShape(input, ["contextId", "revision", "choice"]) || !qaUuid(input.contextId) || !qaRevision(input.revision)
      || input.revision === 0 || !isMessagePreviewChoice(input.choice)) return null;
    const captured = Object.freeze({ ...input });
    return qaAck(await qaCall(plugin => plugin.confirmQaUserChoice(captured)));
  },
  async retireQaUserChoice(input: { contextId: string; expectedIntentRevision: number; revision: number }): Promise<QaMessagePreviewChoiceAck | null> {
    if (!qaShape(input, ["contextId", "expectedIntentRevision", "revision"]) || !qaUuid(input.contextId)
      || !qaRevision(input.expectedIntentRevision) || !qaRevision(input.revision) || input.revision <= input.expectedIntentRevision) return null;
    const captured = Object.freeze({ ...input });
    return qaAck(await qaCall(plugin => plugin.retireQaUserChoice(captured)));
  },
};
