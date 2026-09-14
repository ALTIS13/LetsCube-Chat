"use client";

import { useEffect, useState } from "react";

import { KubIcon, KubModal } from "@/components/kub";
import { showActionFeedback } from "@/lib/actionFeedback";
import { DISABLED_SINK_FILLED, DISABLED_TEXT, FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import {
  REPORT_NOTE_LABEL,
  REPORT_NOTE_MAX,
  REPORT_NOTE_PLACEHOLDER,
  REPORT_REASONS,
  REPORT_SENT_DETAIL,
  REPORT_SENT_TITLE,
  REPORT_STAFF_NOTICE,
  reportDialogTitle,
  reportNoteRemaining,
  type ReportKind,
  type ReportReasonId,
} from "@/lib/personalModeration";
import { submitContentReport } from "@/hooks/usePersonalModeration";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";

/**
 * «Пожаловаться», for a message and for a person.
 *
 * One picker for both, because a report is one row of one table whatever was
 * pressed to raise it: the six reasons are the six `content_reports_reason_check`
 * allows, and the note is the column's own 1000 characters.
 *
 * It is raised through an event rather than mounted per surface, the way
 * `requestAppConfirm` is. Three places can ask for it — a message's menu, a
 * private chat's header menu and the contact card — and all three sit inside
 * `ChatWindow`, which mounts the single host below. A dialog per surface would
 * be three copies of the same state and, on a phone, three chances for two of
 * them to be open at once.
 */

const REPORT_REQUEST_EVENT = "kub:content-report";

export interface ContentReportRequest {
  kind: ReportKind;
  targetUserId: string;
  /** Whose message or profile it is, for the dialog's own line. */
  targetName: string;
  /** Required when `kind` is «message»; the queue has to be able to open it. */
  messageId?: string | null;
  chatId?: string | null;
}

/** Asks for the picker. Safe from anywhere, including a menu item's handler. */
export function requestContentReport(request: ContentReportRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ContentReportRequest>(REPORT_REQUEST_EVENT, { detail: request }));
}

/** The one mount. `ChatWindow` renders it; nothing else should. */
export function ReportDialogHost() {
  const [request, setRequest] = useState<ContentReportRequest | null>(null);
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ContentReportRequest>).detail;
      if (detail?.targetUserId) setRequest(detail);
    };
    window.addEventListener(REPORT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REPORT_REQUEST_EVENT, onRequest);
  }, []);

  if (!request) return null;
  return (
    <ReportDialog
      // A second request while one is open replaces it rather than stacking,
      // and the key resets the reason and the note with it.
      key={`${request.kind}:${request.messageId ?? request.targetUserId}`}
      request={request}
      currentUserId={currentUserId}
      onClose={() => setRequest(null)}
    />
  );
}

export function ReportDialog({
  request,
  currentUserId,
  onClose,
}: {
  request: ContentReportRequest;
  /** Who is reporting. Without a session the insert is refused and the dialog says so. */
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReasonId | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const remaining = reportNoteRemaining(note);

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setRefusal(null);
    const result = await submitContentReport(currentUserId, {
      kind: request.kind,
      targetUserId: request.targetUserId,
      messageId: request.messageId ?? null,
      chatId: request.chatId ?? null,
      reason,
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setRefusal(result.error);
      return;
    }
    // The product's own confirmation, as the bot settings use it: one line for
    // what happened and one for where it went.
    showActionFeedback({
      kind: "success",
      title: REPORT_SENT_TITLE,
      detail: REPORT_SENT_DETAIL,
      key: "content-report",
    });
    onClose();
  };

  return (
    <KubModal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={reportDialogTitle(request.kind)}
      description={request.targetName}
      icon={<KubIcon name="warning" size={18} tone="danger" />}
      tone="danger"
      size="sm"
      mobileSheet={false}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "kub-button inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover",
              FOCUS_RING,
              DISABLED_TEXT,
            )}
          >
            Отмена
          </button>
          <button
            type="button"
            data-testid="report-send"
            onClick={() => void send()}
            disabled={busy || !reason}
            className={cn(
              "kub-button inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)]",
              PRESS_FILLED,
              FOCUS_RING,
              DISABLED_SINK_FILLED,
            )}
          >
            {busy ? "Отправляем…" : "Отправить"}
          </button>
        </>
      )}
    >
      <div
        role="radiogroup"
        aria-label="Причина жалобы"
        data-testid="report-reasons"
        className="divide-y divide-[color:var(--kub-rule)] overflow-hidden rounded-xl kub-raise"
      >
        {REPORT_REASONS.map((option) => (
          <label
            key={option.id}
            data-testid="report-reason"
            data-report-reason={option.id}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-[color:var(--kub-text)] kub-raise-hover",
              busy && "cursor-not-allowed",
            )}
          >
            <input
              type="radio"
              name="content-report-reason"
              value={option.id}
              checked={reason === option.id}
              disabled={busy}
              onChange={() => {
                setReason(option.id);
                setRefusal(null);
              }}
              className="h-4 w-4 shrink-0 accent-[var(--kub-cyan)]"
            />
            <span className="min-w-0 flex-1">{option.label}</span>
          </label>
        ))}
      </div>

      <label className="mt-3 block text-xs text-[color:var(--kub-muted)]" htmlFor="content-report-note">
        {REPORT_NOTE_LABEL}
      </label>
      <textarea
        id="content-report-note"
        data-testid="report-note"
        value={note}
        disabled={busy}
        rows={3}
        // The column's own limit, so the CHECK can only ever be reached by a
        // paste of astral characters — which `normalizeReportNote` cuts by code
        // point before the insert.
        maxLength={REPORT_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        placeholder={REPORT_NOTE_PLACEHOLDER}
        // Photographed at 390 before this: with `kub-field` — which is only
        // `display:flex` plus a touch-target floor, not a look — the typed text
        // floated on the dialog with no box and started 12px right of its own
        // caption. A step of material is the field now (rule 5's veil, so it
        // reads on this covering surface as well as it would on a panel), and
        // the focus outline is the state channel; no perimeter, which keeps the
        // edge-vocabulary ratchet where it is.
        className={cn(
          "kub-raise mt-1 w-full resize-none rounded-lg px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]",
          FOCUS_RING,
        )}
      />
      {remaining <= 100 && (
        <div className="mt-1 text-right text-[11px] tabular-nums text-[color:var(--kub-muted)]">
          {remaining}
        </div>
      )}

      <p className="mt-3 text-xs leading-snug text-[color:var(--kub-muted)]" data-testid="report-staff-notice">
        {REPORT_STAFF_NOTICE}
      </p>

      {refusal && (
        <p
          data-testid="report-refusal"
          className="mt-3 rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs leading-snug text-[color:var(--kub-danger-text)]"
        >
          {refusal}
        </p>
      )}
    </KubModal>
  );
}
