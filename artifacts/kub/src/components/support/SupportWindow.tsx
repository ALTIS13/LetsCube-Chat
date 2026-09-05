"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import { KUB_SUPPORT_WINDOW_OPEN_EVENT } from "@/lib/supportWindowEvents";
import {
  DOCK_BREAKPOINT,
  clampPosition,
  isDocked,
  readStoredPlacement,
  resolvePlacement,
  writeStoredPlacement,
  type Point,
  type WindowPlacement,
} from "@/lib/floatingWindow";
import {
  OPEN_TICKET_STATUSES,
  SUPPORT_CATEGORIES,
  createTicket,
  listMyTickets,
  listTicketMessages,
  sendTicketMessage,
  supportErrorMessage,
  type UserSupportMessage,
  type UserSupportTicket,
  type UserTicketStatus,
} from "@/lib/support/userTickets";

const STATUS_LABELS: Record<UserTicketStatus, string> = {
  new: "Отправлено",
  in_progress: "В работе",
  waiting_user: "Ждём вас",
  waiting_support: "У поддержки",
  escalated: "Передано",
  resolved: "Решено",
  closed: "Закрыто",
  spam: "Отклонено",
};

function statusTone(status: UserTicketStatus): string {
  if (status === "waiting_user") return "text-[color:var(--kub-warn)]";
  if (status === "resolved" || status === "closed") return "text-[color:var(--kub-muted)]";
  return "text-[color:var(--kub-accent-text)]";
}

