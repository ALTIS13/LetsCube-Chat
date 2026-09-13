import { KubGlassLayer } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";
import { stopLabel, type StopSummary, type VideoSendStop } from "@/lib/videoSendSelection";
import { cn } from "@/lib/utils";

/** Between a number and its unit, so the two never part at a line end. */
const NBSP = String.fromCharCode(160);

interface AttachVideoQualityRowProps {
  /** The stops offered, smallest first, with the source last. */
  stops: readonly VideoSendStop[];
  stop: VideoSendStop;
  onStopChange: (next: VideoSendStop) => void;
  summary: StopSummary;
  /** How many videos are selected, for the name a screen reader hears. */
  videos: number;
}

/**
 * The ladder, as the slider the owner asked for (D-175).
 *
 * One control over the whole selection, because the sheet sends a batch: a stop
 * takes every video bigger than it down to it and leaves the rest as they were
 * picked, which is what `videoSendSelection.ts` computes and what the number on
 * the right is the sum of.
 *
 * The number is marked with «≈» exactly when some of it is an estimate. A
 * browser cannot ask its encoder what bitrate it will really apply — Android
 * can, and Telegram there is exact for that reason — so a figure presented as a
 * promise would be a lie roughly a tenth of the time. Where every file at a stop
 * goes as it was picked the sum is exact, and then the sign is absent.
 *
 * The stops are drawn as ticks rather than labelled individually: five labels
 * across a 360-point phone leaves «Исходное» in three lines, and the stop that
 * matters is the chosen one, which is named in full on the right.
 */
export function AttachVideoQualityRow({ stops, stop, onStopChange, summary, videos }: AttachVideoQualityRowProps) {
  const index = Math.max(0, stops.indexOf(stop));
  const last = Math.max(0, stops.length - 1);
  const ratio = last > 0 ? index / last : 1;
  const size = summary.approximate ? `≈${NBSP}${summary.size}` : summary.size;

  return (
    <div
      data-testid="attach-video-quality"
      data-attach-video-stop={String(stop)}
      className="relative flex flex-col gap-1.5 rounded-[1.375rem] px-4 py-2.5"
    >
      <KubGlassLayer className="rounded-[inherit] border border-[color:var(--glass-line)]" />
      <div className="relative flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-[color:var(--kub-muted)]">
          {videos > 1 ? `Качество · ${videos} видео` : "Качество"}
        </span>
        <span className="flex items-baseline gap-1.5 text-[13px]">
          <span className="font-semibold text-[color:var(--kub-text)]">{summary.label}</span>
          <span
            data-testid="attach-video-estimate"
            className="tabular-nums text-[color:var(--kub-muted)]"
          >
            {size}
          </span>
        </span>
      </div>
      <div className="relative flex h-4 items-center">
        {/* The stops themselves, over the track: a slider with five positions and
            no marks reads as continuous, and a person then expects 913p.
            Inset by half a thumb, because that is where the thumb's centre can
            actually travel — flush marks sit beside the position they name. A
            mark on the filled side is a notch punched in it rather than more of
            the same colour, which is the first draft and was invisible. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 z-10 flex items-center justify-between">
          {stops.map((candidate, at) => (
            <span
              key={String(candidate)}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                // The stop under the thumb is not drawn: the thumb is already
                // there, and a mark over it reads as a blemish on the knob.
                at === index
                  ? "opacity-0"
                  : at < index
                    ? "bg-[color:var(--kub-bg)] opacity-80"
                    : "bg-[color:var(--kub-muted)] opacity-45",
              )}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          data-testid="attach-video-quality-slider"
          aria-label={videos > 1 ? `Качество ${videos} видео` : "Качество видео"}
          aria-valuetext={`${stopLabel(stop)}, ${summary.approximate ? "примерно " : ""}${summary.size}`}
          onChange={(event) => {
            const next = stops[Number(event.target.value)];
            if (next !== undefined) onStopChange(next);
          }}
          className={cn(
            "relative h-1.5 w-full min-w-0 max-w-full cursor-pointer appearance-none rounded-full bg-transparent",
            "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--kub-cyan)]",
            "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full",
            "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full",
            "[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--kub-cyan)]",
            FOCUS_RING,
          )}
          style={{
            background: `linear-gradient(to right, var(--kub-cyan) ${ratio * 100}%, var(--kub-border-color) ${ratio * 100}%)`,
          }}
        />
      </div>
    </div>
  );
}

interface AttachVideoProgressRowProps {
  /** 0 to 1 over the whole batch, so one bar covers three clips. */
  progress: number;
  /** «2 из 3», absent while only one video is being encoded. */
  position: string | null;
  onCancel: () => void;
}

/**
 * What the slider becomes while the encoding runs.
 *
 * A browser encodes at roughly realtime, so a two-minute clip is a two-minute
 * wait, and the sheet stays open with this in place of the ladder rather than
 * closing on a send that has not happened yet. Cancelling cancels the send: the
 * files stay selected and nothing is uploaded. Falling back to sending the
 * picked bytes would be the opposite of what a person pressing «Отмена» after
 * choosing 720p on a 400 MB clip is asking for.
 */
export function AttachVideoProgressRow({ progress, position, onCancel }: AttachVideoProgressRowProps) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      data-testid="attach-video-progress"
      className="relative flex flex-col gap-1.5 rounded-[1.375rem] px-4 py-2.5"
    >
      <KubGlassLayer className="rounded-[inherit] border border-[color:var(--glass-line)]" />
      <div className="relative flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-[color:var(--kub-text)]">
          {position ? `Сжатие видео · ${position}` : "Сжатие видео"}
        </span>
        <span className="flex items-baseline gap-3 text-[13px]">
          <span data-testid="attach-video-progress-percent" className="tabular-nums text-[color:var(--kub-muted)]">
            {percent}%
          </span>
          <button
            type="button"
            data-testid="attach-video-cancel"
            onClick={onCancel}
            className={cn("kub-interactive rounded-full px-1 font-semibold text-[color:var(--kub-cyan)]", FOCUS_RING)}
          >
            Отмена
          </button>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Сжатие видео"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="relative h-1.5 overflow-hidden rounded-full bg-[color:var(--kub-border-color)]"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--kub-cyan)] transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
