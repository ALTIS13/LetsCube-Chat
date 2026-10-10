import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { nativeMessagePreviewsAvailable, readNativeMessagePreviewCandidate, nativeMessagePreviewQaChoiceBridge } from "@/lib/platform/nativeMessagePreviews";
import { nativeMessagePreviewBindingSnapshot, subscribeNativeVoicePush } from "@/lib/platform/nativeVoiceCalls";
import {
  isMessagePreviewChoice, readMessagePreviewBinding, readMessagePreviewCapability,
  readMessagePreviewConsent, readMessagePreviewSession, readQaMessagePreviewChoiceContext,
  type MessagePreviewBinding, type MessagePreviewChoice, type MessagePreviewSession,
  type QaMessagePreviewChoiceContext, type QaMessagePreviewChoiceOwner,
} from "@/lib/platform/nativeMessagePreviewContract";

type Status = "unavailable" | "loading" | "ready" | "saving" | "error";
type NativeClosure = "NOT_REQUESTED" | "PENDING" | "CONFIRMED" | "UNKNOWN" | "RETIRED";
type View = { status: Status; savedChoice: MessagePreviewChoice | null; effectiveChoice: MessagePreviewChoice; error: string | null; nativeClosure: NativeClosure };
type Snapshot = View & { owner: string | null; epoch: number; authRevision: number; operation: number };
type Runtime = { matches(snapshot: Snapshot): boolean; refresh(): void; setChoice(choice: MessagePreviewChoice): Promise<boolean> };
const CLOSED: View = { status: "unavailable", savedChoice: null, effectiveChoice: "none", error: null, nativeClosure: "NOT_REQUESTED" };
type Admission = { kind: "ordinary"; candidate: MessagePreviewBinding } | { kind: "qa"; candidate: QaMessagePreviewChoiceContext };
type QaIntent = { revision: number; closure: NativeClosure; erasureRevision?: number; retirement?: Promise<void> };
type QaLease = { context: QaMessagePreviewChoiceContext; target: QaIntent; terminal: boolean };
// Intent high-water and terminal context ownership survive a Settings remount.
let intentRevision = 0;
const qaContexts = new Map<string, QaLease>();
function nextIntent(): number | null {
  return intentRevision < Number.MAX_SAFE_INTEGER ? ++intentRevision : null;
}
function sameContext(a: QaMessagePreviewChoiceContext, b: QaMessagePreviewChoiceContext): boolean {
  return a.contextId === b.contextId && a.recipientId === b.recipientId
    && a.recipientSessionId === b.recipientSessionId && a.deviceId === b.deviceId
    && a.accountEpoch === b.accountEpoch && a.expiresAt === b.expiresAt;
}
// A settings remount must also wait for a previously dispatched own-row write.
const writes = new Map<string, Promise<void>>();
function enqueue(owner: string, run: () => Promise<boolean>): Promise<boolean> {
  const task = (writes.get(owner) ?? Promise.resolve()).catch(() => {}).then(run);
  const tail = task.then(() => {}, () => {});
  writes.set(owner, tail);
  void tail.then(() => { if (writes.get(owner) === tail) writes.delete(owner); });
  return task;
}

