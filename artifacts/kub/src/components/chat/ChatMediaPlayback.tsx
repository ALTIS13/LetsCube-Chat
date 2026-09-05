"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { KubIcon } from "@/components/kub";
import { applyAudioOutputDevice } from "@/lib/audioOutput";
import { reportError } from "@/lib/monitoring";
import { clampAudioElementVolume, useAudioSettings } from "@/hooks/useAudioSettings";
import { cn } from "@/lib/utils";
import { replacePlaybackItemUrl } from "@/lib/mediaQuality";

export type ChatMediaPlaybackKind = "voice" | "audio" | "video" | "video_message";

export interface ChatMediaPlaybackItem {
  id: string;
  chatId: string;
  kind: ChatMediaPlaybackKind;
  url: string;
  title: string;
  subtitle?: string | null;
  durationMs?: number | null;
  isStaged?: boolean;
}

interface ChatMediaPlaybackContextValue {
  currentItem: ChatMediaPlaybackItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  playbackRate: number;
  volume: number;
  error: string | null;
  isCurrent: (itemId: string) => boolean;
  activate: (item: ChatMediaPlaybackItem, element: HTMLMediaElement) => void;
  play: (item: ChatMediaPlaybackItem, element?: HTMLMediaElement | null) => void;
  toggle: (item: ChatMediaPlaybackItem, element?: HTMLMediaElement | null) => void;
  pause: () => void;
  seek: (time: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
  closeIfCurrent: (itemId: string) => void;
  replaceCurrentItemUrl: (itemId: string, nextUrl: string, options?: { suppressCurrentError?: boolean }) => void;
  canNext: boolean;
  canPrevious: boolean;
}

const ChatMediaPlaybackContext = createContext<ChatMediaPlaybackContextValue | null>(null);

const PLAYBACK_RATES = [0.5, 1, 1.5, 2];
const PLAYBACK_SETTINGS_KEY = "kub.mediaPlayback.v1";

interface PlaybackSettings {
  playbackRate: number;
  volume: number;
}

export function ChatMediaPlaybackProvider({
  chatId,
  playlist,
  children,
}: {
  chatId: string;
  playlist: ChatMediaPlaybackItem[];
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const progressFrameRef = useRef<number | null>(null);
  const lastProgressSyncRef = useRef(0);
  const activeElementRef = useRef<HTMLMediaElement | null>(null);
  const suppressedErrorItemIdRef = useRef<string | null>(null);
  const [activeElement, setActiveElement] = useState<HTMLMediaElement | null>(null);
  const [currentItem, setCurrentItem] = useState<ChatMediaPlaybackItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSettings, setPlaybackSettings] = useState<PlaybackSettings>(() => readPlaybackSettings());
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useAudioSettings();
  const playbackRate = playbackSettings.playbackRate;
  const volume = playbackSettings.volume;

  const playlistIndex = useMemo(() => {
    if (!currentItem || currentItem.isStaged) return -1;
    return playlist.findIndex((item) => item.id === currentItem.id);
  }, [currentItem, playlist]);
  const canPrevious = playlistIndex > 0;
  const canNext = playlistIndex >= 0 && playlistIndex < playlist.length - 1;
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const stopProgressLoop = useCallback(() => {
    if (progressFrameRef.current !== null) {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
  }, []);

  const syncFromElement = useCallback((element: HTMLMediaElement) => {
    const nextDuration = readMediaDuration(element);
    setDuration(nextDuration);
    setCurrentTime(finiteTime(element.currentTime));
    setIsPlaying(!element.paused && !element.ended);
  }, []);

  const startProgressLoop = useCallback((element: HTMLMediaElement) => {
    stopProgressLoop();
    lastProgressSyncRef.current = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastProgressSyncRef.current >= 50) {
        lastProgressSyncRef.current = timestamp;
        syncFromElement(element);
      }
      if (!element.paused && !element.ended) {
        progressFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        progressFrameRef.current = null;
      }
    };
    progressFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopProgressLoop, syncFromElement]);

