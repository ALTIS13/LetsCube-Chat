"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { mapPgError } from "@/lib/errors";

interface Props {
  taskId: string;
  /** Verb in Russian: "отклонить" or "отменить". Drives copy + RPC. */
  mode: "reject" | "cancel";
  onClose: () => void;
  onDone: () => void;
}

const COPY = {
  reject: {
    title:   "Отклонить выполнение",
    icon:    "reject" as const,
    label:   "Причина отклонения",
    placeholder: "Что не так? Что переделать?",
    button:  "Отклонить",
    success: "Задача отклонена",
  },
  cancel: {
    title:   "Отменить задачу",
    icon:    "ban" as const,
    label:   "Причина отмены",
    placeholder: "Почему задача отменяется",
    button:  "Отменить задачу",
    success: "Задача отменена",
  },
};

export function TaskRejectModal({ taskId, mode, onClose, onDone }: Props) {
  const supabase = createClient();
  const c = COPY[mode];
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    if (!reason.trim()) { setError("Укажите причину"); return; }
    setSubmitting(true); setError(null);
    const { error: rpcError } =
      mode === "reject"
        ? await supabase.rpc("task_reject", { p_task_id: taskId, p_reason: reason.trim() })
        : await supabase.rpc("task_cancel", { p_task_id: taskId, p_reason: reason.trim() });
    setSubmitting(false);
    if (rpcError) { setError(mapPgError(rpcError)); return; }
    onDone();
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title={c.title}
      icon={<KubIcon name={c.icon} size={15} />}
      size="sm"
      contentClassName="px-5 py-4 space-y-3"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Закрыть</KubButton>
          <KubButton variant="danger" loading={submitting} onClick={handle}>
            {c.button}
          </KubButton>
        </>
      }
    >
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-accent-text)]">
          {c.label}
        </label>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          placeholder={c.placeholder}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-danger)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-danger)_18%,transparent)] transition-all"
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
