"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Chat, Profile } from "@/types/database";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError } from "@/lib/errors";

interface Props {
  target: Profile;
  onClose: () => void;
  onSuccess: () => void;
}

type DurationKey = "15m" | "1h" | "24h" | "7d" | "perm" | "custom";

const DURATIONS: { key: DurationKey; label: string; hours: number | null }[] = [
  { key: "15m",    label: "15 минут",  hours: 0.25 },
  { key: "1h",     label: "1 час",     hours: 1 },
  { key: "24h",    label: "24 часа",   hours: 24 },
  { key: "7d",     label: "7 дней",    hours: 24 * 7 },
  { key: "perm",   label: "Бессрочно", hours: null },
  { key: "custom", label: "Своя дата", hours: 0 },
];

function defaultCustom(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MuteModal({ target, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const [reason, setReason] = useState("");
  const [durationKey, setDurationKey] = useState<DurationKey>("24h");
  const [customAt, setCustomAt] = useState<string>(defaultCustom());
  const [scope, setScope] = useState<"global" | "chat">("global");
  const [chatId, setChatId] = useState<string>("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== "chat") return;
    let cancelled = false;
    supabase
      .from("chats")
      .select("id,name,type,description,avatar_url,created_by,is_forum,created_at,updated_at")
      .in("type", ["group", "channel"])
      .order("name", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (cancelled) return;
        setChats((data ?? []) as Chat[]);
        if (!chatId && data && data.length > 0) setChatId(data[0].id);
      });
    return () => { cancelled = true; };
  }, [scope, supabase, chatId]);

  const handleSubmit = async () => {
    if (!reason.trim()) { setError("Укажите причину"); return; }
    if (scope === "chat" && !chatId) { setError("Выберите чат"); return; }
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
    const { error } = await supabase.from("mutes").insert({
      user_id: target.id,
      chat_id: scope === "chat" ? chatId : null,
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
      title="Запретить отправку сообщений"
      icon={<KubIcon name="muted" size={15} />}
      size="md"
      contentClassName="px-5 py-4 space-y-4"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Отмена</KubButton>
          <KubButton variant="accent" loading={submitting} onClick={handleSubmit}>
            Замьютить
          </KubButton>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
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
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Где
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: "global", label: "Везде" },
            { id: "chat",   label: "В одном чате" },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setScope(o.id as "global" | "chat")}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-semibold transition-colors border",
                scope === o.id
                  ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)] kub-glow-soft"
                  : "bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border-[color:var(--kub-border-color)]"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {scope === "chat" && (
          <select
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)]"
          >
            {chats.length === 0 && <option value="">Нет доступных групп</option>}
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Причина
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Например: спам / оскорбления"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
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
                  : "bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border-[color:var(--kub-border-color)]"
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
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)]"
          />
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
