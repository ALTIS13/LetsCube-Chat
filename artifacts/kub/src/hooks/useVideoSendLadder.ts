import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { targetSizeFor, type VideoSendHeight } from "@/lib/videoSendLadder";
import {
  SOURCE_STOP,
  defaultStop,
  encodableStops,
  nearestStop,
  stopForVideo,
  stopSummary,
  type SelectedVideo,
  type StopSummary,
  type VideoSendStop,
} from "@/lib/videoSendSelection";
import { readVideoSource } from "@/lib/videoSource";
import { planVideoSend, transcodeVideo } from "@/lib/videoTranscode";
import { canEncodeFrame, videoTranscodeSupport } from "@/lib/videoTranscodeSupport";

/** A selected video, as the attach sheet holds it. */
export interface VideoSendPick {
  id: string;
  file: File;
}

export interface VideoSendLadderProgress {
  /** 0 to 1 across the whole batch. */
  value: number;
  /** «2 из 3», or null while one file is being encoded. */
  position: string | null;
}

export interface VideoSendLadder {
  /** Whether the containers have been read and the rungs asked about. */
  ready: boolean;
  stops: VideoSendStop[];
  stop: VideoSendStop;
  setStop: (next: VideoSendStop) => void;
  summary: StopSummary;
  /** How many videos the slider governs. */
  videos: number;
  /** Set while encoding runs; null otherwise. */
  progress: VideoSendLadderProgress | null;
  cancel: () => void;
  /**
   * The files to send: every video the chosen stop encodes, replaced by its
   * smaller self. `null` means the person cancelled, and nothing should be sent.
   *
   * `origins` maps each replacement back to the size of the file it replaced, so
   * the tray can say «после сжатия» and mean it. Without it the staged
   * attachment carries the transcoded file as though it were the original, and
   * the one number that would tell a person their wait was worth something is
   * the only one missing.
   */
  prepare: (files: readonly File[]) => Promise<{ files: File[]; origins: Map<File, number> } | null>;
}

interface LadderFacts {
  /** What each picked file turned out to be, by its pick id. */
  videos: SelectedVideo[];
  /** `${id}|${rung}` for every pair this browser said it can encode. */
  encodable: Set<string>;
  ready: boolean;
}

const EMPTY: LadderFacts = { videos: [], encodable: new Set(), ready: false };

const pairKey = (videoId: string, rung: VideoSendHeight) => `${videoId}|${rung}`;

/**
 * The video ladder, for the surface that offers it (D-175).
 *
 * Everything asynchronous and browser-bound lives here: reading what each
 * picked file actually is, asking WebCodecs which rungs it can encode, holding
 * the chosen stop, and carrying out the encoding when the send happens. Every
 * decision it makes is delegated to the pure modules, which is where they are
 * tested — this hook contributes no rule of its own.
 *
 * **Why the rungs are probed rather than assumed.** The session probe asks about
 * 1280x720. A device whose encoder tops out there would accept that question and
 * refuse a 2160 frame, so offering 4K on the strength of the session probe would
 * put a rung on the slider that silently declines at send time. D-175 exists
 * because a silent decline and a failed transcode are the same thing to a
 * person, so a rung nothing can encode is removed instead.
 */
