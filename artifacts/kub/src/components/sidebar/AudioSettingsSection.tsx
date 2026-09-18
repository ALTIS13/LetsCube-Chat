"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { KubButton, KubIcon, KubSwitch } from "@/components/kub";
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
import {
  AUDIO_APPLYING_NOTE,
  AUDIO_DEFAULT_INPUT_LABEL,
  AUDIO_DEFAULT_OUTPUT_LABEL,
  AUDIO_DEVICE_NAMES_NOTE,
  AUDIO_GAIN_LABEL,
  AUDIO_GROUP_DEVICES,
  AUDIO_GROUP_LEVEL,
  AUDIO_GROUP_PROCESSING,
  AUDIO_INPUT_LABEL,
  AUDIO_INTRO_NOTE,
  AUDIO_LEVEL_METER_LABEL,
  AUDIO_MODE_GROUP_LABEL,
  AUDIO_MODE_SEGMENTS,
  AUDIO_OUTPUT_LABEL,
  AUDIO_OUTPUT_UNSUPPORTED_NOTE,
  AUDIO_PROCESSING_HINT,
  AUDIO_RESET_LABEL,
  AUDIO_SELF_MONITOR_LABEL,
  audioDeviceOptions,
  audioLevelPercent,
  deviceFallbackNote,
  micTestLabel,
  selfMonitorHint,
  type AudioDeviceChoice,
  type AudioModeSegment,
} from "@/lib/audioSettingsSurface";
import { DISABLED_SINK, FOCUS_RING, PRESS_SINK } from "@/lib/controlSurface";
import {
  MIC_ACTIVATION_GROUP_CAPTION,
  MIC_ACTIVATION_GROUP_LABEL,
  MIC_ACTIVATION_SCOPE_NOTE,
  MIC_ACTIVATION_SEGMENTS,
  MIC_GATE_LEVEL_LABEL,
  MIC_GATE_THRESHOLD_LABEL,
  MIC_TALK_KEY_LISTENING,
  MIC_TALK_KEY_ROW_LABEL,
  MIC_TALK_TOUCH_NOTE,
  micActivationHint,
  micGateOpenAt,
  micGateThresholdHint,
  micLevelPosition,
  micTalkKeyLabel,
  micTalkKeyNote,
  micTalkKeyRefusal,
  type MicActivation,
} from "@/lib/micGate";
import { coarsePointer } from "@/lib/pointer";
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
  // A phone's own keys and mixer set how loud it plays, so it gets no playback
  // sliders here (D-118); the microphone's stays, as nothing else sets that.
  const deviceSetsVolume = coarsePointer();
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
  // The key recorder's two states. `listening` is a control waiting for a
  // press; `keyRefusal` is why the last press was not taken, because a control
  // that swallows a key and changes nothing reads as broken.
  const [listeningForKey, setListeningForKey] = useState(false);
  const [keyRefusal, setKeyRefusal] = useState<string | null>(null);
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
        setDeviceNotice(deviceFallbackNote("input"));
      }
      if (
        settings.selectedOutputDeviceId !== DEFAULT_AUDIO_DEVICE_ID &&
        outputs.length > 0 &&
        !outputs.some((device) => device.deviceId === settings.selectedOutputDeviceId)
      ) {
        updateSettings({ selectedOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
        setDeviceNotice(deviceFallbackNote("output"));
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

  /**
   * The key recorder, while it is listening.
   *
   * Capture phase, so the press is read before whatever else the application
   * binds keys to — `MainLayout` runs its own capture listener first, which is
   * why `Escape` both closes the conversation behind this panel and lands here
   * as a refusal. That is the honest outcome of pressing a key the interface
   * already owns, and `micTalkKeyRefusal` says which ones those are.
   *
   * The whole rule is in `lib/micGate.ts`; this listener decides nothing.
   */
  useEffect(() => {
    if (!listeningForKey || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      setListeningForKey(false);
      const refusal = micTalkKeyRefusal(event.code);
      if (refusal) {
        setKeyRefusal(refusal);
        return;
      }
      setKeyRefusal(null);
      updateSettings({ micTalkKey: event.code });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listeningForKey, updateSettings]);

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
        ? deviceFallbackNote("input")
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
    <div className="space-y-4" data-testid="audio-settings">
      {/*
        The row this panel opens from already says «Звук», carries the
        microphone icon and prints the current value, so the icon, the title
        «Звук и голосовые» and the two sentences naming the controls below were
        the panel introducing itself a second time. The one fact left is the one
        a person cannot read off any control here.
      */}
      <p className="px-1 text-xs leading-snug text-[color:var(--kub-muted)]">{AUDIO_INTRO_NOTE}</p>

      <AudioGroup caption={AUDIO_GROUP_DEVICES}>
        <DeviceRow
          label={AUDIO_INPUT_LABEL}
          value={settings.selectedInputDeviceId}
          options={audioDeviceOptions(DEFAULT_AUDIO_DEVICE_ID, AUDIO_DEFAULT_INPUT_LABEL, inputDevices)}
          disabled={applying}
          onChange={(deviceId) => void changeInputDevice(deviceId)}
        />
        <DeviceRow
          label={AUDIO_OUTPUT_LABEL}
          value={settings.selectedOutputDeviceId}
          options={audioDeviceOptions(DEFAULT_AUDIO_DEVICE_ID, AUDIO_DEFAULT_OUTPUT_LABEL, outputDevices)}
          disabled={applying || !outputSelectionSupported}
          onChange={(deviceId) => void changeOutputDevice(deviceId)}
        />
        <AudioNote>{AUDIO_DEVICE_NAMES_NOTE}</AudioNote>
        {!outputSelectionSupported && <AudioNote>{AUDIO_OUTPUT_UNSUPPORTED_NOTE}</AudioNote>}
        {deviceNotice && <AudioNote>{deviceNotice}</AudioNote>}
      </AudioGroup>

      <AudioGroup caption={AUDIO_GROUP_LEVEL}>
        <SliderRow
          label={AUDIO_GAIN_LABEL}
          value={settings.micInputGain}
          min={0}
          max={2}
          step={0.05}
          onChange={(micInputGain) => updateSettings({ micInputGain })}
        />
        <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 min-h-11">
          <KubButton
            size="sm"
            variant={testing ? "secondary" : "primary"}
            onClick={startMicTest}
            data-testid="audio-mic-test"
          >
            {micTestLabel(testing)}
          </KubButton>
          <div
            role="meter"
            aria-label={AUDIO_LEVEL_METER_LABEL}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={audioLevelPercent(level)}
            data-testid="audio-level-meter"
            className="h-2 min-w-0 overflow-hidden rounded-full bg-[var(--kub-surface-3)]"
          >
            <div
              className="h-full rounded-full bg-[var(--kub-cyan)] transition-[width]"
              style={{ width: `${audioLevelPercent(level)}%` }}
            />
          </div>
        </div>
        <SwitchRow
          label={AUDIO_SELF_MONITOR_LABEL}
          hint={selfMonitorHint(selfMonitoring, testing)}
          checked={selfMonitoring}
          disabled={!testing}
          testId="audio-self-monitor"
          onChange={() => void toggleSelfMonitoring()}
        />
        {/*
          The phone branch of D-118, and `send-quality-and-phone-volume.test.mts`
          reads this exact JSX to prove it is still here — which is why the label
          is written out rather than taken from the words module.
        */}
        {selfMonitoring && !deviceSetsVolume && (
          <SliderRow
            label="Громкость прослушивания"
            value={settings.monitorGain}
            min={0}
            max={1}
            step={0.05}
            onChange={(monitorGain) => updateSettings({ monitorGain })}
          />
        )}
        {applying && <AudioNote>{AUDIO_APPLYING_NOTE}</AudioNote>}
        {error && <AudioNote tone="danger">{error}</AudioNote>}
        {monitorError && <AudioNote tone="danger">{monitorError}</AudioNote>}
      </AudioGroup>

      {/*
        How the microphone decides to be open, which is the choice Discord's
        settings screen calls «Voice Activity» versus «Push to Talk».

        It belongs on this screen and not on one of its own:
        `docs/proposals/2026-09-13-voice-channels.md:1038` says in as many words
        that the call's settings *are* this section — it already holds both
        device pickers, the processing modes and the monitor.

        Directly under «Уровень» on purpose. The threshold is calibrated against
        a live level, and the live level is the meter in the group above: a
        second capture opened by this group would be a settings screen turning
        the microphone on by itself.
      */}
      <AudioGroup caption={MIC_ACTIVATION_GROUP_CAPTION}>
        <div className="min-w-0 px-3 py-2">
          <div
            role="radiogroup"
            aria-label={MIC_ACTIVATION_GROUP_LABEL}
            data-testid="mic-activation-picker"
            data-segment-track="true"
            className={SEGMENT_TRACK}
          >
            {MIC_ACTIVATION_SEGMENTS.map((segment) => (
              <ActivationSegment
                key={segment.mode}
                mode={segment.mode}
                label={segment.label}
                active={settings.micActivation === segment.mode}
                onSelect={() => updateSettings({ micActivation: segment.mode })}
              />
            ))}
          </div>
        </div>
        <AudioNote>{micActivationHint(settings.micActivation)}</AudioNote>

        {settings.micActivation === "voice" && (
          <>
            <SliderRow
              label={MIC_GATE_THRESHOLD_LABEL}
              value={settings.micGateThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(micGateThreshold) => updateSettings({ micGateThreshold })}
              below={<GateLevel level={testing ? level : 0} threshold={settings.micGateThreshold} />}
            />
            <AudioNote>{micGateThresholdHint(testing)}</AudioNote>
          </>
        )}

        {settings.micActivation === "ptt" && (
          <>
            <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 min-h-11">
              <span className="min-w-0 text-sm text-[color:var(--kub-text)]">{MIC_TALK_KEY_ROW_LABEL}</span>
              <button
                type="button"
                onClick={() => {
                  setKeyRefusal(null);
                  setListeningForKey((waiting) => !waiting);
                }}
                aria-live="polite"
                data-testid="mic-talk-key"
                data-listening={listeningForKey ? "true" : "false"}
                className={cn(
                  "kub-button h-9 shrink-0 rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-text)] kub-raise",
                  FOCUS_RING,
                  PRESS_SINK,
                )}
              >
                {listeningForKey ? MIC_TALK_KEY_LISTENING : micTalkKeyLabel(settings.micTalkKey)}
              </button>
            </div>
            {keyRefusal ? (
              <AudioNote tone="danger">{keyRefusal}</AudioNote>
            ) : (
              <AudioNote>{micTalkKeyNote(settings.micTalkKey)}</AudioNote>
            )}
            <AudioNote>{MIC_TALK_TOUCH_NOTE}</AudioNote>
          </>
        )}

        <AudioNote>{MIC_ACTIVATION_SCOPE_NOTE}</AudioNote>
      </AudioGroup>

      <AudioGroup caption={AUDIO_GROUP_PROCESSING}>
        <div className="min-w-0 px-3 py-2">
          {/*
            A track with flush segments, which is how this product draws a
            one-of-N choice: the theme radiogroup two rows above this panel and
            «Лимит кэша» in `StorageSection`, a sibling inside another
            disclosure on the same screen, are both `rounded-lg border
            the page ground at .5 of a rem of padding. That token belongs here
            and only here —
            on the well a segment is cut into, never on a box holding rows.
          */}
          <div
            role="radiogroup"
            aria-label={AUDIO_MODE_GROUP_LABEL}
            data-testid="audio-mode-picker"
            data-segment-track="true"
            className={SEGMENT_TRACK}
          >
            {AUDIO_MODE_SEGMENTS.map((segment) => (
              <ModeSegment
                key={segment.mode}
                segment={segment}
                active={settings.processingMode === segment.mode}
                busy={applying}
                onSelect={
                  segment.selectable
                    ? () => void changeProcessingMode(segment.mode)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <SwitchRow
          label="Убрать шум"
          hint="Снижает шум вентиляторов и комнаты."
          checked={settings.noiseSuppression}
          disabled={applying}
          testId="audio-noise-suppression"
          onChange={(noiseSuppression) => void changeProcessingToggle("noiseSuppression", noiseSuppression)}
        />
        <SwitchRow
          label="Убрать эхо"
          hint="Полезно без наушников."
          checked={settings.echoCancellation}
          disabled={applying}
          testId="audio-echo-cancellation"
          onChange={(echoCancellation) => void changeProcessingToggle("echoCancellation", echoCancellation)}
        />
        <SwitchRow
          label="Выравнивать голос"
          hint="Автоматически держит уровень."
          checked={settings.autoGainControl}
          disabled={applying}
          testId="audio-auto-gain"
          onChange={(autoGainControl) => void changeProcessingToggle("autoGainControl", autoGainControl)}
        />
        <AudioNote>{AUDIO_PROCESSING_HINT}</AudioNote>
        {processingNotice && <AudioNote>{processingNotice}</AudioNote>}
      </AudioGroup>

      <div className="overflow-hidden rounded-xl kub-raise">
        <button
          type="button"
          data-testid="audio-reset"
          onClick={() => void resetAudioSettings()}
          className={cn(
            // D-047 said this was 162x16, the smallest target on the screen,
            // and answered it with `kub-button`. It is a row now, like every
            // other action on this screen, so the 44px is `min-h-11` and holds
            // on a pointer as well as on a finger.
            "kub-button grid w-full min-w-0 grid-cols-[1.125rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 min-h-11 text-left kub-interactive transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] kub-raise-hover",
            FOCUS_RING,
            PRESS_SINK,
          )}
        >
          <KubIcon name="rotate" size={16} className="text-[color:var(--kub-muted)]" />
          <span className="min-w-0 text-sm text-[color:var(--kub-text)]">{AUDIO_RESET_LABEL}</span>
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

/**
 * A caption and a list of rows, which is the one object the settings screen is
 * made of — `SettingsGroup` draws the four groups outside this panel exactly
 * like this, and nothing on the screen is drawn any other way.
 *
 * No perimeter: the step of material is what separates it from the panel it
 * sits on (rule 11 of the material contract). The three boxes that stood here
 * before were filled from the page-ground token and outlined — the page's own
 * ground,
 * painted inside a panel, which is why the section read as a hole rather than
 * as part of the screen.
 */
function AudioGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <section data-audio-group={caption}>
      <h4 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        {caption}
      </h4>
      <div className="overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise">
        {children}
      </div>
    </section>
  );
}

/** A sentence that belongs to the group above it, drawn as one of its rows. */
function AudioNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-xs leading-snug",
        tone === "danger" ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]",
      )}
    >
      {children}
    </p>
  );
}

/**
 * A device choice: the caption, then the select under it at the row's full
 * width — the shape `ChannelManageModal` gives every select it draws.
 *
 * Two things were measured before settling on it, both at 1440, where the
 * settings screen is a **296px** row inside a ~350px column:
 *
 *  - The two selects used to sit side by side under a two-column grid keyed on
 *    the sm breakpoint. That
 *    breakpoint answers a question about the window when the question is about
 *    the column, so at 1440 each select was ~130px and both device names came
 *    out as «Системный м…».
 *  - One select beside its caption does not fit either: the caption column and
 *    the gap take 116, leaving 156, and «Системный микрофон» needs 133 of text
 *    plus 16 of padding and ~20 for the browser's own arrow. It clipped into
 *    the arrow. A caption sized to its own text leaves 11px of slack with Inter
 *    loaded and none without it.
 *
 * Under the caption the select gets 272px at 1440 and more everywhere else, so
 * the layout is the same at every width and nothing depends on a font being
 * present.
 */
function DeviceRow({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly AudioDeviceChoice[];
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="block min-w-0 px-3 py-2">
      <span className="mb-1 block min-w-0 text-sm text-[color:var(--kub-text)]">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "kub-field h-9 w-full min-w-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 text-xs text-[color:var(--kub-text)] outline-none",
          FOCUS_RING,
          DISABLED_SINK,
        )}
      >
        {options.map((option) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The well a one-of-N choice is cut into, written once and used by both
 * pickers.
 *
 * One constant rather than two identical class lists, and that is load-bearing
 * rather than tidy: `tests/unit/audio-settings-surface.test.mts` counts the
 * strings in this file that paint the page ground and the strings that draw a
 * perimeter, and it names the two that are allowed — this track, and the device
 * field. A second copy of the same line would read as a third box even though
 * the pixels are the same object drawn twice.
 */
const SEGMENT_TRACK =
  "flex w-full min-w-0 gap-0.5 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-0.5";

/**
 * A segment's own class list, shared by the two pickers for the same reason the
 * track is. The `min-h-11` is measured — see the note in
 * `tests/unit/touch-target-system.test.mjs`, which pins this exact string.
 */
function segmentClasses(active: boolean, selectable: boolean): string {
  return cn(
    // `min-h-11`, not `h-9`. Measured at 1440, where the settings column is
    // 296px wide: a segment gets 87px and «Без обработки» needs 98.9, so the
    // label wraps — and a fixed `h-9` clipped the second line off the bottom
    // of the pill. A minimum lets it grow instead. 11 is 44px, exactly what
    // `.kub-button` asks of a coarse pointer, so the `min-h-*` that outranks
    // that class here agrees with it rather than defeating it (which is the
    // trap `touch-target-system.test.mjs` guards, and why it allows >= 11).
    "kub-button min-h-11 min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px] font-semibold leading-tight transition-colors",
    FOCUS_RING,
    active
      ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
      : selectable
      ? "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
      : "bg-[var(--kub-inset)] bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] text-[color:var(--kub-muted)] cursor-not-allowed",
    selectable && PRESS_SINK,
    selectable && !active && DISABLED_SINK,
  );
}

/**
 * One segment of the microphone-mode picker.
 *
 * A sibling of `ModeSegment` rather than the same component with a prop,
 * because the two differ in exactly one thing that matters and it is not the
 * pixels: the attribute. `tests/e2e/audio-settings-vocabulary.spec.ts` reads
 * `[data-audio-mode]` **globally** to prove the processing picker is one
 * unwrapped row of equal segments, so a second picker answering to the same
 * attribute would silently join that measurement and the geometry assertion
 * would start describing six segments across two rows.
 *
 * Every one of these three can be chosen — there is no state-rather-than-choice
 * segment here, which is the other thing `ModeSegment` carries.
 */
function ActivationSegment({
  mode,
  label,
  active,
  onSelect,
}: {
  mode: MicActivation;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-mic-activation={mode}
      onClick={onSelect}
      className={segmentClasses(active, true)}
    >
      {label}
    </button>
  );
}

/**
 * The live level, drawn under the threshold on the **same axis**.
 *
 * `micLevelPosition` is the inverse of the mapping the slider's value goes
 * through, so a bar at this width and the handle above it mean the same
 * loudness — which is the whole reason the threshold is stored as a position
 * rather than as a number of decibels. The two line up to within half a thumb
 * (6px of a 272px track at 1440), because a range input insets its travel by
 * that much and a plain box does not; the reading that matters is the colour
 * rather than the alignment.
 *
 * Accent while the gate would be open and muted while it would not: that is
 * the answer a person is looking for while dragging, and it is `micGateOpenAt`
 * making it rather than this component.
 */
function GateLevel({ level, threshold }: { level: number; threshold: number }) {
  const open = level > 0 && level >= micGateOpenAt(threshold);
  const width = Math.round(micLevelPosition(level) * 100);
  return (
    <div
      role="meter"
      aria-label={MIC_GATE_LEVEL_LABEL}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      data-testid="mic-gate-level"
      data-open={open ? "true" : "false"}
      className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--kub-range-track)]"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          open ? "bg-[var(--kub-cyan)]" : "bg-[var(--kub-muted)]",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * One segment of the processing picker.
 *
 * `custom` is the state the three switches below put the settings into, not a
 * choice — so it never takes a press, and it is drawn filled while it is the
 * state and sunk while it is not. The sink is written out rather than taken
 * from `DISABLED_SINK` precisely because it must not apply when the segment is
 * both disabled and current: a `disabled:` variant outranks the plain fill
 * beside it, and the accent would never reach a pixel.
 */
function ModeSegment({
  segment,
  active,
  busy,
  onSelect,
}: {
  segment: AudioModeSegment;
  active: boolean;
  busy: boolean;
  onSelect?: () => void;
}) {
  const selectable = Boolean(onSelect);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={!selectable || busy}
      data-audio-mode={segment.mode}
      onClick={onSelect}
      className={segmentClasses(active, selectable)}
    >
      {segment.label}
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
  below,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Drawn under the track, on the same axis. Only the threshold uses it. */
  below?: ReactNode;
}) {
  return (
    <label className="block min-w-0 px-3 py-2">
      <span className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 text-[color:var(--kub-text)]">{label}</span>
        <span className="shrink-0 tabular-nums text-xs text-[color:var(--kub-muted)]">{formatAudioPercent(value)}</span>
      </span>
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
        //
        // `kub-range` since 2026-09-18, and it is the same defect the rail's
        // per-person volume met: `accent-color` paints the filled half and the
        // thumb and leaves the rest of the track to the browser, which in the
        // dark theme came back `rgb(59, 59, 59)` — a pure neutral grey, no hue
        // — on a panel ground of `rgb(17, 42, 71)`. Both halves are ours now,
        // in tokens, and the fill ratio arrives as a custom property because a
        // gradient stop cannot be a Tailwind class.
        className="kub-field kub-range w-full"
        style={{ "--kub-range-filled": `${rangeFilled(value, min, max)}%` } as CSSProperties}
      />
      {below}
    </label>
  );
}

/** Where the fill stops, as a percentage of the track. */
function rangeFilled(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.round(((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100);
}

/**
 * An on/off row.
 *
 * `KubSwitch` rather than a bare checkbox input: the product says
 * on and off with a switch everywhere else, and the two checkboxes that stood
 * here rendered as large accent squares that matched nothing on the screen.
 * The switch is a `<button role="switch">`, which a `<label>` cannot be
 * associated with, so the words reach it through `aria-label` and
 * `aria-describedby` instead.
 */
function SwitchRow({
  label,
  hint,
  checked,
  disabled = false,
  testId,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  testId?: string;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 min-h-11">
      <span className="min-w-0">
        <span className="block text-sm text-[color:var(--kub-text)]">{label}</span>
        {hint && (
          <span id={hintId} className="mt-0.5 block text-xs leading-snug text-[color:var(--kub-muted)]">
            {hint}
          </span>
        )}
      </span>
      <KubSwitch
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onCheckedChange={onChange}
      />
    </div>
  );
}
