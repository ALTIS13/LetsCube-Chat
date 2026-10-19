import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";

export type AndroidUpdatePhase = "idle" | "checking" | "available" | "current" | "downloading"
  | "paused" | "verifying" | "ready" | "installing" | "failed" | "unavailable";
export type AndroidUpdateSnapshot = {
  phase: AndroidUpdatePhase;
  version?: string | null;
  bytes: number;
  total: number;
  canInstall: boolean;
  error: string | null;
};
type Command = "status" | "check" | "start" | "install" | "cancel" | "permission";
export type AndroidUpdatesBridge = Record<Command, () => Promise<AndroidUpdateSnapshot>>;
const native = registerPlugin<AndroidUpdatesBridge>("AndroidUpdates");
export function hasAndroidUpdates(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("AndroidUpdates");
}
const EMPTY: AndroidUpdateSnapshot = { phase: "unavailable", bytes: 0, total: 0, canInstall: false, error: null };

/** Shared observers never own the native download or erase a ready APK on detach. */
export function createAndroidUpdateStore(bridge: AndroidUpdatesBridge, available: () => boolean) {
  let state = { snapshot: EMPTY, commandPending: false };
  let owners = 0, serial = 0, accepted = 0, commandOwner = 0, timer: ReturnType<typeof setInterval> | null = null;
  let reading: Promise<void> | null = null;
  let checking: Promise<void> | null = null;
  let nextCheckAt = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  async function run(command: Command) {
    if (!available()) return;
    const id = ++serial;
    if (command !== "status") { commandOwner = id; state = { ...state, commandPending: true }; emit(); }
    try {
      // No caller-controlled catalog, channel, URL, file, hash or install flags.
      const snapshot = await bridge[command]();
      if (id >= accepted) { accepted = id; state = { ...state, snapshot }; emit(); }
    } catch {
      if (id >= accepted) {
        accepted = id;
        state = { ...state, snapshot: { ...state.snapshot,
          phase: ["idle", "unavailable"].includes(state.snapshot.phase) ? "failed" : state.snapshot.phase,
          error: "BRIDGE" } }; emit();
      }
    } finally {
      if (command !== "status" && commandOwner === id) { state = { ...state, commandPending: false }; emit(); }
    }
  }
  const read = () => {
    if (!reading) reading = run("status").finally(() => { reading = null; });
    return reading;
  };
  const check = () => {
    if (!checking) {
      nextCheckAt = Date.now() + 5 * 60_000;
      checking = run("check").finally(() => { checking = null; });
    }
    return checking;
  };
  const discover = () => {
    if (owners && document.visibilityState === "visible" && !state.commandPending
      && ["idle", "current", "available"].includes(state.snapshot.phase)) void check();
  };
  const refresh = () => { void read().then(discover); };
  const visible = () => { if (document.visibilityState === "visible") refresh(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    getServerSnapshot: () => state,
    acquire() {
      if (!available() || typeof window === "undefined") return () => {};
      if (++owners === 1) {
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", visible);
        void read().then(discover);
        timer = setInterval(() => {
          if (document.visibilityState !== "visible") return;
          if (["checking", "downloading", "paused", "verifying"].includes(state.snapshot.phase)) void read();
          else if (Date.now() >= nextCheckAt && !state.commandPending
            && ["idle", "current", "available"].includes(state.snapshot.phase)) refresh();
        }, 1000);
      }
      let released = false;
      return () => {
        if (released) return; released = true;
        if (--owners === 0) {
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", visible);
          if (timer !== null) clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh: read,
    check, download: () => run("start"), install: () => run("install"),
    cancel: () => run("cancel"), permission: () => run("permission"),
  };
}
export const androidUpdateStore = createAndroidUpdateStore(native, hasAndroidUpdates);
