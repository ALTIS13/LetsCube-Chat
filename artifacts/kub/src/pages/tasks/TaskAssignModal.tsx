"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import type { Profile } from "@/types/database";
import { mapPgError } from "@/lib/errors";

interface Props {
  taskId: string;
  /** Currently-assigned user (if any) — used to show "current" state. */
  currentAssignee: Profile | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Admin/manager-only modal for assigning or reassigning a task while it is
 * still in `new` or `assigned`.  Calls the `task_assign` RPC -- role check
 * lives server-side, so this modal only handles UX.
 */
export function TaskAssignModal({ taskId, currentAssignee, onClose, onDone }: Props) {
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Profile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!search.trim() || picked) { setResults([]); return; }
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
  }, [search, picked, supabase]);

  const submit = async () => {
    if (!picked) { setError("Выберите исполнителя"); return; }
    setSubmitting(true); setError(null);
    const { error: rpcError } = await supabase.rpc("task_assign", {
      p_task_id: taskId,
      p_assignee_id: picked.id,
    });
    setSubmitting(false);
    if (rpcError) { setError(mapPgError(rpcError)); return; }
    onDone();
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title={currentAssignee ? "Переназначить задачу" : "Назначить исполнителя"}
      icon={<KubIcon name="userPlus" size={15} />}
      size="sm"
      contentClassName="px-5 py-4 space-y-3"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Отмена</KubButton>
          <KubButton variant="primary" loading={submitting} onClick={submit} disabled={!picked}>
            Назначить
          </KubButton>
        </>
      }
    >
      {currentAssignee && !picked && (
        <div className="rounded-xl px-3 py-2 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] flex items-center gap-2">
          <UserAvatar user={currentAssignee} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--kub-muted)]">
              Сейчас назначен
            </div>
            <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
              {currentAssignee.full_name ?? "Без имени"}
            </div>
          </div>
        </div>
      )}

      {picked ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
          <UserAvatar user={picked} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate text-[color:var(--kub-text)]">
              {picked.full_name ?? "Без имени"}
            </div>
            {picked.username && (
              <div className="text-xs truncate text-[color:var(--kub-muted)]">@{picked.username}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setPicked(null); setSearch(""); }}
            className="p-1.5 rounded-lg kub-raise-hover text-[color:var(--kub-muted)]"
            aria-label="Сбросить"
          >
            <KubIcon name="close" size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] transition-all">
            <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
            <input
              autoFocus
              type="text"
              placeholder="Поиск по имени или @никнейму…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
            />
            {searching && <KubIcon name="spinner" size={14} className="text-[color:var(--kub-cyan)]" />}
          </div>
          {results.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]">
              {results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => { setPicked(p); setSearch(""); setResults([]); }}
                  className="w-full flex items-center gap-3 px-3 py-2 kub-raise-hover text-left"
                >
                  <UserAvatar user={p} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
                      {p.full_name ?? "Без имени"}
                    </div>
                    {p.username && (
                      <div className="text-[11px] truncate text-[color:var(--kub-muted)]">@{p.username}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger-text)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}
    </KubModal>
  );
}
