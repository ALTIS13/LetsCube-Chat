"use client";

import { useState } from "react";
import { KubButton, KubIcon, KubModal } from "@/components/kub";

interface TaskDeleteModalProps {
  open: boolean;
  count: number;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}

export function TaskDeleteModal({
  open,
  count,
  loading = false,
  error = null,
  onClose,
  onConfirm,
}: TaskDeleteModalProps) {
  const [reason, setReason] = useState("");
  const plural = count === 1 ? "задача" : count >= 2 && count <= 4 ? "задачи" : "задач";

  return (
    <KubModal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={count === 1 ? "Удалить задачу?" : "Удалить выбранные задачи?"}
      description="Задачи будут скрыты из обычных списков. История и события сохранятся."
      icon={<KubIcon name="ban" size={16} />}
      size="md"
      footer={
        <>
          <KubButton variant="secondary" onClick={onClose} disabled={loading}>
            Отмена
          </KubButton>
          <KubButton
            variant="danger"
            loading={loading}
            leftIcon={<KubIcon name="ban" size={14} />}
            onClick={() => onConfirm(reason.trim() || null)}
          >
            Удалить
          </KubButton>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)]">
          Будет удалено: <span className="font-semibold">{count}</span> {plural}.
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
            Причина, необязательно
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Например: тестовая задача больше не нужна"
            className="w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none transition-colors focus:border-[color:var(--kub-cyan)]"
          />
        </label>
        {error && (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]">
            {error}
          </div>
        )}
      </div>
    </KubModal>
  );
}
