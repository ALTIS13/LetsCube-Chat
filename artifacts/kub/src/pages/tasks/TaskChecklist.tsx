"use client";

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { createClient } from "@/lib/supabase/client";
import {
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_TEXT_MAX,
  checklistProgress,
  checklistRefusal,
  checklistText,
} from "@/lib/taskChecklist";
import { cn } from "@/lib/utils";
import type { TaskChecklistItem } from "@/types/database";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

interface TaskChecklistProps {
  taskId: string;
  items: TaskChecklistItem[];
  /** The creator, staff, or an administrator of the task's location, on a task still open. */
  canEdit: boolean;
  /** Those, and the assignee: the person doing the work marks it done. */
  canTick: boolean;
  onChanged: () => void;
}

/**
 * The checklist of a task (tracker item 62): points written by whoever may edit
 * the task, ticked off by them or by the assignee, «2 из 5» above them. Every
 * change is one of the four `task_checklist_*` functions; a tick shows at once
 * and is taken back if the database refuses it.
 */
export function TaskChecklist({ taskId, items, canEdit, canTick, onChanged }: TaskChecklistProps) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A tick is drawn before its answer, as the reader expects of a checkbox.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  useEffect(() => setTicked({}), [items]);

  const shown = items.map((item) => (item.id in ticked ? { ...item, done: ticked[item.id] } : item));
  const progress = checklistProgress(shown);
  if (!shown.length && !canEdit) return null;

  const run = async (call: () => PromiseLike<{ error: { message?: string | null } | null }>) => {
    setBusy(true);
    setError(null);
    const { error: refused } = await call();
    setBusy(false);
    if (refused) {
      setError(checklistRefusal(refused));
      return false;
    }
    onChanged();
    return true;
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const text = checklistText(draft);
    if (!text) return;
    if (await run(() => supabase.rpc("task_checklist_add", { p_task_id: taskId, p_text: text }))) setDraft("");
  };

  const toggle = async (item: TaskChecklistItem, done: boolean) => {
    setTicked((current) => ({ ...current, [item.id]: done }));
    const ok = await run(() => supabase.rpc("task_checklist_set_done", { p_item_id: item.id, p_done: done }));
    if (!ok) {
      setTicked((current) => {
        const { [item.id]: _undone, ...rest } = current;
        return rest;
      });
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const original = items.find((item) => item.id === editing.id);
    const text = checklistText(editing.text);
    setEditing(null);
    if (!text || !original || text === original.text) return;
    await run(() => supabase.rpc("task_checklist_rename", { p_item_id: original.id, p_text: text }));
  };

  const editKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(null);
    }
  };

  return (
    <div data-testid="task-checklist">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
          Чек-лист
        </div>
        {progress && (
          <span data-testid="task-checklist-progress" className="text-xs tabular-nums text-[color:var(--kub-muted)]">
            {progress.done} из {progress.total}
          </span>
        )}
      </div>
      {progress && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--kub-border-color)_65%,transparent)]">
          <div
            className="h-full rounded-full bg-[var(--kub-online)] transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map((item) => (
            <li
              key={item.id}
              data-testid="task-checklist-item"
              data-done={item.done}
              className="group flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors kub-raise-hover"
            >
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canTick || busy}
                onChange={(event) => void toggle(item, event.currentTarget.checked)}
                aria-label={item.text}
                className={cn("mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--kub-online)] disabled:cursor-default", FOCUS_RING)}
              />
              {editing?.id === item.id ? (
                <input
                  autoFocus
                  value={editing.text}
                  maxLength={CHECKLIST_TEXT_MAX}
                  onChange={(event) => setEditing({ id: item.id, text: event.currentTarget.value })}
                  onKeyDown={editKeys}
                  onBlur={() => void saveEdit()}
                  aria-label="Текст пункта"
                  className={cn(
                    "min-w-0 flex-1 rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2 py-0.5 text-sm text-[color:var(--kub-text)]",
                    FOCUS_RING,
                  )}
                />
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing({ id: item.id, text: item.text })}
                  title="Изменить пункт"
                  className={cn(
                    "min-w-0 flex-1 break-words rounded-md text-left text-sm",
                    item.done ? "text-[color:var(--kub-muted)] line-through" : "text-[color:var(--kub-text)]",
                    FOCUS_RING,
                  )}
                >
                  {item.text}
                </button>
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 break-words text-sm",
                    item.done ? "text-[color:var(--kub-muted)] line-through" : "text-[color:var(--kub-text)]",
                  )}
                >
                  {item.text}
                </span>
              )}
              {canEdit && editing?.id !== item.id && (
                <button
                  type="button"
                  onClick={() => void run(() => supabase.rpc("task_checklist_remove", { p_item_id: item.id }))}
                  disabled={busy}
                  aria-label={`Удалить пункт «${item.text}»`}
                  title="Удалить пункт"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] opacity-0 transition-opacity hover:text-[color:var(--kub-text)] group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
                    FOCUS_RING,
                  )}
                >
                  <KubIcon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && shown.length < CHECKLIST_MAX_ITEMS && (
        <form onSubmit={(event) => void add(event)} className="mt-2 flex items-center gap-2">
          <input
            data-testid="task-checklist-draft"
            value={draft}
            maxLength={CHECKLIST_TEXT_MAX}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Добавить пункт"
            aria-label="Новый пункт чек-листа"
            className={cn(
              "min-w-0 flex-1 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)]",
              FOCUS_RING,
            )}
          />
          <KubButton type="submit" variant="secondary" size="md" disabled={busy || !draft.trim()}>
            Добавить
          </KubButton>
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
