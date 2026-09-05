"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { DEFAULT_MEDIA_QUALITY, getVideoRecordingProfile, type MediaQuality } from "@/lib/mediaQuality";
import { cameraAndMicPermissionHelp, isNativeApp } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";

const MAX_DURATION_MS = 60_000;
const MIN_DURATION_MS = 700;
const TIMER_TICK_MS = 250;
const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
  "video/mp4;codecs=h264,aac",
  "video/mp4",
] as const;

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
  mediaQuality?: MediaQuality;
  autoStart?: boolean;
  autoAddOnStop?: boolean;
  stopSignal?: number;
  locked?: boolean;
  onLockedStop?: () => void;
}

export function VideoMessageRecorderModal({
  open,
  onClose,
  onAddVideo,
  variant = "round",
  mediaQuality = DEFAULT_MEDIA_QUALITY,
  autoStart = false,
  autoAddOnStop = false,
  stopSignal = 0,
  locked = false,
  onLockedStop,
}: VideoMessageRecorderModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordedRef = useRef<RecordedVideo | null>(null);
  const autoAddOnStopRef = useRef(autoAddOnStop);
  const lastStopSignalRef = useRef(stopSignal);
  const selectedFacingModeRef = useRef<FacingMode>(variant === "regular" ? "environment" : "user");
  const [status, setStatus] = useState<RecorderStatus>("loading");
  const [facingMode, setFacingMode] = useState<FacingMode>(variant === "regular" ? "environment" : "user");
  const [videoInputCount, setVideoInputCount] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [recorded, setRecorded] = useState<RecordedVideo | null>(null);
  const [switchingCamera, setSwitchingCamera] = useState(false);

  useEffect(() => {
    autoAddOnStopRef.current = autoAddOnStop;
  }, [autoAddOnStop]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    timerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const stopRecordingPipeline = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const sourceTracks = new Set(streamRef.current?.getTracks() ?? []);
    recordingStreamRef.current?.getTracks().forEach((track) => {
      if (!sourceTracks.has(track)) track.stop();
    });
    recordingStreamRef.current = null;
    canvasRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    stopRecordingPipeline();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopRecordingPipeline]);

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
    stopRecordingPipeline();
    chunksRef.current = [];
    startedAtRef.current = 0;
  }, [clearTimers, stopRecordingPipeline]);

  const attachPreviewStream = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      await videoRef.current.play().catch(() => undefined);
    }
  }, []);

  const startPreview = useCallback(async (nextFacingMode: FacingMode) => {
    cleanupRecorder();
    stopStream();
    clearRecorded();
    selectedFacingModeRef.current = nextFacingMode;
    setFacingMode(nextFacingMode);
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
      const profile = getVideoRecordingProfile(mediaQuality, variant);
      const stream = await devices.getUserMedia({
        audio: true,
        video: videoConstraints(nextFacingMode, profile),
      });

      if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("unavailable");
        return;
      }

      await attachPreviewStream(stream);
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
  }, [attachPreviewStream, cleanupRecorder, clearRecorded, mediaQuality, stopStream, variant]);

  useEffect(() => {
    if (!open) return;
    const initialFacingMode = variant === "regular" ? "environment" : "user";
    selectedFacingModeRef.current = initialFacingMode;
    void startPreview(initialFacingMode);
    return () => {
      cleanupRecorder();
      stopStream();
      clearRecorded();
    };
  }, [cleanupRecorder, clearRecorded, open, startPreview, stopStream, variant]);

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

    let recordingStream = stream;
    const profile = getVideoRecordingProfile(mediaQuality, variant);
    if (variant === "round") {
      recordingStream = createRoundRecordingStream(
        videoRef.current,
        stream,
        profile.width,
        profile.frameRate,
        (frameId) => { frameRef.current = frameId; },
        (canvas) => { canvasRef.current = canvas; },
      );
      recordingStreamRef.current = recordingStream;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recordingStream, {
        mimeType,
        videoBitsPerSecond: profile.videoBitsPerSecond,
        audioBitsPerSecond: profile.audioBitsPerSecond,
      });
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
      if (finalDurationMs < MIN_DURATION_MS) {
        showAppAlert("Слишком короткая запись.", isRoundLabel(variant));
        chunksRef.current = [];
        setDurationMs(0);
        void startPreview(selectedFacingModeRef.current);
        return;
      }
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
  }, [cleanupRecorder, clearRecorded, finishRecording, mediaQuality, onAddVideo, startPreview, status, stopStream, variant]);

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
    if (autoStart && !isNativeApp()) closeWithoutCallback();
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
    void startPreview(selectedFacingModeRef.current);
  }, [startPreview]);

  const addVideo = useCallback(() => {
    if (!recorded) return;
    void Promise.resolve(onAddVideo(recorded.blob, recorded.durationMs, recorded.mimeType)).then(close, () => setStatus("error"));
  }, [close, onAddVideo, recorded]);

  const switchCamera = useCallback(() => {
    const currentFacingMode = selectedFacingModeRef.current;
    const nextFacingMode: FacingMode = currentFacingMode === "user" ? "environment" : "user";
    if (switchingCamera) return;

    if (status === "recording" && variant === "round") {
      const currentStream = streamRef.current;
      const devices = navigator.mediaDevices;
      if (!currentStream || !devices?.getUserMedia) return;
      setSwitchingCamera(true);
      const profile = getVideoRecordingProfile(mediaQuality, "round");
      void devices.getUserMedia({
        audio: false,
        video: videoConstraints(nextFacingMode, profile),
      }).then(async (nextVideoStream) => {
        const nextVideoTracks = nextVideoStream.getVideoTracks();
        if (!nextVideoTracks.length) {
          nextVideoStream.getTracks().forEach((track) => track.stop());
          selectedFacingModeRef.current = currentFacingMode;
          setFacingMode(currentFacingMode);
          return;
        }
        currentStream.getVideoTracks().forEach((track) => track.stop());
        const audioTracks = currentStream.getAudioTracks();
        selectedFacingModeRef.current = nextFacingMode;
        setFacingMode(nextFacingMode);
        await attachPreviewStream(new MediaStream([...nextVideoTracks, ...audioTracks]));
      }).catch(() => {
        selectedFacingModeRef.current = currentFacingMode;
        setFacingMode(currentFacingMode);
      }).finally(() => {
        setSwitchingCamera(false);
      });
      return;
    }

    if (status === "ready") {
      const devices = navigator.mediaDevices;
      if (!devices?.getUserMedia) return;
      setSwitchingCamera(true);
      const profile = getVideoRecordingProfile(mediaQuality, variant);
      void devices.getUserMedia({
        audio: true,
        video: videoConstraints(nextFacingMode, profile),
      }).then(async (nextStream) => {
        if (!nextStream.getVideoTracks().length || !nextStream.getAudioTracks().length) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        cleanupRecorder();
        clearRecorded();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        selectedFacingModeRef.current = nextFacingMode;
        setFacingMode(nextFacingMode);
        setDurationMs(0);
        await attachPreviewStream(nextStream);
        setStatus("ready");
      }).catch(() => {
        selectedFacingModeRef.current = currentFacingMode;
        setFacingMode(currentFacingMode);
      }).finally(() => {
        setSwitchingCamera(false);
      });
    }
  }, [attachPreviewStream, cleanupRecorder, clearRecorded, mediaQuality, status, switchingCamera, variant]);

  const isRound = variant === "round";
  const statusCopy = getStatusCopy(status, variant);
  const canAttemptFacingModeSwitch = isRound || videoInputCount > 1;
  const canSwitchCamera = (status === "ready" || (isRound && status === "recording" && supportsCanvasCapture())) && canAttemptFacingModeSwitch;
  const displayDuration = status === "recorded" ? recorded?.durationMs ?? durationMs : durationMs;
  const switchCameraButton = canSwitchCamera ? (
    <button
      type="button"
      data-testid="video-recorder-switch-camera"
      data-switch-placement={isRound ? "outside-preview" : "inside-preview"}
      onClick={switchCamera}
      disabled={switchingCamera}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border text-white shadow-lg backdrop-blur transition disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
        isRound
          ? "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] kub-raise-hover"
          : "border-white/15 bg-black/60 hover:bg-black/75"
      )}
      aria-label="Сменить камеру"
      title="Сменить камеру"
    >
      <KubIcon name={switchingCamera ? "spinner" : "rotate"} size={17} className={switchingCamera ? "animate-spin" : undefined} />
    </button>
  ) : null;

  const preview = (
    <div className={cn("relative flex items-start justify-center", isRound ? "overflow-visible px-8 pt-1" : "w-full")}>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden border border-[color:var(--kub-border-color)] bg-black shadow-2xl",
          isRound
            ? "h-[min(56vw,214px)] w-[min(56vw,214px)] max-h-[220px] max-w-[220px] rounded-full"
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
        {!isRound && switchCameraButton && (
          <div className="absolute right-3 top-3">{switchCameraButton}</div>
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
      {isRound && switchCameraButton && (
        <div className="absolute right-3 top-0 z-10">{switchCameraButton}</div>
      )}
    </div>
  );

  const statusPanel = (
    <div className={cn(
      "w-full rounded-xl px-3 py-2 text-xs leading-5 text-[color:var(--kub-muted)] kub-raise",
      isRound && "bg-[var(--kub-surface)]"
    )}>
      <div className="flex items-center gap-2 font-semibold text-[color:var(--kub-text)]">
        <KubIcon
          name={status === "recorded" ? "check" : status === "recording" ? "video" : "camera"}
          size={14}
          tone={status === "recorded" ? "accent" : "muted"}
        />
        {statusCopy.title}
        {(status === "recording" || status === "recorded") && (
          <span className="ml-auto tabular-nums text-[color:var(--kub-accent-text)]">{formatDuration(displayDuration)}</span>
        )}
      </div>
      <div className="mt-1">{statusCopy.body}</div>
    </div>
  );

  const controls = autoAddOnStop ? (
    (locked || isNativeApp()) && status === "recording" ? (
      <div className="flex w-full justify-end">
        <KubButton
          type="button"
          variant="danger"
          onClick={onLockedStop ?? finishRecording}
          leftIcon={<KubIcon name="pause" size={14} />}
          data-testid="composer-locked-recording-stop"
        >
          Остановить
        </KubButton>
      </div>
    ) : null
  ) : (
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
        <KubButton
          type="button"
          onClick={startRecording}
          disabled={status !== "ready"}
          leftIcon={<KubIcon name="video" size={14} />}
          data-testid="video-message-record-start"
        >
          Начать запись
        </KubButton>
      )}
    </div>
  );

  if (isRound) {
    if (!open) return null;
    return (
      <div
        data-testid="video-message-recorder-modal"
        data-recorder-layout="compact-round"
        data-recorder-shell="composer-attached"
        data-facing-mode={facingMode}
        // Stands on the message list, so `-strong`. `kub-glow-soft` and
        // `shadow-2xl` both set box-shadow and both lose to --glass-shadow.
        className="kub-glass-strong mx-3 mb-2 rounded-3xl border border-[color:var(--kub-border-color)] p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)]">
              <KubIcon name="video" size={15} />
            </span>
            <span className="truncate">Видеосообщение</span>
            {(status === "recording" || status === "recorded") && (
              <span className="shrink-0 tabular-nums text-[color:var(--kub-accent-text)]">{formatDuration(displayDuration)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-text)]"
            aria-label="Закрыть видеосообщение"
          >
            <KubIcon name="close" size={15} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3">
          {preview}
          {statusPanel}
          {controls}
        </div>
      </div>
    );
  }

  return (
    <KubModal
      open={open}
      onClose={close}
      title="Записать видео"
      description="Запись попадёт во вложения как обычное видео и отправится только по кнопке отправки."
      icon={<KubIcon name="video" size={18} />}
      size="lg"
      contentClassName="p-0"
      footer={controls}
    >
      <div
        data-testid="regular-video-recorder-modal"
        data-recorder-layout="regular-modal"
        data-facing-mode={facingMode}
        className="flex min-h-0 flex-col items-center gap-4 px-4 py-4 sm:px-5"
      >
        {preview}
        {statusPanel}
      </div>
    </KubModal>
  );
}

