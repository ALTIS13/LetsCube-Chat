import { useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import type { SupportTicketMessage } from "@/lib/support/operatorApi";
import { useConversationScroll } from "@/lib/support/useConversationScroll";
import { cn } from "@/lib/utils";

interface SupportConversationProps {
  conversationKey: string;
  messages: SupportTicketMessage[];
  canReply: boolean;
  replyAvailable: boolean;
  busy: boolean;
  onReply: (body: string) => Promise<boolean>;
}

export function SupportConversation({
  conversationKey,
  messages,
  canReply,
  replyAvailable,
  busy,
  onReply,
}: SupportConversationProps) {
  const [body, setBody] = useState("");
  const lastMessage = messages.at(-1) ?? null;
  const { scrollRef, contentRef, hasNewMessages, handleScroll, scrollToLatest } = useConversationScroll({
    conversationKey,
    messageCount: messages.length,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageOwned: lastMessage?.authorKind === "operator",
  });

  const submit = async () => {
    const value = body.trim();
    if (!value || value.length > 8_000) return;
    const sent = await onReply(value);
    if (sent) setBody("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Переписка по обращению">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-testid="support-ticket-scroll"
          className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        >
          <div ref={contentRef} className="space-y-3">
        {messages.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <KubIcon name="chatBubble" size={28} tone="muted" />
            <p className="mt-3 text-sm text-[color:var(--kub-muted)]">
              В обращении пока нет сообщений.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const operator = message.authorKind === "operator";
            const system = message.authorKind === "system";
            return (
              <article
                key={message.id}
                className={cn(
                  "max-w-[88%] rounded-xl border px-3 py-2.5",
                  operator
                    ? "ml-auto border-[color:var(--kub-cyan)]/30 bg-[color-mix(in_srgb,var(--kub-cyan)_12%,var(--kub-surface-2))]"
                    : system
                      ? "mx-auto max-w-[94%] border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-center"
                      : "mr-auto border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
                  <span>
                    {operator
                      ? "Оператор"
                      : system
                        ? "Система"
                        : message.authorKind === "email"
                          ? "Письмо клиента"
                          : "Клиент"}
                  </span>
                  <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--kub-text)]">
                  {message.body}
                </p>
              </article>
            );
          })
        )}
          </div>
        </div>
        {hasNewMessages ? (
          <KubButton
            type="button"
            size="sm"
            variant="secondary"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-lg"
            leftIcon={<KubIcon name="chevronDown" size={14} />}
            onClick={() => scrollToLatest()}
          >
            Новые сообщения
          </KubButton>
        ) : null}
      </div>

      <div className="flex-shrink-0 border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-3">
        {!canReply ? (
          <p className="rounded-lg bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            Для ответа требуется право «Ответы поддержки».
          </p>
        ) : !replyAvailable ? (
          <p className="rounded-lg border border-[color:var(--kub-warn)]/30 bg-[color-mix(in_srgb,var(--kub-warn)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
            Сначала примите обращение или откройте назначенное вам обращение.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ответ клиенту</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={8_000}
                rows={2}
                placeholder="Напишите ответ клиенту…"
                className="max-h-36 min-h-12 w-full resize-y rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none transition-colors placeholder:text-[color:var(--kub-muted)] focus:border-[color:var(--kub-cyan)]"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
            </label>
            <KubButton
              type="button"
              size="icon"
              loading={busy}
              disabled={!body.trim()}
              aria-label="Ответить"
              onClick={() => void submit()}
            >
              <KubIcon name="send" size={16} />
            </KubButton>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