  useEffect(() => {
    void applyAudioOutputDevice(audioRef.current, settings.selectedOutputDeviceId);
  }, [settings.selectedOutputDeviceId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    writePlaybackSettings(playbackSettings);
  }, [playbackSettings]);

  useEffect(() => {
    if (!currentItem || currentItem.chatId === chatId || currentItem.isStaged) return;
    close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, currentItem?.chatId]);

  useEffect(() => {
    activeElementRef.current = activeElement;
  }, [activeElement]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      stopProgressLoop();
      activeElementRef.current?.pause();
    };
  }, [stopProgressLoop]);

  useEffect(() => {
    if (!activeElement) return;

    const sync = () => {
      syncFromElement(activeElement);
    };
    const handlePlay = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setVisible(true);
      setIsPlaying(true);
      sync();
      startProgressLoop(activeElement);
    };
    const handlePause = () => {
      stopProgressLoop();
      setIsPlaying(false);
      sync();
    };
    const handleEnded = () => {
      stopProgressLoop();
      sync();
      setIsPlaying(false);
      hideTimerRef.current = window.setTimeout(() => setVisible(false), 2200);
    };
    const handleError = () => {
      if (suppressedErrorItemIdRef.current === currentItem?.id) {
        suppressedErrorItemIdRef.current = null;
        setError(null);
        return;
      }
      stopProgressLoop();
      setIsPlaying(false);
      setError("Не удалось воспроизвести медиа.");
      reportError(new Error("media_element_error"), {
        category: "media_playback_failed",
        mediaKind: currentItem?.kind,
        staged: currentItem?.isStaged,
      });
      setVisible(true);
    };

    activeElement.addEventListener("timeupdate", sync);
    activeElement.addEventListener("loadedmetadata", sync);
    activeElement.addEventListener("durationchange", sync);
    activeElement.addEventListener("play", handlePlay);
    activeElement.addEventListener("pause", handlePause);
    activeElement.addEventListener("ended", handleEnded);
    activeElement.addEventListener("error", handleError);
    sync();

    return () => {
      stopProgressLoop();
      activeElement.removeEventListener("timeupdate", sync);
      activeElement.removeEventListener("loadedmetadata", sync);
      activeElement.removeEventListener("durationchange", sync);
      activeElement.removeEventListener("play", handlePlay);
      activeElement.removeEventListener("pause", handlePause);
      activeElement.removeEventListener("ended", handleEnded);
      activeElement.removeEventListener("error", handleError);
    };
  }, [activeElement, currentItem?.id, currentItem?.isStaged, currentItem?.kind, startProgressLoop, stopProgressLoop, syncFromElement]);

  const mediaElementForItem = useCallback((item: ChatMediaPlaybackItem) => {
    return item.kind === "voice" || item.kind === "audio" ? audioRef.current : videoRef.current;
  }, []);

  const activate = useCallback((item: ChatMediaPlaybackItem, element: HTMLMediaElement) => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setError(null);
    setVisible(true);
    setCurrentItem(item);
    setActiveElement((previous) => {
      if (previous && previous !== element) previous.pause();
      return element;
    });
    element.playbackRate = playbackRate;
    element.volume = volume;
    if (element instanceof HTMLAudioElement) {
      void applyAudioOutputDevice(element, settings.selectedOutputDeviceId);
    }
  }, [playbackRate, settings.selectedOutputDeviceId, volume]);

  const play = useCallback((item: ChatMediaPlaybackItem, element?: HTMLMediaElement | null) => {
    const media = element ?? mediaElementForItem(item);
    if (!media || !item.url) return;
    activate(item, media);
    if (media.src !== item.url) {
      media.src = item.url;
      media.load();
    }
    media.playbackRate = playbackRate;
    media.volume = volume;
    setIsPlaying(true);
    void media.play().catch((error) => {
      setIsPlaying(false);
      setError("Не удалось воспроизвести медиа.");
      reportError(error, {
        category: "media_playback_failed",
        mediaKind: item.kind,
        staged: item.isStaged,
      });
      setVisible(true);
    });
  }, [activate, mediaElementForItem, playbackRate, volume]);

  const pause = useCallback(() => {
    activeElement?.pause();
    setIsPlaying(false);
  }, [activeElement]);

  const toggle = useCallback((item: ChatMediaPlaybackItem, element?: HTMLMediaElement | null) => {
    const media = element ?? (currentItem?.id === item.id ? activeElement : mediaElementForItem(item));
    if (!media) return;
    if (currentItem?.id !== item.id || activeElement !== media) {
      play(item, media);
      return;
    }
    if (media.paused || media.ended) {
      if (media.ended) media.currentTime = 0;
      play(item, media);
      return;
    }
    media.pause();
  }, [activeElement, currentItem?.id, mediaElementForItem, play]);

  const seek = useCallback((time: number) => {
    if (!activeElement || !Number.isFinite(time)) return;
    const nextTime = Math.max(0, duration > 0 ? Math.min(time, duration) : time);
    activeElement.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [activeElement, duration]);

  const setRate = useCallback((rate: number) => {
    const nextRate = normalizePlaybackRate(rate);
    setPlaybackSettings((previousSettings) => ({ ...previousSettings, playbackRate: nextRate }));
    if (activeElement) activeElement.playbackRate = nextRate;
  }, [activeElement]);

  const setVolume = useCallback((nextVolume: number) => {
    const safeVolume = normalizeVolume(nextVolume);
    setPlaybackSettings((previousSettings) => ({ ...previousSettings, volume: safeVolume }));
    if (activeElement) activeElement.volume = safeVolume;
  }, [activeElement]);

  const previous = useCallback(() => {
    if (!canPrevious) return;
    play(playlist[playlistIndex - 1]);
  }, [canPrevious, play, playlist, playlistIndex]);

  const next = useCallback(() => {
    if (!canNext) return;
    play(playlist[playlistIndex + 1]);
  }, [canNext, play, playlist, playlistIndex]);

  const close = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    stopProgressLoop();
    activeElement?.pause();
    setVisible(false);
    setCurrentItem(null);
    setActiveElement(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [activeElement, stopProgressLoop]);

  const closeIfCurrent = useCallback((itemId: string) => {
    if (currentItem?.id === itemId) close();
  }, [close, currentItem?.id]);

  const replaceCurrentItemUrl = useCallback((
    itemId: string,
    nextUrl: string,
    options: { suppressCurrentError?: boolean } = {},
  ) => {
    if (options.suppressCurrentError && currentItem?.id === itemId) {
      suppressedErrorItemIdRef.current = itemId;
    } else if (suppressedErrorItemIdRef.current === itemId) {
      suppressedErrorItemIdRef.current = null;
    }
    setCurrentItem((current) => replacePlaybackItemUrl(current, itemId, nextUrl));
    setError(null);
  }, [currentItem?.id]);

  const value = useMemo<ChatMediaPlaybackContextValue>(() => ({
    currentItem: visible ? currentItem : null,
    isPlaying,
    currentTime,
    duration,
    progress,
    playbackRate,
    volume,
    error,
    isCurrent: (itemId) => visible && currentItem?.id === itemId,
    activate,
    play,
    toggle,
    pause,
    seek,
    setRate,
    setVolume,
    next,
    previous,
    close,
    closeIfCurrent,
    replaceCurrentItemUrl,
    canNext,
    canPrevious,
  }), [
    activate,
    canNext,
    canPrevious,
    close,
    closeIfCurrent,
    currentItem,
    currentTime,
    duration,
    error,
    isPlaying,
    next,
    pause,
    playbackRate,
    play,
    previous,
    progress,
    replaceCurrentItemUrl,
    seek,
    setRate,
    setVolume,
    toggle,
    visible,
    volume,
  ]);

  return (
    <ChatMediaPlaybackContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <video ref={videoRef} preload="metadata" playsInline className="hidden" />
    </ChatMediaPlaybackContext.Provider>
  );
}

