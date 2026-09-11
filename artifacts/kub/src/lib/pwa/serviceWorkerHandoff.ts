/**
 * How a page and a waiting service worker agree that they are the same build.
 *
 * Every deploy now installs a new worker (see `serviceWorkerBuild.ts`), and a
 * new worker waits while an older one still controls a page. Without this, the
 * waiting worker announced "Доступно обновление" to every page it found — including
 * the page that had just loaded the new build from the network, which is every
 * first launch after a deploy. The page would be asked to update to the build
 * it was already running, and accepting would reload it for nothing.
 *
 * So the page asks first. It names the module entry it booted; the worker says
 * whether that is its own build, and when the asking page is the only window of
 * this origin it takes over on the spot — nothing else can be holding on to the
 * previous build's cache, and the page already runs the new code, so there is
 * nothing to reload. With several windows it waits for them to close, because
 * one of the others may still be an old build lazy-loading its chunks from the
 * old cache. A page that is not the worker's build is still told an update is
 * waiting, exactly as before.
 *
 * Any failure — no entry, an old worker that does not know the message, no
 * answer in time — falls back to announcing, which is the behaviour this
 * replaced. Being wrong here costs one unnecessary prompt, never a stuck page.
 */

export const KUB_SW_HANDOFF_MESSAGE = "KUB_SW_HANDOFF";
export const KUB_SW_HANDOFF_RESULT = "KUB_SW_HANDOFF_RESULT";
export const KUB_SW_HANDOFF_TIMEOUT_MS = 3000;

export type HandoffResult = {
  /** The waiting worker's build id. */
  build: string;
  /** The asking page runs the worker's own build. */
  current: boolean;
  /** The worker took over, so there is no longer anything waiting. */
  activated: boolean;
};

/**
 * The module entry this page booted, in the same terms the build records it:
 * the first module script served from this origin's `/assets/`.
 *
 * `null` in the dev server, whose entry is `/src/main.tsx` — which makes the
 * page announce, as it always did.
 */
export function pageEntryPath(scriptSources: readonly string[], origin: string): string | null {
  for (const source of scriptSources) {
    let url: URL;
    try {
      url = new URL(source, origin);
    } catch {
      continue;
    }
    if (url.origin === origin && url.pathname.includes("/assets/")) return url.pathname;
  }
  return null;
}

export function parseHandoffResult(value: unknown): HandoffResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== KUB_SW_HANDOFF_RESULT) return null;
  if (typeof record.build !== "string" || typeof record.current !== "boolean" || typeof record.activated !== "boolean") {
    return null;
  }
  return { build: record.build, current: record.current, activated: record.activated };
}

/** Asks a waiting worker whether this page is its build. Never rejects. */
export function requestHandoff(
  worker: { postMessage(message: unknown, transfer: Transferable[]): void },
  entry: string,
  timeoutMs: number = KUB_SW_HANDOFF_TIMEOUT_MS,
): Promise<HandoffResult | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (result: HandoffResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => finish(parseHandoffResult(event.data));
    try {
      worker.postMessage({ type: KUB_SW_HANDOFF_MESSAGE, entry }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/** Whether the page still has to be told that an update is waiting. */
export function shouldAnnounceWaitingWorker(result: HandoffResult | null): boolean {
  return result?.current !== true;
}

/**
 * How long to wait before asking again, after an answer that neither offered
 * an update nor took over; `null` when there is nothing left to ask.
 *
 * "Keep waiting" is the answer while another window is open — and, briefly,
 * right after one closes: a browser keeps a closed window in the worker's list
 * of clients for a moment. Measured in Chromium, a page opened straight after
 * the previous one closed asked once, was told to wait, and never asked again,
 * so a first launch after a deploy stayed on the old worker until the launch
 * after it. A few spaced questions close that gap. After the last one, a window
 * that is still open is a real window, and the next launch takes over.
 */
export const KUB_SW_HANDOFF_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 10_000];

export function nextHandoffDelay(result: HandoffResult | null, attempt: number): number | null {
  if (!result || !result.current || result.activated) return null;
  return KUB_SW_HANDOFF_RETRY_DELAYS_MS[attempt] ?? null;
}
