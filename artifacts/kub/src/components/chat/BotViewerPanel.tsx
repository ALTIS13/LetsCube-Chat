"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KubIcon } from "@/components/kub";
import { showActionFeedback } from "@/lib/actionFeedback";
import { showAppAlert } from "@/lib/appDialogs";
import {
  dismissBotViewerInterface,
  pressBotViewerButton,
  readBotViewerInterfaces,
  waitForBotViewerAnswer,
  type BotViewerInterface,
} from "@/lib/botViewerInterface";
import { DISABLED_SINK, FOCUS_RING, PRESS_SINK_RAISED } from "@/lib/controlSurface";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type WaitForBotViewerPanel = (callbackId: string, accountId: string, signal?: AbortSignal) => Promise<boolean>;
export interface BotViewerContextValue {
  waitForCallback: WaitForBotViewerPanel;
  signal: () => AbortSignal;
  isCurrent: (accountId?: string) => boolean;
}
export const BotViewerContext = createContext<BotViewerContextValue | null>(null);

interface ViewerState {
  scope: string;
  panels: BotViewerInterface[];
}

export function useBotViewerPanels(chatId: string, accountId: string | null) {
  const scope = `${accountId ?? ""}:${chatId}`;
  const [state, setState] = useState<ViewerState>({ scope, panels: [] });
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const currentScope = useRef(scope);
  const requestNumber = useRef(0);
  const scopeAbort = useRef(new AbortController());
  currentScope.current = scope;
  const panels = useMemo(
    () => state.scope === scope ? state.panels.filter((panel) => panel.expiresAt > Date.now()) : [],
    [scope, state],
  );

  const refresh = useCallback(async (): Promise<BotViewerInterface[] | null> => {
    const sequence = ++requestNumber.current;
    const rows = accountId
      ? await readBotViewerInterfaces(chatId, accountId, scopeAbort.current.signal)
      : null;
    if (currentScope.current !== scope || scopeAbort.current.signal.aborted || sequence !== requestNumber.current) return null;
    setState({ scope, panels: rows ?? [] });
    return rows;
  }, [accountId, chatId, scope]);

  useEffect(() => {
    const abort = new AbortController();
    scopeAbort.current = abort;
    requestNumber.current += 1;
    setState({ scope, panels: [] });
    setPending(new Set());
    void refresh();
    const onReturn = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => { void refresh(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);
    document.addEventListener("visibilitychange", onReturn);
    const { data: authListener } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== accountId) {
        requestNumber.current += 1;
        setState({ scope, panels: [] });
      } else {
        void refresh();
      }
    });
    return () => {
      abort.abort();
      authListener.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [accountId, refresh, scope]);

  useEffect(() => {
    if (!accountId) return;
    const timer = window.setInterval(() => { void refresh(); }, panels.length > 0 ? 5000 : 15000);
    return () => window.clearInterval(timer);
  }, [accountId, panels.length, refresh]);

  useEffect(() => {
    if (panels.length === 0) return;
    const nextExpiry = Math.min(...panels.map((panel) => panel.expiresAt));
    const timer = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        panels: current.panels.filter((panel) => panel.expiresAt > Date.now()),
      }));
    }, Math.max(0, nextExpiry - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [panels]);

  const waitForCallback = useCallback<WaitForBotViewerPanel>(async (callbackId, pressedAccount, signal) => {
    if (!accountId || pressedAccount !== accountId || signal?.aborted) return false;
    const deadline = Date.now() + 6000;
    const followup = async () => {
      while (Date.now() < deadline && !signal?.aborted && currentScope.current === scope) {
        const rows = await refresh();
        if (rows === null) return false;
        if (rows.some((panel) => panel.callbackQueryId === callbackId)) return true;
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(done, Math.min(400, Math.max(0, deadline - Date.now())));
          function done() { signal?.removeEventListener("abort", done); window.clearTimeout(timer); resolve(); }
          signal?.addEventListener("abort", done, { once: true });
          if (signal?.aborted) done();
        });
      }
      return false;
    };
    return Promise.race([
      followup(),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 3200)),
    ]);
  }, [accountId, refresh, scope]);

  const context = useMemo<BotViewerContextValue>(() => ({
    waitForCallback,
    signal: () => scopeAbort.current.signal,
    isCurrent: (pressedAccount) => (pressedAccount === undefined || pressedAccount === accountId)
      && currentScope.current === scope && !scopeAbort.current.signal.aborted,
  }), [accountId, scope, waitForCallback]);

  const press = useCallback(async (panel: BotViewerInterface, key: string) => {
    if (!accountId) return;
    const pendingKey = `${panel.id}:${key}`;
    if (pending.has(pendingKey)) return;
    setPending((previous) => new Set(previous).add(pendingKey));
    try {
      const result = await pressBotViewerButton(panel, key, accountId, scopeAbort.current.signal);
      if (currentScope.current !== scope || result.kind === "cancelled") return;
      if (result.kind === "accepted") {
        const answer = await waitForBotViewerAnswer(result.callbackId, accountId, scopeAbort.current.signal);
        if (currentScope.current !== scope || scopeAbort.current.signal.aborted) return;
        if (answer.alert) showAppAlert(answer.text, "Бот", "alert", accountId);
        else showActionFeedback({ kind: "info", title: answer.text, key: `bot-viewer:${panel.id}:${key}`, ownerUserId: accountId });
      } else {
        showActionFeedback({ kind: "error", title: result.message, key: `bot-viewer:${panel.id}:error`, ownerUserId: accountId });
      }
      void refresh();
    } finally {
      if (currentScope.current === scope) setPending((previous) => {
        const next = new Set(previous);
        next.delete(pendingKey);
        return next;
      });
    }
  }, [accountId, pending, refresh, scope]);

  const dismiss = useCallback(async (panel: BotViewerInterface) => {
    if (!accountId) return;
    const pendingKey = `${panel.id}:dismiss`;
    if (pending.has(pendingKey)) return;
    setPending((previous) => new Set(previous).add(pendingKey));
    try {
      const closed = await dismissBotViewerInterface(panel, accountId, scopeAbort.current.signal);
      if (currentScope.current !== scope || scopeAbort.current.signal.aborted) return;
      if (closed) setState((current) => ({ ...current, panels: current.panels.filter((row) => row.id !== panel.id) }));
      else showActionFeedback({ kind: "error", title: "Не удалось закрыть панель. Попробуйте ещё раз.", key: `bot-viewer:${panel.id}:dismiss`, ownerUserId: accountId });
      void refresh();
    } finally {
      if (currentScope.current === scope) setPending((previous) => {
        const next = new Set(previous);
        next.delete(pendingKey);
        return next;
      });
    }
  }, [accountId, pending, refresh, scope]);

  return { panels, pending, context, press, dismiss };
}

