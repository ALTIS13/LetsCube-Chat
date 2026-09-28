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
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { applyAudioOutputDevice } from "@/lib/audioOutput";
import { reportError } from "@/lib/monitoring";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { cn } from "@/lib/utils";
import { replacePlaybackItemUrl } from "@/lib/mediaQuality";
import { coarsePointer } from "@/lib/pointer";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { nextToggleSpeed, playerMoment, speedLabel } from "@/lib/chatTopCard";
import {
  AUDIO_SETTINGS_KEY,
  PLAYBACK_RATES,
  PLAYBACK_SETTINGS_KEY,
  DEFAULT_PLAYBACK,
  elementVolume,
  normalizePlaybackRate,
  normalizeVolume,
  readStoredPlayback,
  type StoredPlayback,
} from "@/lib/playbackVolume";

export type ChatMediaPlaybackKind = "voice" | "audio" | "video" | "video_message";

export interface ChatMediaPlaybackItem {
  id: string;
  chatId: string;
  kind: ChatMediaPlaybackKind;
  url: string;
  title: string;
  subtitle?: string | null;
  /** When the message was sent, for the player's row: «Никита Фермер 06 сент. в 18:20». */
  sentAt?: string | null;
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
  /**
   * D-313. The bubble's element is going away with its chat: carry on from the
   * same second on the player's own. A no-op unless this is the application's
   * player and the element is the one playing.
   */
  detach: (itemId: string, element: HTMLMediaElement) => void;
  /** Whether this element is the one the player drives right now. */
  isActiveElement: (element: HTMLMediaElement | null) => boolean;
  /** The chat on screen, as far as the application's player knows; null outside one. */
  openChatId: string | null;
  /** Present on the application's player only: a chat announces itself and its media. */
  registerChat?: (chatId: string, playlist: ChatMediaPlaybackItem[]) => void;
  leaveChat?: (chatId: string) => void;
}

const EMPTY_PLAYLIST: ChatMediaPlaybackItem[] = [];

const ChatMediaPlaybackContext = createContext<ChatMediaPlaybackContextValue | null>(null);

/**
 * A conversation's media player.
 *
 * Mounted once for the application (D-313), a chat's `ChatMediaPlaybackProvider`
 * only tells it which chat is open and what that chat can play, so a voice
 * message keeps going when its chat is left — Telegram's behaviour, which the
 * tester asked for: a long one can be heard while writing to somebody else.
 * Where nothing wraps a chat (a fixture, a capture page), the chat's provider
 * is a player of its own again, exactly as before.
 */
export function ChatMediaPlaybackProvider({
  chatId,
  playlist,
  children,
}: {
  chatId: string;
  playlist: ChatMediaPlaybackItem[];
  children: ReactNode;
}) {
  const outer = useContext(ChatMediaPlaybackContext);
  if (outer?.registerChat && outer.leaveChat) {
    return (
      <ChatPlaylistRegistration register={outer.registerChat} leave={outer.leaveChat} chatId={chatId} playlist={playlist}>
        {children}
      </ChatPlaylistRegistration>
    );
  }
  return <MediaPlaybackEngine chatId={chatId} playlist={playlist}>{children}</MediaPlaybackEngine>;
}

/** The application's player, around everything that can show a chat. */
export function AppMediaPlaybackProvider({ children }: { children: ReactNode }) {
  return <MediaPlaybackEngine appLevel>{children}</MediaPlaybackEngine>;
}

function ChatPlaylistRegistration({
  register,
  leave,
  chatId,
  playlist,
  children,
}: {
  register: (chatId: string, playlist: ChatMediaPlaybackItem[]) => void;
  leave: (chatId: string) => void;
  chatId: string;
  playlist: ChatMediaPlaybackItem[];
  children: ReactNode;
}) {
  useEffect(() => {
    register(chatId, playlist);
  }, [register, chatId, playlist]);
  useEffect(() => () => leave(chatId), [leave, chatId]);
  return <>{children}</>;
}