function viewportSize() {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function formatWhen(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  return sameDay
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * The support desk, as a window the person can move out of the way.
 *
 * It is a window rather than a page on purpose: a support conversation happens
 * *about* something on screen, and sending someone to a separate route to ask
 * about it takes away the thing they were asking about. Everything here is
 * their own — their tickets, their history — read through RLS, so no operator
 * data or anyone else's conversation can appear in it.
 */
export function SupportWindow() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<WindowPlacement>(() =>
    resolvePlacement(readStoredPlacement(), viewportSize()),
  );
  const [docked, setDocked] = useState(() => isDocked(viewportSize()));
  const [tickets, setTickets] = useState<UserSupportTicket[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UserSupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>(SUPPORT_CATEGORIES[0].value);

  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(KUB_SUPPORT_WINDOW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(KUB_SUPPORT_WINDOW_OPEN_EVENT, onOpen);
  }, []);

  // A resize or a rotation can strand the window off screen; put it back.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const viewport = viewportSize();
      setDocked(isDocked(viewport));
      setPlacement((current) => resolvePlacement(current, viewport));
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const refreshTickets = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await listMyTickets(userId);
      setTickets(rows);
      setActiveId((current) => current ?? rows.find((row) => OPEN_TICKET_STATUSES.includes(row.status))?.id ?? rows[0]?.id ?? null);
      if (rows.length === 0) setComposing(true);
    } catch (loadError) {
      setError(supportErrorMessage(loadError));
    }
  }, [userId]);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    void refreshTickets().finally(() => setLoading(false));
  }, [open, userId, refreshTickets]);

  useEffect(() => {
    if (!open || !activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void listTicketMessages(activeId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((loadError) => {
        if (!cancelled) setError(supportErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeId]);

  // A reply from support has to arrive without the person reopening anything.
  useEffect(() => {
    if (!open || !activeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`support-window:${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_ticket_messages",
          filter: `ticket_id=eq.${activeId}`,
        },
        () => {
          void listTicketMessages(activeId).then(setMessages).catch(() => undefined);
          void refreshTickets();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, activeId, refreshTickets]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (docked || event.button !== 0) return;
    // The close and new-request buttons live in the handle. Capturing the
    // pointer for a drag redirects every later pointer event to the handle, so
    // the button never receives its click — the window became unclosable.
    if ((event.target as HTMLElement).closest("button")) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      start: placement.position,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPlacement((current) => ({
      ...current,
      position: clampPosition(
        {
          x: drag.start.x + (event.clientX - drag.origin.x),
          y: drag.start.y + (event.clientY - drag.origin.y),
        },
        current.size,
        viewportSize(),
      ),
    }));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    writeStoredPlacement(placement);
  };

  const activeTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === activeId) ?? null,
    [tickets, activeId],
  );
  const canReply =
    activeTicket !== null && activeTicket.status !== "closed" && activeTicket.status !== "spam";

  const submitNewTicket = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createTicket({ category, subject, message: draft });
      setSubject("");
      setDraft("");
      setComposing(false);
      await refreshTickets();
      setActiveId(created.id);
    } catch (submitError) {
      setError(supportErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async () => {
    if (busy || !activeId || !draft.trim()) return;
    setBusy(true);
    setError("");
    const body = draft.trim();
    try {
      await sendTicketMessage(activeId, body);
      setDraft("");
      setMessages(await listTicketMessages(activeId));
      await refreshTickets();
    } catch (sendError) {
      setError(supportErrorMessage(sendError));
    } finally {
      setBusy(false);
    }
  };

  if (!open || !userId) return null;

  const frameStyle = docked
    ? undefined
    : {
        left: `${placement.position.x}px`,
        top: `${placement.position.y}px`,
        width: `${placement.size.width}px`,
        height: `${placement.size.height}px`,
      };

  return (
    <div
      role="dialog"
      aria-label="Поддержка"
      data-testid="support-window"
      data-docked={docked ? "true" : "false"}
      className={cn(
        // `-strong` in both shapes: floating it covers the conversation, and
        // docked it covers the whole screen.
        "kub-glass-strong fixed z-[70] flex flex-col overflow-hidden border border-[color:var(--kub-border-color)]",
        docked
          ? "inset-x-0 bottom-0 top-0 rounded-none"
          : "rounded-2xl",
      )}
      style={frameStyle}
    >
      <div
        data-testid="support-window-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          // The veil, not a fill. The window is frosted, so an opaque strip
          // across its top both cancels the material there and pins the title
          // bar to an elevation the window itself has moved past.
          "kub-raise flex shrink-0 items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-2",
          docked ? "" : "cursor-grab active:cursor-grabbing select-none",
        )}
        style={docked ? undefined : { paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <KubIcon name="help" size={16} className="text-[color:var(--kub-cyan)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">Поддержка</div>
          {activeTicket && !composing && (
            <div className="truncate text-[12px] text-[color:var(--kub-muted)]">
              {activeTicket.publicReference} ·{" "}
              <span className={statusTone(activeTicket.status)}>
                {STATUS_LABELS[activeTicket.status]}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Новое обращение"
          onClick={() => {
            setComposing(true);
            setDraft("");
            setError("");
          }}
          className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
        >
          <KubIcon name="create" size={16} />
        </button>
        <button
          type="button"
          aria-label="Закрыть поддержку"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>

      {tickets.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[color:var(--kub-border-color)] px-2 py-1.5">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => {
                setActiveId(ticket.id);
                setComposing(false);
                setError("");
              }}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1 text-xs transition-colors",
                ticket.id === activeId && !composing
                  ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-text)]"
                  : "text-[color:var(--kub-muted)] kub-raise-hover",
              )}
              title={ticket.subject}
            >
              <span className="max-w-[9rem] truncate inline-block align-bottom">
                {ticket.subject}
              </span>
            </button>
          ))}
        </div>
      )}

      {composing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <label className="text-xs text-[color:var(--kub-muted)]">
            Тема
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={180}
              placeholder="Коротко о проблеме"
              className="mt-1 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            />
          </label>
          <label className="text-xs text-[color:var(--kub-muted)]">
            Раздел
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            >
              {SUPPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-0 flex-1 flex-col text-xs text-[color:var(--kub-muted)]">
            Что произошло
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={8000}
              placeholder="Опишите, что случилось и что вы делали до этого"
              className="mt-1 min-h-[7rem] flex-1 resize-none rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            />
          </label>
          {error && <p className="text-xs text-[color:var(--kub-danger-text)]">{error}</p>}
          <div className="flex shrink-0 gap-2">
            {tickets.length > 0 && (
              <KubButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setComposing(false);
                  setError("");
                }}
              >
                Отмена
              </KubButton>
            )}
            <KubButton
              size="sm"
              className="flex-1"
              disabled={busy || subject.trim().length < 3 || draft.trim().length === 0}
              onClick={() => void submitNewTicket()}
            >
              Отправить
            </KubButton>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={threadRef}
            data-testid="support-thread"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
          >
            {loading && (
              <p className="text-center text-xs text-[color:var(--kub-muted)]">Загружаем…</p>
            )}
            {!loading && messages.length === 0 && (
              <p className="text-center text-xs text-[color:var(--kub-muted)]">
                Пока сообщений нет.
              </p>
            )}
            {messages.map((message) => {
              const mine = message.authorKind === "requester";
              return (
                <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                      // Both bubbles composite over the window rather than
                      // replacing it: the person's own already mixed its cyan
                      // into transparent, and support's now takes the veil so
                      // the pair sit at the same distance from the glass.
                      mine
                        ? "bg-[color-mix(in_srgb,var(--kub-cyan)_22%,transparent)] text-[color:var(--kub-text)]"
                        : "kub-raise text-[color:var(--kub-text)]",
                    )}
                  >
                    {!mine && (
                      <div className="mb-0.5 text-[12px] text-[color:var(--kub-accent-text)]">
                        Поддержка
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    {/* `--kub-text`, not `--kub-muted`, and it is the ink that
                        changed rather than the bubble. Both bubbles here are
                        translucent over a window that floats above whatever the
                        messenger happens to be showing, so their ground is not
                        a fixed value the way an opaque chat bubble's is.
                        Photographed at 10px: the muted grey measured 4.44:1 in
                        the dark theme and 4.30:1 in the light one on the fill
                        the product paints, and 3.98:1 and 3.86:1 against the
                        worst ground this window can reach. Every fill that
                        would have rescued the grey either failed the same worst
                        ground or went flush with the window — `--kub-message-out`
                        composited to within 1.01 of it in the dark theme, which
                        is a bubble you cannot see. This measures 10.06:1 and
                        13.94:1. */}
                    <div className="mt-0.5 text-right text-[12px] text-[color:var(--kub-text)]">
                      {formatWhen(message.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="shrink-0 border-t border-[color:var(--kub-border-color)] p-2"
            style={
              docked
                ? { paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }
                : undefined
            }
          >
            {error && <p className="px-1 pb-1 text-xs text-[color:var(--kub-danger-text)]">{error}</p>}
            {canReply ? (
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitReply();
                    }
                  }}
                  rows={1}
                  maxLength={8000}
                  placeholder="Сообщение поддержке"
                  aria-label="Сообщение поддержке"
                  className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                />
                <KubButton
                  size="sm"
                  aria-label="Отправить"
                  disabled={busy || draft.trim().length === 0}
                  onClick={() => void submitReply()}
                >
                  <KubIcon name="send" size={16} />
                </KubButton>
              </div>
            ) : (
              <p className="px-1 py-1 text-center text-xs text-[color:var(--kub-muted)]">
                Обращение закрыто. Создайте новое, если нужна помощь.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { DOCK_BREAKPOINT };
