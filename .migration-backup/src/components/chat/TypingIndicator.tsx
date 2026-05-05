"use client";

export function TypingIndicator({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-1.5 ml-10 mb-1">
      <div
        className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-bl-sm"
        style={{ background: "var(--tg-message-in)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full typing-dot"
          style={{ background: "var(--tg-text-secondary)" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full typing-dot"
          style={{ background: "var(--tg-text-secondary)" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full typing-dot"
          style={{ background: "var(--tg-text-secondary)" }}
        />
      </div>
      {name && (
        <span className="text-xs" style={{ color: "var(--tg-text-secondary)" }}>
          {name} печатает…
        </span>
      )}
    </div>
  );
}