export function BotViewerPanel({ viewer }: { viewer: ReturnType<typeof useBotViewerPanels> }) {
  if (viewer.panels.length === 0) return null;
  return (
    <div
      data-bot-viewer-layer="true"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--kub-composer-height)+112px)] z-30 flex justify-center px-3 sm:bottom-[calc(var(--kub-composer-height)+12px)]"
    >
      <div className="pointer-events-auto flex max-h-[min(52vh,28rem)] w-full max-w-[420px] flex-col gap-2 overflow-y-auto overscroll-contain">
        {viewer.panels.map((panel) => (
          <section
            key={panel.id}
            data-bot-viewer-panel={panel.id}
            role="region"
            aria-label={panel.title}
            className="min-w-0 shrink-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-3 text-[color:var(--kub-text)] shadow-lg"
          >
            <div className="flex min-w-0 items-start gap-2">
              <span title="Видно только вам" className="mt-0.5 shrink-0 text-[color:var(--kub-cyan)]">
                <KubIcon name="lock" size={16} />
              </span>
              <h2 className="min-w-0 flex-1 break-words text-sm font-semibold leading-5">{panel.title}</h2>
              <button
                type="button"
                aria-label="Закрыть"
                title="Закрыть"
                disabled={viewer.pending.has(`${panel.id}:dismiss`)}
                onClick={() => void viewer.dismiss(panel)}
                className={cn("kub-interactive -m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11", FOCUS_RING, DISABLED_SINK)}
              >
                <KubIcon name={viewer.pending.has(`${panel.id}:dismiss`) ? "spinner" : "close"} size={16} />
              </button>
            </div>
            {panel.body && <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-[color:var(--kub-muted)]">{panel.body}</p>}
            {panel.progress !== null && (
              <div className="mt-3 flex items-center gap-2" role="progressbar" aria-label="Выполнение" aria-valuemin={0} aria-valuemax={100} aria-valuenow={panel.progress}>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:var(--kub-border-color)]">
                  <div className="h-full rounded-full bg-[color:var(--kub-cyan)] transition-[width] motion-reduce:transition-none" style={{ width: `${panel.progress}%` }} />
                </div>
                <span className="w-9 text-right text-xs tabular-nums text-[color:var(--kub-muted)]">{panel.progress}%</span>
              </div>
            )}
            {panel.buttons.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {panel.buttons.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex min-w-0 gap-1.5">
                    {row.map((button) => {
                      const busy = viewer.pending.has(`${panel.id}:${button.key}`);
                      return (
                        <button
                          key={button.key}
                          type="button"
                          disabled={busy}
                          onClick={() => void viewer.press(panel, button.key)}
                          className={cn("kub-interactive kub-raise flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-md bg-transparent px-2 py-1.5 text-center text-[13px] font-medium leading-tight text-[color:var(--kub-text)] hover:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil)),linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))] [@media(pointer:coarse)]:min-h-11", FOCUS_RING, DISABLED_SINK, PRESS_SINK_RAISED)}
                        >
                          {busy && <KubIcon name="spinner" size={14} className="mr-1.5 shrink-0 animate-spin" />}
                          <span className="min-w-0 break-words">{button.text}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
