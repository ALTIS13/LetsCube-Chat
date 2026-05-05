"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubInput, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import type { Profile, TaskPriority, TaskWithPeople } from "@/types/database";
import { PRIORITIES, TASK_PRIORITY_META } from "./taskMeta";
import { cn } from "@/lib/utils";
import { mapPgError } from "@/lib/errors";

interface ChatOption {
  id: string;
  name: string | null;
  type: "private" | "group" | "channel";
}

interface TaskFormModalProps {
  /**
   * When provided, the modal renders in EDIT mode and calls `task_update`
   * on submit; otherwise it stays in CREATE mode and calls `task_create`.
   */
  task?: TaskWithPeople | null;
  onClose: () => void;
  /** Fired with the task id after a successful create OR update. */
  onDone: (taskId: string) => void;
}

/**
 * Admin/manager-only modal for creating OR editing a task.  All writes go
 * through SECURITY DEFINER RPCs (`task_create` / `task_update`); the
 * `tasks` table itself rejects direct INSERT/UPDATE.
 */
export function TaskFormModal({ task, onClose, onDone }: TaskFormModalProps) {
  const supabase = createClient();
  const isEdit = !!task;

  // ── Form state, prefilled in edit mode ─────────────────────────────────
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [dueAt, setDueAt] = useState<string>(toLocalInput(task?.due_at));

  const [assignee, setAssignee] = useState<Profile | null>(task?.assignee ?? null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  // Chat binding (optional). RLS already filters the chat list to ones the
  // caller can see — no extra client-side guard needed.
  const [chats, setChats] = useState<ChatOption[]>([]);
  const [chatId, setChatId] = useState<string | null>(task?.chat_id ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("chats")
      .select("id, name, type")
      .order("name", { ascending: true, nullsFirst: false })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return;
        setChats((data ?? []) as ChatOption[]);
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Debounced user search by full_name / username (RLS lets staff read all
  // profiles; non-staff would never see this modal).
  useEffect(() => {
    if (!search.trim() || assignee) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const q = search.trim();
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(8);
      setResults((data ?? []) as Profile[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [search, assignee, supabase]);

  const chatLabel = useMemo(() => {
    return (c: ChatOption): string => {
      if (c.name && c.name.trim().length > 0) return c.name;
      if (c.type === "private") return "Личный чат";
      if (c.type === "channel") return "Канал без названия";
      return "Группа без названия";
    };
  }, []);

  const handleSubmit = async () => {
    if (!title.trim()) { setError("Укажите название задачи"); return; }
    setSubmitting(true);
    setError(null);
    const due_iso =
      dueAt && !isNaN(new Date(dueAt).getTime())
        ? new Date(dueAt).toISOString()
        : null;

    if (isEdit && task) {
      const { error: rpcError } = await supabase.rpc("task_update", {
        p_task_id: task.id,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_priority: priority,
        p_due_at: due_iso,
        p_assignee_id: assignee?.id ?? null,
        p_chat_id: chatId,
      });
      setSubmitting(false);
      if (rpcError) { setError(mapPgError(rpcError)); return; }
      onDone(task.id);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc("task_create", {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_assignee_id: assignee?.id ?? null,
      p_priority: priority,
      p_due_at: due_iso,
      p_chat_id: chatId,
    });
    setSubmitting(false);
    if (rpcError) { setError(mapPgError(rpcError)); return; }
    onDone(data as string);
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title={isEdit ? "Редактирование задачи" : "Новая задача"}
      icon={<KubIcon name="tasks" size={15} />}
      size="md"
      contentClassName="px-5 py-4 space-y-4"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Отмена</KubButton>
          <KubButton variant="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? "Сохранить" : "Создать"}
          </KubButton>
        </>
      }
    >
      <KubInput
        label="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Что нужно сделать?"
        autoFocus
      />

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Описание
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Детали, шаги, ссылки…"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Приоритет
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITIES.map((p) => {
            const meta = TASK_PRIORITY_META[p];
            const active = priority === p;
            return (
              <button
                type="button"
                key={p}
                onClick={() => setPriority(p)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-semibold transition-colors border",
                  active
                    ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)] kub-glow-soft"
                    : "bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border-[color:var(--kub-border-color)]",
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Срок (необязательно)
        </label>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] transition-all"
        />
      </div>

      <div>
        <label
          htmlFor="task-chat-select"
          className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]"
        >
          Связанный чат (необязательно)
        </label>
        <select
          id="task-chat-select"
          value={chatId ?? ""}
          onChange={(e) => setChatId(e.target.value ? e.target.value : null)}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] transition-all"
        >
          <option value="">— Без привязки —</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {chatTypePrefix(c.type)} {chatLabel(c)}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-[color:var(--kub-muted)]">
          Только чаты, в которых вы состоите.
        </p>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Исполнитель
        </label>
        {assignee ? (
          <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
            <UserAvatar user={assignee} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate text-sm text-[color:var(--kub-text)]">
                {assignee.full_name ?? "Без имени"}
              </div>
              {assignee.username && (
                <div className="text-xs truncate text-[color:var(--kub-muted)]">
                  @{assignee.username}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setAssignee(null); setSearch(""); }}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]"
              aria-label="Убрать"
            >
              <KubIcon name="close" size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] transition-all">
              <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
              <input
                type="text"
                placeholder="Поиск по имени или @username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
              />
              {searching && <KubIcon name="spinner" size={14} className="text-[color:var(--kub-cyan)]" />}
            </div>
            {results.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]">
                {results.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => { setAssignee(p); setSearch(""); setResults([]); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--kub-surface-3)] text-left"
                  >
                    <UserAvatar user={p} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
                        {p.full_name ?? "Без имени"}
                      </div>
                      {p.username && (
                        <div className="text-[11px] truncate text-[color:var(--kub-muted)]">
                          @{p.username}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-[color:var(--kub-muted)]">
              {isEdit
                ? "Можно убрать исполнителя — задача станет неназначенной."
                : "Можно создать задачу без исполнителя — назначить позже."}
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}
    </KubModal>
  );
}

/** ISO timestamp → `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function chatTypePrefix(t: ChatOption["type"]): string {
  if (t === "private") return "👤";
  if (t === "channel") return "📣";
  return "👥";
}