function MediaPlaybackEngine({
  chatId: chatIdProp = null,
  playlist: playlistProp = EMPTY_PLAYLIST,
  appLevel = false,
  children,
}: {
  chatId?: string | null;
  playlist?: ChatMediaPlaybackItem[];
  appLevel?: boolean;
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
  const currentItemRef = useRef<ChatMediaPlaybackItem | null>(null);
  // The application's player learns the open chat and each chat's media from
  // the chats themselves; a chat's own player was given them.
  const [registered, setRegistered] = useState<{
    openChatId: string | null;
    playlists: Record<string, ChatMediaPlaybackItem[]>;
  }>({ openChatId: null, playlists: {} });
  const chatId = appLevel ? registered.openChatId : chatIdProp;
  const playlist = appLevel
    ? (currentItem ? registered.playlists[currentItem.chatId] ?? EMPTY_PLAYLIST : EMPTY_PLAYLIST)
    : playlistProp;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSettings, setPlaybackSettings] = useState<StoredPlayback>(() => readPlaybackSettings());
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useAudioSettings();
  const playbackRate = playbackSettings.playbackRate;
  // The one volume every element in a conversation is set to — this provider is
  // the only thing that writes `.volume` now (D-149) — and under a finger it is
  // the device's own (D-118). Both rules live in `lib/playbackVolume.ts`.
  const volume = elementVolume(playbackSettings.volume, coarsePointer());

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
    currentItemRef.current = currentItem;
  }, [currentItem]);

  // A voice message or a track goes on when its chat is left (D-313); a video
  // is a picture and ends with the chat it is drawn in, and so does a draft
  // being previewed in the composer.
  useEffect(() => {
    if (!currentItem || currentItem.chatId === chatId) return;
    const audible = (currentItem.kind === "voice" || currentItem.kind === "audio") && !currentItem.isStaged;
    if (audible) return;
    if (!appLevel && currentItem.isStaged) return;
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

  const registerChat = useCallback((openChatId: string, items: ChatMediaPlaybackItem[]) => {
    setRegistered((previous) => ({ openChatId, playlists: { ...previous.playlists, [openChatId]: items } }));
  }, []);

  const leaveChat = useCallback((leftChatId: string) => {
    setRegistered((previous) => (previous.openChatId === leftChatId ? { ...previous, openChatId: null } : previous));
  }, []);

  const detach = useCallback((itemId: string, element: HTMLMediaElement) => {
    if (!appLevel) return;
    const item = currentItemRef.current;
    if (!item || item.id !== itemId || activeElementRef.current !== element) return;
    if (item.kind !== "voice" && item.kind !== "audio") return;
    const own = audioRef.current;
    if (!own || own === element) return;
    // Read before anything else: removing a media element from the document
    // pauses it, and this runs while it is still in place.
    const wasPlaying = !element.paused && !element.ended;
    const at = finiteTime(element.currentTime);
    const source = element.currentSrc || element.src || item.url;
    element.pause();
    if (own.src !== source) own.src = source;
    try {
      own.currentTime = at;
    } catch {
      // Before metadata some engines refuse; the listener below puts it back.
    }
    own.addEventListener("loadedmetadata", () => {
      if (Math.abs(finiteTime(own.currentTime) - at) > 0.5) {
        try {
          own.currentTime = at;
        } catch {
          // Leaves it at the start, which is the old behaviour.
        }
      }
    }, { once: true });
    own.playbackRate = element.playbackRate;
    own.volume = element.volume;
    void applyAudioOutputDevice(own, settings.selectedOutputDeviceId);
    activeElementRef.current = own;
    setActiveElement(own);
    if (!wasPlaying) {
      setIsPlaying(false);
      return;
    }
    void own.play().catch((error) => {
      setIsPlaying(false);
      reportError(error, { category: "media_playback_failed", mediaKind: item.kind, staged: false });
    });
  }, [appLevel, settings.selectedOutputDeviceId]);

  const isActiveElement = useCallback(
    (element: HTMLMediaElement | null) => Boolean(element) && activeElementRef.current === element,
    [],
  );

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
    detach,
    isActiveElement,
    openChatId: chatId,
    registerChat: appLevel ? registerChat : undefined,
    leaveChat: appLevel ? leaveChat : undefined,
  }), [
    appLevel,
    chatId,
    detach,
    isActiveElement,
    leaveChat,
    registerChat,
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
      detach: noop,
      isActiveElement: () => false,
      openChatId: null,
    } satisfies ChatMediaPlaybackContextValue;
  }
  return context;
}

