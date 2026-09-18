"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { currentVoiceRoom, useVoiceCall } from "@/hooks/useVoiceCall";
import {
  trimVoiceSamples,
  voiceHealthOf,
  voiceHealthScale,
  type VoiceHealth,
  type VoiceHealthSample,
  type VoiceHealthScale,
} from "@/lib/voiceConnectionHealth";

/**
 * How the call is doing, sampled while somebody is looking (D-217).
 *
 * The arithmetic is `lib/voiceConnectionHealth.ts` and is pure; this is the
 * timer and the ring buffer.
 *
 * **Sampling only while the panel is open** is the whole of the design here. A
 * call runs for hours and the panel is read for seconds. Sampling for the
 * lifetime of the call would mean a `getStats()` round trip every second of
 * every call on every device, for a graph nobody has asked to see — and
 * `getStats()` is not free: it walks every transport and every track. So the
 * hook takes an `enabled` flag, and the panel is the only thing that sets it.
 *
 * **The cost of that choice, stated rather than hidden:** the graph starts
 * empty and fills over four minutes, so somebody who opens the panel the moment
 * a call breaks sees the break and not what led to it. That is the right trade
 * — the alternative buys history for a problem nobody has, at the price of a
 * timer on every call — and the panel says «Измеряем соединение…» rather than
 * drawing an empty frame as though it were a flat line.
 */

export interface VoiceHealthView {
  /** The numbers, from every reading held. */
  readonly health: VoiceHealth;
  /** The series and its ceiling, for the graph. */
  readonly scale: VoiceHealthScale;
  /** Which media server this call landed on, or null. */
  readonly serverName: string | null;
  /** Whether a call is running at all. */
  readonly connected: boolean;
}

/** One reading a second, which is the rate the graph's axis is drawn for. */
const SAMPLE_EVERY_MS = 1000;

export function useVoiceHealth(enabled: boolean): VoiceHealthView {
  const call = useVoiceCall();
  const connected = call.phase === "connected" || call.phase === "reconnecting";
  const [samples, setSamples] = useState<VoiceHealthSample[]>([]);
  const [serverName, setServerName] = useState<string | null>(null);
  // `Date.now()` captured per render rather than per sample, so every number on
  // screen is computed against one instant. Two fields computed against two
  // instants is how a graph's last point disagrees with the «last» field.
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);

  // A call that ends takes its readings with it. Keeping them would draw the
  // previous call's graph under the next call's header.
  useEffect(() => {
    if (connected) return;
    setSamples([]);
    setServerName(null);
  }, [connected]);

  useEffect(() => {
    if (!enabled || !connected) return;
    let cancelled = false;

    const tick = async () => {
      // Overlap guard. `getStats()` on a bad connection can take longer than
      // the interval, and a second reading started before the first returned
      // would put two readings at almost the same instant — which the loss
      // arithmetic then divides by a near-zero window.
      if (running.current) return;
      running.current = true;
      try {
        const transport = currentVoiceRoom();
        if (!transport) return;
        const reading = await transport.sampleHealth();
        if (cancelled) return;
        setSamples((held) => trimVoiceSamples([...held, reading], reading.at));
        setNow(reading.at);
        setServerName((held) => held ?? transport.serverName());
      } catch {
        // A reading that threw is a reading that did not happen. The series
        // keeps its shape and the panel keeps saying what it last knew.
      } finally {
        running.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), SAMPLE_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connected, enabled]);

  return useMemo(
    () => ({
      health: voiceHealthOf(samples, now),
      scale: voiceHealthScale(samples, now),
      serverName,
      connected,
    }),
    [connected, now, samples, serverName],
  );
}
