"use client";

export function TypingIndicator({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-1.5 ml-10 mb-1">
      <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-bl-sm bg-[var(--kub-message-in)] border border-[color:var(--kub-border-color)]">
        <span className="w-1.5 h-1.5 rounded-full typing-dot bg-[color:var(--kub-muted)]" />
        <span className="w-1.5 h-1.5 rounded-full typing-dot bg-[color:var(--kub-muted)]" />
        <span className="w-1.5 h-1.5 rounded-full typing-dot bg-[color:var(--kub-muted)]" />
      </div>
      {name && (
        <span className="text-xs text-[color:var(--kub-muted)]">
          {name} печатает…
        </span>
      )}
    </div>
  );
}