type PlaybackRowRounding = "bottom" | "all";

const ROW_ROUNDING: Record<PlaybackRowRounding, string> = {
  bottom: "rounded-b-[1.375rem]",
  all: "rounded-[1.375rem]",
};

const ROW_CONTROL =
  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

/**
 * The player, as one row (tracker item 70).
 *
 * The owner put ours beside Telegram's on 2026-09-28: ours a card a third of a
 * phone's screen tall — a tile, a title and the sender, a time, a seek slider
 * and a duration, then previous, play, next, a speed list and a cross — and
 * Telegram's one line. Telegram's is `FragmentContextView` (DrKLO/Telegram,
 * master, read 2026-09-28): 36 high; play or pause in the accent at the left;
 * the sender in bold and the date after it; the speed as a «1X» chip that a tap
 * moves through 1, 1.5 and 2 and a long press opens the list of; a cross; and
 * how far it has got as a 2-high line along the foot. No slider, no previous
 * and next — the message's own waveform seeks.
 *
 * Three things differ, each for a reason. It is 40 high, so the 2-high line
 * runs under the 36-wide controls rather than across them. The line seeks
 * under a mouse: Telegram Desktop seeks music from the same slider in its bar
 * (`media_player_widget.cpp`, tdesktop dev, read 2026-09-28) and leaves voice
 * and round video out only because its player cannot seek them yet — «Round
 * video seek is not supported for now :(» — which ours can. Under a finger it
 * does not, as Telegram Android's does not, so a tap near the card's edge
 * cannot jump the playback. And a computer keeps its volume (D-118), behind
 * an icon that shows the slider while it is pointed at, as Telegram Desktop's
 * volume button does.
 */
