"use client";

import { X, Send, Mic } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { cn } from "@/lib/utils";

interface VoiceRecorderProps {
  onSend: (blob: Blob, duration: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const { state, duration, audioBlob, start, stop, cancel, reset, formatDuration } =
    useVoiceRecorder();

  // Auto-start on mount
  if (state === "idle" && !audioBlob) {
    start();
  }

  const handleSend = () => {
    if (state === "recording") stop();
    setTimeout(() => {
      if (audioBlob) {
        onSend(audioBlob, duration);
        reset();
      }
    }, 100);
  };

  const handleCancel = () => {
    cancel();
    onCancel();
  };

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-2.5"
      style={{ background: "var(--tg-input)" }}
    >
      {/* Cancel */}
      <button
        onClick={handleCancel}
        className="flex-shrink-0 p-1.5 rounded-full hover:bg-white/10 transition-colors"
        style={{ color: "#ef4444" }}
      >
        <X size={18} />
      </button>

      {/* Waveform / indicator */}
      <div className="flex-1 flex items-center gap-2">
        {state === "recording" && (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
            style={{ background: "#ef4444" }}
          />
        )}
        <div className="flex items-end gap-0.5 h-6">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-all",
                state === "recording" ? "animate-pulse" : ""
              )}
              style={{
                background: "var(--tg-accent)",
                height: `${state === "recording" ? 4 + Math.random() * 16 : 4}px`,
                animationDelay: `${i * 50}ms`,
                opacity: state === "recording" ? 0.7 + Math.random() * 0.3 : 0.3,
              }}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums flex-shrink-0" style={{ color: "var(--tg-text)" }}>
          {formatDuration(duration)}
        </span>
      </div>

      {/* Send */}
      <button
        onClick={handleSend}
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all hover:brightness-110 active:scale-95"
        style={{ background: "var(--tg-accent)" }}
      >
        <Send size={16} style={{ color: "#fff" }} className="ml-0.5" />
      </button>
    </div>
  );
}
