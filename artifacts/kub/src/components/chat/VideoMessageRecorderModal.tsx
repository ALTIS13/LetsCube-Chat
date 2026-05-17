"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { cn } from "@/lib/utils";

const MAX_DURATION_MS = 60_000;
const TIMER_TICK_MS = 250;
const PREFERRED_MIME_TYPES = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"] as const;

type RecorderStatus = "loading" | "ready" | "recording" | "recorded" | "denied" | "unavailable" | "unsupported" | "error";
type FacingMode = "user" | "environment";
type VideoRecorderVariant = "round" | "regular";

interface RecordedVideo {
  blob: Blob;
  mimeType: string;
  previewUrl: string;
  durationMs: number;
}

interface VideoMessageRecorderModalProps {
  open: boolean;
  onClose: () => void;
  onAddVideo: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  variant?: VideoRecorderVariant;
  autoStart?: boolean;
  autoAddOnStop?: boolean;
  stopSignal?: number;
}

export function VideoMessageRecorderModal({
  open,
  onClose,
  onAddVideo,
  variant = "round",
  autoStart = false,
  autoAddOnStop = false,
  stopSignal = 0,
}: VideoMessageRecorderModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordedRef = useRef<RecordedVideo | null>(null);
  const autoAddOnStopRef = useRef(autoAddOnStop);
  const lastStopSignalRef = useRef(stopSignal);
  const [status, setStatus] = useState<RecorderStatus>("loading");
  const [facingMode, setFacingMode] = useState<FacingMode>(variant === "regular" ? "environment" : "user");
  const [videoInputCount, setVideoInputCount] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [recorded, setRecorded] = useState<RecordedVideo | null>(null);

  useEffect(() => {
    autoAddOnStopRef.current = autoAddOnStop;
  }, [autoAddOnStop]);

  useEffect(() => {
    if (!open) return;
    setFacingMode(variant === "regular" ? "environment" : "user");
  }, [open, variant]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    timerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearRecorded = useCallback(() => {
    const current = recordedRef.current;
    if (current) URL.revokeObjectURL(current.previewUrl);
    recordedRef.current = null;
    setRecorded(null);
  }, []);

  const cleanupRecorder = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        // cleanup path
      }
    }
    chunksRef.current = [];
    startedAtRef.current = 0;
  }, [clearTimers]);

  const startPreview = useCallback(async (nextFacingMode: FacingMode) => {
    cleanupRecorder();
    stopStream();
    clearRecorded();
    setDurationMs(0);
    setStatus("loading");

    if (typeof MediaRecorder === "undefined" || !pickMimeType()) {
      setStatus("unsupported");
      return;
    }

    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }

    try {
      const square = variant === "round";
      const stream = await devices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: nextFacingMode },
          width: { ideal: square ? 720 : 1280 },
          height: { ideal: square ? 720 : 720 },
        },
      });

      if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("unavailable");
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");

      if (devices.enumerateDevices) {
        const availableDevices: MediaDeviceInfo[] = await devices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        setVideoInputCount(availableDevices.filter((device) => device.kind === "videoinput").length);
      }
    } catch (error) {
      stopStream();
      const name = String((error as { name?: unknown } | null)?.name ?? "").toLowerCase();
      if (name.includes("allowed") || name.includes("security")) {
        setStatus("denied");
      } else if (name.includes("found") || name.includes("readable") || name.includes("constrain")) {
        setStatus("unavailable");
      } else {
        setStatus("error");
      }
    }
  }, [cleanupRecorder, clearRecorded, stopStream, variant]);

  useEffect(() => {
    if (!open) return;
    void startPreview(facingMode);
    return () => {
      cleanupRecorder();
      stopStream();
      clearRecorded();
    };
  }, [cleanupRecorder, clearRecorded, facingMode, open, startPreview, stopStream]);

  const finishRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      setStatus("error");
      stopStream();
    }
  }, [clearTimers, stopStream]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (!stream || !mimeType || status !== "ready") return;

    chunksRef.current = [];
    startedAtRef.current = Date.now();
    setDurationMs(0);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      setStatus("unsupported");
      stopStream();
      return;
    }

    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      setStatus("error");
      cleanupRecorder();
      stopStream();
    };
    recorder.onstop = () => {
      clearTimers();
      const finalDurationMs = Math.max(1, Date.now() - startedAtRef.current);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
      chunksRef.current = [];
      recorderRef.current = null;
      startedAtRef.current = 0;
      stopStream();
      if (!blob.size) {
        setStatus("error");
        return;
      }
      const finalMimeType = blob.type || mimeType;
      if (autoAddOnStopRef.current) {
        void Promise.resolve(onAddVideo(blob, finalDurationMs, finalMimeType)).catch(() => setStatus("error"));
        return;
      }
      const previewUrl = URL.createObjectURL(blob);
      const nextRecorded = {
        blob,
        mimeType: finalMimeType,
        previewUrl,
        durationMs: finalDurationMs,
      };
      clearRecorded();
      recordedRef.current = nextRecorded;
      setRecorded(nextRecorded);
      setDurationMs(finalDurationMs);
      setStatus("recorded");
    };

    try {
      recorder.start(100);
    } catch {
      cleanupRecorder();
      stopStream();
      setStatus("error");
      return;
    }

    setStatus("recording");
    timerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startedAtRef.current);
    }, TIMER_TICK_MS);
    maxTimerRef.current = setTimeout(finishRecording, MAX_DURATION_MS);
  }, [cleanupRecorder, clearRecorded, finishRecording, onAddVideo, status, stopStream]);

  useEffect(() => {
    if (!open || !autoStart || status !== "ready") return;
    startRecording();
  }, [autoStart, open, startRecording, status]);

  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = stopSignal;
    if (!open || !autoAddOnStop) return;
    if (status === "recording") {
      finishRecording();
      return;
    }
    if (autoStart) closeWithoutCallback();
  // closeWithoutCallback is intentionally not a dependency: this effect handles
  // the hold-release edge while camera permission is still resolving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAddOnStop, autoStart, finishRecording, open, status, stopSignal]);

  const close = useCallback(() => {
    cleanupRecorder();
    stopStream();
    clearRecorded();
    onClose();
  }, [cleanupRecorder, clearRecorded, onClose, stopStream]);

  const closeWithoutCallback = useCallback(() => {
    cleanupRecorder();
    stopStream();
    clearRecorded();
    onClose();
  }, [cleanupRecorder, clearRecorded, onClose, stopStream]);

  const retake = useCallback(() => {
    void startPreview(facingMode);
  }, [facingMode, startPreview]);

  const addVideo = useCallback(() => {
    if (!recorded) return;
    void Promise.resolve(onAddVideo(recorded.blob, recorded.durationMs, recorded.mimeType)).then(close, () => setStatus("error"));
  }, [close, onAddVideo, recorded]);

  const switchCamera = useCallback(() => {
    setFacingMode((current) => (current === "user" ? "environment" : "user"));
  }, []);

  const isRound = variant === "round";
  const statusCopy = getStatusCopy(status, variant);
  const canSwitchCamera = (status === "ready" || status === "recording") && videoInputCount > 1;
  const displayDuration = status === "recorded" ? recorded?.durationMs ?? durationMs : durationMs;

  return (
    <KubModal
      open={open}
      onClose={close}
      title={isRound ? "Видеосообщение" : "Записать видео"}
      description={
        isRound
          ? "Запись попадёт во вложения как круглый видеоролик и отправится только по кнопке отправки."
          : "Запись попадёт во вложения как обычное видео и отправится только по кнопке отправки."
      }
      icon={<KubIcon name="video" size={18} />}
      size="lg"
      contentClassName="p-0"
      footer={
        autoAddOnStop ? null : (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            {status === "recorded" ? (
              <>
                <KubButton type="button" variant="secondary" onClick={retake} leftIcon={<KubIcon name="rotate" size={14} />}>
                  Перезаписать
                </KubButton>
                <KubButton type="button" variant="danger" onClick={close} leftIcon={<KubIcon name="delete" size={14} />}>
                  Удалить
                </KubButton>
                <KubButton type="button" onClick={addVideo} leftIcon={<KubIcon name="check" size={14} />}>
                  Добавить
                </KubButton>
              </>
            ) : status === "recording" ? (
              <KubButton
                type="button"
                variant="danger"
                onClick={finishRecording}
                leftIcon={<KubIcon name="pause" size={14} />}
                data-testid="video-message-record-stop"
              >
                Остановить
              </KubButton>
            ) : (
              <>
                {canSwitchCamera && (
                  <KubButton type="button" variant="secondary" onClick={switchCamera} leftIcon={<KubIcon name="rotate" size={14} />}>
                    Сменить камеру
                  </KubButton>
                )}
                <KubButton
                  type="button"
                  onClick={startRecording}
                  disabled={status !== "ready"}
                  leftIcon={<KubIcon name="video" size={14} />}
                  data-testid="video-message-record-start"
                >
                  Начать запись
                </KubButton>
              </>
            )}
          </div>
        )
      }
    >
      <div
        data-testid={isRound ? "video-message-recorder-modal" : "regular-video-recorder-modal"}
        className="flex min-h-0 flex-col items-center gap-4 px-4 py-4 sm:px-5"
      >
        <div
          className={cn(
            "relative flex items-center justify-center overflow-hidden border border-[color:var(--kub-border-color)] bg-black shadow-2xl",
            isRound
              ? "h-[min(70vw,260px)] w-[min(70vw,260px)] max-h-[320px] max-w-[320px] rounded-full"
              : "aspect-video w-full max-w-[560px] rounded-2xl"
          )}
        >
          {recorded ? (
            <video
              src={recorded.previewUrl}
              className={cn("h-full w-full", isRound ? "object-cover" : "object-contain")}
              controls
              playsInline
              preload="metadata"
              data-testid={isRound ? "round-video-recorded-preview" : "regular-video-recorded-preview"}
            />
          ) : (
            <video
              ref={videoRef}
              className={cn("h-full w-full", isRound ? "object-cover" : "object-contain", status !== "ready" && status !== "recording" && "opacity-30")}
              muted
              playsInline
              autoPlay
              data-testid={isRound ? "round-video-live-preview" : "regular-video-live-preview"}
            />
          )}
          {status === "recording" && (
            <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-[var(--kub-danger)] animate-pulse" />
              {formatDuration(displayDuration)}
            </div>
          )}
          {status !== "ready" && status !== "recording" && status !== "recorded" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
                <KubIcon name={status === "loading" ? "spinner" : "video"} size={22} className={status === "loading" ? "animate-spin" : undefined} />
              </span>
              <div>
                <div className="text-sm font-semibold text-white">{statusCopy.title}</div>
                <div className="mt-1 text-xs leading-5 text-white/70">{statusCopy.body}</div>
              </div>
            </div>
          )}
        </div>

        <div className="w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs leading-5 text-[color:var(--kub-muted)]">
          <div className="flex items-center gap-2 font-semibold text-[color:var(--kub-text)]">
            <KubIcon
              name={status === "recorded" ? "check" : status === "recording" ? "video" : "camera"}
              size={14}
              tone={status === "recorded" ? "accent" : "muted"}
            />
            {statusCopy.title}
            {(status === "recording" || status === "recorded") && (
              <span className="ml-auto tabular-nums text-[color:var(--kub-cyan)]">{formatDuration(displayDuration)}</span>
            )}
          </div>
          <div className="mt-1">{statusCopy.body}</div>
        </div>
      </div>
    </KubModal>
  );
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mimeType of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    } catch {
      // ignored
    }
  }
  return null;
}

