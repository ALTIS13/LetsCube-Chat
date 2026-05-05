"use client";

import { useEffect, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { clampAudioElementVolume, useAudioSettings } from "@/hooks/useAudioSettings";

interface AudioMessageProps {
  url: string;
  duration?: number;
  isMe: boolean;
}

export function AudioMessage({ url, duration = 0, isMe }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { settings } = useAudioSettings();

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
    }
  }, [settings.voicePlaybackVolume]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else {
      audio.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
      void audio.play().then(() => setPlaying(true)).catch((err) => {
        console.error("[voice] playback failed:", err);
        setPlaying(false);
      });
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress((audio.currentTime / audio.duration) * 100);
    setCurrentTime(Math.floor(audio.currentTime));
  };

  const handleEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2.5 min-w-[180px]">
      <audio ref={audioRef} src={url} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} />

      <button
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan"
      >
        {playing ? <KubIcon name="pause" size={16} /> : <KubIcon name="play" size={16} className="ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <div
          className={`h-1 rounded-full cursor-pointer overflow-hidden ${
            isMe ? "bg-[color:var(--kub-border-color)]" : "bg-[var(--kub-surface-3)]"
          }`}
          onClick={handleSeek}
        >
          <div
            className="h-full rounded-full transition-all bg-[var(--kub-cyan)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-[color:var(--kub-muted)]">
          {playing ? fmt(currentTime) : fmt(duration)}
        </span>
      </div>
    </div>
  );
}
