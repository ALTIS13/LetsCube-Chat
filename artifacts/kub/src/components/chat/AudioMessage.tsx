"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { clampAudioElementVolume, useAudioSettings } from "@/hooks/useAudioSettings";

interface AudioMessageProps {
  url?: string | null;
  duration?: number;
  isMe: boolean;
}

export function AudioMessage({ url, duration = 0, isMe }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(() => finiteDuration(duration));
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const { settings } = useAudioSettings();

  const stopProgressLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioDuration = finiteDuration(audio.duration || durationSeconds);
    const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (audioDuration > 0) {
      setDurationSeconds(audioDuration);
      setProgress(Math.min(100, Math.max(0, (nextTime / audioDuration) * 100)));
    } else {
      setProgress(0);
    }
    setCurrentTime(Math.floor(Math.max(0, nextTime)));
  }, [durationSeconds]);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const tick = () => {
      updateProgress();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopProgressLoop, updateProgress]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
    }
  }, [settings.voicePlaybackVolume]);

  useEffect(() => {
    stopProgressLoop();
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDurationSeconds(finiteDuration(duration));
  }, [duration, url, stopProgressLoop]);

  useEffect(() => stopProgressLoop, [stopProgressLoop]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      stopProgressLoop();
      updateProgress();
    }
    else {
      audio.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
      if (audio.ended) audio.currentTime = 0;
      void audio.play().then(() => setPlaying(true)).catch((err) => {
        console.error("[voice] playback failed:", err);
        setPlaying(false);
      });
    }
  };

  const handlePlay = () => {
    setPlaying(true);
    startProgressLoop();
  };

  const handlePause = () => {
    setPlaying(false);
    stopProgressLoop();
    updateProgress();
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    const nextDuration = finiteDuration(audio?.duration || duration);
    setDurationSeconds(nextDuration);
    updateProgress();
  };

  const handleEnded = () => {
    const audio = audioRef.current;
    stopProgressLoop();
    if (audio) audio.currentTime = 0;
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioDuration = finiteDuration(audio.duration || durationSeconds);
    if (audioDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audioDuration;
    updateProgress();
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const srcReady = Boolean(url);

  return (
    <div className="flex items-center gap-2.5 min-w-[180px]" data-voice-message="true">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleLoadedMetadata}
          onTimeUpdate={updateProgress}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onError={() => {
            stopProgressLoop();
            setPlaying(false);
          }}
        />
      )}

      <button
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
      >
        {playing ? <KubIcon name="pause" size={16} /> : <KubIcon name="play" size={16} className="ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <div
          data-voice-progress="track"
          data-audio-src-ready={srcReady ? "true" : "false"}
          className={`h-1.5 rounded-full cursor-pointer overflow-hidden ${
            isMe ? "bg-[color:var(--kub-border-color)]" : "bg-[var(--kub-surface-3)]"
          }`}
          onClick={handleSeek}
        >
          <div
            className="h-full origin-left rounded-full bg-[var(--kub-cyan)]"
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress / 100))})` }}
          />
        </div>
        <span className="text-[10px] text-[color:var(--kub-muted)]">
          {!url ? "загрузка..." : playing ? fmt(currentTime) : fmt(durationSeconds)}
        </span>
      </div>
    </div>
  );
}

function finiteDuration(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
