import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ui] app render failed:", error, errorInfo);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-[var(--kub-bg)] text-[color:var(--kub-text)] kub-grid-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-6 text-center shadow-2xl">
          <h1 className="text-lg font-semibold">Произошла ошибка интерфейса</h1>
          <p className="mt-2 text-sm text-[color:var(--kub-muted)]">
            Обновите страницу. Если ошибка повторится, сообщите администратору.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-5 text-sm font-semibold text-[color:var(--kub-bg)] transition hover:brightness-110"
          >
            Обновить
          </button>
        </div>
      </main>
    );
  }
}
