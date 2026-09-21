type SessionSignal = { session: unknown; error: unknown };

/** Auth callbacks signal synchronously; SDK reads only happen at boot/resume. */
export function attachNativeVoiceLifecycle(
  controller: { signalSession(value: unknown): void; invalidate(): void; stop(): void },
  source: {
    subscribe(callback: (session: unknown) => void): () => void;
    getSession(): Promise<SessionSignal>;
    onResume(callback: () => void): () => void;
  },
): () => void {
  let revision = 0;
  let stopped = false;
  const unsubscribe = source.subscribe((session) => {
    if (stopped) return;
    ++revision;
    controller.signalSession(session);
  });
  const read = async () => {
    const ticket = ++revision;
    try {
      const result = await source.getSession();
      if (!stopped && ticket === revision) controller.signalSession(result.error ? null : result.session);
    } catch {
      if (!stopped && ticket === revision) controller.signalSession(null);
    }
  };
  const offResume = source.onResume(() => {
    if (stopped) return;
    controller.invalidate();
    void read();
  });
  void read();
  return () => {
    stopped = true;
    ++revision;
    unsubscribe();
    offResume();
    controller.stop();
  };
}
