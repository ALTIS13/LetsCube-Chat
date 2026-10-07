import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { nativeMessagePreviewsAvailable, readNativeMessagePreviewCandidate } from "@/lib/platform/nativeMessagePreviews";
import {
  isMessagePreviewChoice, readMessagePreviewBinding, readMessagePreviewCapability,
  readMessagePreviewConsent, readMessagePreviewSession,
  type MessagePreviewBinding, type MessagePreviewChoice, type MessagePreviewSession,
} from "@/lib/platform/nativeMessagePreviewContract";

type Status = "unavailable" | "loading" | "ready" | "saving" | "error";
type View = { status: Status; savedChoice: MessagePreviewChoice | null; effectiveChoice: MessagePreviewChoice; error: string | null };
type Snapshot = View & { owner: string | null; epoch: number; authRevision: number; operation: number };
type Runtime = { matches(snapshot: Snapshot): boolean; refresh(): void; setChoice(choice: MessagePreviewChoice): Promise<boolean> };
const CLOSED: View = { status: "unavailable", savedChoice: null, effectiveChoice: "none", error: null };
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
    let binding: MessagePreviewBinding | null = null;
    let savedChoice: MessagePreviewChoice | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const own = () => !stopped && useAppStore.getState().currentUser?.id === owner
      && useAppStore.getState().accountEpoch === epoch;
    const current = (auth: number, op: number) => own() && auth === authRevision && op === operation
      && session !== null && session.recipientId === owner && session.expiresAt > Date.now();
    const publish = (view: View) => {
      if (own()) setSnapshot({ ...view, owner, epoch, authRevision, operation });
    };
    const invalidate = () => {
      ++authRevision; ++operation; session = null; binding = null; savedChoice = null;
      clearTimeout(timer); clearTimeout(expiry); publish(CLOSED);
    };
    const capability = async (auth: number, op: number, expected?: MessagePreviewBinding) => {
      if (!current(auth, op) || !nativeMessagePreviewsAvailable()) return null;
      const candidate = readMessagePreviewBinding(await readNativeMessagePreviewCandidate(), session!);
      if (!candidate || !current(auth, op) || (expected && candidate.deviceId !== expected.deviceId)) return null;
      const result = await preview.rpc("native_message_preview_capability", { p_device_id: candidate.deviceId });
      if (!current(auth, op) || result.error) return null;
      const latest = readMessagePreviewBinding(await readNativeMessagePreviewCandidate(), session!);
      if (!current(auth, op) || !latest || latest.deviceId !== candidate.deviceId) return null;
      const choice = readMessagePreviewCapability(result.data, candidate);
      return choice === null ? null : { candidate, choice };
    };
    const load = async (auth: number, op: number) => {
      try {
        await (writes.get(owner) ?? Promise.resolve());
        const result = await capability(auth, op);
        if (!current(auth, op)) return;
        if (!result) { publish(CLOSED); return; }
        binding = result.candidate; savedChoice = result.choice;
        publish({ status: "ready", savedChoice, effectiveChoice: savedChoice, error: null });
      } catch { if (current(auth, op)) publish(CLOSED); }
    };
    const acceptSession = (value: unknown) => {
      session = readMessagePreviewSession(value);
      if (!session || session.recipientId !== owner) { session = null; publish(CLOSED); return; }
      const auth = authRevision, op = operation;
      publish({ ...CLOSED, status: "loading" });
      expiry = setTimeout(invalidate, Math.min(session.expiresAt - Date.now(), 2_147_483_647));
      // Supabase auth callbacks must return before any client API is called.
      timer = setTimeout(() => { if (current(auth, op)) void load(auth, op); }, 0);
    };
    const refresh = () => {
      invalidate();
      const auth = authRevision, op = operation;
      void client.auth.getSession().then(result => {
        if (!own() || auth !== authRevision || op !== operation) return;
        acceptSession(result.error ? null : result.data.session);
      }).catch(() => { if (own() && auth === authRevision && op === operation) publish(CLOSED); });
    };
    const setChoice = async (choice: MessagePreviewChoice): Promise<boolean> => {
      if (!isMessagePreviewChoice(choice) || !binding || !current(authRevision, operation)) return false;
      const auth = authRevision, op = ++operation, expected = binding;
      publish({ status: "saving", savedChoice, effectiveChoice: "none", error: null });
      return enqueue(owner, async () => {
        try {
          const before = await capability(auth, op, expected);
          if (!before || !current(auth, op)) throw new Error("unavailable");
          const result = await preview.from("notification_preview_preferences")
            .upsert({ user_id: owner, preview_level: choice }, { onConflict: "user_id" })
            .select("user_id,preview_level");
          if (!current(auth, op)) return false;
          if (result.error || readMessagePreviewConsent(result.data, owner, choice) === null) throw new Error("refused");
          const after = await capability(auth, op, expected);
          if (!current(auth, op)) return false;
          if (!after || after.choice !== choice) throw new Error("unconfirmed");
          binding = after.candidate; savedChoice = after.choice;
          publish({ status: "ready", savedChoice, effectiveChoice: savedChoice, error: null });
          return true;
        } catch {
          if (current(auth, op)) {
            binding = null;
            publish({ status: "error", savedChoice, effectiveChoice: "none", error: "Не удалось сохранить" });
          }
          return false;
        }
      });
    };
    const instance: Runtime = { refresh, setChoice,
      matches: value => current(value.authRevision, value.operation) };
    runtime.current = instance;
    const authSubscription = client.auth.onAuthStateChange((_event, value) => {
      invalidate(); acceptSession(value);
    }).data.subscription;
    const unsubscribe = useAppStore.subscribe(() => { if (!own()) invalidate(); });
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", refresh);
    refresh();
    return () => {
      stopped = true; invalidate(); authSubscription.unsubscribe(); unsubscribe();
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", refresh);
      if (runtime.current === instance) runtime.current = null;
    };
  }, [owner, epoch]);

  const view = snapshot.owner === owner && snapshot.epoch === epoch && runtime.current?.matches(snapshot) ? snapshot : CLOSED;
  const ownsRender = () => useAppStore.getState().currentUser?.id === owner && useAppStore.getState().accountEpoch === epoch;
  return {
    status: view.status, savedChoice: view.savedChoice, effectiveChoice: view.effectiveChoice,
    error: view.error, canChoose: view.status === "ready", saving: view.status === "saving",
    refresh: () => { if (ownsRender()) runtime.current?.refresh(); },
    setChoice: (choice: MessagePreviewChoice) => ownsRender() ? runtime.current?.setChoice(choice) ?? Promise.resolve(false) : Promise.resolve(false),
  };
}
