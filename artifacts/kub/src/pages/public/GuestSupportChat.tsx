import { useMemo, useState, type FormEvent } from "react";
import { KubBadge, KubButton, KubIcon, KubPanel } from "@/components/kub";
import { SUPPORT_CATEGORY_LABELS, type GuestSupportSession, type PublicSupportTicket } from "@/lib/support/types";
import { getSupportErrorMessage } from "@/lib/support/errors";
import { sendGuestSupportMessage } from "@/lib/support/supportGateway";
import { useConversationScroll } from "@/lib/support/useConversationScroll";

interface GuestSupportChatProps {
  ticket: PublicSupportTicket;
  session: GuestSupportSession;
  onTicketChange: (ticket: PublicSupportTicket) => void;
  onForget: () => Promise<void>;
}

const STATUS_LABELS: Record<PublicSupportTicket["status"], string> = {
  new: "Ожидает оператора",
  in_progress: "В работе",
  waiting_user: "Ждём ваш ответ",
  waiting_support: "Ожидает поддержки",
  escalated: "Передано старшему",
  resolved: "Решено",
  closed: "Закрыто",
  spam: "Закрыто",
};

export function GuestSupportChat({
  ticket,
  session,
  onTicketChange,
  onForget,
}: GuestSupportChatProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState("");
  const expiresLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
      }).format(new Date(session.idleExpiresAt)),
    [session.idleExpiresAt],
  );
  const lastMessage = ticket.messages.at(-1) ?? null;
  const { scrollRef, contentRef, hasNewMessages, handleScroll, scrollToLatest } = useConversationScroll({
    conversationKey: ticket.id,
    messageCount: ticket.messages.length,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageOwned: lastMessage?.authorType === "guest" || lastMessage?.authorType === "user",
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body) return;
    if (body.length > 4_000) {
      setError("Сообщение слишком длинное.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await sendGuestSupportMessage(session, body);
      onTicketChange(updated);
      setMessage("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : getSupportErrorMessage("service_unavailable"),
      );
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setForgetting(true);
    setError("");
    try {
      await onForget();
    } catch {
      setError("Не удалось закрыть доступ к обращению. Попробуйте позже.");
    } finally {
      setForgetting(false);
    }
  };

  return (
    <KubPanel className="flex h-[clamp(28rem,72dvh,44rem)] min-h-0 w-full min-w-0 flex-col overflow-hidden p-0" data-testid="guest-support-chat">
      <header className="border-b border-[color:var(--kub-border-color)] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-pink)]">
              Обращение {ticket.publicReference}
            </p>
            <h2 className="mt-1 break-words text-lg font-bold text-[color:var(--kub-text)]">
              {ticket.subject}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
              {SUPPORT_CATEGORY_LABELS[ticket.category]}
            </p>
          </div>
          <KubBadge tone={ticket.status === "waiting_user" ? "warn" : "cyan"}>
            {STATUS_LABELS[ticket.status]}
          </KubBadge>
        </div>
      </header>

      {/* No fill. The panel around this is the material; a translucent
          --kub-bg painted by hand across its middle covered the frosting over
          the whole conversation and left it showing only in the header and the
          composer strips. The bubbles carry their own elevation instead. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-testid="guest-support-scroll"
          className="h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
          aria-live="polite"
        >
          <div ref={contentRef} className="space-y-3">
        {ticket.messages.map((item) => {
          const own = item.authorType === "guest" || item.authorType === "user";
          const system = item.authorType === "system";
          return (
            <div
              key={item.id}
              className={system ? "flex justify-center" : `flex ${own ? "justify-end" : "justify-start"}`}
            >
              <div
                // The veil, not --kub-surface-2: a bubble has to be found
                // against the panel it lies on, and that panel is translucent,
                // so its composited value depends on what is behind the page.
                // An absolute colour chosen against one of those values is
                // flush against the next. Deliberately not glass either —
                // there is one blur per bubble to pay for on every scrolled
                // frame, to reveal the panel that is already right behind it.
                className={
                  system
                    ? "kub-raise max-w-xl rounded-md px-3 py-2 text-center text-xs text-[color:var(--kub-muted)]"
                    : `max-w-[88%] rounded-md px-3 py-2.5 text-sm leading-6 sm:max-w-[72%] ${
                        own
                          ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                          : "kub-raise border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]"
                      }`
                }
              >
                {!system && (
                  <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${own ? "opacity-70" : "text-[color:var(--kub-muted)]"}`}>
                    {own ? "Вы" : "Поддержка LETSCUBE"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{item.body}</p>
              </div>
            </div>
          );
        })}
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

      <form onSubmit={submit} className="border-t border-[color:var(--kub-border-color)] p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={2}
            maxLength={4_000}
            placeholder="Напишите сообщение оператору"
            // --kub-inset: a composer field is cut into the panel holding it,
            // the same way the application's own composer is.
            className="min-h-11 flex-1 resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2.5 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          />
          <KubButton
            type="submit"
            size="icon"
            loading={busy}
            disabled={!message.trim()}
            aria-label="Отправить сообщение"
          >
            <KubIcon name="send" size={17} />
          </KubButton>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-[color:var(--kub-danger-text)]">{error}</p>}
        <div className="mt-3 flex flex-col gap-2 text-[10px] leading-4 text-[color:var(--kub-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>Доступ на этом устройстве действует при активности до {expiresLabel}.</p>
          <button
            type="button"
            onClick={forget}
            disabled={forgetting}
            className="self-start font-semibold text-[color:var(--kub-danger-text)] hover:brightness-110 disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed sm:self-auto"
          >
            {forgetting ? "Закрываем доступ…" : "Забыть обращение на устройстве"}
          </button>
        </div>
      </form>
    </KubPanel>
  );
}