export function PlaybackRow({ placement, rounding }: { placement: "chat" | "list"; rounding: PlaybackRowRounding }) {
  const playback = useChatMediaPlayback();
  const item = playback.currentItem;
  if (!item) return null;

  const duration = playback.duration || (item.durationMs ? item.durationMs / 1000 : 0);
  const position = duration > 0 ? Math.min(playback.currentTime, duration) : 0;
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const elsewhere = item.chatId !== playback.openChatId;
  const sender = item.isStaged ? item.title : item.subtitle?.trim() || item.title;
  const moment = item.isStaged ? "предпросмотр" : playerMoment(item.sentAt);
  const edge = ROW_ROUNDING[rounding];

  // Telegram's bar takes you to the message it is playing: into its chat from
  // anywhere else (D-313), and to it in its own chat.
  const goToMessage = () => {
    if (!elsewhere) {
      requestChatMessageJump(item.chatId, item.id);
      return;
    }
    void safeOpenChat(item.chatId, {
      unavailableMessage: "Чат недоступен или был удалён.",
      unavailableTitle: "Чат недоступен",
    }).then((opened) => {
      if (!opened) return;
      // The pane has to mount before it can take the jump; global search waits
      // the same two beats.
      window.setTimeout(() => requestChatMessageJump(item.chatId, item.id), 250);
      window.setTimeout(() => requestChatMessageJump(item.chatId, item.id), 700);
    });
  };

  const words = (
    <>
      <span className="min-w-0 truncate font-semibold text-[color:var(--kub-text)]">{sender}</span>
      {playback.error ? (
        <span className="min-w-0 truncate text-[color:var(--kub-danger-text)]">{playback.error}</span>
      ) : moment ? (
        <span className="shrink-0 text-[color:var(--kub-muted)]">{moment}</span>
      ) : null}
    </>
  );
  const wordsClass = "relative flex min-w-0 flex-1 items-baseline gap-1.5 px-1 text-left text-[14px] leading-5";

  return (
    <div
      data-testid="chat-media-playback-bar"
      data-placement={placement}
      data-current-kind={item.kind}
      role="group"
      aria-label="Воспроизведение"
      className={cn("relative flex h-10 min-w-0 items-center gap-0.5 px-1", edge)}
    >
      {/* The foot of the row, clipped to the card's corners: the progress line,
          and over it the band that seeks under a mouse. First in the markup so
          the controls paint over the band where the two meet. */}
      <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", edge)}>
        <input
          data-testid="chat-media-playback-progress"
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step="0.01"
          value={position}
          disabled={duration <= 0}
          onChange={(event) => playback.seek(Number(event.currentTarget.value))}
          className="peer pointer-events-auto absolute inset-x-0 bottom-0 h-2 w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default pointer-coarse:pointer-events-none"
          aria-label="Позиция воспроизведения"
        />
        <span
          aria-hidden="true"
          data-testid="chat-media-playback-line"
          className="absolute bottom-0 left-0 h-[2px] rounded-full bg-[var(--kub-cyan)] transition-[height] duration-150 peer-hover:h-1 peer-focus-visible:h-1 motion-reduce:transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <button
        type="button"
        onClick={() => (playback.isPlaying ? playback.pause() : playback.play(item))}
        className={cn(ROW_CONTROL, "text-[color:var(--kub-cyan)]")}
        aria-label={playback.isPlaying ? "Пауза" : "Воспроизвести"}
      >
        <KubIcon name={playback.isPlaying ? "pause" : "play"} size={18} />
      </button>

      {item.isStaged ? (
        <div className={wordsClass}>{words}</div>
      ) : (
        <button
          type="button"
          data-testid="chat-media-playback-source"
          onClick={goToMessage}
          title={elsewhere ? "Открыть чат с этим сообщением" : "Перейти к сообщению"}
          className={cn(wordsClass, "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]")}
        >
          {words}
        </button>
      )}

      <SpeedChip rate={playback.playbackRate} onRate={playback.setRate} />

      <label
        // A phone's own keys and mixer set how loud it plays, and Telegram draws
        // no slider there; a desktop keeps one (D-118), behind its icon as
        // Telegram Desktop keeps it, and shown while the pointer or the focus is
        // on it (item 70).
        className={cn(ROW_CONTROL, "group/volume cursor-pointer text-[color:var(--kub-muted)] pointer-coarse:hidden")}
        title="Громкость"
      >
        <KubIcon name="volume" size={16} />
        <span className="pointer-events-none absolute right-0 top-full z-30 pt-1.5 opacity-0 transition-opacity duration-150 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100 group-hover/volume:pointer-events-auto group-hover/volume:opacity-100">
          <span className="kub-glass-strong flex h-10 items-center rounded-xl border border-[color:var(--kub-border-color)] px-3">
            <input
              data-testid="chat-media-playback-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.volume}
              onInput={(event) => playback.setVolume(Number(event.currentTarget.value))}
              onChange={(event) => playback.setVolume(Number(event.currentTarget.value))}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-[var(--kub-surface-3)] accent-[var(--kub-cyan)]"
              aria-label="Громкость воспроизведения"
            />
          </span>
        </span>
      </label>

      <button
        type="button"
        data-testid="chat-media-playback-close"
        onClick={playback.close}
        className={cn(ROW_CONTROL, "text-[color:var(--kub-muted)]")}
        aria-label="Закрыть панель воспроизведения"
      >
        <KubIcon name="close" size={16} />
      </button>
    </div>
  );
}

/**
 * The «1X» chip. A tap moves to the next of Telegram's stops; a long press, or
 * a right click on a computer, opens every speed there is. Accent when it is
 * not 1, as Telegram colours its chip.
 */