// The proposal is intentionally absent from the installed generated database types.
type PreviewClient = {
  rpc(name: "native_message_preview_capability", args: { p_device_id: string }): PromiseLike<{ data: unknown; error: unknown }>;
  from(name: "notification_preview_preferences"): {
    upsert(row: { user_id: string; preview_level: MessagePreviewChoice }, options: { onConflict: "user_id" }): {
      select(columns: "user_id,preview_level"): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

export function useNativeMessagePreview() {
  const owner = useAppStore(state => state.currentUser?.id ?? null);
  const epoch = useAppStore(state => state.accountEpoch);
  const runtime = useRef<Runtime | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ ...CLOSED, owner: null, epoch: -1, authRevision: 0, operation: 0 });

  useEffect(() => {
    if (!owner || !nativeMessagePreviewsAvailable()) return;
    const client = createClient();
    const preview = client as unknown as PreviewClient;
    let stopped = false, authRevision = 0, operation = 0;
    let session: MessagePreviewSession | null = null;
    let acceptedIdentity: (Pick<MessagePreviewSession, "recipientId" | "recipientSessionId"> & { accountEpoch: number }) | null = null;
    let binding: MessagePreviewBinding | null = null;
    let admission: Admission | null = null;
    let qaLease: QaLease | null = null;
    let qaTarget: QaIntent | null = null;
    const qa = import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE === "true";
    let savedChoice: MessagePreviewChoice | null = null;
    let lastView: View = CLOSED;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let deadline = 0;
    const own = () => !stopped && useAppStore.getState().currentUser?.id === owner
      && useAppStore.getState().accountEpoch === epoch;
    const current = (auth: number, op: number) => own() && auth === authRevision && op === operation
      && session !== null && session.recipientId === owner && session.expiresAt > Date.now();
    const selectorOwner = (): QaMessagePreviewChoiceOwner | null => {
      const selector = nativeMessagePreviewBindingSnapshot();
      if (!session || !selector || selector.recipientId !== owner || selector.recipientSessionId !== session.recipientSessionId) return null;
      return { recipientId: selector.recipientId, recipientSessionId: selector.recipientSessionId, deviceId: selector.deviceId, accountEpoch: epoch };
    };
    const selected = (context: QaMessagePreviewChoiceContext) => {
      const value = selectorOwner();
      return !!value && value.recipientId === context.recipientId && value.recipientSessionId === context.recipientSessionId
        && value.deviceId === context.deviceId && value.accountEpoch === context.accountEpoch;
    };
    const qaCurrent = (auth: number, op: number, lease: QaLease, target: QaIntent) => current(auth, op)
      && !lease.terminal && lease.target === target && qaContexts.get(lease.context.contextId) === lease
      && lease.context.expiresAt > Date.now() && selected(lease.context);
    const publish = (view: View) => {
      lastView = view;
      if (own()) setSnapshot({ ...view, owner, epoch, authRevision, operation });
    };
    const retire = (lease: QaLease, target: QaIntent) => {
      if (lease.target !== target || target.retirement) return;
      lease.terminal = true; target.closure = "UNKNOWN";
      const revision = nextIntent();
      if (revision === null) return;
      target.retirement = nativeMessagePreviewQaChoiceBridge.retireQaUserChoice({
        contextId: lease.context.contextId, expectedIntentRevision: target.erasureRevision ?? target.revision, revision,
      }).then(ack => {
        if (lease.target !== target) return;
        target.closure = ack?.applied === true ? "RETIRED" : "UNKNOWN";
        if (qaTarget === target) publish({ ...lastView, effectiveChoice: "none", nativeClosure: target.closure });
      });
    };
    const invalidate = (terminal = false) => {
      const lease = qaLease, target = qaTarget;
      if (terminal && lease && target) retire(lease, target);
      if (terminal) acceptedIdentity = null;
      ++authRevision; ++operation; session = null; binding = null; admission = null; savedChoice = null;
      clearTimeout(timer); clearTimeout(expiry); publish({ ...CLOSED, nativeClosure: target?.closure ?? "NOT_REQUESTED" });
      if (!terminal && qaLease && !qaLease.terminal) {
        expiry = setTimeout(() => invalidate(true), Math.max(0, deadline - Date.now()));
      }
    };
    const closeExpiredOperation = (auth: number, op: number) => {
      if (!qa || !own() || auth !== authRevision || op !== operation || !session || !qaLease || !qaTarget
        || session.recipientId !== owner || qaLease.target !== qaTarget
        || Math.min(session.expiresAt, qaLease.context.expiresAt) > Date.now()) return false;
      invalidate(true); return true;
    };
    const armExpiry = () => {
      clearTimeout(expiry);
      if (session) {
        deadline = Math.min(session.expiresAt, qaLease?.context.expiresAt ?? session.expiresAt);
        expiry = setTimeout(() => invalidate(true), Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
      }
    };
    const qaContext = async (auth: number, op: number, expected?: QaMessagePreviewChoiceContext) => {
      if (!current(auth, op) || !nativeMessagePreviewsAvailable() || qaLease?.terminal) return null;
      const captured = selectorOwner();
      if (!captured) return null;
      const reply = await nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext(captured);
      if (!current(auth, op)) return null;
      const context = readQaMessagePreviewChoiceContext(reply, captured, Date.now());
      if (!context || !selected(context) || (expected && !sameContext(context, expected))) return null;
      if (qaLease) return sameContext(context, qaLease.context) ? context : null;
      for (const [id, lease] of qaContexts) if (lease.context.expiresAt <= Date.now()) qaContexts.delete(id);
      if (qaContexts.has(context.contextId)) return null;
      qaTarget = { revision: 0, closure: "NOT_REQUESTED" };
      qaLease = { context, target: qaTarget, terminal: false }; qaContexts.set(context.contextId, qaLease);
      armExpiry();
      return context;
    };
    const capability = async (auth: number, op: number, expected?: Admission) => {
      if (!current(auth, op) || !nativeMessagePreviewsAvailable()) return null;
      if (qa) {
        if (expected && expected.kind !== "qa") return null;
        const candidate = await qaContext(auth, op, expected?.candidate);
        const lease = qaLease, target = qaTarget;
        if (!candidate || !lease || !target || !qaCurrent(auth, op, lease, target)) return null;
        const result = await preview.rpc("native_message_preview_capability", { p_device_id: candidate.deviceId });
        if (!qaCurrent(auth, op, lease, target) || result.error) return null;
        const latest = await qaContext(auth, op, candidate);
        if (!latest || !qaCurrent(auth, op, lease, target)) return null;
        const choice = readMessagePreviewCapability(result.data, candidate);
        return choice === null ? null : { admission: { kind: "qa", candidate } as Admission, choice };
      }
      const candidate = readMessagePreviewBinding(await readNativeMessagePreviewCandidate(), session!);
      if (!candidate || !current(auth, op) || (expected && (expected.kind !== "ordinary" || candidate.deviceId !== expected.candidate.deviceId))) return null;
      const result = await preview.rpc("native_message_preview_capability", { p_device_id: candidate.deviceId });
      if (!current(auth, op) || result.error) return null;
      const latest = readMessagePreviewBinding(await readNativeMessagePreviewCandidate(), session!);
      if (!current(auth, op) || !latest || latest.deviceId !== candidate.deviceId) return null;
      const choice = readMessagePreviewCapability(result.data, candidate);
      return choice === null ? null : { admission: { kind: "ordinary", candidate } as Admission, choice };
    };
    const load = async (auth: number, op: number) => {
      try {
        await (writes.get(owner) ?? Promise.resolve());
        const result = await capability(auth, op);
        if (!current(auth, op)) { closeExpiredOperation(auth, op); return; }
        if (qaLease && qaTarget && !qaCurrent(auth, op, qaLease, qaTarget)) {
          retire(qaLease, qaTarget); publish({ ...CLOSED, nativeClosure: qaTarget.closure }); return;
        }
        if (!result) {
          if (qaLease && qaTarget) retire(qaLease, qaTarget);
          publish({ ...CLOSED, nativeClosure: qaTarget?.closure ?? "NOT_REQUESTED" }); return;
        }
        admission = result.admission; binding = admission.candidate; savedChoice = result.choice;
        publish({ status: "ready", savedChoice, effectiveChoice: qa ? "none" : savedChoice, error: null, nativeClosure: qaTarget?.closure ?? "NOT_REQUESTED" });
      } catch {
        if (!closeExpiredOperation(auth, op) && current(auth, op)) { if (qa) invalidate(true); else publish(CLOSED); }
      }
    };
    const acceptSession = (value: unknown) => {
      session = readMessagePreviewSession(value);
      if (!session || session.recipientId !== owner) { invalidate(qa); return; }
      if (qaLease && (qaLease.terminal || !selected(qaLease.context) || qaLease.context.expiresAt <= Date.now())) { invalidate(true); return; }
      if (qa) acceptedIdentity = { recipientId: session.recipientId, recipientSessionId: session.recipientSessionId, accountEpoch: epoch };
      const auth = authRevision, op = operation;
      publish({ ...CLOSED, status: "loading", nativeClosure: qaTarget?.closure ?? "NOT_REQUESTED" });
      armExpiry();
      // Supabase auth callbacks must return before any client API is called.
      timer = setTimeout(() => { if (current(auth, op)) void load(auth, op); }, 0);
    };
    const refresh = () => {
      invalidate(qa && lastView.status === "saving");
      const auth = authRevision, op = operation;
      void client.auth.getSession().then(result => {
        if (!own() || auth !== authRevision || op !== operation) return;
        acceptSession(result.error ? null : result.data.session);
      }).catch(() => {
        if (own() && auth === authRevision && op === operation) { if (qa) invalidate(true); else publish(CLOSED); }
      });
    };
    const setChoice = async (choice: MessagePreviewChoice): Promise<boolean> => {
      if (!isMessagePreviewChoice(choice) || !binding || !admission || !current(authRevision, operation)) return false;
      const lease = qaLease;
      if (qa && (!lease || !qaTarget || !qaCurrent(authRevision, operation, lease, qaTarget))) {
        invalidate(true); return false;
      }
      const revision = qa ? nextIntent() : null;
      if (qa && revision === null) { invalidate(true); return false; }
      const previousTarget = qaTarget;
      const target: QaIntent | null = qa ? { revision: revision!, closure: "UNKNOWN" } : null;
      if (lease && target) { lease.target = target; qaTarget = target; }
      const auth = authRevision, op = ++operation, expected = admission;
      const live = () => current(auth, op) && (!qa || (!!lease && !!target && qaCurrent(auth, op, lease, target)));
      publish({ status: "saving", savedChoice, effectiveChoice: "none", error: null, nativeClosure: target?.closure ?? "NOT_REQUESTED" });
      const failed = () => {
        const wasLive = live();
        if (lease && target) retire(lease, target);
        if (qa && !wasLive && own() && auth === authRevision && op === operation) {
          invalidate(true); return false;
        }
        if (current(auth, op)) {
          binding = null; admission = null;
          publish({ status: "error", savedChoice, effectiveChoice: "none", error: "Не удалось подтвердить сохранение", nativeClosure: target?.closure ?? "NOT_REQUESTED" });
        }
        return false;
      };
      if (lease && target) {
        const ack = await nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({ contextId: lease.context.contextId, revision: target.revision });
        if (ack?.applied === false && lease.target === target && !target.retirement) {
          target.erasureRevision = previousTarget?.erasureRevision ?? previousTarget?.revision ?? 0;
        }
        if (ack?.applied !== true || !live()) return failed();
        target.closure = "PENDING";
        publish({ ...lastView, nativeClosure: "PENDING" });
      }
      return enqueue(owner, async () => {
        try {
          const before = await capability(auth, op, expected);
          if (!before || !live()) throw new Error("unavailable");
          const result = await preview.from("notification_preview_preferences")
            .upsert({ user_id: owner, preview_level: choice }, { onConflict: "user_id" })
            .select("user_id,preview_level");
          if (!live()) return failed();
          if (result.error || readMessagePreviewConsent(result.data, owner, choice) === null) throw new Error("refused");
          const after = await capability(auth, op, expected);
          if (!live()) return failed();
          if (!after || after.choice !== choice) throw new Error("unconfirmed");
          if (lease && target) {
            const ack = await nativeMessagePreviewQaChoiceBridge.confirmQaUserChoice({ contextId: lease.context.contextId, revision: target.revision, choice });
            if (ack?.applied !== true || !live()) return failed();
            const latest = await qaContext(auth, op, lease.context);
            if (!latest || !live()) return failed();
            target.closure = "CONFIRMED";
          }
          admission = after.admission; binding = admission.candidate; savedChoice = after.choice;
          publish({ status: "ready", savedChoice, effectiveChoice: qa ? "none" : savedChoice, error: null, nativeClosure: target?.closure ?? "NOT_REQUESTED" });
          return true;
        } catch {
          return failed();
        }
      });
    };
    const instance: Runtime = { refresh, setChoice,
      matches: value => current(value.authRevision, value.operation)
        && (!qaLease || qaLease.context.expiresAt > Date.now())
        && (!qaLease || value.status === "error" || (!!qaTarget && qaCurrent(value.authRevision, value.operation, qaLease, qaTarget)))
        || (qa && own() && value.authRevision === authRevision && value.operation === operation && value.status === "unavailable") };
    runtime.current = instance;
    const authSubscription = client.auth.onAuthStateChange((event, value) => {
      const next = qa ? readMessagePreviewSession(value) : null;
      const duplicateInitial = event === "INITIAL_SESSION" && own() && !!next && !!acceptedIdentity
        && next.recipientId === acceptedIdentity.recipientId && next.recipientSessionId === acceptedIdentity.recipientSessionId
        && acceptedIdentity.accountEpoch === epoch;
      invalidate(qa && (!duplicateInitial || lastView.status === "saving")); acceptSession(value);
    }).data.subscription;
    const unsubscribe = useAppStore.subscribe(() => { if (!own()) invalidate(true); });
    const unsubscribeNative = qa ? subscribeNativeVoicePush(() => {
      if (qaLease && !selected(qaLease.context)) invalidate(true);
    }) : () => {};
    const visible = () => { if (document.visibilityState === "visible") refresh(); else if (qa) invalidate(true); };
    const hidden = () => { if (qa) invalidate(true); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", refresh);
    window.addEventListener("pagehide", hidden);
    refresh();
    return () => {
      invalidate(true); stopped = true; authSubscription.unsubscribe(); unsubscribe(); unsubscribeNative();
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", refresh);
      window.removeEventListener("pagehide", hidden);
      if (runtime.current === instance) runtime.current = null;
    };
  }, [owner, epoch]);

  const view = snapshot.owner === owner && snapshot.epoch === epoch && runtime.current?.matches(snapshot) ? snapshot : CLOSED;
  const ownsRender = () => useAppStore.getState().currentUser?.id === owner && useAppStore.getState().accountEpoch === epoch;
  return {
    status: view.status, savedChoice: view.savedChoice, effectiveChoice: view.effectiveChoice,
    error: view.error, nativeClosure: view.nativeClosure, canChoose: view.status === "ready", saving: view.status === "saving",
    refresh: () => { if (ownsRender()) runtime.current?.refresh(); },
    setChoice: (choice: MessagePreviewChoice) => ownsRender() ? runtime.current?.setChoice(choice) ?? Promise.resolve(false) : Promise.resolve(false),
  };
}
