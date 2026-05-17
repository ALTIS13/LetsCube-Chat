"use client";

import { type ChangeEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { clampAudioElementVolume, useAudioSettings } from "@/hooks/useAudioSettings";
import { applyAudioOutputDevice } from "@/lib/audioOutput";
import { useChatMediaPlayback, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";

interface AudioMessageProps {
  url?: string | null;
  duration?: number;
  isMe: boolean;
  playbackItem?: ChatMediaPlaybackItem | null;
}

export function AudioMessage({ url, duration = 0, isMe, playbackItem }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [metadataReady, setMetadataReady] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metadataWarmupElapsed, setMetadataWarmupElapsed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const durationPrimingRef = useRef(false);
  const { settings } = useAudioSettings();
  const mediaPlayback = useChatMediaPlayback();

  const stopProgressLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const primeInfiniteDuration = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || durationPrimingRef.current || Number.isFinite(audio.duration)) return;

    durationPrimingRef.current = true;
    const previousTime = finiteTime(audio.currentTime);
    let done = false;
    let fallbackTimer: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      audio.removeEventListener("timeupdate", finish);
      audio.removeEventListener("durationchange", finish);

      const nextDuration = readMediaDuration(audio);
      try {
        audio.currentTime = previousTime;
      } catch {
        // Ignore browser-specific seek failures; playback can still proceed.
      }

      durationPrimingRef.current = false;
      if (nextDuration > 0) {
        setDurationSeconds(nextDuration);
        setMetadataReady(true);
        setCurrentTime(clampTime(previousTime, nextDuration));
      }
    };

    audio.addEventListener("timeupdate", finish);
    audio.addEventListener("durationchange", finish);
    fallbackTimer = window.setTimeout(finish, 1500);

    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      finish();
    }
  }, []);

  // Progress must come from the media element. Message metadata can be stale or rounded.
  const syncFromAudio = useCallback((options?: { force?: boolean }) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (durationPrimingRef.current) return;
    const audioDuration = readMediaDuration(audio);
    const nextTime = finiteTime(audio.currentTime);

    if (audioDuration > 0) {
      setDurationSeconds(audioDuration);
      setMetadataReady(true);
    }

    if (options?.force || !seeking) {
      setCurrentTime(clampTime(nextTime, audioDuration));
    }
  }, [seeking]);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const tick = () => {
      syncFromAudio();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopProgressLoop, syncFromAudio]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
    }
  }, [settings.voicePlaybackVolume]);

  useEffect(() => {
    void applyAudioOutputDevice(audioRef.current, settings.selectedOutputDeviceId);
  }, [settings.selectedOutputDeviceId, url]);

  useEffect(() => {
    stopProgressLoop();
    setPlaying(false);
    setCurrentTime(0);
    setDurationSeconds(0);
    setMetadataReady(false);
    setSeeking(false);
    setLoadError(null);
    setMetadataWarmupElapsed(false);

    const audio = audioRef.current;
    if (!audio || !url) return;

    audio.preload = "auto";
    audio.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
    audio.load();

    const syncTimer = window.setTimeout(() => {
      const nextDuration = readMediaDuration(audio);
      if (nextDuration > 0) {
        setDurationSeconds(nextDuration);
        setMetadataReady(true);
      } else if (audio.duration === Infinity) {
        primeInfiniteDuration();
      }
      setMetadataWarmupElapsed(true);
    }, 1200);

    return () => window.clearTimeout(syncTimer);
  }, [duration, url, stopProgressLoop, primeInfiniteDuration]);

  useEffect(() => stopProgressLoop, [stopProgressLoop]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !url || loadError) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      stopProgressLoop();
      syncFromAudio({ force: true });
    }
    else {
      audio.volume = clampAudioElementVolume(settings.voicePlaybackVolume);
      if (audio.ended || (durationSeconds > 0 && audio.currentTime >= durationSeconds)) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      if (playbackItem) {
        mediaPlayback.play(playbackItem, audio);
        return;
      }
      void audio.play().then(() => setPlaying(true)).catch((err) => {
        console.error("[voice] playback failed:", err);
        setPlaying(false);
      });
    }
  };

  const handlePlay = () => {
    setPlaying(true);
    if (playbackItem && audioRef.current) mediaPlayback.activate(playbackItem, audioRef.current);
    startProgressLoop();
  };

  const handlePause = () => {
    setPlaying(false);
    stopProgressLoop();
    syncFromAudio({ force: true });
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextDuration = readMediaDuration(audio);
    setDurationSeconds(nextDuration);
    setMetadataReady(nextDuration > 0);
    if (nextDuration === 0 && audio.duration === Infinity) {
      primeInfiniteDuration();
      return;
    }
    syncFromAudio({ force: true });
  };

  const handleEnded = () => {
    const audio = audioRef.current;
    stopProgressLoop();
    setPlaying(false);
    if (audio) {
      const audioDuration = readMediaDuration(audio);
      setDurationSeconds(audioDuration);
      setCurrentTime(audioDuration > 0 ? audioDuration : finiteTime(audio.currentTime));
    }
  };

  const commitSeek = useCallback((nextTime: number) => {
    const audio = audioRef.current;
    if (!audio || durationSeconds <= 0) return;
    const safeTime = clampTime(nextTime, durationSeconds);
    audio.currentTime = safeTime;
    setCurrentTime(safeTime);
  }, [durationSeconds]);

  const handleSeekChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.currentTarget.value);
    if (!Number.isFinite(nextTime)) return;
    commitSeek(nextTime);
  };

  const finishSeek = (e: PointerEvent<HTMLInputElement>) => {
    if (e.currentTarget.disabled) return;
    setSeeking(false);
    syncFromAudio({ force: true });
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  const srcReady = Boolean(url);
  const canSeek = srcReady && metadataReady && durationSeconds > 0 && !loadError;
  const canPlayAudio = srcReady && !loadError && (metadataReady || metadataWarmupElapsed);
  const progressRatio = useMemo(() => {
    if (durationSeconds <= 0) return 0;
    return Math.min(1, Math.max(0, currentTime / durationSeconds));
  }, [currentTime, durationSeconds]);
  const trackColor = isMe ? "var(--kub-border-color)" : "var(--kub-surface-3)";

  return (
    <div className="flex w-[min(230px,calc(100vw-7.5rem))] max-w-full min-w-0 items-center gap-2.5" data-voice-message="true">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={handleLoadedMetadata}
          onLoadedData={handleLoadedMetadata}
          onCanPlay={handleLoadedMetadata}
          onCanPlayThrough={handleLoadedMetadata}
          onProgress={() => syncFromAudio()}
          onTimeUpdate={() => syncFromAudio()}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onError={() => {
            stopProgressLoop();
            setPlaying(false);
            setLoadError("Не удалось загрузить голосовое сообщение");
          }}
        />
      )}

      <button
        onClick={toggle}
        disabled={!canPlayAudio}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
      >
        {playing ? <KubIcon name="pause" size={16} /> : <KubIcon name="play" size={16} className="ml-0.5" />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          aria-label="Перемотка голосового сообщения"
          type="range"
          min={0}
          max={durationSeconds > 0 ? durationSeconds : 0}
          step="0.01"
          value={durationSeconds > 0 ? Math.min(currentTime, durationSeconds) : 0}
          disabled={!canSeek}
          data-voice-progress="track"
          data-audio-src-ready={srcReady ? "true" : "false"}
          className="h-1.5 w-full min-w-0 max-w-full cursor-pointer appearance-none rounded-full bg-transparent disabled:cursor-not-allowed [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--kub-cyan)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-ms-thumb]:h-3 [&::-ms-thumb]:w-3 [&::-ms-thumb]:rounded-full [&::-ms-thumb]:border-0 [&::-ms-thumb]:bg-[var(--kub-cyan)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--kub-cyan)]"
          style={{
            background: `linear-gradient(to right, var(--kub-cyan) ${progressRatio * 100}%, ${trackColor} ${progressRatio * 100}%)`,
          }}
          onPointerDown={(e) => {
            if (!e.currentTarget.disabled) setSeeking(true);
          }}
          onPointerUp={finishSeek}
          onPointerCancel={finishSeek}
          onChange={handleSeekChange}
        />
        <span className="text-[10px] text-[color:var(--kub-muted)]">
          {loadError || (!url ? "загрузка..." : `${fmt(currentTime)} / ${metadataReady ? fmt(durationSeconds) : "--:--"}`)}
        </span>
      </div>
    </div>
  );
}

function finiteDuration(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteTime(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function clampTime(value: number, duration: number) {
  const safeValue = finiteTime(value);
  const safeDuration = finiteDuration(duration);
  return safeDuration > 0 ? Math.min(safeDuration, Math.max(0, safeValue)) : safeValue;
}

function readMediaDuration(audio: HTMLAudioElement) {
  const directDuration = finiteDuration(audio.duration);
  if (directDuration > 0) return directDuration;

  const seekable = audio.seekable;
  try {
    if (seekable.length === 0) return 0;
    const end = finiteDuration(seekable.end(seekable.length - 1));
    if (end > 0) return end;
  } catch {
    return 0;
  }

  return 0;
}
