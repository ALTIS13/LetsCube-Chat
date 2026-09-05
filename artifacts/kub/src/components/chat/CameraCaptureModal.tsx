"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { cameraPermissionHelp } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";

const MAX_CAPTURE_DIMENSION = 2560;
const CAPTURE_MIME_TYPE = "image/jpeg";
const CAPTURE_QUALITY = 0.95;

type CameraStatus = "loading" | "live" | "captured" | "denied" | "unavailable" | "error";
type FacingMode = "environment" | "user";

interface CapturedPhoto {
  file: File;
  previewUrl: string;
}

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onAddFile: (file: File) => void;
}

export function CameraCaptureModal({ open, onClose, onAddFile }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef<CapturedPhoto | null>(null);
  const [status, setStatus] = useState<CameraStatus>("loading");
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [videoInputCount, setVideoInputCount] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearCaptured = useCallback(() => {
    const current = capturedRef.current;
    if (current) URL.revokeObjectURL(current.previewUrl);
    capturedRef.current = null;
    setCaptured(null);
  }, []);

  const startCamera = useCallback(async (nextFacingMode: FacingMode) => {
    stopStream();
    clearCaptured();
    setStatus("loading");

    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }

    try {
      const stream = await devices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacingMode },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("live");

      if (devices.enumerateDevices) {
        const availableDevices: MediaDeviceInfo[] = await devices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        setVideoInputCount(availableDevices.filter((device) => device.kind === "videoinput").length);
      }
    } catch (error) {
      stopStream();
      const name = String((error as { name?: unknown } | null)?.name ?? "").toLowerCase();
      if (name.includes("allowed") || name.includes("security")) {
        setStatus("denied");
      } else if (name.includes("found") || name.includes("constrain")) {
        setStatus("unavailable");
      } else {
        setStatus("error");
      }
    }
  }, [clearCaptured, stopStream]);

  useEffect(() => {
    if (!open) return;
    void startCamera(facingMode);
    return () => {
      stopStream();
      clearCaptured();
    };
  }, [clearCaptured, facingMode, open, startCamera, stopStream]);

  const close = useCallback(() => {
    stopStream();
    clearCaptured();
    onClose();
  }, [clearCaptured, onClose, stopStream]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || status !== "live") return;

    const sourceWidth = video.videoWidth || video.clientWidth;
    const sourceHeight = video.videoHeight || video.clientHeight;
    if (!sourceWidth || !sourceHeight) {
      setStatus("error");
      return;
    }

    const scale = Math.min(1, MAX_CAPTURE_DIMENSION / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("error");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("error");
        return;
      }
      const file = new File([blob], `camera-${timestampLabel()}.jpg`, {
        type: CAPTURE_MIME_TYPE,
        lastModified: Date.now(),
      });
      const previewUrl = URL.createObjectURL(file);
      const nextCaptured = { file, previewUrl };
      clearCaptured();
      capturedRef.current = nextCaptured;
      setCaptured(nextCaptured);
      stopStream();
      setStatus("captured");
    }, CAPTURE_MIME_TYPE, CAPTURE_QUALITY);
  }, [clearCaptured, status, stopStream]);

  const addCaptured = useCallback(() => {
    if (!captured) return;
    const file = captured.file;
    onAddFile(file);
    close();
  }, [captured, close, onAddFile]);

  const retake = useCallback(() => {
    void startCamera(facingMode);
  }, [facingMode, startCamera]);

  const switchCamera = useCallback(() => {
    setFacingMode((current) => (current === "environment" ? "user" : "environment"));
  }, []);

  const pickFallbackFile = useCallback(() => {
    fallbackInputRef.current?.click();
  }, []);

  const handleFallbackChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    onAddFile(file);
    close();
  }, [close, onAddFile]);

  const statusCopy = getStatusCopy(status);
  const canSwitchCamera = status === "live" && videoInputCount > 1;

  return (
    <KubModal
      open={open}
      onClose={close}
      title="Сделать фото"
      description="Фото попадёт во вложения и отправится только после кнопки отправки."
      icon={<KubIcon name="camera" size={18} />}
      size="lg"
      contentClassName="p-0"
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          {status === "captured" ? (
            <>
              <KubButton type="button" variant="secondary" onClick={retake} leftIcon={<KubIcon name="rotate" size={14} />}>
                Переснять
              </KubButton>
              <KubButton type="button" onClick={addCaptured} leftIcon={<KubIcon name="check" size={14} />}>
                Добавить
              </KubButton>
            </>
          ) : (
            <>
              {(status === "denied" || status === "unavailable" || status === "error") && (
                <KubButton type="button" variant="secondary" onClick={pickFallbackFile} leftIcon={<KubIcon name="image" size={14} />}>
                  Выбрать файл
                </KubButton>
              )}
              {canSwitchCamera && (
                <KubButton type="button" variant="secondary" onClick={switchCamera} leftIcon={<KubIcon name="rotate" size={14} />}>
                  Сменить камеру
                </KubButton>
              )}
              <KubButton
                type="button"
                onClick={capturePhoto}
                disabled={status !== "live"}
                leftIcon={<KubIcon name="camera" size={14} />}
                data-testid="camera-capture-shutter"
              >
                Снять
              </KubButton>
            </>
          )}
        </div>
      }
    >
      <div data-testid="camera-capture-modal" className="flex min-h-0 flex-col gap-4 px-4 py-4 sm:px-5">
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFallbackChange}
        />

        <div className="relative overflow-hidden rounded-2xl border border-[color:var(--kub-border-color)] bg-black">
          <video
            ref={videoRef}
            className={cn(
              "aspect-video w-full max-h-[62vh] bg-black object-contain",
              status === "captured" && "hidden",
            )}
            muted
            playsInline
            autoPlay
          />
          {captured && (
            <img
              src={captured.previewUrl}
              alt=""
              className="aspect-video w-full max-h-[62vh] bg-black object-contain"
              draggable={false}
            />
          )}
          {status !== "live" && status !== "captured" && (
            <div className="absolute inset-0 flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
                <KubIcon name={status === "loading" ? "spinner" : "camera"} size={22} className={status === "loading" ? "animate-spin" : undefined} />
              </span>
              <div>
                <div className="text-sm font-semibold text-white">{statusCopy.title}</div>
                <div className="mt-1 max-w-sm text-xs leading-5 text-white/70">{statusCopy.body}</div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl px-3 py-2 text-xs leading-5 text-[color:var(--kub-muted)] kub-raise">
          <div className="flex items-center gap-2 font-semibold text-[color:var(--kub-text)]">
            <KubIcon name={status === "captured" ? "check" : "camera"} size={14} tone={status === "captured" ? "accent" : "muted"} />
            {statusCopy.title}
          </div>
          <div className="mt-1">{statusCopy.body}</div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </KubModal>
  );
}

function getStatusCopy(status: CameraStatus): { title: string; body: string } {
  switch (status) {
    case "loading":
      return {
        title: "Открываем камеру",
        body: "Доступ запрашивается только после вашего действия.",
      };
    case "live":
      return {
        title: "Камера готова",
        body: "Наведите камеру и нажмите «Снять». Фото пока не отправляется.",
      };
    case "captured":
      return {
        title: "Фото готово",
        body: "Можно переснять или добавить фото во вложения.",
      };
    case "denied":
      return {
        title: "Нет доступа к камере.",
        body: `${cameraPermissionHelp()} Или выберите изображение файлом.`,
      };
    case "unavailable":
      return {
        title: "Камера недоступна.",
        body: "На этом устройстве можно выбрать уже готовое изображение.",
      };
    case "error":
    default:
      return {
        title: "Не удалось сделать фото.",
        body: "Попробуйте ещё раз или выберите изображение файлом.",
      };
  }
}

function timestampLabel(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
