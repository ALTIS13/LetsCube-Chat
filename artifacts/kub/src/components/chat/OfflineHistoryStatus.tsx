export function OfflineHistoryStatus({ topInset }: { topInset: number }) {
  return (
    <div data-testid="offline-history-status" role="status"
      style={{ top: topInset + 8 }}
      className="pointer-events-none absolute inset-x-0 z-10 mx-auto w-fit max-w-[90%] rounded-md bg-[var(--kub-surface)] px-3 py-1 text-center text-xs text-[var(--kub-muted)]">
      Сохранённая история
    </div>
  );
}