function videoConstraints(
  facingMode: FacingMode,
  profile: { width: number; height: number; frameRate: number },
): MediaTrackConstraints {
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: profile.frameRate, max: 60 },
  };
}

function supportsCanvasCapture(): boolean {
  return typeof HTMLCanvasElement !== "undefined"
    && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

function createRoundRecordingStream(
  video: HTMLVideoElement | null,
  sourceStream: MediaStream,
  size: number,
  frameRate: number,
  setFrameId: (frameId: number) => void,
  setCanvas: (canvas: HTMLCanvasElement) => void,
): MediaStream {
  if (!video || !supportsCanvasCapture()) return sourceStream;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  setCanvas(canvas);
  const context = canvas.getContext("2d");
  if (!context) return sourceStream;

  const draw = () => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const size = Math.min(sourceWidth, sourceHeight);
      const sx = Math.max(0, (sourceWidth - size) / 2);
      const sy = Math.max(0, (sourceHeight - size) / 2);
      context.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    }
    setFrameId(requestAnimationFrame(draw));
  };
  draw();

  const canvasStream = canvas.captureStream(frameRate);
  return new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...sourceStream.getAudioTracks(),
  ]);
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
        body: cameraAndMicPermissionHelp(),
      };
    case "unavailable":
      return {
        title: "Камера или микрофон недоступны.",
        body: "Проверьте устройство или закройте другое приложение, которое использует камеру.",
      };
    case "unsupported":
      return {
        title: isNativeApp()
          ? isRound ? "Видеосообщения недоступны на этом устройстве." : "Запись видео недоступна на этом устройстве."
          : isRound ? "Видеосообщения не поддерживаются этим браузером." : "Видео не поддерживается этим браузером.",
        body: isNativeApp()
          ? "Выберите готовое видео из галереи или попробуйте другое устройство."
          : "Попробуйте обновить браузер или отправьте видео файлом.",
      };
    case "error":
    default:
      return {
        title: "Не удалось записать видео.",
        body: "Попробуйте ещё раз.",
      };
  }
}

function isRoundLabel(variant: VideoRecorderVariant): string {
  return variant === "round" ? "Видеосообщение" : "Видео";
}

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