export function useChatMediaPlayback() {
  const context = useContext(ChatMediaPlaybackContext);
  if (!context) {
    const noop = () => undefined;
    return {
      currentItem: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      progress: 0,
      playbackRate: 1,
      volume: 1,
      error: null,
      isCurrent: () => false,
      activate: noop,
      play: noop,
      toggle: noop,
      pause: noop,
      seek: noop,
      setRate: noop,
      setVolume: noop,
      next: noop,
      previous: noop,
      close: noop,
      closeIfCurrent: noop,
      replaceCurrentItemUrl: noop,
      canNext: false,
      canPrevious: false,
    } satisfies ChatMediaPlaybackContextValue;
  }
  return context;
}

export function ChatMediaPlaybackBar({ compact = false }: { compact?: boolean } = {}) {
  const playback = useChatMediaPlayback();
  const item = playback.currentItem;
  if (!item) return null;

  const duration = playback.duration || (item.durationMs ? item.durationMs / 1000 : 0);
  const elapsedLabel = formatMediaTime(playback.currentTime);
  const durationLabel = duration > 0 ? formatMediaTime(duration) : "--:--";

  return (
    <div
      data-testid="chat-media-playback-bar"
      data-placement={compact ? "header" : "standalone"}
      data-current-kind={item.kind}
      className={cn(
        "overflow-hidden border border-[color:var(--kub-border-color)] bg-[color-mix(in_srgb,var(--kub-surface)_92%,var(--kub-cyan)_8%)] shadow-lg transition-all",
        compact ? "mx-2 mb-2 rounded-xl sm:mx-3" : "mx-2 mt-2 rounded-2xl sm:mx-3"
      )}
    >
      <div className={cn(
        "flex min-w-0 flex-col gap-2 px-2.5 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-3",
        compact && "py-1.5"
      )}>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-black/80 text-white",
            item.kind === "video_message" ? "rounded-full" : "rounded-xl"
          )}>
            <KubIcon name={item.kind === "voice" || item.kind === "audio" ? "voice" : "video"} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{item.title}</div>
              {item.isStaged && (
                <span className="shrink-0 rounded-full bg-[var(--kub-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--kub-muted)]">
                  предпросмотр
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-[color:var(--kub-muted)]">
              {playback.error ?? item.subtitle ?? "Медиа в текущем чате"}
            </div>
            <div className="mt-1.5 flex min-w-0 items-center gap-2">
              <span className="w-9 shrink-0 text-[10px] tabular-nums text-[color:var(--kub-muted)]">{elapsedLabel}</span>
              <input
                data-testid="chat-media-playback-progress"
                type="range"
                min={0}
                max={duration > 0 ? duration : 0}
                step="0.01"
                value={duration > 0 ? Math.min(playback.currentTime, duration) : 0}
                disabled={duration <= 0}
                onChange={(event) => playback.seek(Number(event.currentTarget.value))}
                className="h-1.5 min-w-[80px] flex-1 cursor-pointer appearance-none rounded-full bg-[var(--kub-surface-3)] accent-[var(--kub-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Позиция воспроизведения"
              />
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[color:var(--kub-muted)]">{durationLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center justify-between gap-1 sm:w-auto sm:justify-start">
          <button
            type="button"
            onClick={playback.previous}
            disabled={!playback.canPrevious}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            aria-label="Предыдущее медиа"
          >
            <KubIcon name="chevronLeft" size={18} />
          </button>
          <button
            type="button"
            onClick={() => (playback.isPlaying ? playback.pause() : item && playback.play(item))}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] transition hover:brightness-110"
            aria-label={playback.isPlaying ? "Пауза" : "Воспроизвести"}
          >
            <KubIcon name={playback.isPlaying ? "pause" : "play"} size={16} />
          </button>
          <button
            type="button"
            onClick={playback.next}
            disabled={!playback.canNext}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            aria-label="Следующее медиа"
          >
            <KubIcon name="chevronRight" size={18} />
          </button>
          <select
            data-testid="chat-media-playback-speed"
            value={playback.playbackRate}
            onChange={(event) => playback.setRate(Number(event.currentTarget.value))}
            className="h-8 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-1.5 text-xs text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            aria-label="Скорость воспроизведения"
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>{rate}x</option>
            ))}
          </select>
          <label
            className="flex h-8 items-center gap-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-1.5 text-[color:var(--kub-muted)]"
            title="Р“СЂРѕРјРєРѕСЃС‚СЊ"
          >
            <KubIcon name="volume" size={14} />
            <input
              data-testid="chat-media-playback-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.volume}
              onInput={(event) => playback.setVolume(Number(event.currentTarget.value))}
              onChange={(event) => playback.setVolume(Number(event.currentTarget.value))}
              className="h-1.5 w-14 cursor-pointer appearance-none rounded-full bg-[var(--kub-surface-3)] accent-[var(--kub-cyan)] sm:w-16"
              aria-label="Р“СЂРѕРјРєРѕСЃС‚СЊ РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёСЏ"
            />
          </label>
          <button
            type="button"
            data-testid="chat-media-playback-close"
            onClick={playback.close}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover"
            aria-label="Закрыть панель воспроизведения"
          >
            <KubIcon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function VideoCircleProgressRing({
  progress,
  className,
  testId,
}: {
  progress: number;
  className?: string;
  testId?: string;
}) {
  const safeProgress = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const style = {
    "--kub-video-ring-progress": `${Math.round(safeProgress * 360)}deg`,
  } as CSSProperties;

  return (
    <span
      data-testid={testId}
      className={cn("pointer-events-none absolute -inset-1 rounded-full p-[3px]", className)}
      style={{
        ...style,
        background: "conic-gradient(var(--kub-cyan) var(--kub-video-ring-progress), color-mix(in_srgb,var(--kub-cyan)_18%,transparent) 0deg)",
      }}
      aria-hidden="true"
    >
      <span className="block h-full w-full rounded-full border border-black/35" />
    </span>
  );
}

