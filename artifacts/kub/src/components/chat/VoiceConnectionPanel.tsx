"use client";

import { useState } from "react";
import { KubIcon } from "@/components/kub";
import { useVoiceCall, useVoiceJoinJournal, useVoiceJoinProgress } from "@/hooks/useVoiceCall";
import { useVoiceHealth } from "@/hooks/useVoiceHealth";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { FOCUS_RING } from "@/lib/controlSurface";
import { makeVoiceReport } from "@/lib/voiceReportSource";
import {
  voiceJoinStageLabel,
  voiceJoinStepMs,
  voiceJoinStepOutcome,
  type VoiceJoinJournal,
} from "@/lib/voiceJoinProgress";
import type { VoiceHealth, VoiceHealthSample } from "@/lib/voiceConnectionHealth";
import {
  voiceHealthAdvice,
  voiceInboundIsFault,
  voiceInboundLabel,
  VOICE_HEALTH_INCOMING_CAPTION,
  VOICE_HEALTH_OUTGOING_CAPTION,
  VOICE_HEALTH_THRESHOLDS,
  type VoiceHealthScale,
  type VoiceHealthVerdict,
  type VoiceInbound,
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
 *
 * ## The two directions are named, and that is a fix rather than a tidy-up
 *
 * Until 2026-09-19 every number here was outbound, and only one of them said
 * so. The owner sat in a channel hearing nothing while this panel read «19 мс,
 * 0.0%, связь стабильна» — all true, all about what he was sending. An
 * unlabelled number is read as «the connection», so a row that measures one
 * direction and says nothing about the other is not merely incomplete: it
 * actively answers a question it never asked. Both halves are now measured and
 * both sit under a heading that names them, and the incoming half leads with a
 * state in words rather than a figure, because «ничего не приходит» is the
 * sentence somebody opened this panel to find.
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
  const { health, scale, samples, serverName, connected } = useVoiceHealth(open);
  const journal = useVoiceJoinJournal();
  const progress = useVoiceJoinProgress();
  const call = useVoiceCall();

  /**
   * **The panel outlives the connection, and that is the change of 2026-09-19.**
   *
   * It used to answer `null` for anything but a running call, which read as
   * correct — there are no numbers to draw — and left the one case somebody
   * actually needs it for with nothing at all: a join that failed. The person
   * whose evening this was had three attempts of fifteen seconds and a single
   * sentence, and the headset button beside that sentence opened an empty box.
   *
   * So when there is no call but there **is** a journal, the panel draws the
   * steps and the button that hands them over. That is not a lesser version of
   * the connected panel; for a failure it is the whole diagnosis, because the
   * step that did not finish is the answer.
   */
  if (!connected && journal.length === 0) return null;

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-2", className)}
      data-testid="voice-connection-panel"
      data-voice-verdict={connected ? health.verdict : "offline"}
      data-voice-connected={connected ? "true" : "false"}
    >
      {connected && <VoiceLatencyGraph scale={scale} />}

      {connected && serverName && (
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

      {connected && (
      <dl className="flex flex-col gap-0.5 text-sm" data-testid="voice-connection-numbers">
        {/* The round trip belongs to neither direction on its own — it is the
            path to the server and back — so it stays above both headings
            rather than being claimed by one of them. */}
        <Row label="Средняя задержка" value={ms(health.averageRttMs)} testId="voice-connection-average" />
        <Row label="Последняя задержка" value={ms(health.lastRttMs)} testId="voice-connection-last" />

        <Caption>{VOICE_HEALTH_OUTGOING_CAPTION}</Caption>
        <Row
          label="Потеря пакетов"
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

        <Caption>{VOICE_HEALTH_INCOMING_CAPTION}</Caption>
        <IncomingRows inbound={health.inbound} />
      </dl>
      )}

      {connected && (
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
      )}

      {connected && <VerdictMark verdict={health.verdict} />}

      {/* The steps, under the numbers rather than over them. On a running call
          they are history and the numbers are the news; on a failed one there
          are no numbers and this is the only thing here. */}
      {/* Named, because five durations with no heading are five numbers. The
          same `Caption` the two directions use above, so the panel has one
          vocabulary for «what the rows under this are about». */}
      {journal.length > 0 && (
        <Caption testId="voice-connection-stages-caption">Шаги подключения</Caption>
      )}
      <JoinTimeline
        journal={journal}
        openElapsedMs={progress?.elapsedMs ?? 0}
        failed={call.phase === "failed"}
      />


      <VoiceReportButton samples={samples} health={connected ? health : null} />
    </div>
  );
}

/**
 * What each step of the join took.
 *
 * **In a failure this is the diagnosis, not an illustration of it.** The
 * 2026-09-19 case reads «Связь с сервером 0.18 с готово» directly above
 * «Медиасоединение 15.01 с ← оборвалось», which is the entire content of an
 * evening, an SSH session and a read of the media server's logs.
 *
 * `tabular-nums` and a right-aligned column, so the durations can be compared
 * down the page rather than read one at a time — the whole reason a fifteen
 * beside four tenths is legible at a glance.
 */
function JoinTimeline({
  journal,
  openElapsedMs,
  failed,
}: {
  journal: VoiceJoinJournal;
  /** The running step's age, ticking. Ignored for a step that has finished. */
  openElapsedMs: number;
  /**
   * Whether the attempt ended in a refusal.
   *
   * Passed in rather than read off `endedAt`, and this was a real defect before
   * it was: `fail()` closes the journal before it publishes, so a failed join
   * has **no** open step and the first version of this list drew every row as
   * «finished» — including the fifteen-second one that had just timed out, on
   * the exact journal it was written for. `voiceJoinStepOutcome` owns the rule
   * and the report uses the same one, so the two cannot disagree.
   */
  failed: boolean;
}) {
  if (journal.length === 0) return null;
  return (
    <ol className="flex flex-col gap-0.5 text-xs" data-testid="voice-connection-stages">
      {journal.map((step, index) => {
        const outcome = voiceJoinStepOutcome(journal, index, failed);
        const ms = outcome === "running" ? openElapsedMs : voiceJoinStepMs(step, step.at);
        const marked = outcome !== "done";
        return (
          <li
            key={step.stage}
            className="flex min-w-0 items-baseline justify-between gap-2"
            data-voice-stage={step.stage}
            data-voice-stage-outcome={outcome}
          >
            <span
              className={cn(
                "min-w-0 truncate",
                marked ? "font-semibold text-[color:var(--kub-text)]" : "text-[color:var(--kub-muted)]",
              )}
            >
              {voiceJoinStageLabel(step.stage)}
            </span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                marked
                  ? "font-semibold text-[color:var(--kub-danger-text)]"
                  : "text-[color:var(--kub-muted)]",
              )}
            >
              {(ms / 1000).toFixed(2)} с
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The button that hands the whole thing over.
 *
 * ## Why the clipboard and not a file
 *
 * This product already has a «save as» — `saveMediaAs` in
 * `lib/messageMediaActions.ts` — and it is deliberately not reused. It fetches
 * a blob, makes an object URL and clicks an anchor with `download`, which is
 * right for a photograph somebody wants on their disk and wrong for this: the
 * report's destination is a chat message, so a file would be one more step
 * before it could be sent and one more thing to attach. `copyWithFeedback` is
 * the mechanism this application already uses for «hand the person a string»
 * in five places, and it says whether it worked — which matters here, because a
 * clipboard write can be refused outright and silence then reads as success.
 *
 * ## Built on the press, which is why `KubCopyButton` does not fit
 *
 * That component takes the text as a **prop**, so the report would have to be
 * composed on every render of the panel — once a second while it is open, each
 * one reaching into the transport for the server's facts and walking the
 * document for its audio elements. This builds it once, when somebody asks.
 */
function VoiceReportButton({
  samples,
  health,
}: {
  samples: readonly VoiceHealthSample[];
  /** `null` when there is no call, so the report says so rather than printing zeroes. */
  health: VoiceHealth | null;
}) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await copyWithFeedback(makeVoiceReport({ samples, health }), {
        success: "Отчёт о соединении скопирован",
        error: "Не удалось скопировать отчёт",
        key: "voice-connection-report",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      data-testid="voice-connection-report"
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--glass-line)]",
        "px-2 py-1.5 text-xs font-semibold text-[color:var(--kub-text)] kub-raise-hover",
        FOCUS_RING,
      )}
    >
      <KubIcon name="copy" size={13} className="shrink-0" />
      Скопировать отчёт о соединении
    </button>
  );
}

/** «45 мс», or a dash for a number nobody measured. */
function ms(value: number | null): string {
  return value === null ? "—" : `${value} мс`;
}

/**
 * Which direction the rows under it are about.
 *
 * A `dt`-less line inside the `dl` rather than a heading outside it, so the
 * list stays one list: the two halves are the same measurement taken at two
 * ends, and splitting them into two `dl`s would put a semantic boundary where
 * there is only a visual one.
 */
function Caption({
  children,
  // `voice-connection-caption` is the **two directions** and nothing else:
  // `voice-call.spec.ts` reads `.first()` and `.last()` of it to prove that
  // neither half of the call can be mistaken for «the connection». Adding a
  // third caption under that id made `.last()` answer «Шаги подключения», which
  // is how this default came to be overridable rather than fixed.
  testId = "voice-connection-caption",
}: {
  children: string;
  testId?: string;
}) {
  return (
    <p
      className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

/**
 * The incoming half.
 *
 * **The state comes first, in words, and the numbers come after it.** Every
 * other row here is a figure because a figure is what somebody is comparing
 * against a threshold; this one is a sentence because the question is not «how
 * much» but «is anything reaching me», and a reader who has just discovered
 * they can hear nobody should not have to infer that from a dash.
 *
 * A fault is drawn in `--kub-danger-text`, which is the text-safe tone — never
 * `--kub-warn`, which exists only for a mark. The rest is the ordinary muted
 * value, including «Никто не передаёт»: an empty room is not a failure.
 */
function IncomingRows({ inbound }: { inbound: VoiceInbound }) {
  const fault = voiceInboundIsFault(inbound.reading);
  return (
    <>
      <Row
        label="Состояние"
        value={voiceInboundLabel(inbound.reading)}
        testId="voice-connection-inbound-state"
        tone={fault ? "danger" : "normal"}
        data-reading={inbound.reading}
      />
      <Row
        label="Потеря пакетов"
        value={inbound.lossPercent === null ? "—" : `${inbound.lossPercent.toFixed(1)}%`}
        testId="voice-connection-inbound-loss"
      />
      {/* One number over several senders, so it says which one: the worst
          voice in the room, not an average — an average hides the person who
          is breaking up behind everybody who is fine. A dash here is not a
          formatting gap; `voiceInboundJitterStands` withholds the number for
          a reading it would misrepresent. */}
      <Row
        label="Дрожание"
        value={ms(inbound.lastJitterMs)}
        testId="voice-connection-inbound-jitter"
        title="Худший показатель среди собеседников"
      />
    </>
  );
}

function Row({
  label,
  value,
  testId,
  tone = "normal",
  title,
  ...rest
}: {
  label: string;
  value: string;
  testId: string;
  tone?: "normal" | "danger";
  /** Hover text on the label, for a number that needs saying which one it is. */
  title?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2" {...rest}>
      <dt className="min-w-0 truncate text-[color:var(--kub-muted)]" title={title}>
        {label}
      </dt>
      {/* `tabular-nums` so the numbers do not shuffle sideways once a second,
          which is what a proportional font does to a figure that changes. */}
      <dd
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          tone === "danger" ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]",
        )}
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
          : verdict === "not_receiving"
            ? "Входящий звук не идёт"
            : verdict === "unheard"
              ? "Звук не воспроизводится"
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
