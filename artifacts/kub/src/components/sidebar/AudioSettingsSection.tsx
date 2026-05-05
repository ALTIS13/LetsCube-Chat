"use client";

import { useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import {
  formatAudioPercent,
  useAudioSettings,
  type AudioSettings,
} from "@/hooks/useAudioSettings";

function audioConstraints(settings: AudioSettings): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      channelCount: 1,
    },
  };
}

export function AudioSettingsSection() {
  const { settings, updateSettings, resetSettings } = useAudioSettings();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  const stopMicTest = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setTesting(false);
    setLevel(0);
  };

  useEffect(() => stopMicTest, []);

  const startMicTest = async () => {
    if (testing) {
      stopMicTest();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setError("Проверка микрофона не поддерживается этим браузером.");
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints(settings));
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      const source = context.createMediaStreamSource(stream);
      const data = new Uint8Array(analyser.fftSize);
      gain.gain.value = settings.micInputGain;
      source.connect(gain);
      gain.connect(analyser);
      streamRef.current = stream;
      contextRef.current = context;
      setTesting(true);

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
    } catch {
      setError("Не удалось получить доступ к микрофону.");
      stopMicTest();
    }
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
          max={2}
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
          {error && (
            <div className="mt-2 text-xs text-[color:var(--kub-danger)]">
              {error}
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
