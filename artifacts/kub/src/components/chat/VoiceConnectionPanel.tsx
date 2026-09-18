"use client";

import { KubIcon } from "@/components/kub";
import { useVoiceHealth } from "@/hooks/useVoiceHealth";
import {
  voiceHealthAdvice,
  VOICE_HEALTH_THRESHOLDS,
  type VoiceHealthScale,
  type VoiceHealthVerdict,
} from "@/lib/voiceConnectionHealth";
import { cn } from "@/lib/utils";

/**
 * How this call is doing, in numbers (D-217).
 *
 * Asked for by the owner on 2026-09-18 with a screenshot of Discord's: a
 * latency graph over the last few minutes, the average and the latest round
 * trip, outbound packet loss, the media server's name, and a sentence saying
 * what the numbers mean.
 *
 * The arithmetic is `lib/voiceConnectionHealth.ts`, the sampling is
 * `hooks/useVoiceHealth.ts`, and both are tested without a browser. What is
 * here is the drawing and the words.
 *
 * ## Three decisions about the drawing
 *
 * **The graph is an SVG polyline, not a canvas and not a library.** Two hundred
 * and forty points is nothing, the theme's colours have to reach it, and the
 * one thing this must survive is a reader with reduced motion — a canvas would
 * need its own resize handling and its own colour plumbing for no gain.
 *
 * **A gap in the readings is a gap in the line.** The series carries `null`
 * where a reading had no round trip, and the polyline is broken there rather
 * than bridged. A bridged line invents a measurement across the exact moment
 * the connection was failing, which is the moment the panel is being read.
 *
 * **Nothing here animates.** The line redraws once a second because the data
 * moved; there is no transition on it. A graph that eases between values is a
 * graph that is never showing the current one, and under
 * `prefers-reduced-motion` it would have to be turned off anyway — leaving a
 * feature that behaves differently for the people most likely to be
 * diagnosing a problem.
 */

const GRAPH_WIDTH = 280;
const GRAPH_HEIGHT = 64;

export function VoiceConnectionPanel({
  open,
  className,
}: {
  /** Sampling runs only while this is true; see `useVoiceHealth`. */
  open: boolean;
  className?: string;
}) {
  const { health, scale, serverName, connected } = useVoiceHealth(open);

  if (!connected) return null;

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-2", className)}
      data-testid="voice-connection-panel"
      data-voice-verdict={health.verdict}
    >
      <VoiceLatencyGraph scale={scale} />

      {serverName && (
        <p
          className="truncate text-sm font-semibold text-[color:var(--kub-text)]"
          data-testid="voice-connection-server"
          // The media server, as Discord names it. Not decoration: two people
          // on one node with one problem is a different report from two people
          // on different continents, and it is the first thing worth knowing.
          title="Медиасервер этого звонка"
        >
          {serverName}
        </p>
      )}

      <dl className="flex flex-col gap-0.5 text-sm" data-testid="voice-connection-numbers">
        <Row label="Средняя задержка" value={ms(health.averageRttMs)} testId="voice-connection-average" />
        <Row label="Последняя задержка" value={ms(health.lastRttMs)} testId="voice-connection-last" />
        <Row
          label="Потеря исходящих пакетов"
          // `toFixed(1)`, not the number as it is. `roundLoss` returns 0 for a
          // clean connection and «0%» reads like a default while «0.0%» reads
          // like somebody measured — which is the distinction
          // `voice-connection-health.test.mts` states and which this line was
          // quietly dropping. The owner's screenshot shows «0.0%».
          value={
            health.outboundLossPercent === null
              ? "—"
              : `${health.outboundLossPercent.toFixed(1)}%`
          }
          testId="voice-connection-loss"
        />
      </dl>

      <p
        className={cn(
          "text-xs leading-relaxed",
          // `--kub-danger-text` rather than `--kub-warn`, and the difference is
          // measured rather than preferred: `--kub-warn` exists only as a tone
          // for a dot and has no text-safe variant, while `--kub-online` had to
          // be split into `--kub-online-text` for exactly that reason. Painting
          // a sentence in a tone tuned for a mark is the pairing D-214 measured
          // at 1.50:1. «Lagging» is mildly over-stated by a danger colour and
          // the three sentences say which state this is.
          health.verdict === "good" || health.verdict === "unknown"
            ? "text-[color:var(--kub-muted)]"
            : "text-[color:var(--kub-danger-text)]",
        )}
        data-testid="voice-connection-advice"
      >
        {voiceHealthAdvice(health.verdict)}
      </p>

      <VerdictMark verdict={health.verdict} />
    </div>
  );
}

