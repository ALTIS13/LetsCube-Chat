"use client";

import { useMemo, useState, type FormEvent } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { createClient } from "@/lib/supabase/client";
import { formatTaskMoment } from "@/lib/taskPeriod";
import {
  REMINDER_NOTE_MAX,
  defaultReminderInput,
  orderReminders,
  reminderMomentError,
  reminderNote,
  reminderRecipientLabel,
  reminderRefusal,
  reminderStatusLabel,
  toReminderInput,
  type ReminderRecipient,
} from "@/lib/taskReminders";
import { cn } from "@/lib/utils";
import type { TaskReminder } from "@/types/database";
import { TASK_FIELD_WELL } from "./taskFieldWell";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

interface TaskRemindersProps {
  taskId: string;
  reminders: TaskReminder[];
  currentUserId: string | null;
  /** The creator, staff, an administrator of the task's location, or its assignee, on a task still open. */
  canRemind: boolean;
  /** Offered as «Исполнителю» when the task has an assignee other than the reader. */
  assigneeName: string | null;
  onChanged: () => void;
}

/**
 * The reminders on a task (tracker item 66): a moment, an optional note, and
 * who it goes to. The list shows the reader's own and those set for them as
 * the assignee — `task_reminders`' policy reads nothing else — soonest first.
 */
export function TaskReminders({
  taskId,
  reminders,
  currentUserId,
  canRemind,
  assigneeName,
  onChanged,
}: TaskRemindersProps) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  const [recipient, setRecipient] = useState<ReminderRecipient>("author");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = orderReminders(reminders);
  if (!shown.length && !canRemind) return null;

  const start = () => {
    setAt(defaultReminderInput(new Date()));
    // On somebody else's work the assignee comes first: the tester's reminder,
    // «пора приступать делать», is for the person doing it (tracker item 66).
    setRecipient(assigneeName ? "assignee" : "author");
    setNote("");
    setError(null);
    setOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const refusal = reminderMomentError(at, Date.now());
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: refused } = await supabase.rpc("task_reminder_add", {
      p_task_id: taskId,
      p_remind_at: new Date(at).toISOString(),
      p_recipient: assigneeName ? recipient : "author",
      p_note: reminderNote(note),
    });
    setBusy(false);
    if (refused) {
      setError(reminderRefusal(refused));
      return;
    }
    setOpen(false);
    onChanged();
  };

  const remove = async (reminder: TaskReminder) => {
    setBusy(true);
    setError(null);
    const { error: refused } = await supabase.rpc("task_reminder_remove", { p_reminder_id: reminder.id });
    setBusy(false);
    if (refused) {
      setError(reminderRefusal(refused));
      return;
    }
    onChanged();
  };

  return (
    <div data-testid="task-reminders">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
          Напоминания
        </div>
        {canRemind && !open && (
          <button
            type="button"
            data-testid="task-reminder-open"
            onClick={start}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[color:var(--kub-accent-text)] transition-colors kub-raise-hover",
              FOCUS_RING,
            )}
          >
            <KubIcon name="create" size={14} />
            Напомнить
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map((reminder) => {
            const mine = reminder.created_by === currentUserId;
            const status = reminderStatusLabel(reminder.status);
            const past = reminder.status !== "pending";
            return (
              <li
                key={reminder.id}
                data-testid="task-reminder"
                data-status={reminder.status}
                className="group flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors kub-raise-hover"
              >
                <KubIcon
                  name="clock"
                  size={16}
                  className={cn("mt-0.5 shrink-0", past ? "text-[color:var(--kub-muted)]" : "text-[color:var(--kub-accent-text)]")}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm tabular-nums",
                      past ? "text-[color:var(--kub-muted)]" : "text-[color:var(--kub-text)]",
                    )}
                  >
                    {formatTaskMoment(reminder.remind_at)}
                    <span className="text-[color:var(--kub-muted)]">
                      {" · "}
                      {reminderRecipientLabel(reminder.recipient, mine)}
                      {status ? ` · ${status}` : ""}
                    </span>
                  </div>
                  {reminder.note && (
                    <div className="break-words text-xs text-[color:var(--kub-muted)]">{reminder.note}</div>
                  )}
                </div>
                {mine && (
                  <button
                    type="button"
                    data-testid="task-reminder-remove"
                    onClick={() => void remove(reminder)}
                    disabled={busy}
                    aria-label={`Удалить напоминание на ${formatTaskMoment(reminder.remind_at)}`}
                    title="Удалить напоминание"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] opacity-0 transition-opacity hover:text-[color:var(--kub-text)] group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
                      FOCUS_RING,
                    )}
                  >
                    <KubIcon name="close" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        // `min` greys out the past in the picker; the refusal itself is ours,
        // in words, rather than the browser's bubble, which blocked the submit.
        <form
          noValidate
          onSubmit={(event) => void save(event)}
          className="mt-2 space-y-2"
          data-testid="task-reminder-form"
        >
          <input
            type="datetime-local"
            data-testid="task-reminder-at"
            value={at}
            min={toReminderInput(new Date())}
            onChange={(event) => setAt(event.currentTarget.value)}
            aria-label="Когда напомнить"
            className={cn(TASK_FIELD_WELL, "w-full", FOCUS_RING)}
          />
          {assigneeName && (
            <div role="radiogroup" aria-label="Кому напомнить" className="flex flex-wrap gap-1.5">
              {(["assignee", "author"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={recipient === value}
                  onClick={() => setRecipient(value)}
                  className={cn(
                    "min-w-0 max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors",
                    recipient === value
                      ? "border-[color:var(--kub-accent-text)] bg-[color-mix(in_srgb,var(--kub-accent-text)_14%,transparent)] text-[color:var(--kub-text)]"
                      : "border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                    FOCUS_RING,
                  )}
                >
                  {value === "assignee" ? `Исполнителю — ${assigneeName}` : "Мне"}
                </button>
              ))}
            </div>
          )}
          <input
            data-testid="task-reminder-note"
            value={note}
            maxLength={REMINDER_NOTE_MAX}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Заметка, например «пришли комплектующие»"
            aria-label="Заметка к напоминанию"
            className={cn(TASK_FIELD_WELL, "w-full", FOCUS_RING)}
          />
          <div className="flex justify-end gap-2">
            <KubButton type="button" variant="ghost" size="md" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </KubButton>
            <KubButton type="submit" variant="secondary" size="md" disabled={busy} data-testid="task-reminder-save">
              Напомнить
            </KubButton>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-[color:var(--kub-danger-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