export function useVideoSendLadder(picks: readonly VideoSendPick[]): VideoSendLadder {
  const [facts, setFacts] = useState<LadderFacts>(EMPTY);
  const [wanted, setWanted] = useState<VideoSendStop | null>(null);
  const [progress, setProgress] = useState<VideoSendLadderProgress | null>(null);

  // The sheet recomputes its selection on every render, so the array identity
  // changes constantly while its contents do not. The effect keys on what the
  // selection *is*, and reads the picks themselves through a ref.
  const key = picks.map((pick) => `${pick.id}:${pick.file.size}`).join("|");
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const readRef = useRef(new Map<string, SelectedVideo>());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const current = picksRef.current;
    if (!current.length) {
      setFacts(EMPTY);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const videos: SelectedVideo[] = [];
      for (const pick of current) {
        const cached = readRef.current.get(pick.id);
        if (cached) {
          videos.push(cached);
          continue;
        }
        const read = await readVideoSource(pick.file);
        if (cancelled) return;
        const video: SelectedVideo = { id: pick.id, sizeBytes: pick.file.size, source: read?.source ?? null };
        readRef.current.set(pick.id, video);
        videos.push(video);
      }

      const support = await videoTranscodeSupport();
      if (cancelled) return;

      const encodable = new Set<string>();
      if (support.available && support.codec) {
        // One question per distinct frame, not per file: a selection of ten
        // clips off the same phone asks four times, not forty.
        const asked = new Map<string, boolean>();
        for (const video of videos) {
          if (!video.source) continue;
          for (const rung of [480, 720, 1080, 1440, 2160] as VideoSendHeight[]) {
            if (stopForVideo(video, rung) === SOURCE_STOP) continue;
            const frame = targetSizeFor(video.source, rung);
            const frameKey = `${support.codec}|${frame.width}x${frame.height}`;
            let answer = asked.get(frameKey);
            if (answer === undefined) {
              answer = await canEncodeFrame(support.codec, frame.width, frame.height);
              if (cancelled) return;
              asked.set(frameKey, answer);
            }
            if (answer) encodable.add(pairKey(video.id, rung));
          }
        }
      }

      setFacts({ videos, encodable, ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  const stops = useMemo(
    () => encodableStops(facts.videos, (video, rung) => facts.encodable.has(pairKey(video.id, rung))),
    [facts],
  );

  // The chosen stop survives a change of selection wherever it still exists, and
  // falls to the nearest one that does otherwise. Re-defaulting on every pick
  // would undo a choice a person had already made.
  const stop = wanted === null ? defaultStop(facts.videos) : nearestStop(stops, wanted);
  const summary = useMemo(() => stopSummary(facts.videos, stop), [facts.videos, stop]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const prepare = useCallback(
    async (files: readonly File[]): Promise<{ files: File[]; origins: Map<File, number> } | null> => {
      const byFile = new Map<File, SelectedVideo>();
      for (const pick of picksRef.current) {
        const video = readRef.current.get(pick.id);
        if (video) byFile.set(pick.file, video);
      }
      const support = await videoTranscodeSupport();
      const plans = files.map((file) => {
        const video = byFile.get(file);
        if (!video?.source) return null;
        const chosen = stopForVideo(video, stop);
        if (chosen === SOURCE_STOP) return null;
        const plan = planVideoSend(video.source, chosen, support, facts.encodable.has(pairKey(video.id, chosen)));
        return plan.action === "transcode" ? { file, plan } : null;
      });
      const total = plans.filter(Boolean).length;
      const origins = new Map<File, number>();
      if (!total) return { files: [...files], origins };

      const controller = new AbortController();
      abortRef.current = controller;
      setProgress({ value: 0, position: total > 1 ? `1 из ${total}` : null });
      let done = 0;
      const prepared = [...files];
      try {
        for (let index = 0; index < plans.length; index += 1) {
          const entry = plans[index];
          if (!entry) continue;
          setProgress({ value: done / total, position: total > 1 ? `${done + 1} из ${total}` : null });
          const encoded = await transcodeVideo(entry.file, entry.plan, {
            signal: controller.signal,
            onProgress: (value) =>
              setProgress({ value: (done + value) / total, position: total > 1 ? `${done + 1} из ${total}` : null }),
          });
          if (controller.signal.aborted) return null;
          // A transcode that failed for any other reason is not a failed send:
          // the picked bytes go, which is the path a browser without an encoder
          // takes anyway.
          if (encoded) {
            prepared[index] = encoded;
            origins.set(encoded, entry.file.size);
          }
          done += 1;
        }
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
      return { files: prepared, origins };
    },
    [facts.encodable, stop],
  );

  return {
    ready: facts.ready,
    stops,
    stop,
    setStop: setWanted,
    summary,
    videos: facts.videos.length,
    progress,
    cancel,
    prepare,
  };
}