/** «45 мс», or a dash for a number nobody measured. */
function ms(value: number | null): string {
  return value === null ? "—" : `${value} мс`;
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="min-w-0 truncate text-[color:var(--kub-muted)]">{label}</dt>
      {/* `tabular-nums` so the numbers do not shuffle sideways once a second,
          which is what a proportional font does to a figure that changes. */}
      <dd
        className="shrink-0 font-semibold tabular-nums text-[color:var(--kub-text)]"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The one-glyph verdict, beside the sentence.
 *
 * Colour is never the only signal: there is a glyph, a word and the numbers
 * above. That is the same rule `KubBadge` follows and the reason its tone lives
 * on a dot rather than on its label.
 */
function VerdictMark({ verdict }: { verdict: VoiceHealthVerdict }) {
  if (verdict === "unknown") return null;
  const good = verdict === "good";
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        good ? "text-[color:var(--kub-online-text)]" : "text-[color:var(--kub-danger-text)]",
      )}
      data-testid="voice-connection-verdict"
    >
      <KubIcon name={good ? "check" : "warning"} size={13} className="shrink-0" />
      {good
        ? "Связь стабильна"
        : verdict === "lagging"
          ? `Задержка выше ${VOICE_HEALTH_THRESHOLDS.laggingRttMs} мс`
          : `Потеря выше ${VOICE_HEALTH_THRESHOLDS.distortingLossPercent}%`}
    </p>
  );
}

/**
 * The latency graph.
 *
 * Drawn right-aligned — the newest reading is at the right edge and the line
 * grows leftwards as history accumulates — because that is where a reader's eye
 * goes for «now», and it is what the owner's screenshot shows.
 */
function VoiceLatencyGraph({ scale }: { scale: VoiceHealthScale }) {
  const { points, maxMs } = scale;
  const slots = Math.max(points.length, 2);
  const x = (index: number) => (index / (slots - 1)) * GRAPH_WIDTH;
  const y = (value: number) => GRAPH_HEIGHT - (Math.min(value, maxMs) / maxMs) * GRAPH_HEIGHT;

  // Runs of consecutive readings that had a round trip. A gap in the readings
  // is a gap in the line; bridging it would invent a measurement across the
  // moment the connection was failing.
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  points.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, value });
  });
  if (run.length > 0) runs.push(run);

  return (
    <div
      className="w-full overflow-hidden rounded-lg bg-[color:var(--kub-surface-2)] p-2"
      data-testid="voice-connection-graph"
      data-voice-graph-points={points.length}
      data-voice-graph-max={maxMs}
    >
      <svg
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        className="h-16 w-full"
        role="img"
        aria-label={`График задержки, максимум ${maxMs} миллисекунд`}
        preserveAspectRatio="none"
      >
        {/* The ceiling, so the axis is readable without a label per gridline. */}
        <line
          x1="0"
          y1="0.5"
          x2={GRAPH_WIDTH}
          y2="0.5"
          stroke="var(--kub-rule)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        {runs.map((segment) => {
          const path = segment.map((point) => `${x(point.index)},${y(point.value)}`).join(" ");
          return (
            <g key={`${segment[0].index}-${segment.length}`}>
              {/* A line, and no area under it. The fill was there first and the
                  pixels refused it: a healthy connection reads 40–49 against a
                  50ms floor, so the area covered nearly the whole frame as one
                  solid block and the line it was meant to support disappeared
                  into its own top edge. Discord's draws a line. */}
              <polyline
                points={path}
                fill="none"
                stroke="var(--kub-cyan)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                // The stroke keeps its width whatever the viewBox is stretched
                // to, which `preserveAspectRatio="none"` would otherwise
                // squash horizontally and leave looking hand-drawn.
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-[color:var(--kub-muted)]">
        <span>0</span>
        <span data-testid="voice-connection-ceiling">{maxMs} мс</span>
      </div>
    </div>
  );
}
