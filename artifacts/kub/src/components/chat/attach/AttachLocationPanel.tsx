import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubGlassLayer, KubIcon } from "@/components/kub";
import { formatAccuracy, formatCoordinates } from "@/lib/attachSheet";
import { DISABLED_SINK, FOCUS_RING } from "@/lib/controlSurface";
import {
  getMessengerLocationErrorMessage,
  getMessengerPosition,
  type MessengerPosition,
} from "@/lib/platform/geolocation";
import { cn } from "@/lib/utils";

type LocationState =
  | { status: "locating" }
  | { status: "ready"; position: MessengerPosition }
  | { status: "failed"; message: string };

/**
 * «Геопозиция», as Telegram lays it out: the place on top, and under it the row
 * «Отправить геопозицию — С точностью до …», which is the only thing that sends.
 * The menu item this replaces sent exact coordinates on one tap, with nothing on
 * screen.
 *
 * The position is asked for when this tab is opened — a deliberate tap — and
 * never because the sheet opened.
 */
export function AttachLocationPanel({ onSend }: { onSend: (latitude: number, longitude: number) => void }) {
  const [state, setState] = useState<LocationState>({ status: "locating" });
  const attemptRef = useRef(0);

  const locate = useCallback(() => {
    const attempt = ++attemptRef.current;
    setState({ status: "locating" });
    getMessengerPosition().then(
      (position) => {
        if (attemptRef.current === attempt) setState({ status: "ready", position });
      },
      (error: unknown) => {
        if (attemptRef.current === attempt) setState({ status: "failed", message: getMessengerLocationErrorMessage(error) });
      },
    );
  }, []);

  useEffect(() => {
    locate();
    return () => {
      attemptRef.current += 1;
    };
  }, [locate]);

  const position = state.status === "ready" ? state.position : null;
  const accuracy = position ? formatAccuracy(position.accuracy) : null;
  const subtitle =
    state.status === "locating"
      ? "Определяем…"
      : state.status === "failed"
      ? "Не удалось определить"
      : accuracy
      ? `С точностью до ${accuracy}`
      : "Точность неизвестна";

  return (
    // The sheet is as tall as what it holds, so the place is given a height of
    // its own rather than whatever the sheet had left over.
    <div data-attach-location={state.status} className="flex flex-col gap-3 pb-3 pt-1">
      <AttachLocationPreview position={position} locating={state.status === "locating"} />

      <div className="mx-3 overflow-hidden rounded-[1.375rem] border border-[color:var(--glass-line)] kub-raise">
        <button
          type="button"
          data-testid="attach-location-send"
          disabled={!position}
          onClick={() => position && onSend(position.latitude, position.longitude)}
          className={cn(
            "kub-interactive relative flex min-h-[3.75rem] w-full items-center gap-3 px-4 py-2 text-left transition-colors kub-raise-hover",
            DISABLED_SINK,
            FOCUS_RING,
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]">
            <KubIcon name="mapPin" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-[color:var(--kub-accent-text)]">Отправить геопозицию</span>
            <span aria-live="polite" className="block truncate text-[13px] tabular-nums text-[color:var(--kub-muted)]">
              {subtitle}
            </span>
          </span>
        </button>
      </div>

      {state.status === "failed" && (
        <div className="mx-4 flex flex-col items-start gap-2">
          <p className="text-[13px] leading-snug text-[color:var(--kub-muted)]">{state.message}</p>
          <KubButton variant="secondary" size="md" onClick={locate} leftIcon={<KubIcon name="rotate" size={15} />}>
            Повторить
          </KubButton>
        </div>
      )}
    </div>
  );
}

/**
 * Where the map goes, and the only place it goes.
 *
 * The owner's decision (2026-09-12): the preview is to be rendered from
 * OpenStreetMap data on LETSCUBE's own infrastructure, so that nothing about a
 * person — not a coordinate, not a referer, not an address — reaches a third
 * party. That service does not exist yet, so what is drawn here is a neutral
 * field with the coordinates on it, and nothing on it pretends to be a street.
 *
 * **No third-party map is called from this component, and none may be added.**
 * When LETSCUBE's own renderer exists, this is the seam: give it a URL built
 * from `position` and swap the field below for an `<img>`, keeping the box's
 * size, its radius, its edge and the coordinate chip. Everything outside this
 * component — the row that sends, the message that is sent, the tab's states —
 * stays as it is, because none of it knows how the place is drawn.
 */
function AttachLocationPreview({ position, locating }: { position: MessengerPosition | null; locating: boolean }) {
  return (
    <div
      data-attach-location-preview=""
      className="relative mx-3 h-48 shrink-0 overflow-hidden rounded-[1.75rem] border border-[color:var(--glass-line)] bg-[var(--kub-inset)]"
      style={{
        backgroundImage:
          "linear-gradient(var(--kub-rule) 1px, transparent 1px), linear-gradient(90deg, var(--kub-rule) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {position && (
          <span
            aria-hidden="true"
            className="absolute h-24 w-24 rounded-full border border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
          />
        )}
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]">
          {locating ? <KubIcon name="spinner" size={22} className="animate-spin" /> : <KubIcon name="mapPin" size={24} />}
        </span>
      </div>
      {position && (
        <span
          data-attach-location-coordinates=""
          className="absolute bottom-2.5 left-2.5 flex h-7 items-center rounded-full px-3 text-[12px] font-medium tabular-nums text-[color:var(--kub-text)]"
        >
          <KubGlassLayer className="rounded-full border border-[color:var(--glass-line)]" />
          <span className="relative">{formatCoordinates(position.latitude, position.longitude)}</span>
        </span>
      )}
    </div>
  );
}