function readPlaybackSettings(): PlaybackSettings {
  if (typeof window === "undefined") return { playbackRate: 1, volume: 1 };
  try {
    const raw = window.localStorage.getItem(PLAYBACK_SETTINGS_KEY);
    if (!raw) return { playbackRate: 1, volume: 1 };
    const parsed = JSON.parse(raw) as Partial<PlaybackSettings>;
    return {
      playbackRate: normalizePlaybackRate(Number(parsed.playbackRate)),
      volume: normalizeVolume(Number(parsed.volume)),
    };
  } catch {
    return { playbackRate: 1, volume: 1 };
  }
}

function writePlaybackSettings(settings: PlaybackSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYBACK_SETTINGS_KEY, JSON.stringify({
      playbackRate: normalizePlaybackRate(settings.playbackRate),
      volume: normalizeVolume(settings.volume),
    }));
  } catch {
    // Local storage can be unavailable in private mode; playback still works.
  }
}

function normalizePlaybackRate(rate: number): number {
  return PLAYBACK_RATES.includes(rate) ? rate : 1;
}

function normalizeVolume(volume: number): number {
  return clampAudioElementVolume(Number.isFinite(volume) ? volume : 1);
}

function readMediaDuration(element: HTMLMediaElement): number {
  return Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
}

function finiteTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatMediaTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const secs = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}