function SpeedChip({ rate, onRate }: { rate: number; onRate: (rate: number) => void }) {
  const [menu, setMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  // Set when a held finger opened the list, so the click the release sends
  // does not also move the speed.
  const heldRef = useRef(false);

  const clearPress = useCallback(() => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [menu]);

  const accented = Math.abs(rate - 1) > 0.01;
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="chat-media-playback-speed"
        data-rate={rate}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`Скорость воспроизведения ${speedLabel(rate)}`}
        title="Скорость: нажмите, чтобы переключить; удерживайте — все скорости"
        onPointerDown={(event) => {
          heldRef.current = false;
          clearPress();
          if (event.pointerType === "mouse") return;
          pressTimerRef.current = window.setTimeout(() => {
            pressTimerRef.current = null;
            heldRef.current = true;
            setMenu(true);
          }, 450);
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        onContextMenu={(event) => {
          event.preventDefault();
          clearPress();
          setMenu(true);
        }}
        onClick={() => {
          if (heldRef.current) {
            heldRef.current = false;
            return;
          }
          if (menu) {
            setMenu(false);
            return;
          }
          onRate(nextToggleSpeed(rate));
        }}
        className={cn(ROW_CONTROL, "select-none [-webkit-touch-callout:none]")}
      >
        <span
          // Telegram's speed glyph is its number in an outlined box — a line
          // that means something (rule 11) — drawn in the colour of the words.
          className={cn(
            "rounded-[5px] border-[1.5px] border-current px-[3px] text-[11px] font-bold leading-[13px] tabular-nums",
            accented ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]",
          )}
        >
          {speedLabel(rate)}
        </span>
      </button>
      {menu && (
        <div
          role="menu"
          aria-label="Скорость воспроизведения"
          data-testid="chat-media-playback-speed-menu"
          className="kub-glass-strong absolute right-0 top-[calc(100%+6px)] z-30 w-28 rounded-xl border border-[color:var(--kub-border-color)] p-1"
        >
          {PLAYBACK_RATES.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === rate}
              onClick={() => {
                onRate(value);
                setMenu(false);
              }}
              className="flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm tabular-nums text-[color:var(--kub-text)] transition-colors kub-raise-hover"
            >
              <span>{speedLabel(value)}</span>
              {value === rate && <KubIcon name="check" size={14} tone="accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The player over the chat list while a voice message plays with no chat open
 * (D-313) — Telegram keeps its player there. Its own component so that only it
 * follows the playback's many updates; the list does not subscribe. The same
 * row as a conversation's top card, in a card of its own.
 */
export function ListPlaybackBar() {
  const playback = useChatMediaPlayback();
  if (playback.openChatId !== null || !playback.currentItem) return null;
  return (
    <div data-testid="list-playback-card" className="relative mx-2 mb-1.5 flex-shrink-0 sm:mx-3">
      <KubGlassLayer className="rounded-[1.375rem] border border-[color:var(--glass-line)]" />
      <div className="relative">
        <PlaybackRow placement="list" rounding="all" />
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

/**
 * The player's stored rate and volume.
 *
 * The sound settings are read too, and only so that they can be inherited: a
 * volume somebody had set there before D-149 took that second slider away
 * becomes this player's, once, and the next write below makes it the player's
 * own. What that inheritance is and when it stops applying is
 * `readStoredPlayback`'s to say, which is why it takes the two raw strings and
 * this function does nothing but fetch them.
 */
function readPlaybackSettings(): StoredPlayback {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK;
  try {
    return readStoredPlayback(
      window.localStorage.getItem(PLAYBACK_SETTINGS_KEY),
      window.localStorage.getItem(AUDIO_SETTINGS_KEY),
    );
  } catch {
    return DEFAULT_PLAYBACK;
  }
}

function writePlaybackSettings(settings: StoredPlayback) {
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

function readMediaDuration(element: HTMLMediaElement): number {
  return Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
}

function finiteTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

