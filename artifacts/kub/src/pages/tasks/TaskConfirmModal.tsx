"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { mapPgError } from "@/lib/errors";

interface Props {
  taskId: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Manager/admin confirms the task is done.  An optional note is recorded as
 * an event payload.  The "you can't confirm your own task" rule is enforced
 * server-side in `task_confirm`.
 */
export function TaskConfirmModal({ taskId, onClose, onDone }: Props) {
  const supabase = createClient();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setSubmitting(true); setError(null);
    const { error: rpcError } = await supabase.rpc("task_confirm", {
      p_task_id: taskId,
      p_note: note.trim() || null,
    });
    setSubmitting(false);
    if (rpcError) { setError(mapPgError(rpcError)); return; }
    onDone();
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title="Подтвердить выполнение"
      icon={<KubIcon name="checkCircle" size={15} />}
      size="sm"
      contentClassName="px-5 py-4 space-y-3"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Закрыть</KubButton>
          <KubButton variant="primary" loading={submitting} onClick={handle}>
            Подтвердить
          </KubButton>
        </>
      }
    >
      <p className="text-sm text-[color:var(--kub-muted)]">
        Подтверждение завершит задачу. Это действие нельзя отменить —
        задача перейдёт в статус «Подтверждена».
      </p>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-accent-text)]">
          Комментарий (необязательно)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Например, «всё чисто, спасибо»"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-inset)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] transition-all"
        />
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger-text)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}
    </KubModal>
  );
}
