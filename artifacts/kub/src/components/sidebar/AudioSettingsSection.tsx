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
import { callSoundReadiness, primeCallSounds } from "@/lib/callSoundPlayer";
import {
  CALL_SOUND_HINT,
  CALL_SOUND_LABEL,
  NOTIFICATION_SOUND_HINT,
  NOTIFICATION_SOUND_LABEL,
  SOUND_BLOCKED_NOTE,
  SOUND_GROUP_CAPTION,
  SOUND_SCOPE_NOTE,
} from "@/lib/callSounds";
import {
  AUDIO_ADVANCED_GROUP,
  AUDIO_APPLYING_NOTE,
  audioAdvancedLabel,
  AUDIO_DEFAULT_INPUT_LABEL,
  AUDIO_DEFAULT_OUTPUT_LABEL,
  AUDIO_DEVICE_NAMES_NOTE,
  AUDIO_GAIN_HINT,
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
  AUDIO_PROCESSING_SWITCHES,
  AUDIO_RESET_LABEL,
  AUDIO_SELF_MONITOR_LABEL,
  audioDeviceOptions,
  deviceFallbackNote,
  micTestLabel,
  processingRefusalNote,
  selfMonitorHint,
  type AudioDeviceChoice,
  type AudioModeSegment,
  type AudioProcessingKey,
} from "@/lib/audioSettingsSurface";
import { DISABLED_SINK, FOCUS_RING, PRESS_SINK } from "@/lib/controlSurface";
import {
  MIC_ACTIVATION_GROUP_CAPTION,
  MIC_ACTIVATION_GROUP_LABEL,
  MIC_ACTIVATION_SCOPE_NOTE,
  MIC_ACTIVATION_SEGMENTS,
  MIC_AUTO_THRESHOLD_BUSY_LABEL,
  MIC_AUTO_THRESHOLD_LABEL,
  MIC_AUTO_THRESHOLD_MS,
  MIC_GATE_LEVEL_LABEL,
  MIC_GATE_THRESHOLD_ELSEWHERE_NOTE,
  MIC_GATE_THRESHOLD_LABEL,
  MIC_TALK_KEY_LISTENING,
  MIC_TALK_KEY_ROW_LABEL,
  MIC_TALK_TOUCH_NOTE,
  autoMicThreshold,
  micActivationHint,
  micAutoThresholdNote,
  micAutoThresholdRefusal,
  micGateOpenAt,
  micLevelPosition,
  micGateThresholdHint,
  micMeterPercent,
  micTalkKeyLabel,
  micTalkKeyNote,
  micTalkKeyRefusal,
  type MicActivation,
  type MicAutoThresholdState,
} from "@/lib/micGate";
import { openMicLevelSource, type MicLevelSource } from "@/lib/micLevel";
import { MIC_NO_INPUT_HINT, MIC_NO_INPUT_LABEL } from "@/lib/micNoInput";
import { prefersReducedMotion } from "@/lib/motion";
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
  // What the player last found out about whether anything can be heard. Read
  // rather than assumed, and read again after each press that could change it.
  const [blocked, setBlocked] = useState(() => callSoundReadiness());
  // What the browser actually did with the three processing constraints, which
  // is not always what the three switches asked for. Read off the live track
  // rather than assumed — see `processingRefusalNote`.
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  // The threshold measurement: which of its four states it is in, and the
  // readings it has collected so far. The readings are a ref rather than state
  // because they arrive twenty times a second and nothing draws them.
  const [autoThreshold, setAutoThreshold] = useState<MicAutoThresholdState>("idle");
  // The advanced fold: component state, deliberately not a stored setting. The
  // reasoning is at the group itself, beside the list of what went behind it.
  const [advanced, setAdvanced] = useState(false);
  const advancedButtonId = useId();
  const advancedPanelId = useId();
  const autoRunRef = useRef<{ levels: number[]; until: number } | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  const streamRef = useRef<MediaStream | null>(null);
  const levelSourceRef = useRef<MicLevelSource | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);
  const monitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const monitorInputGainRef = useRef<GainNode | null>(null);

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
    // The level source owns its own `AudioContext` and its own clone of the
    // track, and closing it is what stops the audio thread. There is no second
    // analyser here any more: the meter on this screen and the gate in a call
    // are one measurement, taken by `lib/micLevel.ts`, so a threshold placed
    // against this bar is placed against the number the call will compare.
    levelSourceRef.current?.close();
    levelSourceRef.current = null;
    if (autoTimerRef.current !== null) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    autoRunRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    if (updateState) {
      setTesting(false);
      setLevel(0);
      setProcessingNotice(null);
      setAppliedNotice(null);
      setAutoThreshold("idle");
    }
  };

  useEffect(() => {
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

  /**
   * End the measurement and place the threshold, on whatever it collected.
   *
   * `autoMicThreshold` answering `null` is not «use the default»: it is «that
   * was not a measurement», and the control says so rather than writing a
   * number nobody's room produced.
   */
  const finishAutoThreshold = useCallback(() => {
    if (autoTimerRef.current !== null) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    const run = autoRunRef.current;
    autoRunRef.current = null;
    if (!run) return;
    const answer = autoMicThreshold(run.levels);
    if (answer === null) {
      // Which refusal it was, asked of the same module that refused, so the
      // sentence and the decision cannot disagree. D-280: a run that arrived
      // complete and contained nothing is not «не удалось измерить».
      setAutoThreshold(micAutoThresholdRefusal(run.levels) === "silent" ? "silent" : "failed");
      return;
    }
    updateSettings({ micGateThreshold: answer });
    setAutoThreshold("done");
  }, [updateSettings]);

  /**
   * One reading, from the one sampler, going to the two things that want it:
   * the bar, and the measurement while one is running.
   */
  const receiveLevel = useCallback(
    (value: number) => {
      setLevel(value);
      const run = autoRunRef.current;
      if (!run) return;
      run.levels.push(value);
      if (Date.now() >= run.until) finishAutoThreshold();
    },
    [finishAutoThreshold],
  );

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
      const track = stream.getAudioTracks()[0];
      stream.getAudioTracks().forEach((each) => {
        each.onended = () => {
          setError("Микрофон недоступен.");
          stopMicTest();
        };
      });
      debugMicTrack(stream);
      void refreshDevices();
      streamRef.current = stream;

      // The one place the level is read, and it is the module a call reads it
      // with. A second analyser here would be a second answer to «how loud is
      // this microphone» — on a different scale, at a different rate — and the
      // threshold below is set by comparing the two.
      const source = track ? openMicLevelSource(track, receiveLevel) : null;
      if (!source) {
        stopMicTest(false);
        setError("Проверка микрофона не поддерживается этим браузером.");
        return false;
      }
      levelSourceRef.current = source;

      setTesting(true);
      setProcessingNotice(result.deviceFallback
        ? deviceFallbackNote("input")
        : result.fallback
        ? "Часть обработки микрофона не поддерживается этим браузером. Используется стандартный режим."
        : null);
      setAppliedNotice(readAppliedProcessing(track, nextSettings));
      if (result.deviceFallback) updateSettings({ selectedInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });

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

  /**
   * Measure the room and put the threshold above it.
   *
   * It starts the capture itself when there is none, which is the whole point
   * of the control: the threshold used to be calibrated by pressing a button in
   * a different group and then scrolling back, and a person who had not found
   * that button saw a bar that never moved.
   */
  const startAutoThreshold = async () => {
    if (autoRunRef.current) return;
    const running = testing || (await setupMicTest(settings));
    if (!running) return;
    setAutoThreshold("listening");
    autoRunRef.current = { levels: [], until: Date.now() + MIC_AUTO_THRESHOLD_MS };
    // A level that stops arriving — a capture that ended under it, a context
    // the browser suspended — must not leave the control saying «слушаем…» for
    // the rest of the session.
    autoTimerRef.current = setTimeout(finishAutoThreshold, MIC_AUTO_THRESHOLD_MS + 1500);
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
        // Asked again, because `applyConstraints` resolving means the browser
        // accepted the request and not that it granted it.
        setAppliedNotice(readAppliedProcessing(track, nextSettings));
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

      {/*
        First, and above the microphone chain the rest of this panel is. The
        sounds belong to the whole product — a call arriving while nothing is
        open, a message while the window is behind another one — where
        «Устройства», «Уровень», «Микрофон в звонке» and «Обработка голоса» are
        four views of one capture. Somebody opening this screen because the
        telephone is too loud should not have to read past all of that.
      */}
      <AudioGroup caption={SOUND_GROUP_CAPTION}>
        <SwitchRow
          label={CALL_SOUND_LABEL}
          hint={CALL_SOUND_HINT}
          checked={settings.callSoundEnabled}
          testId="audio-call-sound"
          onChange={(callSoundEnabled) => {
            updateSettings({ callSoundEnabled });
            // The press is a gesture, and a gesture is the one thing a browser
            // wants before it will play anything. Turning the sound on is
            // therefore also the moment it becomes possible — which is why the
            // note below can be true before this press and false after it.
            if (callSoundEnabled) void primeCallSounds().then(() => setBlocked(callSoundReadiness()));
          }}
        />
        <SwitchRow
          label={NOTIFICATION_SOUND_LABEL}
          hint={NOTIFICATION_SOUND_HINT}
          checked={settings.notificationSoundEnabled}
          testId="audio-notification-sound"
          onChange={(notificationSoundEnabled) => {
            updateSettings({ notificationSoundEnabled });
            if (notificationSoundEnabled) void primeCallSounds().then(() => setBlocked(callSoundReadiness()));
          }}
        />
        {/*
          Said only once it has actually happened, never as a warning in
          advance. A browser that refuses sound until the page has been touched
          is the ordinary case for a tab opened and left alone, and on every
          shell where it does not happen the sentence would be a lie about the
          product. What it must never become is an excuse: the band itself is
          the notice, and it is built to be missed by nobody.
        */}
        {blocked === "blocked" && <AudioNote>{SOUND_BLOCKED_NOTE}</AudioNote>}
        <AudioNote>{SOUND_SCOPE_NOTE}</AudioNote>
      </AudioGroup>

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

      {/*
        «Уровень» is the measurement and nothing else now. «Усиление микрофона»
        used to open this group and is under «Расширенные настройки голоса» at
        the foot of the panel — it is the one control here that does **not**
        reach a call (D-271), and a slider that cannot change what a listener
        hears has no business above the meter that shows what they do hear.
      */}
      <AudioGroup caption={AUDIO_GROUP_LEVEL}>
        <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 min-h-11">
          <KubButton
            size="sm"
            variant={testing ? "secondary" : "primary"}
            onClick={startMicTest}
            data-testid="audio-mic-test"
          >
            {micTestLabel(testing)}
          </KubButton>
          {/*
            The same meter the threshold is drawn against, on the same axis.
            These two bars used to disagree: this one was linear and the one
            under the threshold logarithmic, so a peak of 0.05 filled 5% here
            and 63% there — two pictures of one measurement, on one screen.
          */}
          <MicMeter
            level={level}
            reducedMotion={reducedMotion}
            label={AUDIO_LEVEL_METER_LABEL}
            testId="audio-level-meter"
          />
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
        {/*
          D-279, and the reason it is a sentence rather than the control: the
          threshold is drawn only for «По голосу», and a slider that a person
          could calibrate in «Всегда» against a live bar while it changed
          nothing about who hears them is the defect class this register is
          full of. The reasoning, and Discord's own four answers to «this
          control cannot work here», are at the constant.
        */}
        {settings.micActivation !== "voice" && <AudioNote>{MIC_GATE_THRESHOLD_ELSEWHERE_NOTE}</AudioNote>}

        {settings.micActivation === "voice" && (
          <>
            <SliderRow
              label={MIC_GATE_THRESHOLD_LABEL}
              value={settings.micGateThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(micGateThreshold) => {
                // A hand on the slider ends the measurement's claim on it: a
                // note still saying «поставлен по комнате» over a number the
                // person has since dragged would be describing the wrong one.
                if (autoThreshold !== "listening") setAutoThreshold("idle");
                updateSettings({ micGateThreshold });
              }}
              below={
                <MicMeter
                  level={testing ? level : 0}
                  reducedMotion={reducedMotion}
                  label={MIC_GATE_LEVEL_LABEL}
                  testId="mic-gate-level"
                  threshold={settings.micGateThreshold}
                />
              }
            />
            <AudioNote>{micGateThresholdHint(testing)}</AudioNote>
            {/*
              The measurement, in the group it belongs to. The capture it needs
              is the one the «Уровень» group starts, and this control starts it
              too when there is none — so the threshold can be set without
              knowing that a button two rows up is a prerequisite.

              It leaves the capture open afterwards, on purpose: the «done»
              note asks the person to speak into it. A sentence saying so was
              added on 2026-09-20 and removed the same day — the owner: «как бы
              пользователь и так знает что его микрофон используется». The
              reasoning is at `micAutoThresholdNote`.
            */}
            {/*
              An action row, the shape «Сбросить настройки звука» is drawn in
              at the foot of this panel — not a caption beside a button. The
              first draft was the caption-and-button shape the talk key uses,
              and at 390 it printed «Подобрать порог» twice on one line: that
              row works for the key because the button carries the *value*
              («Ё / ~») while the caption carries the question, and here there
              is no value, only the verb.
            */}
            <button
              type="button"
              onClick={() => void startAutoThreshold()}
              disabled={autoThreshold === "listening"}
              aria-live="polite"
              data-testid="mic-auto-threshold"
              data-state={autoThreshold}
              className={cn(
                "kub-button grid w-full min-w-0 grid-cols-[1.125rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 min-h-11 text-left kub-interactive transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] kub-raise-hover",
                FOCUS_RING,
                PRESS_SINK,
                DISABLED_SINK,
              )}
            >
              <KubIcon name="microphone" size={16} className="text-[color:var(--kub-muted)]" />
              <span className="min-w-0 text-sm text-[color:var(--kub-text)]">
                {autoThreshold === "listening" ? MIC_AUTO_THRESHOLD_BUSY_LABEL : MIC_AUTO_THRESHOLD_LABEL}
              </span>
            </button>
            <AudioNote tone={autoThreshold === "failed" || autoThreshold === "silent" ? "danger" : "muted"}>
              {micAutoThresholdNote(autoThreshold)}
            </AudioNote>
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
        <AudioNote>{AUDIO_PROCESSING_HINT}</AudioNote>
        {/*
          What the browser actually did, which is the only thing that makes the
          three switches above honest. A constraint is a request; a headset with
          its own processing, or a platform that does not expose the control,
          answers it with whatever it likes and says so only in
          `track.getSettings()`.
        */}
        {appliedNotice && <AudioNote tone="danger">{appliedNotice}</AudioNote>}
        {processingNotice && <AudioNote>{processingNotice}</AudioNote>}
      </AudioGroup>

      {/*
        The fold, at the foot of the panel where Discord puts its own.

        It is the arrangement the owner asked for on 2026-09-20 — «усиление
        пусть будет также как в дискорде» — and the arrangement is most of what
        there was to take. Of the seven controls in Discord's advanced panel,
        one is a switch we already have and it already reaches a call
        («Выравнивать голос», the `autoGainControl` constraint); one is a
        warning about a silent microphone, which is below; and the rest are
        native capabilities a web page does not have — ducking other
        applications' audio needs the operating system's mixer, and QoS is a
        socket option. `docs/INTERFACE_DEFECT_REGISTER.md` D-275 goes through
        all seven with a verdict per surface. Nothing here is drawn greyed out
        with a tooltip: a control that cannot work on this surface is absent
        from it.

        Closed by default and **not** remembered. A disclosure whose state
        outlives the visit is one a person finds already open without having
        opened it, and the whole job of this one is that the screen above it
        starts calm.
      */}
      <AudioGroup label={AUDIO_ADVANCED_GROUP}>
        <button
          type="button"
          id={advancedButtonId}
          aria-expanded={advanced}
          // Only while the panel exists, exactly as `DisclosureRow` in the
          // settings screen does it: `aria-controls` pointing at an id that is
          // not in the document is a dangling reference.
          aria-controls={advanced ? advancedPanelId : undefined}
          data-testid="audio-advanced-toggle"
          onClick={() => setAdvanced((open) => !open)}
          className={cn(
            "kub-button grid w-full min-w-0 grid-cols-[1.125rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 min-h-11 text-left kub-interactive transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] kub-raise-hover",
            FOCUS_RING,
            PRESS_SINK,
          )}
        >
          <KubIcon name="settings" size={16} className="text-[color:var(--kub-muted)]" />
          <span className="min-w-0 text-sm text-[color:var(--kub-text)]">{audioAdvancedLabel(advanced)}</span>
          <KubIcon
            name="chevronDown"
            size={14}
            className={cn(
              "shrink-0 text-[color:var(--kub-muted)] transition-transform duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)]",
              advanced && "rotate-180",
            )}
          />
        </button>
        {advanced && (
          <div
            id={advancedPanelId}
            role="region"
            aria-labelledby={advancedButtonId}
            data-testid="audio-advanced"
            className="divide-y divide-[color:var(--kub-rule)]"
          >
            {/*
              The three constraints one at a time. The plain-language choice
              between them — «Чистый голос» / «Без обработки» — stays above the
              fold, because that is the control a person needs; these are the
              same three settings taken apart, and «Вручную» is the state they
              leave the picker in when they stop agreeing.
            */}
            {AUDIO_PROCESSING_SWITCHES.map((entry) => (
              <SwitchRow
                key={entry.key}
                label={entry.label}
                hint={entry.hint}
                checked={settings[entry.key]}
                disabled={applying}
                testId={PROCESSING_TEST_IDS[entry.key]}
                onChange={(checked) => void changeProcessingToggle(entry.key, checked)}
              />
            ))}
            <SwitchRow
              label={MIC_NO_INPUT_LABEL}
              hint={MIC_NO_INPUT_HINT}
              checked={settings.micNoInputWarning}
              testId="audio-no-input-warning"
              onChange={(micNoInputWarning) => updateSettings({ micNoInputWarning })}
            />
            {/*
              Last, and the only control on this screen that cannot change what
              a listener hears. Its own line says where it does apply; D-271 is
              why that line exists and why this is here rather than over the
              meter.
            */}
            <SliderRow
              label={AUDIO_GAIN_LABEL}
              hint={AUDIO_GAIN_HINT}
              value={settings.micInputGain}
              min={0}
              max={2}
              step={0.05}
              onChange={(micInputGain) => updateSettings({ micInputGain })}
            />
          </div>
        )}
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
/**
 * A group of rows.
 *
 * `caption` is optional because one group's first row is a button that names it
 * — the advanced fold — and a heading above that button would print the same
 * words twice. `label` is what `data-audio-group` says, so a captionless group
 * can still be found by a capture spec; it defaults to the caption, which is
 * what every other group here relies on.
 *
 * The box below is the **one** group shape this file may draw, and
 * `tests/unit/audio-settings-surface.test.mts` counts it: a second box string
 * anywhere in this component is the dialect D-121 was about, so a new group
 * comes through here or not at all.
 */
function AudioGroup({
  caption,
  label,
  children,
}: {
  caption?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <section data-audio-group={label ?? caption}>
      {caption && (
        <h4 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
          {caption}
        </h4>
      )}
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
 * The live level, on the threshold's own axis — the one meter this screen has.
 *
 * Two bars are drawn from it: the one beside «Проверить микрофон» and the one
 * under the threshold. They are one component rather than two because they are
 * one measurement, and until 2026-09-20 they were not: the first was linear in
 * amplitude and the second logarithmic, so a peak of 0.05 filled 5% of the
 * first and 63% of the second, on the same screen, at the same instant. A
 * person reading the loud one and setting the quiet one had no way to know.
 *
 * `micMeterPercent` is the inverse of the mapping the slider's value goes
 * through, so a bar at this width and the handle above it mean the same
 * loudness — which is the whole reason the threshold is stored as a position
 * rather than as a number of decibels. The two line up to within half a thumb
 * (6px of a 272px track at 1440), because a range input insets its travel by
 * that much and a plain box does not; the reading that matters is the colour
 * rather than the alignment.
 *
 * ## With a `threshold`: the line is drawn **inside** the bar
 *
 * D-279, second round. Until 2026-09-20 the whole bar was one colour that
 * switched — `--kub-muted` below the threshold, `--kub-cyan` above it — and
 * the owner, having watched it switch: «но требуется более явно разделение».
 * He is right, and the reason is that those two are not two colours. They are
 * two saturations of one blue-grey, so what the switch changed was how bright
 * the bar was, not what it was saying; and it said it about the **whole** bar
 * at once, so there was never anything on screen marking *where* the line is.
 * A person dragging the handle had to look up at the slider, estimate its x,
 * and compare it to a bar in another row.
 *
 * Discord solves this by having only one object: its sensitivity track *is*
 * the coloured scale, warm to the left of the handle and green to the right,
 * with the handle sitting on the boundary (photographed by the owner,
 * 2026-09-20). We do not copy the object, because ours is not the same thing:
 * their track is a scale and ours is a live meter, and how their track shows
 * the live level could not be established from a still. What is taken is the
 * **mechanic** — the boundary is visible inside the coloured object, always,
 * rather than inferred by comparing two of them:
 *
 *  - a mark at the threshold's own position, drawn whatever the level is, so
 *    the line exists on screen when the room is silent;
 *  - the fill in two parts, `--kub-warn` up to the mark and `--kub-cyan` past
 *    it, so a voice growing louder is seen to **cross** it at exactly that x.
 *
 * Both of those are measured against a 3:1 floor from the rendered pixels
 * rather than from the token values, because the first version of this was
 * not: it implied the boundary with two 16% track tints and a gap, which came
 * out at **1.09:1** and **1.33:1** and was reported by a reader as «there is
 * no bar». See the comments at the two elements.
 *
 * Amber against blue rather than Discord's warm against green, and that is
 * not a palette convenience. `--kub-warn` is this material's one warm tone and
 * is documented as tuned for a mark rather than for a word — its light value
 * was darkened specifically so an indicator clears 3:1. And amber/blue is the
 * pair that survives the common colour deficiencies, where warm/green is the
 * pair that does not: a control whose only state signal is red-green is unread
 * by about one man in twelve.
 *
 * Without a `threshold` there is no line to cross, so the bar stays one accent
 * fill and says only how loud.
 *
 * `transition-[width]` only when motion is wanted. See `micMeterPercent` for
 * the whole of that decision, including why the bar still moves.
 */
function MicMeter({
  level,
  reducedMotion,
  label,
  testId,
  threshold,
}: {
  level: number;
  reducedMotion: boolean;
  label: string;
  testId: string;
  threshold?: number;
}) {
  const width = micMeterPercent(level, reducedMotion);
  const gated = threshold !== undefined;
  const open = gated && level > 0 && level >= micGateOpenAt(threshold);
  // The mark, on the meter's own axis rather than on the slider's: the same
  // `micLevelPosition` mapping the width goes through, which is what makes the
  // two comparable at all.
  const line = gated ? Math.round(micLevelPosition(micGateOpenAt(threshold)) * 100) : 0;
  const below = Math.min(width, line);
  const above = Math.max(0, width - line);
  // Whether the level has reached the mark. Below this the mark is on bare
  // track and carries the boundary itself; at or past it the mark is painted
  // over and the gap takes the job.
  const covered = gated && line > 0 && width >= line;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      data-testid={testId}
      data-open={gated ? (open ? "true" : "false") : undefined}
      data-threshold={gated ? line : undefined}
      className={cn(
        "relative h-2 min-w-0 w-full overflow-hidden rounded-full bg-[var(--kub-range-track)]",
        gated && "mt-1",
      )}
    >
      {gated ? (
        <>
          {/*
            **The засечка, and it is under the fills rather than over them.**

            The first version of this drew the boundary as a 2px gap in the
            track's own colour, on top, with the two zones either side tinted
            at 16%. Measured off the rendered pixels afterwards, at rest and in
            the dark theme: the two zones were **1.09:1** apart and the gap was
            **1.33:1** against the warm one. Reviewed by a second reader who
            looked at the screenshot and reported that the meter had no bar at
            all — it does; he could not see it. A gap can only be seen where
            something has been taken out of, and in a silent room there is
            nothing there to take.

            That is the state the owner is in, because his dimmer is at zero,
            and it is also the state `micGateThresholdHint` describes in so
            many words. A sentence about a landmark that is invisible is the
            register's most repeated shape.

            So the mark is a real mark, in `--kub-muted` — this material's
            quiet-mark tone — measured at 7.47:1 against the track in the dark
            theme and 4.80:1 in the light one, against a floor of 3:1. Drawn
            **first**, so a fill covers it, which is why there is no colour
            that has to clear 3:1 against both a near-black track and a bright
            amber at once.
          */}
          <div
            aria-hidden="true"
            data-testid={`${testId}-notch`}
            className="absolute inset-y-0 w-[2px] -translate-x-px bg-[var(--kub-muted)]"
            style={{ left: `${line}%` }}
          />
          {/*
            And the level over it, in two parts. `35ms` rather than one of the
            motion tokens, and it is the one number here taken from Discord's
            own bundle (`transition:width 35ms ease`, build 615980): a reading
            arrives every `MIC_LEVEL_PERIOD_MS`, so a transition longer than
            50ms spends its whole life drawing a level the microphone never
            had. The smoothing this meter has is the analyser's own 42.7ms
            window, and it does not need a second one.
          */}
          <div
            data-testid={`${testId}-below`}
            className={cn(
              "absolute inset-y-0 left-0 bg-[var(--kub-warn)]",
              !reducedMotion && "transition-[width] duration-[35ms] ease-out",
            )}
            style={{ width: `${below}%` }}
          />
          <div
            data-testid={`${testId}-above`}
            className={cn(
              "absolute inset-y-0 bg-[var(--kub-cyan)]",
              !reducedMotion && "transition-[width] duration-[35ms] ease-out",
            )}
            style={{ left: `${line}%`, width: `${above}%` }}
          />
          {/*
            The boundary again, **only once a fill has covered the mark**, and
            this one is the gap: the track's own colour, so it reads as a bite
            out of the bar. It is not decoration for the hue break above it.
            Amber and blue are 1.94:1 apart in luminance in the dark theme and
            **1.32:1** in the light one — a hue break and almost nothing else —
            so for a reader who cannot separate those hues the filled boundary
            would otherwise not exist. The track against either fill is 9.94:1
            and 5.12:1 dark, 3.28:1 and 4.34:1 light.
          */}
          {covered && (
            <div
              aria-hidden="true"
              data-testid={`${testId}-gap`}
              className="absolute inset-y-0 w-[2px] -translate-x-px bg-[var(--kub-range-track)]"
              style={{ left: `${line}%` }}
            />
          )}
        </>
      ) : (
        <div
          className={cn(
            "h-full rounded-full bg-[var(--kub-cyan)]",
            !reducedMotion && "transition-[width] duration-[35ms] ease-out",
          )}
          style={{ width: `${width}%` }}
        />
      )}
    </div>
  );
}

/**
 * Whether this viewer has asked for reduced motion, kept current.
 *
 * `prefersReducedMotion()` is a reading rather than a subscription, and this
 * panel is open for as long as somebody is adjusting it — long enough for the
 * system setting to change under it, which is exactly what somebody who has
 * just found the setting will do.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** The three switches, by the names the specs already reach them under. */
const PROCESSING_TEST_IDS: Record<AudioProcessingKey, string> = {
  noiseSuppression: "audio-noise-suppression",
  echoCancellation: "audio-echo-cancellation",
  autoGainControl: "audio-auto-gain",
};

/**
 * What the browser actually did with the three constraints, off the live track.
 *
 * `getSettings()` is the only honest source. A browser that omits the keys —
 * WebKit omits all three — produces no note at all rather than a guess.
 */
function readAppliedProcessing(track: MediaStreamTrack | undefined, settings: AudioSettings): string | null {
  if (!track || typeof track.getSettings !== "function") return null;
  return processingRefusalNote(
    {
      noiseSuppression: settings.noiseSuppression,
      echoCancellation: settings.echoCancellation,
      autoGainControl: settings.autoGainControl,
    },
    track.getSettings() as Partial<Record<AudioProcessingKey, unknown>>,
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
  hint,
  value,
  min,
  max,
  step,
  onChange,
  below,
}: {
  label: string;
  /** Where the number applies, for a control whose reach is not obvious. */
  hint?: string;
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
      {hint && (
        <span className="mb-1.5 block text-xs leading-snug text-[color:var(--kub-muted)]">{hint}</span>
      )}
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
