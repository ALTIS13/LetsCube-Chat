"use client";

import { useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import {
  formatAudioPercent,
  useAudioSettings,
  type AudioSettings,
} from "@/hooks/useAudioSettings";
import { cn } from "@/lib/utils";

type AudioContextCtor = typeof AudioContext;
type MicProcessingMode = "clean" | "raw";

const DEFAULT_MONITOR_GAIN = 0.8;

function audioConstraints(mode: MicProcessingMode, includeAdvanced = true): MediaStreamConstraints {
  const processed = mode === "clean";
  return {
    audio: {
      echoCancellation: { ideal: processed },
      noiseSuppression: { ideal: processed },
      autoGainControl: { ideal: processed },
      channelCount: { ideal: 1 },
      ...(includeAdvanced ? {
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
      } : null),
    },
  };
}

export function AudioSettingsSection() {
  const { settings, updateSettings, resetSettings } = useAudioSettings();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processingMode, setProcessingMode] = useState<MicProcessingMode>("clean");
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);
  const [selfMonitoring, setSelfMonitoring] = useState(false);
  const [monitorGain, setMonitorGain] = useState(DEFAULT_MONITOR_GAIN);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);
  const monitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);

  const stopSelfMonitoring = (updateState = true) => {
    try {
      monitorSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      monitorGainRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    monitorSourceRef.current = null;
    monitorGainRef.current = null;
    const context = monitorContextRef.current;
    monitorContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    if (updateState) {
      setSelfMonitoring(false);
      setMonitorError(null);
    }
  };

  const stopMicTest = (updateState = true) => {
    stopSelfMonitoring(updateState);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    if (updateState) {
      setTesting(false);
      setLevel(0);
      setProcessingNotice(null);
    }
  };

  useEffect(() => {
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = monitorGain;
    }
  }, [monitorGain]);

  useEffect(() => {
    return () => {
      stopMicTest(false);
      stopSelfMonitoring(false);
    };
  }, []);

  const enableSelfMonitoring = async (stream: MediaStream): Promise<boolean> => {
    setMonitorError(null);
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      setMonitorError("Прослушивание себя не поддерживается в этом браузере.");
      return false;
    }

    stopSelfMonitoring(false);
    try {
      const context = new AudioContextCtor();
      if (context.state === "suspended") {
        await context.resume();
      }
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = monitorGain;
      source.connect(gain);
      gain.connect(context.destination);
      monitorContextRef.current = context;
      monitorSourceRef.current = source;
      monitorGainRef.current = gain;
      setSelfMonitoring(true);
      return true;
    } catch {
      stopSelfMonitoring(false);
      setSelfMonitoring(false);
      setMonitorError("Не удалось включить прослушивание. Попробуйте ещё раз.");
      return false;
    }
  };

  const setupMicTest = async (mode: MicProcessingMode, restoreMonitoring = false) => {
    const AudioContextCtor = getAudioContextCtor();
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      setError("Проверка микрофона не поддерживается этим браузером.");
      return false;
    }

    setError(null);
    setMonitorError(null);
    try {
      const result = await requestMicStream(mode);
      const stream = result.stream;
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      const source = context.createMediaStreamSource(stream);
      const data = new Uint8Array(analyser.fftSize);
      gain.gain.value = settings.micInputGain;
      source.connect(gain);
      gain.connect(analyser);
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError("Микрофон недоступен.");
          stopMicTest();
        };
      });
      debugMicTrack(stream);
      streamRef.current = stream;
      contextRef.current = context;
      setTesting(true);
      setProcessingNotice(result.fallback
        ? "Часть обработки микрофона не поддерживается этим браузером. Используется стандартный режим."
        : null);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const sample of data) {
          peak = Math.max(peak, Math.abs(sample - 128));
        }
        setLevel(Math.min(1, (peak / 128) * settings.micInputGain));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();

      if (restoreMonitoring) {
        await enableSelfMonitoring(stream);
      }
      return true;
    } catch (err) {
      setError(microphoneErrorMessage(err));
      stopMicTest();
      return false;
    }
  };

  const startMicTest = async () => {
    if (testing) {
      stopMicTest();
      return;
    }
    await setupMicTest(processingMode);
  };

  const changeProcessingMode = async (mode: MicProcessingMode) => {
    if (processingMode === mode) return;
    setProcessingMode(mode);
    setProcessingNotice(null);
    if (!testing) return;
    const restoreMonitoring = selfMonitoring;
    stopMicTest();
    await setupMicTest(mode, restoreMonitoring);
  };

  const toggleSelfMonitoring = async () => {
    if (selfMonitoring) {
      stopSelfMonitoring();
      return;
    }
    const stream = streamRef.current;
    if (!testing || !stream || !stream.active || stream.getAudioTracks().every((track) => track.readyState === "ended")) {
      setMonitorError("Сначала запустите проверку микрофона.");
      return;
    }
    await enableSelfMonitoring(stream);
  };

  return (
    <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
      <div className="px-4 py-3 space-y-4">
        <div className="flex items-start gap-3">
          <KubIcon name="microphone" size={16} className="mt-0.5 text-[color:var(--kub-cyan)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Звук и голосовые</div>
            <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Настройки применяются внутри приложения и не меняют системную громкость Windows.
            </p>
          </div>
        </div>

        <SliderRow
          label="Громкость микрофона"
          value={settings.micInputGain}
          min={0}
          max={2}
          step={0.05}
          onChange={(micInputGain) => updateSettings({ micInputGain })}
        />
        <SliderRow
          label="Громкость голосовых"
          value={settings.voicePlaybackVolume}
          min={0}
          max={1}
          step={0.05}
          onChange={(voicePlaybackVolume) => updateSettings({ voicePlaybackVolume })}
        />

        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow
            label="Шумоподавление"
            checked={settings.noiseSuppression}
            onChange={(noiseSuppression) => updateSettings({ noiseSuppression })}
          />
          <ToggleRow
            label="Эхоподавление"
            checked={settings.echoCancellation}
            onChange={(echoCancellation) => updateSettings({ echoCancellation })}
          />
          <ToggleRow
            label="Автоусиление"
            checked={settings.autoGainControl}
            onChange={(autoGainControl) => updateSettings({ autoGainControl })}
          />
        </div>

        <div className="rounded-xl px-3 py-3 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]">
          <div className="flex items-center gap-3">
            <KubButton size="sm" variant={testing ? "secondary" : "primary"} onClick={startMicTest}>
              {testing ? "Остановить" : "Проверка микрофона"}
            </KubButton>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
              <div
                className="h-full rounded-full bg-[var(--kub-cyan)] transition-[width]"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="min-w-0 text-xs font-semibold text-[color:var(--kub-text)]">Обработка микрофона</span>
              <span className="shrink-0 text-[10px] text-[color:var(--kub-muted)]">
                {processingMode === "clean" ? "Чистый голос" : "Без обработки"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <ModeButton
                active={processingMode === "clean"}
                label="Чистый голос"
                onClick={() => void changeProcessingMode("clean")}
              />
              <ModeButton
                active={processingMode === "raw"}
                label="Без обработки"
                onClick={() => void changeProcessingMode("raw")}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Если слышите эхо, используйте наушники. Если голос звучит с артефактами, попробуйте режим «Без обработки».
            </p>
          </div>

          <label className="mt-3 flex min-w-0 items-start gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <input
              type="checkbox"
              checked={selfMonitoring}
              disabled={!testing}
              onChange={() => void toggleSelfMonitoring()}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--kub-cyan)] disabled:opacity-50"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[color:var(--kub-text)]">Прослушивать себя</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {selfMonitoring
                  ? "Используйте наушники, чтобы избежать эха."
                  : "Доступно только во время проверки микрофона."}
              </span>
            </span>
          </label>

          {selfMonitoring && (
            <SliderRow
              label="Громкость прослушивания"
              value={monitorGain}
              min={0}
              max={1}
              step={0.05}
              onChange={setMonitorGain}
            />
          )}

          {processingNotice && (
            <div className="mt-2 text-xs text-[color:var(--kub-muted)]">
              {processingNotice}
            </div>
          )}
          {error && (
            <div className="mt-2 text-xs text-[color:var(--kub-danger)]">
              {error}
            </div>
          )}
          {monitorError && (
            <div className="mt-2 text-xs text-[color:var(--kub-danger)]">
              {monitorError}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={resetSettings}
          className="text-xs font-semibold text-[color:var(--kub-cyan)] hover:underline"
        >
          Сбросить настройки звука
        </button>
      </div>
    </div>
  );
}

