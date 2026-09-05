import { useCallback, useEffect, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { PublicPageShell } from "./PublicPageShell";
import { SupportRequestForm } from "./SupportRequestForm";
import { GuestSupportChat } from "./GuestSupportChat";
import { guestSupportSessionStore } from "@/lib/support/guestSessionStore";
import {
  createSupportTicket,
  loadGuestSupportTicket,
  revokeGuestSupportSession,
} from "@/lib/support/supportGateway";
import { SupportGatewayError, getSupportErrorMessage } from "@/lib/support/errors";
import type {
  GuestSupportSession,
  NormalizedSupportRequest,
  PublicSupportTicket,
} from "@/lib/support/types";

export function SupportPage() {
  const [session, setSession] = useState<GuestSupportSession | null>(null);
  const [ticket, setTicket] = useState<PublicSupportTicket | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const scrollRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Поддержка — LETSCUBE";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void guestSupportSessionStore
      .load()
      .then(async (savedSession) => {
        if (!savedSession || cancelled) return;
        try {
          const savedTicket = await loadGuestSupportTicket(savedSession);
          if (cancelled) return;
          setSession(savedSession);
          setTicket(savedTicket);
        } catch (requestError) {
          if (
            requestError instanceof SupportGatewayError &&
            ["session_expired", "session_invalid", "forbidden"].includes(requestError.code)
          ) {
            await guestSupportSessionStore.clear();
          } else if (!cancelled) {
            setError(
              requestError instanceof Error
                ? requestError.message
                : getSupportErrorMessage("service_unavailable"),
            );
          }
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || !ticket) return;
    const interval = window.setInterval(() => {
      void loadGuestSupportTicket(session)
        .then((updated) => {
          setTicket(updated);
          setError("");
        })
        .catch(() => {
          // A temporary polling failure should not discard the local session or interrupt typing.
        });
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [session, ticket?.id]);

  useEffect(() => {
    if (!ticket?.id) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRootRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ticket?.id]);

  const createTicket = async (request: NormalizedSupportRequest) => {
    setSubmitting(true);
    setError("");
    try {
      const created = await createSupportTicket(request);
      await guestSupportSessionStore.save(created.session);
      setSession(created.session);
      setTicket(created.ticket);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : getSupportErrorMessage("service_unavailable"),
      );
      throw requestError;
    } finally {
      setSubmitting(false);
    }
  };

  const forgetTicket = useCallback(async () => {
    if (session) {
      try {
        await revokeGuestSupportSession(session);
      } catch {
        // Local removal is still required when the server is temporarily unavailable.
      }
    }
    await guestSupportSessionStore.clear();
    setSession(null);
    setTicket(null);
    setError("");
  }, [session]);

  return (
    <PublicPageShell scrollRootRef={scrollRootRef}>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--kub-pink)]">
            Связь с командой
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-[color:var(--kub-text)] sm:text-4xl">
            Поддержка LETSCUBE
          </h1>
          <p className="mt-4 text-sm leading-7 text-[color:var(--kub-muted)] sm:text-base">
            Опишите ситуацию и сразу продолжите общение с оператором в защищённом чате.
            Контактные данные нужны только для обратной связи и поиска клиента, если это потребуется.
          </p>
        </header>

        {restoring ? (
          <div className="flex min-h-80 items-center justify-center" aria-label="Восстановление обращения">
            <KubIcon name="spinner" size={24} tone="accent" />
          </div>
        ) : ticket && session ? (
          <GuestSupportChat
            ticket={ticket}
            session={session}
            onTicketChange={setTicket}
            onForget={forgetTicket}
          />
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,760px)_minmax(260px,1fr)]">
            <SupportRequestForm busy={submitting} error={error} onSubmit={createTicket} />
            <aside className="space-y-6 lg:sticky lg:top-24">
              <SupportFact
                icon="clock"
                title="Чат откроется сразу"
                text="Ссылка из письма не требуется. Доступ к обращению сохранится только на этом устройстве."
              />
              <SupportFact
                icon="shield"
                title="Не отправляйте секреты"
                text="Оператору не нужны пароль, одноразовый код, приватный ключ или данные банковской карты."
              />
              <SupportFact
                icon="mail"
                title="Ответ по контактам"
                text="Email и телефон в публичной форме считаются неподтверждёнными, пока пользователь не подтвердил их отдельно."
              />
              <p className="border-t border-[color:var(--kub-border-color)] pt-5 text-xs leading-5 text-[color:var(--kub-muted)]">
                Почта поддержки:{" "}
                <a className="font-semibold text-[color:var(--kub-accent-text)]" href="mailto:support@app.letscube.ru">
                  support@app.letscube.ru
                </a>
              </p>
            </aside>
          </div>
        )}
      </main>
    </PublicPageShell>
  );
}

function SupportFact({
  icon,
  title,
  text,
}: {
  icon: "clock" | "shield" | "mail";
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 border-b border-[color:var(--kub-border-color)] pb-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]">
        <KubIcon name={icon} size={17} />
      </span>
      <div>
        <h2 className="text-sm font-bold text-[color:var(--kub-text)]">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">{text}</p>
      </div>
    </div>
  );
}
