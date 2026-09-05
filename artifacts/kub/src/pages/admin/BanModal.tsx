"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubButton, KubIcon, KubModal, KubNotice } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError } from "@/lib/errors";

interface Props {
  target: Profile;
  onClose: () => void;
  onSuccess: () => void;
}

type DurationKey = "1h" | "24h" | "7d" | "30d" | "perm" | "custom";

const DURATIONS: { key: DurationKey; label: string; hours: number | null }[] = [
  { key: "1h",     label: "1 час",       hours: 1 },
  { key: "24h",    label: "24 часа",     hours: 24 },
  { key: "7d",     label: "7 дней",      hours: 24 * 7 },
  { key: "30d",   label: "30 дней",     hours: 24 * 30 },
  { key: "perm",   label: "Бессрочно",   hours: null },
  { key: "custom", label: "Своя дата",   hours: 0 },
];

function defaultCustom(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BanModal({ target, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const [reason, setReason] = useState("");
  const [durationKey, setDurationKey] = useState<DurationKey>("24h");
  const [customAt, setCustomAt] = useState<string>(defaultCustom());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason.trim()) { setError("Укажите причину"); return; }
    let expires_at: string | null;
    if (durationKey === "custom") {
      if (!customAt) { setError("Укажите дату окончания"); return; }
      const ts = new Date(customAt);
      if (isNaN(ts.getTime()) || ts.getTime() <= Date.now()) {
        setError("Дата должна быть в будущем");
        return;
      }
      expires_at = ts.toISOString();
    } else {
      const hours = DURATIONS.find((d) => d.key === durationKey)?.hours ?? null;
      expires_at = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    }
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.from("bans").insert({
      user_id: target.id,
      reason: reason.trim(),
      expires_at,
      issued_by: currentUser?.id ?? null,
    });
    setSubmitting(false);
    if (error) { setError(mapPgError(error)); return; }
    onSuccess();
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Заблокировать пользователя"
      icon={<KubIcon name="shieldOff" size={15} />}
      size="md"
      contentClassName="px-5 py-4 space-y-4"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Отмена</KubButton>
          <KubButton variant="danger" loading={submitting} onClick={handleSubmit}>
            Заблокировать
          </KubButton>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)]">
        <UserAvatar user={target} size="md" />
        <div className="min-w-0">
          <div className="font-semibold truncate text-[color:var(--kub-text)]">
            {target.full_name ?? "Без имени"}
          </div>
          <div className="text-xs truncate text-[color:var(--kub-muted)]">
            {target.username ? `@${target.username}` : target.id}
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-accent-text)]">
          Причина
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="За что блокируется"
          className="w-full rounded-xl px-3 py-2 text-sm resize-none bg-[var(--kub-inset)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-accent-text)]">
          Срок
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {DURATIONS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDurationKey(d.key)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-semibold transition-colors border",
                durationKey === d.key
                  ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)] kub-glow-soft"
                  : "bg-[var(--kub-inset)] text-[color:var(--kub-text)] border-[color:var(--kub-border-color)]"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        {durationKey === "custom" && (
          <input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm bg-[var(--kub-inset)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          />
        )}
      </div>

      {error && (
        <KubNotice tone="danger" className="text-xs">
          {error}
        </KubNotice>
      )}
    </KubModal>
  );
}
