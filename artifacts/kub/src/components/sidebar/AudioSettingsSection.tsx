"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import {
  DEFAULT_AUDIO_DEVICE_ID,
  applyLiveAudioGain,
  buildAudioTrackConstraints,
  formatAudioPercent,
  inferProcessingMode,
  settingsForProcessingMode,
  useAudioSettings,
  type AudioSettings,
  type AudioProcessingMode,
} from "@/hooks/useAudioSettings";
import { supportsAudioOutputSelection } from "@/lib/audioOutput";
import { cn } from "@/lib/utils";

type AudioContextCtor = typeof AudioContext;
type SinkAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface AudioDeviceOption {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export function AudioSettingsSection() {
  const { settings, updateSettings, resetSettings } = useAudioSettings();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [applying, setApplying] = useState(false);
  const [selfMonitoring, setSelfMonitoring] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);
  const monitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const monitorInputGainRef = useRef<GainNode | null>(null);
  const testInputGainRef = useRef<GainNode | null>(null);

  const outputSelectionSupported = supportsAudioOutputSelection();

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId || `${DEFAULT_AUDIO_DEVICE_ID}-${index}`,
          label: device.label || `Микрофон ${index + 1}`,
          kind: device.kind,
        }));
      const outputs = devices
        .filter((device) => device.kind === "audiooutput")
        .map((device, index) => ({
          deviceId: device.deviceId || `${DEFAULT_AUDIO_DEVICE_ID}-${index}`,
          label: device.label || `Устройство вывода ${index + 1}`,
          kind: device.kind,
        }));
      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (
        settings.selectedInputDeviceId !== DEFAULT_AUDIO_DEVICE_ID &&
        inputs.length > 0 &&
        !inputs.some((device) => device.deviceId === settings.selectedInputDeviceId)
      ) {
        updateSettings({ selectedInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
        setDeviceNotice("Выбранный микрофон недоступен. Используется системный.");
      }
      if (
        settings.selectedOutputDeviceId !== DEFAULT_AUDIO_DEVICE_ID &&
        outputs.length > 0 &&
        !outputs.some((device) => device.deviceId === settings.selectedOutputDeviceId)
      ) {
        updateSettings({ selectedOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
        setDeviceNotice("Выбранное устройство вывода недоступно. Используется системное.");
      }
    } catch {
      setDeviceNotice("Не удалось получить список аудиоустройств.");
    }
  }, [settings.selectedInputDeviceId, settings.selectedOutputDeviceId, updateSettings]);

  const stopSelfMonitoring = useCallback((updateState = true) => {
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
    monitorInputGainRef.current = null;
    const context = monitorContextRef.current;
    monitorContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    if (updateState) {
      setSelfMonitoring(false);
      setMonitorError(null);
    }
  }, []);

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
    testInputGainRef.current = null;
    if (updateState) {
      setTesting(false);
      setLevel(0);
      setProcessingNotice(null);
    }
  };

  useEffect(() => {
    applyLiveAudioGain(testInputGainRef.current?.gain ?? null, settings.micInputGain);
    applyLiveAudioGain(monitorInputGainRef.current?.gain ?? null, settings.micInputGain);
  }, [settings.micInputGain]);

  useEffect(() => {
    applyLiveAudioGain(monitorGainRef.current?.gain ?? null, settings.monitorGain);
  }, [settings.monitorGain]);

  useEffect(() => {
    void refreshDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshDevices]);

  useEffect(() => {
    return () => {
      stopMicTest(false);
      stopSelfMonitoring(false);
    };
  }, []);

  const enableSelfMonitoring = async (stream: MediaStream, audioSettings = settings): Promise<boolean> => {
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
      if (audioSettings.selectedOutputDeviceId !== DEFAULT_AUDIO_DEVICE_ID) {
        const sinkContext = context as SinkAudioContext;
        if (typeof sinkContext.setSinkId === "function") {
          await sinkContext.setSinkId(audioSettings.selectedOutputDeviceId);
        } else {
          setMonitorError("Выбор устройства вывода для прослушивания себя не поддерживается этим браузером. Используется системное устройство.");
        }
      }
      const source = context.createMediaStreamSource(stream);
      const inputGain = context.createGain();
      const gain = context.createGain();
      inputGain.gain.value = audioSettings.micInputGain;
      gain.gain.value = audioSettings.monitorGain;
      source.connect(inputGain);
      inputGain.connect(gain);
      gain.connect(context.destination);
      monitorContextRef.current = context;
      monitorSourceRef.current = source;
      monitorInputGainRef.current = inputGain;
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

  const setupMicTest = async (nextSettings: AudioSettings, restoreMonitoring = false) => {
    const AudioContextCtor = getAudioContextCtor();
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      setError("Проверка микрофона не поддерживается этим браузером.");
      return false;
    }

    setError(null);
    setMonitorError(null);
    try {
      const result = await requestMicStream(nextSettings);
      const stream = result.stream;
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      const source = context.createMediaStreamSource(stream);
      const data = new Uint8Array(analyser.fftSize);
      gain.gain.value = nextSettings.micInputGain;
      source.connect(gain);
      gain.connect(analyser);
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError("Микрофон недоступен.");
          stopMicTest();
        };
      });
      debugMicTrack(stream);
      void refreshDevices();
      streamRef.current = stream;
      contextRef.current = context;
      testInputGainRef.current = gain;
      setTesting(true);
      setProcessingNotice(result.deviceFallback
        ? "Выбранный микрофон недоступен. Используется системный."
        : result.fallback
        ? "Часть обработки микрофона не поддерживается этим браузером. Используется стандартный режим."
        : null);
      if (result.deviceFallback) updateSettings({ selectedInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const sample of data) {
          peak = Math.max(peak, Math.abs(sample - 128));
        }
        setLevel(Math.min(1, peak / 128));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();

      if (restoreMonitoring) {
        await enableSelfMonitoring(stream, nextSettings);
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
    await setupMicTest(settings);
  };

  const applySettingsLive = async (nextSettings: AudioSettings, options?: { forceReacquire?: boolean }) => {
    setProcessingNotice(null);
    if (!testing) return;
    const restoreMonitoring = selfMonitoring;
    setApplying(true);
    const track = streamRef.current?.getAudioTracks()[0] ?? null;
    if (!options?.forceReacquire && track && typeof track.applyConstraints === "function") {
      try {
        await track.applyConstraints(buildAudioTrackConstraints(nextSettings, false));
        setProcessingNotice(null);
        setApplying(false);
        return;
      } catch {
        setProcessingNotice("Не удалось применить настройки микрофона на лету. Перезапускаем проверку.");
      }
    }
    stopMicTest(false);
    await setupMicTest(nextSettings, restoreMonitoring);
    setApplying(false);
  };

  const changeProcessingMode = async (mode: Exclude<AudioProcessingMode, "custom">) => {
    if (settings.processingMode === mode) return;
    const nextSettings = updateSettings(settingsForProcessingMode(mode));
    await applySettingsLive(nextSettings);
  };

  const changeProcessingToggle = async (
    key: "noiseSuppression" | "echoCancellation" | "autoGainControl",
    checked: boolean,
  ) => {
    const nextPatch = {
      [key]: checked,
    } as Pick<AudioSettings, typeof key>;
    const merged = {
      ...settings,
      ...nextPatch,
    };
    const nextSettings = updateSettings({
      ...nextPatch,
      processingMode: inferProcessingMode(
        Boolean(merged.echoCancellation),
        Boolean(merged.noiseSuppression),
        Boolean(merged.autoGainControl),
      ),
    });
    await applySettingsLive(nextSettings);
  };

  const changeInputDevice = async (selectedInputDeviceId: string) => {
    setDeviceNotice(null);
    const nextSettings = updateSettings({ selectedInputDeviceId });
    await applySettingsLive(nextSettings, { forceReacquire: true });
  };

  const changeOutputDevice = async (selectedOutputDeviceId: string) => {
    setDeviceNotice(null);
    const nextSettings = updateSettings({ selectedOutputDeviceId });
    if (!outputSelectionSupported && selectedOutputDeviceId !== DEFAULT_AUDIO_DEVICE_ID) {
      setDeviceNotice("Выбор устройства вывода не поддерживается этим браузером. Используется системное устройство.");
    }
    if (selfMonitoring && testing && streamRef.current) {
      stopSelfMonitoring(false);
      await enableSelfMonitoring(streamRef.current, nextSettings);
    }
    return nextSettings;
  };

  const resetAudioSettings = async () => {
    const nextSettings = resetSettings();
    setDeviceNotice(null);
    await applySettingsLive(nextSettings, { forceReacquire: true });
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
    <div className="space-y-3">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <KubIcon name="microphone" size={16} className="mt-0.5 text-[color:var(--kub-cyan)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Звук и голосовые</div>
            <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Выберите микрофон и наушники, проверьте уровень и настройте обработку голоса. Эти настройки не меняют системную громкость.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] px-3 py-3">
          <SectionHeader
            title="Устройства"
            description="Список появится после разрешения доступа к микрофону. Если браузер не умеет выбирать вывод, звук пойдёт в системное устройство."
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <DeviceSelect
              label="Микрофон"
              value={settings.selectedInputDeviceId}
              defaultLabel="Системный микрофон"
              devices={inputDevices}
              disabled={applying}
              onChange={(deviceId) => void changeInputDevice(deviceId)}
            />
            <DeviceSelect
              label="Наушники / динамики"
              value={settings.selectedOutputDeviceId}
              defaultLabel="Системный вывод"
              devices={outputDevices}
              disabled={applying || !outputSelectionSupported}
              note={!outputSelectionSupported ? "Браузер не даёт выбрать вывод здесь. Используется системное устройство." : null}
              onChange={(deviceId) => void changeOutputDevice(deviceId)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] px-3 py-3">
          <SectionHeader
            title="Громкость"
            description="Микрофон влияет на проверку и голосовые записи. Громкость голосовых применяется только в LETSCUBE."
          />
          <div className="mt-3 grid gap-3">
            <SliderRow
              label="Микрофон"
              value={settings.micInputGain}
              min={0}
              max={2}
              step={0.05}
              onChange={(micInputGain) => updateSettings({ micInputGain })}
            />
            <SliderRow
              label="Голосовые сообщения"
              value={settings.voicePlaybackVolume}
              min={0}
              max={1}
              step={0.05}
              onChange={(voicePlaybackVolume) => updateSettings({ voicePlaybackVolume })}
            />
          </div>
        </div>

        <div className="rounded-xl px-3 py-3 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]">
          <SectionHeader
            title="Проверка и обработка"
            description="Запустите проверку, чтобы увидеть уровень микрофона и сразу услышать изменения."
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
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
              <span className="min-w-0 text-xs font-semibold text-[color:var(--kub-text)]">Как звучит голос</span>
              <span className="shrink-0 text-[10px] text-[color:var(--kub-muted)]">
                {processingModeLabel(settings.processingMode)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
              <ModeButton
                active={settings.processingMode === "clean"}
                label="Чистый голос"
                onClick={() => void changeProcessingMode("clean")}
              />
              <ModeButton
                active={settings.processingMode === "raw"}
                label="Без обработки"
                onClick={() => void changeProcessingMode("raw")}
              />
              <ModeButton
                active={settings.processingMode === "custom"}
                label="Вручную"
                disabled
                onClick={() => undefined}
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ToggleRow
                label="Убрать шум"
                description="Снижает шум вентиляторов и комнаты."
                checked={settings.noiseSuppression}
                disabled={applying}
                onChange={(noiseSuppression) => void changeProcessingToggle("noiseSuppression", noiseSuppression)}
              />
              <ToggleRow
                label="Убрать эхо"
                description="Полезно без наушников."
                checked={settings.echoCancellation}
                disabled={applying}
                onChange={(echoCancellation) => void changeProcessingToggle("echoCancellation", echoCancellation)}
              />
              <ToggleRow
                label="Выравнивать голос"
                description="Автоматически держит уровень."
                checked={settings.autoGainControl}
                disabled={applying}
                onChange={(autoGainControl) => void changeProcessingToggle("autoGainControl", autoGainControl)}
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
              <span className="block text-xs font-semibold text-[color:var(--kub-text)]">Слышать свой микрофон</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {selfMonitoring
                  ? "Идёт только в выбранные наушники/динамики. Используйте наушники, чтобы избежать эха."
                  : "Доступно во время проверки микрофона."}
              </span>
            </span>
          </label>

          {selfMonitoring && (
            <SliderRow
              label="Громкость прослушивания"
              value={settings.monitorGain}
              min={0}
              max={1}
              step={0.05}
              onChange={(monitorGain) => updateSettings({ monitorGain })}
            />
          )}

          {applying && (
            <div className="mt-2 text-xs text-[color:var(--kub-muted)]">
              Применяем настройки…
            </div>
          )}
          {deviceNotice && (
            <div className="mt-2 text-xs text-[color:var(--kub-muted)]">
              {deviceNotice}
            </div>
          )}
          {processingNotice && (
            <div className="mt-2 text-xs text-[color:var(--kub-muted)]">
              {processingNotice}
            </div>
          )}
          {error && (
            <div className="mt-2 text-xs text-[color:var(--kub-danger-text)]">
              {error}
            </div>
          )}
          {monitorError && (
            <div className="mt-2 text-xs text-[color:var(--kub-danger-text)]">
              {monitorError}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void resetAudioSettings()}
          // D-047: 162x16 before this, the smallest target on the screen.
          className="kub-button inline-flex items-center text-xs font-semibold text-[color:var(--kub-accent-text)] hover:underline"
        >
          Сбросить настройки звука
        </button>
      </div>
    </div>
  );
}

async function requestMicStream(settings: AudioSettings): Promise<{ stream: MediaStream; fallback: boolean; deviceFallback: boolean }> {
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: buildAudioTrackConstraints(settings) }),
      fallback: false,
      deviceFallback: false,
    };
  } catch (err) {
    if (isPermissionError(err)) throw err;
  }

  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: buildAudioTrackConstraints(settings, false) }),
      fallback: true,
      deviceFallback: false,
    };
  } catch (err) {
    if (isPermissionError(err)) throw err;
  }

  if (settings.selectedInputDeviceId !== DEFAULT_AUDIO_DEVICE_ID) {
    const fallbackSettings = { ...settings, selectedInputDeviceId: DEFAULT_AUDIO_DEVICE_ID };
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: buildAudioTrackConstraints(fallbackSettings, false) }),
      fallback: true,
      deviceFallback: true,
    };
  }

  return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), fallback: true, deviceFallback: false };
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

function isPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "NotAllowedError" ||
    err.name === "PermissionDeniedError" ||
    err.name === "SecurityError"
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
  disabled = false,
  onClick,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // D-047: 288x36 before this.
        // `h-9` rather than `min-h-9`: index.css now lives in @layer
        // components, so a `min-h-*` utility outranks `.kub-button`'s own
        // min-height and the touch minimum never reached this control.
        // Measured: with `min-h-9` the coarse box stayed 36px.
        "kub-button h-9 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default",
        active
          ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
          : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
      )}
    >
      {label}
    </button>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
        {description}
      </p>
    </div>
  );
}

function DeviceSelect({
  label,
  value,
  defaultLabel,
  devices,
  disabled,
  note,
  onChange,
}: {
  label: string;
  value: string;
  defaultLabel: string;
  devices: AudioDeviceOption[];
  disabled?: boolean;
  note?: string | null;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="block min-w-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] px-3 py-2">
      <span className="mb-1 block text-xs font-semibold text-[color:var(--kub-text)]">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 text-xs text-[color:var(--kub-text)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value={DEFAULT_AUDIO_DEVICE_ID}>{defaultLabel}</option>
        {devices
          .filter((device) => device.deviceId !== DEFAULT_AUDIO_DEVICE_ID)
          .map((device) => (
            <option key={`${device.kind}:${device.deviceId}`} value={device.deviceId}>
              {device.label}
            </option>
          ))}
      </select>
      {note && <span className="mt-1 block text-[11px] leading-relaxed text-[color:var(--kub-muted)]">{note}</span>}
    </label>
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
        // D-047: 314x16 before this. A slider is a control a finger aims at,
        // and `kub-field` is what carries the touch minimum for a box whose
        // whole area is the target.
        className="kub-field w-full accent-[var(--kub-cyan)]"
      />
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-start gap-2 rounded-lg px-3 py-2 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--kub-cyan)] disabled:opacity-60"
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[color:var(--kub-text)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

function processingModeLabel(mode: AudioProcessingMode): string {
  if (mode === "clean") return "Чистый голос";
  if (mode === "raw") return "Без обработки";
  return "Настроено вручную";
}
