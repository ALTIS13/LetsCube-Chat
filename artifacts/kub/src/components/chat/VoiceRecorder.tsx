"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { useVoiceRecorder, formatVoiceDuration, type VoiceErrorCode } from "@/hooks/useVoiceRecorder";

interface VoiceRecorderProps {
  onSend: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  onCancel: () => void;
}

const BAR_COUNT = 20;

const ERROR_TEXT: Record<VoiceErrorCode, string> = {
  permission_denied: "Доступ к микрофону запрещён. Разрешите его в настройках браузера.",
  no_device: "Микрофон не найден или занят другим приложением.",
  unsupported: "Браузер не поддерживает запись голосовых сообщений.",
  unknown: "Не удалось начать запись. Попробуйте ещё раз.",
};

const BAR_STYLES = Array.from({ length: BAR_COUNT }).map((_, i) => {
  const base = 4 + Math.round(7 * (1 + Math.sin(i * 0.6)));
  return {
    height: `${base}px`,
    animationDelay: `${(i * 55) % 660}ms`,
  } as const;
});

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const { state, durationMs, error, start, stop, cancel } = useVoiceRecorder();
  const [sending, setSending] = useState(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
    return () => { mountedRef.current = false; };
  }, [start]);

  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    try {
      const result = await stop();
      if (!result || result.blob.size === 0) {
        if (mountedRef.current) setSending(false);
        onCancel();
        return;
      }
      await onSend(result.blob, result.durationMs, result.mimeType);
    } catch (err) {
      console.error("[voice] send failed:", err);
      if (mountedRef.current) setSending(false);
    }
  };

  const handleCancel = () => {
    if (sending) return;
    cancel();
    onCancel();
  };

  const isRecording = state === "recording";
  const formatted = useMemo(() => formatVoiceDuration(durationMs), [durationMs]);

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5 bg-[var(--kub-surface-2)] border border-[color:var(--kub-danger)]/30">
        <div className="flex-1 text-sm text-[color:var(--kub-danger)]">
          {ERROR_TEXT[error]}
        </div>
        <button
          onClick={onCancel}
          className="flex-shrink-0 min-h-[40px] px-4 rounded-lg text-xs font-semibold transition-colors hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-text)]"
        >
          Закрыть
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
      <button
        onClick={handleCancel}
        disabled={sending}
        className="flex-shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[color:var(--kub-danger)]"
        aria-label="Отменить запись"
      >
        <KubIcon name="close" size={18} />
      </button>

      <div className="flex-1 flex items-center gap-2">
        {isRecording && (
          <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse bg-[var(--kub-danger)]" aria-hidden />
        )}
        <div className="flex items-center gap-0.5 h-6" aria-hidden>
          {BAR_STYLES.map((s, i) => (
            <div
              key={i}
              className={isRecording ? "vrec-bar w-1 rounded-full bg-[var(--kub-cyan)]" : "w-1 rounded-full bg-[var(--kub-cyan)]"}
              style={{
                height: s.height,
                opacity: isRecording ? undefined : 0.3,
                animationDelay: isRecording ? s.animationDelay : undefined,
              }}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums flex-shrink-0 text-[color:var(--kub-text)]" aria-live="polite">
          {formatted}
        </span>
      </div>

      <button
        onClick={handleSend}
        disabled={sending}
        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan"
        aria-label="Отправить голосовое"
      >
        {sending ? <KubIcon name="spinner" size={18} /> : <KubIcon name="send" size={18} className="ml-0.5" />}
      </button>
    </div>
  );
}
