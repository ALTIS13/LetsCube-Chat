"use client";

import { useId, useRef } from "react";
import { KubIcon } from "@/components/kub/KubIcon";
import { useTopicNotificationPreferences } from "@/hooks/useTopicNotificationPreferences";
import { MUTE_ACTION_LABEL, MUTE_CHOICE_BACK, UNMUTE_ACTION_LABEL } from "@/lib/chatMute";
import { FOCUS_RING } from "@/lib/controlSurface";
import type { TopicNotificationMode } from "@/lib/topicNotificationPreferences";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

export interface TopicNotificationControlProps {
  chatId: string;
  topicId: string | null;
  canonicalScopeKey: string;
  title: string;
  parentMuted: boolean | null;
  onBack: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const choices: readonly { mode: TopicNotificationMode; label: string }[] = [
  { mode: "inherit", label: "Как в чате" },
  { mode: "enabled", label: UNMUTE_ACTION_LABEL },
  { mode: "disabled", label: MUTE_ACTION_LABEL },
];
const ROW = "flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-1 text-left text-sm text-[color:var(--kub-text)]";

/** Caller supplies a current owned, unarchived canonical topic scope. This
 * submenu displays confirmed settings; it never grants delivery authority.
 */
export function TopicNotificationControl({ chatId, topicId, canonicalScopeKey, title, parentMuted, onBack }: TopicNotificationControlProps) {
  const userId = useAppStore(state => state.currentUser?.id ?? null);
  const accountEpoch = useAppStore(state => state.accountEpoch);
  const validScope = UUID.test(chatId) && (canonicalScopeKey === "general"
    ? topicId === null || UUID.test(topicId) : UUID.test(canonicalScopeKey) && canonicalScopeKey === topicId);
  const view = useTopicNotificationPreferences(validScope ? chatId : null);
  const name = useId();
  const scopeRef = useRef({ chatId, topicId, canonicalScopeKey });
  if (scopeRef.current.chatId !== chatId || scopeRef.current.topicId !== topicId || scopeRef.current.canonicalScopeKey !== canonicalScopeKey) {
    scopeRef.current = { chatId, topicId, canonicalScopeKey };
  }
  const scope = scopeRef.current;
  const owned = Boolean(userId) && view.userId === userId && view.accountEpoch === accountEpoch && view.chatId === chatId;
  const row = owned ? view.rows.find(row => row.scope_key === canonicalScopeKey) : undefined;
  const confirmed = owned && !view.unavailable ? row?.mode ?? "inherit" : null;
  const canChoose = owned && !view.loading && !view.unavailable && !view.pending;
  const current = () => {
    const now = useAppStore.getState();
    return owned && scopeRef.current === scope && now.currentUser?.id === view.userId && now.accountEpoch === view.accountEpoch;
  };
  const choose = (mode: TopicNotificationMode) => {
    if (!canChoose || !current() || mode === confirmed) return;
    void view.setMode(canonicalScopeKey === "general" ? null : topicId, mode, row?.revision ?? 0);
  };
  const inheritDetail = parentMuted === null ? "Статус чата недоступен"
    : parentMuted ? "Уведомления отключены" : "Уведомления включены";
  const conflict = owned && view.conflict?.scope_key === canonicalScopeKey;
  const retry = owned && (view.error || view.unavailable) && !view.loading && !view.pending;
  if (!validScope) return null;

  return (
    <div className="min-w-0" aria-busy={Boolean(view.loading || view.pending)}>
      <button type="button" onClick={onBack} className={cn(ROW, "kub-raise-hover", FOCUS_RING)}>
        <KubIcon name="chevronLeft" size={16} tone="muted" className="shrink-0" />
        <span>{MUTE_CHOICE_BACK}</span>
      </button>
      <div className="break-words px-4 py-2 text-sm font-semibold text-[color:var(--kub-text)]">{title}</div>
      <fieldset disabled={!canChoose} className="min-w-0">
        <legend className="sr-only">Уведомления темы: {title}</legend>
        {choices.map(({ mode, label }) => (
          <label key={mode} className={cn(ROW, "kub-raise-hover has-disabled:cursor-not-allowed has-disabled:opacity-60")}>
            <input type="radio" name={name} value={mode} checked={confirmed === mode}
              onChange={() => choose(mode)} className={cn("h-4 w-4 shrink-0 accent-[var(--kub-cyan)]", FOCUS_RING)} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="break-words">{label}</span>
              {mode === "inherit" && <span className="break-words text-xs text-[color:var(--kub-muted)]">{inheritDetail}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {(view.loading || view.pending || conflict || !owned || view.unavailable) && (
        <div className="flex min-h-11 min-w-0 items-center gap-2 px-4 py-1 text-xs text-[color:var(--kub-muted)]" role="status">
          <span className="min-w-0 flex-1 break-words">
            {view.pending ? "Сохранение..." : view.loading ? "Загрузка..." : conflict ? "Настройка изменена на другом устройстве."
              : view.error?.code === "write_failed" ? "Не удалось сохранить настройку." : "Настройка недоступна."}
          </span>
          {retry && <button type="button" aria-label="Повторить" title="Повторить"
            onClick={() => { if (current()) void view.refresh(); }}
            className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center kub-raise-hover", FOCUS_RING)}>
            <KubIcon name="rotate" size={16} tone="muted" />
          </button>}
        </div>
      )}
    </div>
  );
}