function getStatusCopy(status: RecorderStatus, variant: VideoRecorderVariant): { title: string; body: string } {
  const isRound = variant === "round";
  switch (status) {
    case "loading":
      return {
        title: "Открываем камеру",
        body: "Камера и микрофон запрашиваются только после вашего действия.",
      };
    case "ready":
      return {
        title: "Камера готова",
        body: isRound
          ? "Нажмите и удерживайте кнопку записи или начните запись здесь, чтобы подготовить видеосообщение."
          : "Нажмите «Начать запись», чтобы подготовить обычное видео.",
      };
    case "recording":
      return {
        title: "Идёт запись",
        body: "Запись остановится автоматически через 60 секунд.",
      };
    case "recorded":
      return {
        title: "Видео готово",
        body: "Можно посмотреть, перезаписать, удалить или добавить запись во вложения.",
      };
    case "denied":
      return {
        title: "Нет доступа к камере или микрофону.",
        body: "Разрешите доступ в браузере и попробуйте ещё раз.",
      };
    case "unavailable":
      return {
        title: "Камера или микрофон недоступны.",
        body: "Проверьте устройство или закройте другое приложение, которое использует камеру.",
      };
    case "unsupported":
      return {
        title: isRound ? "Видеосообщения не поддерживаются этим браузером." : "Видео не поддерживается этим браузером.",
        body: "Попробуйте обновить браузер или отправьте видео файлом.",
      };
    case "error":
    default:
      return {
        title: "Не удалось записать видео.",
        body: "Попробуйте ещё раз.",
      };
  }
}

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
