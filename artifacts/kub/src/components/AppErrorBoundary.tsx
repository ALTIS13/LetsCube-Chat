import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  isChunkLoadError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, isChunkLoadError: false };

  private handleUserRequestedReload = () => {
    window.location.reload();
  };

  private handleUserRequestedRetry = () => {
    this.setState({ hasError: false, isChunkLoadError: false });
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { hasError: true, isChunkLoadError: isChunkLoadError(error) };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    reportError(error, {
      category: "react_error_boundary",
      componentStack: errorInfo.componentStack,
      chunkLoad: isChunkLoadError(error),
    });
    if (import.meta.env.DEV) {
      console.error("[ui] app render failed:", error, errorInfo);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-[var(--kub-bg)] text-[color:var(--kub-text)] kub-grid-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-6 text-center shadow-2xl">
          <h1 className="text-lg font-semibold">
            {this.state.isChunkLoadError ? "Приложение обновилось" : "Произошла ошибка интерфейса"}
          </h1>
          <p className="mt-2 text-sm text-[color:var(--kub-muted)]">
            {this.state.isChunkLoadError
              ? "Приложение обновилось. Нужно перезагрузить страницу."
              : "Попробуйте восстановить интерфейс. Если ошибка повторится, сообщите администратору."}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={this.handleUserRequestedRetry}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-5 text-sm font-semibold text-[color:var(--kub-bg)] transition hover:brightness-110"
            >
              Попробовать снова
            </button>
            <button
              type="button"
              onClick={this.handleUserRequestedReload}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[color:var(--kub-border-color)] px-5 text-sm font-semibold text-[color:var(--kub-text)] transition hover:bg-[var(--kub-surface-2)]"
            >
              Обновить страницу
            </button>
          </div>
        </div>
      </main>
    );
  }
}

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(message);
}
