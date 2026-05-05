"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { getAudioSettings } from "@/hooks/useAudioSettings";

export type RecordingState = "idle" | "recording" | "stopping";

export type VoiceErrorCode =
  | "permission_denied"
  | "no_device"
  | "unsupported"
  | "unknown";

export interface VoiceRecordResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

const TIMER_TICK_MS = 250;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of PREFERRED_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function classifyMicError(err: unknown): VoiceErrorCode {
  if (!(err instanceof Error)) return "unknown";
  const name = err.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "permission_denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no_device";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "no_device";
  }
  return "unknown";
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecordingState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<VoiceErrorCode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolverRef = useRef<((r: VoiceRecordResult | null) => void) | null>(null);
  // Monotonically incremented on every start()/cancel()/unmount. Any in-flight
  // getUserMedia promise compares against this; if it has changed by the time
  // the mic resolves, the acquired tracks are stopped immediately so we never
  // leave a dangling recording session behind.
  const sessionIdRef = useRef<number>(0);
  const disposedRef = useRef<boolean>(false);

  /** Stops timer + tracks; clears recorder/stream refs. Safe to call any number of times. */
  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      try {
        stream.getTracks().forEach((t) => {
          try { t.stop(); } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
      streamRef.current = null;
    }
    const recorderStream = recorderStreamRef.current;
    if (recorderStream && recorderStream !== stream) {
      try {
        recorderStream.getTracks().forEach((t) => {
          try { t.stop(); } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
    }
    recorderStreamRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    recorderRef.current = null;
  }, []);

  // Hard cleanup on unmount: invalidate any in-flight start(), drop resolver, kill the mic.
  // Terminal-path reset policy: every place that ends a recording (onstop, stop's manual
  // completion path, stop's catch, cancel, and this unmount cleanup) MUST reset both
  // chunksRef and startedAtRef. Keep this list in sync with the body of those paths.
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      sessionIdRef.current += 1;
      const resolver = stopResolverRef.current;
      stopResolverRef.current = null;
      try { resolver?.(null); } catch { /* ignore */ }
      teardown();
      chunksRef.current = [];
      startedAtRef.current = 0;
    };
  }, [teardown]);

  /**
   * Begin recording. Idempotent: a second call while already recording resolves true
   * without re-acquiring the microphone (this is what protects us from React StrictMode
   * double-invokes and from re-render races).
   */
  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) {
      // Already running.
      return true;
    }
    if (disposedRef.current) return false;
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("unsupported");
      return false;
    }

    // Bind this start() invocation to a session token. If teardown happens
    // (cancel / unmount / another start) while we await getUserMedia, the
    // session id changes and we abort + release any tracks we acquired.
    sessionIdRef.current += 1;
    const mySession = sessionIdRef.current;
    const isStale = () => disposedRef.current || sessionIdRef.current !== mySession;

    const releaseStream = (s: MediaStream | null) => {
      if (!s) return;
      try { s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }); } catch { /* ignore */ }
    };

    const settings = getAudioSettings();

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: 1,
        },
      });
    } catch (err) {
      const isOverconstrained = err instanceof Error && err.name === "OverconstrainedError";
      if (isOverconstrained) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err2) {
          if (!isStale()) setError(classifyMicError(err2));
          return false;
        }
      } else {
        if (!isStale()) setError(classifyMicError(err));
        return false;
      }
    }

    if (!stream) {
      if (!isStale()) setError("unknown");
      return false;
    }

    // Stale check: caller cancelled or component unmounted while we awaited
    // permission. Drop the freshly acquired tracks immediately.
    if (isStale()) {
      releaseStream(stream);
      return false;
    }

    // Race guard: another start() already won the seat.
    if (recorderRef.current) {
      releaseStream(stream);
      return true;
    }

    streamRef.current = stream;
    let recorderStream = stream;
    if (settings.micInputGain !== 1 && typeof AudioContext !== "undefined") {
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        gain.gain.value = settings.micInputGain;
        source.connect(gain);
        gain.connect(destination);
        audioContextRef.current = audioContext;
        recorderStream = destination.stream;
        recorderStreamRef.current = recorderStream;
      } catch (err) {
        console.warn("[voice] mic gain pipeline unavailable, using raw stream:", err);
        recorderStream = stream;
        recorderStreamRef.current = null;
      }
    }
    chunksRef.current = [];

    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(recorderStream, { mimeType: mime })
        : new MediaRecorder(recorderStream);
      mimeRef.current = recorder.mimeType || mime || "audio/webm";
    } catch (err) {
      console.error("[voice] MediaRecorder ctor failed:", err);
      teardown();
      setError("unsupported");
      return false;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = (e) => {
      console.error("[voice] MediaRecorder error:", e);
    };

    recorder.onstop = () => {
      const finalDurationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      const resolver = stopResolverRef.current;
      stopResolverRef.current = null;
      // Hard-cleanup: drop chunks now that the blob is materialised.
      chunksRef.current = [];
      startedAtRef.current = 0;
      teardown();
      setState("idle");
      setDurationMs(0);
      const result: VoiceRecordResult = { blob, mimeType: mimeRef.current, durationMs: finalDurationMs };
      try { resolver?.(result); } catch (err) { console.error("[voice] resolver threw:", err); }
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setDurationMs(0);
    setState("recording");

    try {
      recorder.start(100);
    } catch (err) {
      console.error("[voice] recorder.start failed:", err);
      teardown();
      setState("idle");
      setError("unknown");
      return false;
    }

    timerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startedAtRef.current);
    }, TIMER_TICK_MS);

    return true;
  }, [teardown]);

  /**
   * Stop recording cleanly and resolve with the produced blob (or null if nothing was
   * recorded). Awaits MediaRecorder.onstop instead of relying on a setTimeout.
   */
  const stop = useCallback((): Promise<VoiceRecordResult | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder) {
        resolve(null);
        return;
      }
      // Avoid double-resolve if stop() is called twice.
      if (stopResolverRef.current) {
        const prev = stopResolverRef.current;
        stopResolverRef.current = (r) => { try { prev(r); } catch { /* ignore */ } resolve(r); };
        return;
      }
      stopResolverRef.current = resolve;
      setState("stopping");
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        } else {
          // Already inactive — fall through to onstop won't fire; resolve manually.
          stopResolverRef.current = null;
          const finalDurationMs = Date.now() - startedAtRef.current;
          const blob = new Blob(chunksRef.current, { type: mimeRef.current });
          chunksRef.current = [];
          startedAtRef.current = 0;
          teardown();
          setState("idle");
          setDurationMs(0);
          resolve({ blob, mimeType: mimeRef.current, durationMs: finalDurationMs });
        }
      } catch (err) {
        console.error("[voice] recorder.stop threw:", err);
        stopResolverRef.current = null;
        chunksRef.current = [];
        startedAtRef.current = 0;
        teardown();
        setState("idle");
        setDurationMs(0);
        resolve(null);
      }
    });
  }, [teardown]);

  /** Drop everything; the user wants to discard the recording. */
  const cancel = useCallback(() => {
    // Invalidate any in-flight start() that may still be awaiting permission.
    sessionIdRef.current += 1;
    const recorder = recorderRef.current;
    chunksRef.current = [];
    startedAtRef.current = 0;
    const resolver = stopResolverRef.current;
    stopResolverRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      // Detach onstop so it can't fire after cancel.
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* ignore */ }
    }
    teardown();
    setState("idle");
    setDurationMs(0);
    try { resolver?.(null); } catch { /* ignore */ }
  }, [teardown]);

  return {
    state,
    durationMs,
    error,
    start,
    stop,
    cancel,
  };
}

export function formatVoiceDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
