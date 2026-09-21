import {
  isMissingVoiceRegistrationRpc, parseNativeVoiceAction, readNativeVoiceSession,
  verifiedNativeVoiceBinding, type NativeVoiceAction, type NativeVoiceBinding, type NativeVoiceSession,
} from "./nativeVoiceContract.ts";
import type { NativePushResult, NativePushTokenRegistration } from "./nativePush";

export interface NativeVoiceBridge {
  getCapabilities(): Promise<{ protocol: number }>;
  beginBinding(binding: NativeVoiceBinding): Promise<{ epoch: string }>;
  commitBinding(binding: NativeVoiceBinding & { epoch: string }): Promise<{ applied: boolean }>;
  clearBinding(): Promise<unknown>;
  setCallsAllowed(input: { allowed: boolean }): Promise<unknown>;
  consumePendingAction(): Promise<{ event: unknown }>;
  revalidateConsumedAction(input: { ringKey: string }): Promise<{ event: unknown }>;
}

export type NativeVoiceContext = Pick<NativeVoiceSession, "recipientId" | "recipientSessionId"> & {
  generation: number;
  identityRevision: number;
};
export interface NativeVoiceDependencies {
  bridge: NativeVoiceBridge;
  loadSettings(session: NativeVoiceSession): Promise<{ pushEnabled: boolean; callsAllowed: boolean }>;
  registerPush(register: NativePushTokenRegistration, interactive: boolean): Promise<NativePushResult>;
  unregisterPush(token: string | null, canCommit: () => boolean): Promise<NativePushResult>;
  registrationMetadata(token: string): Promise<{ tokenHash: string | null; deviceModel: string | null; appVersion: string | null }>;
  rpc(args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  openChat(chatId: string, canCommit: () => boolean): Promise<boolean>;
  navigate(route: string): void;
  navigationReady(userId: string): boolean;
  now(): number;
  defer(work: () => void): void;
  onResult?(result: NativePushResult): void;
  onSessionChanged?(): void;
}

const inactive = (): NativePushResult => ({ status: "native_inactive", message: "" });
const failed = (): NativePushResult => ({ status: "native_error", message: "Не удалось включить уведомления. Попробуйте ещё раз." });

/** One registration owner, including the settings buttons. No SDK work in signalSession. */
export function createNativeVoiceController(deps: NativeVoiceDependencies) {
  let generation = 0;
  let identityRevision = 0;
  let session: NativeVoiceSession | null = null;
  let verified: NativeVoiceBinding | null = null;
  let begin: Promise<{ epoch: string } | null> = Promise.resolve(null);
  let token: string | null = null;
  let queuedRotation: { value: string; ticket: number } | null = null;
  let callsAllowed = true;
  let callsRevision = 0;
  let disabled = false;
  let stopped = false;
  let consuming: Promise<void> | null = null;
  let actionAgain = false;
  let heldAction: { event: NativeVoiceAction; owner: NativeVoiceContext } | null = null;
  let actionRevision = 0;
  const registrations = new Set<number>();

  const current = (ticket: number) => !stopped && ticket === generation;
  const discardAction = () => { heldAction = null; ++actionRevision; };
  const clear = () => {
    verified = null;
    discardAction();
    void deps.bridge.clearBinding().catch(() => undefined);
  };
  const context = (): NativeVoiceContext | null => session
    ? { recipientId: session.recipientId, recipientSessionId: session.recipientSessionId, generation, identityRevision }
    : null;
  const isCurrentSession = (expected: NativeVoiceContext | null) => !!expected && !stopped
    && expected.identityRevision === identityRevision
    && session?.recipientId === expected.recipientId && session.recipientSessionId === expected.recipientSessionId;
  const isCurrentContext = (expected: NativeVoiceContext | null) => isCurrentSession(expected) && current(expected!.generation);

  const transition = () => {
    const ticket = ++generation;
    verified = null;
    if (session?.recipientSessionId && !disabled) {
      begin = deps.bridge.beginBinding({ recipientId: session.recipientId, recipientSessionId: session.recipientSessionId })
        .catch(() => null);
    } else {
      begin = Promise.resolve(null);
      clear();
    }
    return ticket;
  };

  async function actionPending(): Promise<void> {
    if (consuming) { actionAgain = true; return consuming; }
    const binding = verified;
    const ticket = generation;
    if (!binding || !callsAllowed || !deps.navigationReady(binding.recipientId)) return;
    const owner = context()!;
    const revision = actionRevision;
    let retained = heldAction;
    const sameOwner = () => isCurrentSession(owner) && revision === actionRevision && callsAllowed;
    const canCommit = () => current(ticket) && verified === binding && sameOwner() && heldAction === retained
      && deps.navigationReady(binding.recipientId);
    consuming = (async () => {
      try {
        let action: NativeVoiceAction | null;
        if (retained) {
          if (!isCurrentSession(retained.owner)) { heldAction = null; return; }
          // A cached DTO only identifies the consumed receipt. Native cancellation,
          // mute and expiry must authorize every retry after reverification.
          const { event } = await deps.bridge.revalidateConsumedAction({ ringKey: retained.event.ring_key });
          if (!canCommit()) return;
          action = parseNativeVoiceAction(event, binding, deps.now());
          if (!action || action.ring_key !== retained.event.ring_key) {
            heldAction = null;
            // A newer native tap can replace the consumed marker while unbound.
            // Drain it once; only a fresh consume response can authorize navigation.
            actionAgain = true;
            return;
          }
          retained.event = action;
        } else {
          const { event } = await deps.bridge.consumePendingAction();
          if (!sameOwner()) return;
          action = parseNativeVoiceAction(event, binding, deps.now());
          if (!action) return;
          retained = { event: action, owner };
          heldAction = retained;
        }
        if (!canCommit()) return;
        const stillValid = () => canCommit() && parseNativeVoiceAction(action, binding, deps.now()) !== null;
        if (await deps.openChat(action.chat_id, stillValid) && stillValid()) deps.navigate(action.route);
        if (canCommit()) heldAction = null;
      } catch {
        if (current(ticket) && heldAction === retained) heldAction = null;
      }
    })();
    await consuming;
    consuming = null;
    if (actionAgain) { actionAgain = false; await actionPending(); }
  }

  async function reconcile(ticket: number, interactive: boolean): Promise<NativePushResult> {
    const expected = session;
    const pendingBegin = begin;
    if (!expected || !current(ticket) || disabled) return inactive();
    try {
      const epoch = await pendingBegin;
      if (!current(ticket)) return inactive();
      const capabilities = await deps.bridge.getCapabilities();
      if (!current(ticket)) return inactive();
      const settingsRevision = callsRevision;
      const settings = await deps.loadSettings(expected);
      if (!current(ticket)) return inactive();
      if (!interactive && !settings.pushEnabled) { clear(); deps.onResult?.(inactive()); return inactive(); }
      if (settingsRevision === callsRevision) {
        callsAllowed = settings.callsAllowed;
        if (!callsAllowed) discardAction();
        await deps.bridge.setCallsAllowed({ allowed: callsAllowed });
        if (!current(ticket)) return inactive();
      }
      const protocol = capabilities.protocol === 1 && epoch?.epoch && expected.recipientSessionId ? 1 : null;
      if (!protocol) clear();
      registrations.add(ticket);
      const registerToken: NativePushTokenRegistration = async (value) => {
        if (!current(ticket) || disabled) return inactive();
        token = value;
        if (queuedRotation?.ticket === ticket && queuedRotation.value === value) queuedRotation = null;
        const metadata = await deps.registrationMetadata(value);
        if (!current(ticket)) return inactive();
        const args = {
          p_platform: "android", p_provider: "fcm", p_token: value,
          p_token_hash: metadata.tokenHash, p_device_id: null,
          p_device_model: metadata.deviceModel, p_app_version: metadata.appVersion,
        };
        let response = await deps.rpc(protocol ? { ...args, p_voice_call_protocol: 1 } : args);
        if (!current(ticket)) return inactive();
        let legacy = !protocol;
        if (protocol && isMissingVoiceRegistrationRpc(response.error)) {
          clear();
          legacy = true;
          response = await deps.rpc(args);
          if (!current(ticket)) return inactive();
        }
        if (response.error) { clear(); return failed(); }
        if (!legacy && epoch) {
          const binding = verifiedNativeVoiceBinding(response.data, expected);
          if (!binding) { clear(); return failed(); }
          const committed = await deps.bridge.commitBinding({ ...binding, epoch: epoch.epoch });
          if (!current(ticket)) return inactive();
          if (!committed.applied) { clear(); return failed(); }
          verified = binding;
          void actionPending();
        }
        return null;
      };
      let result: NativePushResult;
      let nextToken: string | null = null;
      // Drain rotations within the original operation: explicit enable still owns
      // its preference write, and every attempt retains the SDK timeout/cleanup.
      while (true) {
        result = await deps.registerPush((value) => registerToken(nextToken ?? value), interactive);
        if (!current(ticket)) return inactive();
        if (result.status !== "native_active") {
          // Invalidate callbacks still waiting for metadata/RPC when a timeout wins.
          ++generation;
          clear();
          break;
        }
        if (queuedRotation?.ticket !== ticket || queuedRotation.value === token) break;
        nextToken = queuedRotation.value;
        queuedRotation = null;
      }
      deps.onResult?.(result);
      return result;
    } catch {
      if (current(ticket)) { ++generation; clear(); deps.onResult?.(failed()); }
      return failed();
    } finally {
      registrations.delete(ticket);
      if (queuedRotation?.ticket === ticket) queuedRotation = null;
    }
  }

  const refresh = () => {
    if (stopped) return;
    const ticket = transition();
    deps.defer(() => { void reconcile(ticket, false); });
  };

  return {
    context, isCurrentContext, isCurrentSession, actionPending, refresh,
    invalidate(): void { if (!stopped) transition(); },
    tokenChanged(value: string): void {
      if (stopped || !session || disabled || value === token) return;
      if (registrations.has(generation)) {
        queuedRotation = { value, ticket: generation };
        return;
      }
      token = value;
      refresh();
    },
    signalSession(value: unknown): void {
      if (stopped) return;
      const next = readNativeVoiceSession(value);
      const changed = next?.recipientId !== session?.recipientId || next?.recipientSessionId !== session?.recipientSessionId;
      if (changed) {
        ++identityRevision;
        discardAction();
        callsAllowed = true;
        ++callsRevision;
        disabled = false;
        token = null;
        queuedRotation = null;
        void deps.bridge.setCallsAllowed({ allowed: true }).catch(() => undefined);
      }
      session = next;
      refresh();
      if (changed) deps.onSessionChanged?.();
      if (!session) deps.onResult?.(inactive());
    },
    async enable(): Promise<NativePushResult> {
      if (stopped || !session) return inactive();
      disabled = false;
      return reconcile(transition(), true);
    },
    async disable(): Promise<NativePushResult> {
      disabled = true;
      const ticket = ++generation;
      clear();
      const heldToken = token;
      token = null;
      queuedRotation = null;
      deps.onResult?.(inactive());
      return deps.unregisterPush(heldToken, () => current(ticket));
    },
    setCallsAllowed(allowed: boolean, expected: NativeVoiceContext | null): void {
      if (!isCurrentSession(expected)) return;
      ++callsRevision;
      callsAllowed = allowed;
      if (!allowed) discardAction();
      void deps.bridge.setCallsAllowed({ allowed }).catch(() => undefined);
      if (allowed) void actionPending();
    },
    stop(): void {
      stopped = true;
      ++generation;
      token = null;
      queuedRotation = null;
      session = null;
      clear();
    },
  };
}

export type NativeVoiceController = ReturnType<typeof createNativeVoiceController>;
