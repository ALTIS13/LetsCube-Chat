"use client";

import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";

/**
 * An attachment's upload, drawn on its own placeholder in the conversation
 * (D-314's Telegram half).
 *
 * A ring rather than the tray's bar: the placeholder is the message now, and a
 * ring over the picture is where Telegram says «on its way» — the picture is
 * already there, and only its arrival is pending. The ring is also the way to
 * stop it: the × in its middle takes the placeholder out and stops the upload,
 * from whichever view it is pressed in.
 *
 * A number only when there is one. The resumable path reports bytes; a small
 * file goes as one request whose progress `fetch` does not report, and a
 * frozen «0%» is what D-114 removed from the tray. So `null` spins and claims
 * nothing — no `aria-valuenow`, no percentage.
 */
export function OutgoingUploadRing({
  progress,
  onCancel,
  size = 44,
  tone = "media",
}: {
  progress: number | null;
  onCancel?: () => void;
  size?: number;
  /** Over a picture, or on the bubble's own surface. */
  tone?: "media" | "surface";
}) {
  const shown = typeof progress === "number" ? Math.min(100, Math.max(0, Math.round(progress))) : null;
  const stroke = size >= 36 ? 3 : 2.5;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = shown === null ? circumference * 0.72 : circumference * (1 - shown / 100);
  return (
    <div
      role="progressbar"
      aria-label="Загрузка вложения"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown ?? undefined}
      data-testid="message-upload-progress"
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full",
        tone === "media"
          ? "bg-[color:color-mix(in_srgb,black_46%,transparent)] text-white"
          : "text-[color:var(--kub-cyan)]",
      )}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        className={cn("absolute inset-0", shown === null && "animate-spin")}
        width={size}
        height={size}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 150ms linear" }}
        />
      </svg>
      {onCancel ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
          aria-label="Отменить отправку"
          data-testid="message-upload-cancel"
          className="relative flex h-full w-full items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
        >
          <KubIcon name="close" size={Math.round(size * 0.36)} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * How far a picture's upload is, in the corner of the picture, when that is
 * known — Telegram Web A's rounded percent over a photo or a video. Nothing at
 * all when the path reports no bytes, for the reason the ring spins.
 */
export function OutgoingUploadPercent({ progress }: { progress: number | null }) {
  if (typeof progress !== "number") return null;
  const shown = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <span
      aria-hidden="true"
      data-testid="message-upload-percent"
      className="pointer-events-none absolute left-2 top-2 rounded-full bg-[color:color-mix(in_srgb,black_46%,transparent)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none text-white"
    >
      {shown}%
    </span>
  );
}

/**
 * The same, as a line under a voice message or a file, whose own glyph is not a
 * picture a ring could sit on.
 */
export function OutgoingUploadLine({ progress, onCancel }: { progress: number | null; onCancel?: () => void }) {
  const shown = typeof progress === "number" ? Math.min(100, Math.max(0, Math.round(progress))) : null;
  return (
    <div
      data-testid="message-upload-line"
      className="mt-1 flex items-center gap-2 text-[12px] leading-none text-[color:var(--kub-muted)]"
    >
      <OutgoingUploadRing progress={progress} onCancel={onCancel} size={24} tone="surface" />
      <span className="tabular-nums" aria-hidden="true">
        {shown === null ? "Отправляется…" : `Отправляется · ${shown}%`}
      </span>
    </div>
  );
}
