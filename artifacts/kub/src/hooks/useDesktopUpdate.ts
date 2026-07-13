import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportError } from "@/lib/monitoring";
import { getDesktopBridge, isDesktopApp } from "@/lib/platform/desktop";
import {
  checkDesktopUpdate,
  createDesktopUpdateFailureSnapshot,
  getDesktopUpdatePresentation,
  installDesktopUpdate,
  readDesktopUpdateSnapshot,
  setDesktopUpdateChannel,
  type DesktopUpdateChannel,
  type DesktopUpdateSnapshot,
} from "@/lib/platform/desktopUpdates";

const ACTIVE_POLL_INTERVAL_MS = 250;
const IDLE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const ACTIVE_PHASES = new Set(["checking", "downloading", "installing"]);
let lastAutomaticCheckAt = 0;

export function useDesktopUpdate() {
  const active = isDesktopApp();
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const snapshotRef = useRef<DesktopUpdateSnapshot | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const acceptSnapshot = useCallback((next: DesktopUpdateSnapshot | null) => {
    if (next) snapshotRef.current = next;
    if (mountedRef.current && next) setSnapshot(next);
    return next;
  }, []);

  const showUnavailableFallback = useCallback(() => {
    if (snapshotRef.current) return snapshotRef.current;
    return acceptSnapshot(createDesktopUpdateFailureSnapshot(getDesktopBridge()?.version));
  }, [acceptSnapshot]);

  const reportDesktopUpdateError = useCallback((error: unknown, operation: string) => {
    reportError(
      error instanceof Error ? error : new Error("desktop_update_operation_failed"),
      { category: "desktop_update", operation },
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!active) return null;
    try {
      return acceptSnapshot(await readDesktopUpdateSnapshot());
    } catch (error) {
      reportDesktopUpdateError(error, "state");
      return showUnavailableFallback();
    }
  }, [acceptSnapshot, active, reportDesktopUpdateError, showUnavailableFallback]);

  const runCommand = useCallback(async (
    operation: "check" | "install",
    command: () => Promise<DesktopUpdateSnapshot | null>,
  ) => {
    if (!active) return null;
    setCommandPending(true);
    try {
      return acceptSnapshot(await command());
    } catch (error) {
      reportDesktopUpdateError(error, operation);
      await refresh();
      return null;
    } finally {
      if (mountedRef.current) setCommandPending(false);
    }
  }, [acceptSnapshot, active, refresh, reportDesktopUpdateError]);

  const check = useCallback(async () => {
    lastAutomaticCheckAt = Date.now();
    return runCommand("check", checkDesktopUpdate);
  }, [runCommand]);

  const install = useCallback(
    () => runCommand("install", installDesktopUpdate),
    [runCommand],
  );

  const setChannel = useCallback(async (channel: DesktopUpdateChannel) => {
    if (!active) return null;
    setCommandPending(true);
    try {
      const next = acceptSnapshot(await setDesktopUpdateChannel(channel));
      lastAutomaticCheckAt = Date.now();
      const checked = acceptSnapshot(await checkDesktopUpdate());
      return checked ?? next;
    } catch (error) {
      reportDesktopUpdateError(error, "channel");
      await refresh();
      return null;
    } finally {
      if (mountedRef.current) setCommandPending(false);
    }
  }, [acceptSnapshot, active, refresh, reportDesktopUpdateError]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void readDesktopUpdateSnapshot()
      .then(async (initial) => {
        if (cancelled) return;
        acceptSnapshot(initial);
        if (initial?.phase === "idle" && Date.now() - lastAutomaticCheckAt >= IDLE_CHECK_INTERVAL_MS) {
          lastAutomaticCheckAt = Date.now();
          await runCommand("check", checkDesktopUpdate);
        }
      })
      .catch((error) => {
        reportDesktopUpdateError(error, "initial_state");
        showUnavailableFallback();
      });

    return () => {
      cancelled = true;
    };
  }, [acceptSnapshot, active, reportDesktopUpdateError, runCommand, showUnavailableFallback]);

  useEffect(() => {
    if (!active || !snapshot || !ACTIVE_PHASES.has(snapshot.phase)) return;
    const timer = window.setInterval(() => void refresh(), ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh, snapshot?.phase]);

  useEffect(() => {
    if (!active || !snapshot || !["idle", "current"].includes(snapshot.phase)) return;
    const remaining = Math.max(1_000, IDLE_CHECK_INTERVAL_MS - (Date.now() - lastAutomaticCheckAt));
    const timer = window.setTimeout(() => void check(), remaining);
    return () => window.clearTimeout(timer);
  }, [active, check, snapshot?.phase]);

  useEffect(() => {
    if (!active) return;
    const handleFocus = async () => {
      const current = await refresh();
      if (
        current
        && ["idle", "current"].includes(current.phase)
        && Date.now() - lastAutomaticCheckAt >= IDLE_CHECK_INTERVAL_MS
      ) {
        await check();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [active, check, refresh]);

  const presentation = useMemo(
    () => snapshot ? getDesktopUpdatePresentation(snapshot) : null,
    [snapshot],
  );

  if (!active) return null;
  return {
    snapshot,
    presentation,
    commandPending,
    check,
    install,
    setChannel,
  };
}