async function requestMicStream(mode: MicProcessingMode): Promise<{ stream: MediaStream; fallback: boolean }> {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(audioConstraints(mode)), fallback: false };
  } catch (err) {
    if (isPermissionOrDeviceError(err)) throw err;
  }

  try {
    return { stream: await navigator.mediaDevices.getUserMedia(audioConstraints(mode, false)), fallback: true };
  } catch (err) {
    if (isPermissionOrDeviceError(err)) throw err;
  }

  return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), fallback: true };
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

function microphoneErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Микрофон недоступен.";
  if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError" || err.name === "SecurityError") {
    return "Нет доступа к микрофону.";
  }
  if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError" || err.name === "NotReadableError" || err.name === "TrackStartError") {
    return "Микрофон недоступен.";
  }
  return "Не удалось применить настройки обработки. Используется стандартный режим.";
}

function isPermissionOrDeviceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "NotAllowedError" ||
    err.name === "PermissionDeniedError" ||
    err.name === "SecurityError" ||
    err.name === "NotFoundError" ||
    err.name === "DevicesNotFoundError" ||
    err.name === "NotReadableError" ||
    err.name === "TrackStartError"
  );
}

function debugMicTrack(stream: MediaStream) {
  if (!import.meta.env.DEV) return;
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
  console.debug("[audio] mic test track", {
    settings: track.getSettings(),
    constraints: track.getConstraints(),
    capabilities,
  });
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg px-2 text-xs font-semibold transition-colors",
        active
          ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
          : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]",
      )}
    >
      {label}
    </button>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[color:var(--kub-text)]">{label}</span>
        <span className="tabular-nums text-[color:var(--kub-muted)]">{formatAudioPercent(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--kub-cyan)]"
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--kub-cyan)]"
      />
      <span className="min-w-0 truncate text-xs text-[color:var(--kub-text)]">{label}</span>
    </label>
  );
}
