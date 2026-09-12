"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  KeyboardEvent,
  ClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MessageWithSender } from "@/types/database";

/** The composer stops growing here and scrolls instead. */
const MAX_COMPOSER_HEIGHT_PX = 140;
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";
import { CameraCaptureModal } from "./CameraCaptureModal";
import AttachSheet from "./attach/AttachSheet";
import { VideoMessageRecorderModal } from "./VideoMessageRecorderModal";
import { useChatMediaPlayback, VideoCircleProgressRing, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { useAppStore } from "@/store/app.store";
import { useMuteState } from "@/hooks/useMuteState";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { applyAudioOutputDevice } from "@/lib/audioOutput";
import { formatReplyMessagePreview } from "@/lib/messagePreview";
import { DEFAULT_MEDIA_QUALITY } from "@/lib/mediaQuality";
import { isNativeApp, microphonePermissionHelp } from "@/lib/platform/capabilities";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { useVoiceRecorder, formatVoiceDuration as formatRecorderDuration } from "@/hooks/useVoiceRecorder";
import {
  createComposerSendScope,
  restoreComposerTextIfCurrent,
  runComposerCompletionIfCurrent,
  type ComposerSendToken,
} from "@/lib/composerSendScope";
import {
  createRecordedVideoFile,
  formatAttachmentSize,
  normalizeClipboardFile,
  type StagedAttachment,
} from "@/lib/stagedAttachments";
import {
  StagedAttachmentTransferProgress,
  VoicePlaybackProgress,
} from "@/lib/stagedUploadWorkflow";
import { EmojiCategoryPicker } from "@/components/ui/EmojiCategoryPicker";
import { MESSAGE_EMOJI_CATEGORIES, MESSAGE_EMOJI_SEARCH_TERMS } from "@/lib/emojiCatalog";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
import { forwardDraftTitle } from "@/lib/messageActions";
import { CAPSULE_CONTROL_GLASS, CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING } from "@/lib/controlSurface";
import { locationMessageText, type AttachIncoming, type AttachSendRequest } from "@/lib/attachSheet";
import { ComposerRecordingRow, type ComposerRecordingPreview } from "./ComposerRecordingRow";
import {
  lockProgress,
  readRecordingHold,
  recordingButtonLabel,
  recordingMinimumMs,
  releaseRecording,
  shortPressHint,
  slideCancelProgress,
  slideFollowX,
  type RecordingMode,
  type RecordingPhase,
} from "@/lib/recordingGesture";
import type { VoiceRecordResult } from "@/hooks/useVoiceRecorder";

const DRAFT_PREFIX = "kub:draft:";
const draftKey = (chatId: string) => `${DRAFT_PREFIX}${chatId}`;
const MOBILE_RECORDER_LONG_PRESS_MS = 320;
const RECORDER_TAP_MOVE_PX = 10;
/** How long the hint left by a press too short to be a recording stays (D-130, R7). */
const SHORT_PRESS_HINT_MS = 2200;

/** «Аня, Максим: Привет! Макет…» — who is being forwarded, and the first of it. */
function forwardDraftSummary(messages: MessageWithSender[]): string {
  const names = [...new Set(messages.map((message) => messageActorDisplayName(resolveMessageActor(message))))];
  const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}` : names.join(", ");
  return `${who}: ${formatReplyMessagePreview(messages[0])}`;
}

interface MessageInputProps {
  chatId: string;
  replyTo: MessageWithSender | null;
  onCancelReply: () => void;
  onSend: (content: string) => void | boolean | Promise<unknown>;
  onEdit?: (messageId: string, newContent: string) => Promise<void>;
  onSendVoice?: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  onSendVideoMessage?: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  onTyping?: () => void;
  attachments?: StagedAttachment[];
  onStageFiles?: (files: File[], source: "picker" | "paste" | "camera", options?: { compress?: boolean }) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRetryAttachment?: (attachmentId: string) => void;
  onCancelAttachment?: (attachmentId: string) => void;
  draftOverride?: { id: string; text: string } | null;
  focusRequestKey?: number;
  onFocusChange?: (focused: boolean) => void;
  /**
   * Messages waiting to be forwarded into this chat with the next send, as in
   * Telegram: the chat is picked first, then a comment can be added. A send
   * with nothing typed still forwards them.
   */
  forwardDraft?: MessageWithSender[] | null;
  onCancelForward?: () => void;
  /** The attach sheet (D-122): sends what the sheet picked, with its caption, compressed or as originals. */
  onSendMedia?: (request: AttachSendRequest) => void | Promise<void>;
  /** The attach sheet (D-122): photos pasted or dropped, which open the sheet as their send step. */
  incomingMedia?: AttachIncoming | null;
  onIncomingMediaTaken?: () => void;
}

export function MessageInput({
  chatId,
  replyTo,
  onCancelReply,
  onSend,
  onEdit,
  onSendVoice,
  onSendVideoMessage,
  onTyping,
  attachments = [],
  onStageFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onCancelAttachment,
  draftOverride,
  focusRequestKey = 0,
  onFocusChange,
  forwardDraft = null,
  onCancelForward,
  onSendMedia,
  incomingMedia = null,
  onIncomingMediaTaken,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [sheetWebcamShot, setSheetWebcamShot] = useState<AttachIncoming | null>(null);
  const cameraForSheetRef = useRef(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showVideoMessage, setShowVideoMessage] = useState(false);
  const [videoRecorderVariant, setVideoRecorderVariant] = useState<"round" | "regular">("round");
  const [videoAutoStart, setVideoAutoStart] = useState(false);
  const [videoAutoAddOnStop, setVideoAutoAddOnStop] = useState(false);
  const [videoStopSignal, setVideoStopSignal] = useState(0);
  const [recorderMode, setRecorderMode] = useState<"voice" | "video">("voice");
  const [modeFeedback, setModeFeedback] = useState<string | null>(null);
  const [voiceHoldActive, setVoiceHoldActive] = useState(false);
  const [holdRecorderState, setHoldRecorderState] = useState<{
    mode: RecordingMode;
    phase: RecordingPhase;
  } | null>(null);
  /** How far the finger has travelled from where it landed; the row reads it. */
  const [holdTravel, setHoldTravel] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** A paused recording, waiting to be listened to and then sent. */
  const [recordingPreview, setRecordingPreview] = useState<ComposerRecordingPreview | null>(null);
  /** What a press too short to be a recording leaves beside the button (R7). */
  const [shortHint, setShortHint] = useState<string | null>(null);
  const voiceHold = useVoiceRecorder();
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRecordingStartedRef = useRef(false);
  const touchLongPressTriggeredRef = useRef(false);
  const touchPointerMovedRef = useRef(false);
  const voiceHoldActiveRef = useRef(false);
  const videoHoldActiveRef = useRef(false);
  const holdRecorderStateRef = useRef<typeof holdRecorderState>(null);
  const recorderPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const recorderPointerDownAtRef = useRef(0);
  const recorderPointerIdRef = useRef<number | null>(null);
  const recorderPointerTypeRef = useRef<"mouse" | "touch" | "pen">("mouse");
  /** When the recording itself began, which is later than the press on a finger. */
  const recordingStartedAtRef = useRef(0);
  const shortHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The composer's own row: a mouse released outside it cancels (R4, source T21). */
  const composerRowRef = useRef<HTMLDivElement | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const pausedRecordingRef = useRef<VoiceRecordResult | null>(null);
  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const hasForwardDraft = Boolean(forwardDraft && forwardDraft.length > 0);
  const isAttachmentBusy = attachments.some((item) => item.status === "uploading" || item.status === "sending");
  const editingMessage = useAppStore((s) => s.editingMessage);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const isEditing = editingMessage !== null && editingMessage.chat_id === chatId;
  const muteState = useMuteState(chatId);
  const preEditTextRef = useRef<string | null>(null);
  const composerSendScopeRef = useRef<ReturnType<typeof createComposerSendScope> | null>(null);
  if (!composerSendScopeRef.current) composerSendScopeRef.current = createComposerSendScope(chatId);
  const composerSendScope = composerSendScopeRef.current;
  const voiceRecordingScopeTokenRef = useRef<ComposerSendToken | null>(null);
  const videoRecordingScopeTokenRef = useRef<ComposerSendToken | null>(null);
  const delayedAttachmentScopeTokenRef = useRef<ComposerSendToken | null>(null);

  useLayoutEffect(() => {
    voiceHold.cancel();
    composerSendScope.activate(chatId);
    voiceRecordingScopeTokenRef.current = null;
    videoRecordingScopeTokenRef.current = null;
    delayedAttachmentScopeTokenRef.current = null;
    voiceHoldActiveRef.current = false;
    videoHoldActiveRef.current = false;
    holdRecorderStateRef.current = null;
    setShowVoice(false);
    setShowCamera(false);
    setShowVideoMessage(false);
    setVoiceHoldActive(false);
    setHoldRecorderState(null);
    setVideoAutoStart(false);
    setVideoAutoAddOnStop(false);
    setHoldTravel({ dx: 0, dy: 0 });
    setRecordingPreview(null);
    setShortHint(null);
    return () => {
      composerSendScope.invalidate();
      voiceRecordingScopeTokenRef.current = null;
      videoRecordingScopeTokenRef.current = null;
      delayedAttachmentScopeTokenRef.current = null;
      voiceHoldActiveRef.current = false;
      videoHoldActiveRef.current = false;
      holdRecorderStateRef.current = null;
    };
  }, [chatId, composerSendScope, voiceHold.cancel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(draftKey(chatId));
    setText(saved ?? "");
    preEditTextRef.current = null;
    setEditingMessage(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isEditing) return;
    if (text) localStorage.setItem(draftKey(chatId), text);
    else localStorage.removeItem(draftKey(chatId));
  }, [text, chatId, isEditing]);

  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);

  useEffect(() => {
    return () => {
      if (modeFeedbackTimerRef.current) clearTimeout(modeFeedbackTimerRef.current);
      if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
      voiceHold.cancel();
    };
  }, [voiceHold.cancel]);

  useEffect(() => {
    voiceHoldActiveRef.current = voiceHoldActive;
  }, [voiceHoldActive]);

  /**
   * The time the recording row shows, for both modes.
   *
   * Counted from when the recording itself began rather than from the press,
   * which on a finger is a third of a second earlier, and stopped once the
   * recording is paused — a paused one has a length, not a clock.
   */
  const [holdElapsedMs, setHoldElapsedMs] = useState(0);
  useEffect(() => {
    if (!holdRecorderState || holdRecorderState.phase === "paused") return;
    const tick = () => setHoldElapsedMs(Math.max(0, Date.now() - recordingStartedAtRef.current));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [holdRecorderState]);

  useEffect(() => {
    holdRecorderStateRef.current = holdRecorderState;
  }, [holdRecorderState]);

  useEffect(() => {
    if (!voiceHold.error) return;
    voiceHoldActiveRef.current = false;
    setVoiceHoldActive(false);
    holdRecorderStateRef.current = null;
    setHoldRecorderState(null);
    const message =
      voiceHold.error === "permission_denied" ? microphonePermissionHelp()
      : voiceHold.error === "no_device" ? "Микрофон недоступен."
      : voiceHold.error === "unsupported"
        ? isNativeApp()
          ? "Запись голосовых сообщений недоступна на этом устройстве."
          : "Голосовые сообщения не поддерживаются этим браузером."
      : "Не удалось записать голосовое сообщение.";
    showAppAlert(message, "Голосовое сообщение");
  }, [voiceHold.error]);

  useEffect(() => {
    if (!isEditing || !editingMessage) return;
    if (preEditTextRef.current === null) preEditTextRef.current = text;
    setText(editingMessage.content ?? "");
    setTimeout(() => textareaRef.current?.focus(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage?.id]);

  useEffect(() => {
    if (!draftOverride) return;
    setEditingMessage(null);
    preEditTextRef.current = null;
    setText(draftOverride.text);
    setShowEmoji(false);
    setShowAttach(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [draftOverride, setEditingMessage]);

  useEffect(() => {
    if (!replyTo || isEditing) return;
    setShowEmoji(false);
    setShowAttach(false);
    setShowVoice(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [focusRequestKey, isEditing, replyTo]);

  const exitEditMode = useCallback(() => {
    setEditingMessage(null);
    setText(preEditTextRef.current ?? "");
    preEditTextRef.current = null;
  }, [setEditingMessage]);

  const stageCameraFile = useCallback((file: File, scopeToken: ComposerSendToken | null) => {
    if (!onStageFiles) return;
    if (!scopeToken || !composerSendScope.isActive(scopeToken)) return;
    delayedAttachmentScopeTokenRef.current = null;
    onStageFiles([file], "camera");
    setShowAttach(false);
  }, [composerSendScope, onStageFiles]);

  const stageRecordedVideo = useCallback((blob: Blob, mimeType: string) => {
    if (!onStageFiles) return;
    onStageFiles([createRecordedVideoFile(blob, mimeType)], "camera");
    setShowAttach(false);
  }, [onStageFiles]);

  const resetVideoRecorderFlags = useCallback(() => {
    videoRecordingScopeTokenRef.current = null;
    videoHoldActiveRef.current = false;
    setVideoAutoStart(false);
    setVideoAutoAddOnStop(false);
  }, []);

  const showRecorderModeFeedback = useCallback((mode: "voice" | "video") => {
    if (modeFeedbackTimerRef.current) clearTimeout(modeFeedbackTimerRef.current);
    setModeFeedback(mode === "voice" ? "Режим: голосовое" : "Режим: видеосообщение");
    modeFeedbackTimerRef.current = setTimeout(() => setModeFeedback(null), 1600);
  }, []);

  const toggleRecorderMode = useCallback(() => {
    if (voiceHoldActiveRef.current || videoHoldActiveRef.current) return;
    setRecorderMode((current) => {
      const next = current === "voice" ? "video" : "voice";
      showRecorderModeFeedback(next);
      return next;
    });
  }, [showRecorderModeFeedback]);

  const setActiveHoldRecorder = useCallback((mode: RecordingMode) => {
    const next = { mode, phase: "holding" as const };
    holdRecorderStateRef.current = next;
    setHoldRecorderState(next);
  }, []);

  const clearActiveHoldRecorder = useCallback(() => {
    holdRecorderStateRef.current = null;
    setHoldRecorderState(null);
    recorderPointerStartRef.current = null;
    recorderPointerDownAtRef.current = 0;
    setHoldTravel({ dx: 0, dy: 0 });
    if (recordingPreviewUrlRef.current) URL.revokeObjectURL(recordingPreviewUrlRef.current);
    recordingPreviewUrlRef.current = null;
    pausedRecordingRef.current = null;
    setRecordingPreview(null);
  }, []);

  const lockActiveRecording = useCallback(() => {
    const current = holdRecorderStateRef.current;
    if (!current || current.phase !== "holding") return;
    const next = { ...current, phase: "locked" as const };
    holdRecorderStateRef.current = next;
    setHoldRecorderState(next);
  }, []);

  const showShortPressHint = useCallback((mode: RecordingMode) => {
    if (shortHintTimerRef.current) clearTimeout(shortHintTimerRef.current);
    setShortHint(shortPressHint(mode));
    shortHintTimerRef.current = setTimeout(() => setShortHint(null), SHORT_PRESS_HINT_MS);
  }, []);

  /** Whether a point is over the composer's own row. */
  const pointerInsideComposer = useCallback((x: number, y: number) => {
    const box = composerRowRef.current?.getBoundingClientRect();
    if (!box) return true;
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }, []);

  const startVideoHoldRecording = useCallback(() => {
    // Nothing is asked and nothing is refused: a recording is sent as soon as it
    // is released, so there is never a previous one in the way (R6, R7).
    recordingStartedAtRef.current = Date.now();
    videoRecordingScopeTokenRef.current = composerSendScope.capture();
    videoHoldActiveRef.current = true;
    setActiveHoldRecorder("video");
    setVideoRecorderVariant("round");
    setVideoAutoStart(true);
    setVideoAutoAddOnStop(true);
    setShowVideoMessage(true);
    setShowAttach(false);
    setShowEmoji(false);
  }, [composerSendScope, setActiveHoldRecorder]);

  const stopVideoHoldRecording = useCallback(() => {
    if (!videoHoldActiveRef.current) return;
    setVideoStopSignal((value) => value + 1);
    clearActiveHoldRecorder();
  }, [clearActiveHoldRecorder]);

  const startVoiceHoldRecording = useCallback(async () => {
    // As above: released means sent, so nothing waits to be cleared first.
    recordingStartedAtRef.current = Date.now();
    const scopeToken = composerSendScope.capture();
    voiceRecordingScopeTokenRef.current = scopeToken;
    voiceHoldActiveRef.current = true;
    setVoiceHoldActive(true);
    setActiveHoldRecorder("voice");
    setShowAttach(false);
    setShowEmoji(false);
    const started = await voiceHold.start();
    if (!composerSendScope.isActive(scopeToken)) {
      return;
    }
    if (!started) {
      voiceRecordingScopeTokenRef.current = null;
      voiceHoldActiveRef.current = false;
      setVoiceHoldActive(false);
      clearActiveHoldRecorder();
    }
  }, [clearActiveHoldRecorder, composerSendScope, setActiveHoldRecorder, voiceHold.start]);

  const stopVoiceHoldRecording = useCallback(async () => {
    if (!voiceHoldActiveRef.current) return;
    const scopeToken = voiceRecordingScopeTokenRef.current;
    voiceHoldActiveRef.current = false;
    setVoiceHoldActive(false);
    clearActiveHoldRecorder();
    const result = await voiceHold.stop();
    if (!scopeToken || !composerSendScope.isActive(scopeToken)) return;
    // A press too short to be a recording is answered beside the button, not by
    // a dialog over the whole interface (R7); by here it has already been said.
    if (!result || result.blob.size === 0 || result.durationMs < recordingMinimumMs("voice")) {
      if (!result) voiceHold.cancel();
      return;
    }
    await runComposerCompletionIfCurrent(composerSendScope, scopeToken, () => (
      onSendVoice?.(result.blob, result.durationMs, result.mimeType)
    ));
    if (composerSendScope.isActive(scopeToken)) voiceRecordingScopeTokenRef.current = null;
  }, [clearActiveHoldRecorder, composerSendScope, onSendVoice, voiceHold.cancel, voiceHold.stop]);

  const startRecorderHold = useCallback((mode: "voice" | "video") => {
    if (mode === "video") {
      startVideoHoldRecording();
      return;
    }
    void startVoiceHoldRecording();
  }, [startVideoHoldRecording, startVoiceHoldRecording]);

  const stopRecorderHold = useCallback(() => {
    if (videoHoldActiveRef.current) stopVideoHoldRecording();
    if (voiceHoldActiveRef.current) void stopVoiceHoldRecording();
  }, [stopVideoHoldRecording, stopVoiceHoldRecording]);

  /**
   * Throws the recording away (R4): the microphone is released, the clip is
   * dropped, and nothing is staged or sent.
   *
   * Closing the round-video card tears its `MediaRecorder` down with `onstop`
   * detached, so the clip it was making is never handed on.
   */
  const cancelRecorderHold = useCallback(() => {
    if (videoHoldActiveRef.current) {
      setShowVideoMessage(false);
      resetVideoRecorderFlags();
    }
    if (voiceHoldActiveRef.current) {
      voiceHold.cancel();
      voiceRecordingScopeTokenRef.current = null;
      voiceHoldActiveRef.current = false;
      setVoiceHoldActive(false);
    }
    clearActiveHoldRecorder();
  }, [clearActiveHoldRecorder, resetVideoRecorderFlags, voiceHold.cancel]);

  /**
   * Stops a locked recording without sending it, so it can be heard first.
   *
   * For a voice message that means holding the clip and showing it playable —
   * the only preview there is, now that the tray is not one. The round video
   * has its own card with its own preview, so there the stop still ends and
   * sends, which is what its control has always said it does.
   */
  const pauseLockedRecording = useCallback(async () => {
    const current = holdRecorderStateRef.current;
    if (!current || current.phase !== "locked") return;
    if (current.mode === "video") {
      stopVideoHoldRecording();
      return;
    }
    const result = await voiceHold.stop();
    voiceHoldActiveRef.current = false;
    setVoiceHoldActive(false);
    if (!result || result.blob.size === 0) {
      cancelRecorderHold();
      return;
    }
    if (recordingPreviewUrlRef.current) URL.revokeObjectURL(recordingPreviewUrlRef.current);
    const url = URL.createObjectURL(result.blob);
    recordingPreviewUrlRef.current = url;
    pausedRecordingRef.current = result;
    setRecordingPreview({ url, durationMs: result.durationMs });
    const next = { ...current, phase: "paused" as const };
    holdRecorderStateRef.current = next;
    setHoldRecorderState(next);
  }, [cancelRecorderHold, stopVideoHoldRecording, voiceHold.stop]);

  /** The send in the locked row: what was paused, or what is still running. */
  const sendLockedRecording = useCallback(async () => {
    const current = holdRecorderStateRef.current;
    if (!current) return;
    if (current.mode === "video") {
      stopVideoHoldRecording();
      return;
    }
    if (current.phase !== "paused") {
      await stopVoiceHoldRecording();
      return;
    }
    const recorded = pausedRecordingRef.current;
    const scopeToken = voiceRecordingScopeTokenRef.current;
    clearActiveHoldRecorder();
    if (!recorded || !scopeToken) return;
    await runComposerCompletionIfCurrent(composerSendScope, scopeToken, () => (
      onSendVoice?.(recorded.blob, recorded.durationMs, recorded.mimeType)
    ));
  }, [clearActiveHoldRecorder, composerSendScope, onSendVoice, stopVideoHoldRecording, stopVoiceHoldRecording]);

  const stopLockedRecording = useCallback(() => {
    stopRecorderHold();
  }, [stopRecorderHold]);

  const resetRecorderPointer = useCallback(() => {
    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = null;
    touchRecordingStartedRef.current = false;
    touchLongPressTriggeredRef.current = false;
    touchPointerMovedRef.current = false;
    recorderPointerStartRef.current = null;
    recorderPointerDownAtRef.current = 0;
    recorderPointerIdRef.current = null;
    setHoldTravel({ dx: 0, dy: 0 });
  }, []);

  /** A pointerup that escaped the button: a recording still being held ends and goes. */
  const finishRecorderPointerGesture = useCallback((shouldStop: boolean) => {
    const phase = holdRecorderStateRef.current?.phase;
    resetRecorderPointer();
    if (shouldStop && phase === "holding") stopRecorderHold();
  }, [resetRecorderPointer, stopRecorderHold]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stopActiveTouchRecording = () => {
      if (recorderPointerIdRef.current === null) return;
      const hasActiveRecording =
        voiceHoldActiveRef.current ||
        videoHoldActiveRef.current ||
        touchRecordingStartedRef.current ||
        touchLongPressTriggeredRef.current;
      if (!hasActiveRecording) return;
      finishRecorderPointerGesture(true);
    };
    window.addEventListener("pointerup", stopActiveTouchRecording, true);
    window.addEventListener("touchend", stopActiveTouchRecording, true);
    return () => {
      window.removeEventListener("pointerup", stopActiveTouchRecording, true);
      window.removeEventListener("touchend", stopActiveTouchRecording, true);
    };
  }, [finishRecorderPointerGesture]);

  const handleRecorderContextMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleRecorderMode();
  }, [toggleRecorderMode]);

  const handleRecorderPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || isAttachmentBusy) return;
    event.preventDefault();
    recorderPointerStartRef.current = { x: event.clientX, y: event.clientY };
    recorderPointerDownAtRef.current = Date.now();
    recorderPointerIdRef.current = event.pointerId;
    touchPointerMovedRef.current = false;
    touchLongPressTriggeredRef.current = false;
    recorderPointerTypeRef.current =
      event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse";
    setHoldTravel({ dx: 0, dy: 0 });
    setShortHint(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; recording still works through pointerup.
    }
    if (event.pointerType === "touch") {
      touchRecordingStartedRef.current = false;
      if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = setTimeout(() => {
        touchLongPressTriggeredRef.current = true;
        touchRecordingStartedRef.current = true;
        startRecorderHold(recorderMode);
      }, MOBILE_RECORDER_LONG_PRESS_MS);
      return;
    }
    startRecorderHold(recorderMode);
  }, [isAttachmentBusy, recorderMode, startRecorderHold]);

  /**
   * Both axes, where only the upward one was read before (R4).
   *
   * Crossing the cancel threshold throws the recording away at once rather than
   * waiting for the release, which is what Telegram does: the slide is a gesture
   * a person feels their way through, not a command to be confirmed.
   */
  const handleRecorderPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const startPoint = recorderPointerStartRef.current;
    if (!startPoint) return;
    const dx = event.clientX - startPoint.x;
    const dy = event.clientY - startPoint.y;
    if (event.pointerType === "touch" && Math.hypot(dx, dy) > RECORDER_TAP_MOVE_PX) {
      touchPointerMovedRef.current = true;
    }
    if (!voiceHoldActiveRef.current && !videoHoldActiveRef.current) return;
    if (holdRecorderStateRef.current?.phase !== "holding") return;
    setHoldTravel({ dx, dy });
    const verdict = readRecordingHold({ dx, dy });
    if (verdict === "locking") lockActiveRecording();
    else if (verdict === "cancelling") cancelRecorderHold();
  }, [cancelRecorderHold, lockActiveRecording]);

  /**
   * What letting go means, decided by `releaseRecording` rather than here (R6).
   *
   * A tap that never became a recording still switches the mode, which is the
   * one thing a release did before that has nothing to do with recording.
   */
  const handleRecorderPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = holdRecorderStateRef.current;
    if (event.pointerType === "touch") {
      if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
      const recordingGesture =
        touchRecordingStartedRef.current ||
        touchLongPressTriggeredRef.current ||
        voiceHoldActiveRef.current ||
        videoHoldActiveRef.current;
      if (!recordingGesture) {
        const elapsedMs = Date.now() - recorderPointerDownAtRef.current;
        const shouldToggleMode = elapsedMs < MOBILE_RECORDER_LONG_PRESS_MS && !touchPointerMovedRef.current;
        resetRecorderPointer();
        if (shouldToggleMode) toggleRecorderMode();
        return;
      }
    }
    const startPoint = recorderPointerStartRef.current;
    const travel = startPoint
      ? { dx: event.clientX - startPoint.x, dy: event.clientY - startPoint.y }
      : { dx: 0, dy: 0 };
    const mode = state?.mode ?? recorderMode;
    const verdict = releaseRecording({
      hold: readRecordingHold(travel),
      phase: state?.phase ?? "holding",
      durationMs: Date.now() - recordingStartedAtRef.current,
      mode,
      pointerInsideComposer: pointerInsideComposer(event.clientX, event.clientY),
      pointerType: recorderPointerTypeRef.current,
    });
    resetRecorderPointer();
    if (verdict === "hold" || verdict === "lock") return;
    if (verdict === "cancel") {
      cancelRecorderHold();
      return;
    }
    if (verdict === "too-short") {
      cancelRecorderHold();
      showShortPressHint(mode);
      return;
    }
    stopRecorderHold();
  }, [
    cancelRecorderHold,
    pointerInsideComposer,
    recorderMode,
    resetRecorderPointer,
    showShortPressHint,
    stopRecorderHold,
    toggleRecorderMode,
  ]);

  const handleRecorderPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const nativeActiveTouch =
      isNativeApp() &&
      event.pointerType === "touch" &&
      (voiceHoldActiveRef.current ||
        videoHoldActiveRef.current ||
        touchRecordingStartedRef.current ||
        touchLongPressTriggeredRef.current);
    if (nativeActiveTouch) {
      if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
      return;
    }
    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = null;
    touchRecordingStartedRef.current = false;
    touchLongPressTriggeredRef.current = false;
    touchPointerMovedRef.current = false;
    recorderPointerDownAtRef.current = 0;
    recorderPointerIdRef.current = null;
    if (holdRecorderStateRef.current?.phase === "holding") stopRecorderHold();
  }, [stopRecorderHold]);

  // ── the attach sheet (D-122) ──────────────────────────────────────────────

  const sendFromSheet = useCallback((request: AttachSendRequest) => {
    setShowAttach(false);
    if (onSendMedia) {
      void onSendMedia(request);
      return;
    }
    onStageFiles?.(request.files, request.source === "drop" ? "paste" : request.source, { compress: request.compress });
  }, [onSendMedia, onStageFiles]);

  // The sheet shows the place first; this sends the message the one-tap item
  // sent, and only from the sheet's own row.
  const sendLocationFromSheet = useCallback((latitude: number, longitude: number) => {
    const scopeToken = composerSendScope.capture();
    setShowAttach(false);
    void runComposerCompletionIfCurrent(composerSendScope, scopeToken, () => onSend(locationMessageText(latitude, longitude)));
  }, [composerSendScope, onSend]);

  // A desktop has no camera app behind the file input; the webcam dialog stands
  // in, and its shot goes back into the sheet's grid.
  const openWebcamForSheet = useCallback(() => {
    cameraForSheetRef.current = true;
    delayedAttachmentScopeTokenRef.current = composerSendScope.capture();
    setShowCamera(true);
  }, [composerSendScope]);

  // Photos pasted or dropped open the sheet as their send step.
  useEffect(() => {
    if (!incomingMedia) return;
    setShowEmoji(false);
    setShowAttach(true);
  }, [incomingMedia]);

  const handleSend = useCallback(async () => {
    const sendToken = composerSendScope.capture();
    const currentText = textareaRef.current?.value ?? text;
    const trimmed = currentText.trim();
    // Messages waiting to be forwarded are sent by the send itself, with or
    // without a comment typed beside them.
    if (!trimmed && !hasAttachments && !hasForwardDraft) return;
    if (isEditing && editingMessage && onEdit) {
      if (!trimmed) return;
      await onEdit(editingMessage.id, trimmed);
      if (!composerSendScope.isActive(sendToken)) return;
      setEditingMessage(null);
      setText(preEditTextRef.current ?? "");
      preEditTextRef.current = null;
    } else {
      const previousText = currentText;
      setText("");
      if (typeof window !== "undefined") localStorage.removeItem(draftKey(chatId));
      setShowEmoji(false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      let result: unknown;
      try {
        result = await onSend(trimmed);
      } catch (error) {
        restoreComposerTextIfCurrent(composerSendScope, sendToken, previousText, {
          restoreText: setText,
          writeDraft: (sourceChatId, draft) => {
            if (typeof window !== "undefined") localStorage.setItem(draftKey(sourceChatId), draft);
          },
          focus: () => textareaRef.current?.focus(),
        });
        throw error;
      }
      if (result === false) {
        restoreComposerTextIfCurrent(composerSendScope, sendToken, previousText, {
          restoreText: setText,
          writeDraft: (sourceChatId, draft) => {
            if (typeof window !== "undefined") localStorage.setItem(draftKey(sourceChatId), draft);
          },
          focus: () => textareaRef.current?.focus(),
        });
        return;
      }
      if (!composerSendScope.isActive(sendToken)) return;
    }
    setShowEmoji(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [text, hasAttachments, hasForwardDraft, onSend, isEditing, editingMessage, onEdit, setEditingMessage, chatId, composerSendScope]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (showEmoji || showAttach) {
        e.preventDefault();
        setShowEmoji(false);
        setShowAttach(false);
      } else if (!isEditing && replyTo) {
        e.preventDefault();
        onCancelReply();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isComposing) {
      e.preventDefault();
      if (!isAttachmentBusy && (hasText || hasAttachments || hasForwardDraft)) void handleSend();
      return;
    }
    onTyping?.();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    if (!data || !onStageFiles || isEditing) return;
    const files: File[] = [];
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      files.push(normalizeClipboardFile(file));
    }
    if (!files.length) return;
    onStageFiles(files, "paste");
    setShowAttach(false);
    if (!data.getData("text/plain")) event.preventDefault();
  };

  /**
   * The composer's height follows its text, in the same commit that changes it.
   *
   * It used to be set imperatively: `handleSend` called `setText("")` — queued —
   * and then wrote `style.height = "auto"` straight to the DOM, which applied at
   * once. So on every send the composer collapsed a frame or more BEFORE the
   * message it was sending existed: the list grew into the freed space, painted,
   * and only then did the bubble arrive. Two staggered layout changes where the
   * reader expects one, which is the jerk that survived the scroll placement fix
   * — that fix corrected where the list puts itself, not the fact that its
   * container changed size early.
   *
   * A layout effect runs after React writes the DOM and before the browser
   * paints, so the height and the cleared text land in the same frame. The
   * textarea is controlled by `text`, so this covers typing as well and there is
   * no second place that sizes it.
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, [text]);

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) { setText((t) => t + emoji); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + emoji.length; el.focus(); }, 0);
  };

  if (muteState.muted) {
    const expires = muteState.mute?.expires_at
      ? new Date(muteState.mute.expires_at).toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : null;
    return (
      // No fill of its own: the dock's scroll edge is behind it, and the old
      // page-coloured band stood out as a strip over the wallpaper.
      <div className="flex-shrink-0 px-3 pb-3 pt-2 md:px-4">
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-[var(--kub-raised)] border border-[color:var(--kub-danger)]/30">
          <KubIcon name="muted" size={18} tone="danger" className="flex-shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <div className="font-semibold text-[color:var(--kub-text)]">
              {muteState.scope === "global"
                ? "Вы лишены права отправлять сообщения"
                : "В этом чате вы заблокированы для отправки"}
            </div>
            <div className="truncate text-[color:var(--kub-muted)]">
              {muteState.mute?.reason ?? ""}
              {expires ? ` · до ${expires}` : " · бессрочно"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderedVoiceRecordingScopeToken = voiceRecordingScopeTokenRef.current;
  const renderedVideoRecordingScopeToken = videoRecordingScopeTokenRef.current;
  const renderedDelayedAttachmentScopeToken = delayedAttachmentScopeTokenRef.current;

  if (showVoice) {
    return (
      // No fill of its own, for the same reason as the muted state above.
      <div className="flex-shrink-0 px-3 pb-3 pt-2 md:px-4">
        <VoiceRecorder
          key={chatId}
          onSend={async (blob, durMs, mime) => {
            const scopeToken = renderedVoiceRecordingScopeToken;
            if (!scopeToken) return;
            try {
              await runComposerCompletionIfCurrent(composerSendScope, scopeToken, () => (
                onSendVoice?.(blob, durMs, mime)
              ));
            } finally {
              if (composerSendScope.isActive(scopeToken)) {
                voiceRecordingScopeTokenRef.current = null;
                setShowVoice(false);
              }
            }
          }}
          onCancel={() => {
            if (!renderedVoiceRecordingScopeToken || !composerSendScope.isActive(renderedVoiceRecordingScopeToken)) return;
            voiceRecordingScopeTokenRef.current = null;
            setShowVoice(false);
          }}
        />
      </div>
    );
  }

  const recording = holdRecorderState !== null;

  /**
   * The round button, held in one place.
   *
   * It is the same element whether the row is a composer or a recording, and it
   * keeps its key across both, because React reuses a keyed child rather than
   * remounting it — and a remount here would drop the pointer capture the
   * gesture is running on, which ends the recording in the middle of a slide.
   */
  const recorderButton = (
    <button
      key="composer-recorder"
      type="button"
      data-testid="composer-recorder-button"
      data-recorder-mode={recorderMode}
      onContextMenu={handleRecorderContextMenu}
      onPointerDown={handleRecorderPointerDown}
      onPointerMove={handleRecorderPointerMove}
      onPointerUp={handleRecorderPointerUp}
      onPointerCancel={handleRecorderPointerCancel}
      disabled={isAttachmentBusy}
      className={cn(
        "kub-interactive group/capsule relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-all select-none touch-none",
        FOCUS_RING,
        isAttachmentBusy
          ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
          : recorderMode === "video"
          ? "bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)] hover:bg-[color-mix(in_srgb,var(--kub-pink)_26%,transparent)]"
          : "text-[color:var(--kub-text)]"
      )}
      aria-label={recordingButtonLabel(recorderMode)}
      title={recordingButtonLabel(recorderMode)}
    >
      {/* The video mode keeps its pink wash, which a glass layer would cover. */}
      {recorderMode !== "video" && <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />}
      <KubIcon name={recorderMode === "video" ? "video" : "microphone"} size={22} className="relative" />
    </button>
  );

  return (
    // A plain box, and never a frosted one. This subtree opens the camera and
    // the video recorder — both viewport-covering dialogs — and the attachment
    // menu's click-away backdrop, so a frosted ancestor here would clamp all
    // three to the composer. The composer has no band: its glass is on the
    // capsules in the input row below, each a leaf, over the scroll edge the
    // dock paints. The box itself is untouched; the height it reports is what
    // ChatWindow measures into --kub-composer-height and the list's bottom
    // inset, so it must not move.
    <div className="relative flex-shrink-0">
      <div className="relative">
      {showEmoji && (
        <div className="flex justify-end px-3 pb-2 pt-1.5">
          <div
            data-testid="message-emoji-surface"
            // The emoji sheet opens over the conversation, so it takes the
            // covering fill. Its hand-rolled drop shadow goes with it: that
            // shadow was the composer's own idea of depth, and the material
            // already carries one for every panel in the product.
            className="kub-glass-strong w-full max-w-[480px] rounded-xl border border-[color:var(--kub-border-color)] p-2"
          >
            <EmojiCategoryPicker
              categories={MESSAGE_EMOJI_CATEGORIES}
              onSelect={(value) => value && insertEmoji(value)}
              testIdPrefix="message-emoji"
              className="w-full"
              searchable
              searchTerms={MESSAGE_EMOJI_SEARCH_TERMS}
              scrollable
              compact
            />
          </div>
        </div>
      )}

      <CameraCaptureModal
        key={`camera:${chatId}`}
        open={showCamera}
        onClose={() => {
          if (!renderedDelayedAttachmentScopeToken || !composerSendScope.isActive(renderedDelayedAttachmentScopeToken)) return;
          delayedAttachmentScopeTokenRef.current = null;
          cameraForSheetRef.current = false;
          setShowCamera(false);
        }}
        onAddFile={(file) => {
          // A webcam shot taken from the attach sheet goes back into its grid.
          if (cameraForSheetRef.current && showAttach) {
            cameraForSheetRef.current = false;
            setSheetWebcamShot({ id: Date.now(), files: [file], source: "camera" });
            return;
          }
          stageCameraFile(file, renderedDelayedAttachmentScopeToken);
        }}
      />
      <VideoMessageRecorderModal
        key={`video:${chatId}`}
        open={showVideoMessage}
        variant={videoRecorderVariant}
        mediaQuality={DEFAULT_MEDIA_QUALITY}
        autoStart={videoAutoStart}
        autoAddOnStop={videoAutoAddOnStop}
        stopSignal={videoStopSignal}
        locked={holdRecorderState?.mode === "video" && holdRecorderState.phase !== "holding"}
        onLockedStop={stopLockedRecording}
        onClose={() => {
          if (!renderedVideoRecordingScopeToken || !composerSendScope.isActive(renderedVideoRecordingScopeToken)) return;
          setShowVideoMessage(false);
          resetVideoRecorderFlags();
          if (holdRecorderStateRef.current?.mode === "video") clearActiveHoldRecorder();
        }}
        onAddVideo={async (blob, durationMs, mimeType) => {
          const scopeToken = renderedVideoRecordingScopeToken;
          if (!scopeToken) return;
          const completion = await runComposerCompletionIfCurrent(
            composerSendScope,
            scopeToken,
            async () => {
              if (videoRecorderVariant === "regular") {
                stageRecordedVideo(blob, mimeType);
              } else {
                await onSendVideoMessage?.(blob, durationMs, mimeType);
              }
            },
          );
          if (completion.status === "stale") return;
          setShowVideoMessage(false);
          resetVideoRecorderFlags();
        }}
      />

      {showAttach && (
        <AttachSheet
          incoming={sheetWebcamShot ?? incomingMedia}
          onIncomingTaken={() => {
            if (sheetWebcamShot) setSheetWebcamShot(null);
            else onIncomingMediaTaken?.();
          }}
          onClose={() => setShowAttach(false)}
          onSendMedia={sendFromSheet}
          onSendLocation={sendLocationFromSheet}
          onOpenWebcam={openWebcamForSheet}
        />
      )}

      <div className="px-3 pb-3 pt-2 md:px-4">
        {isEditing && editingMessage && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 bg-[var(--kub-raised)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="edit" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">Редактирование</div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{editingMessage.content}</div>
            </div>
            <button
              onClick={exitEditMode}
              aria-label="Отменить редактирование"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg kub-raise-hover flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {!isEditing && forwardDraft && hasForwardDraft && (
          // Telegram's forward bar: what will be forwarded with the next send.
          <div
            data-testid="composer-forward-draft"
            className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 bg-[var(--kub-raised)] border-l-2 border-[color:var(--kub-cyan)]"
          >
            <KubIcon name="forward" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[color:var(--kub-accent-text)]">{forwardDraftTitle(forwardDraft.length)}</div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{forwardDraftSummary(forwardDraft)}</div>
            </div>
            <button
              type="button"
              onClick={onCancelForward}
              aria-label="Отменить пересылку"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg kub-raise-hover flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {!isEditing && replyTo && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 bg-[var(--kub-raised)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="reply" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[color:var(--kub-accent-text)]">
                {messageActorDisplayName(resolveMessageActor(replyTo))}
              </div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{formatReplyMessagePreview(replyTo)}</div>
            </div>
            <button
              onClick={onCancelReply}
              aria-label="Отменить ответ"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg kub-raise-hover flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <>
            <AttachmentTray
              chatId={chatId}
              attachments={attachments}
              onRemove={onRemoveAttachment}
              onRetry={onRetryAttachment}
              onCancel={onCancelAttachment}
              onRerecord={(attachmentId) => {
                const target = attachments.find((attachment) => attachment.id === attachmentId);
                onRemoveAttachment?.(attachmentId);
                if (target?.kind === "video_message") {
                  videoRecordingScopeTokenRef.current = composerSendScope.capture();
                  setVideoRecorderVariant("round");
                  setVideoAutoStart(false);
                  setVideoAutoAddOnStop(false);
                  setShowVideoMessage(true);
                } else {
                  voiceRecordingScopeTokenRef.current = composerSendScope.capture();
                  setShowVoice(true);
                }
                setShowAttach(false);
                setShowEmoji(false);
              }}
            />
          </>
        )}

        {/* The recording itself is the composer's row now, not a card above it
            (R3); what is left here is the mode's own feedback and the hint a
            press too short to be a recording leaves behind (R7). */}
        {(modeFeedback || shortHint) && !holdRecorderState && (
          <div
            data-testid={shortHint ? "composer-short-press-hint" : "recorder-mode-feedback"}
            className="mb-2 flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-raised)] px-3 py-2 text-xs text-[color:var(--kub-muted)]"
          >
            <KubIcon name={shortHint ? "microphone" : "info"} size={14} tone="muted" />
            <span className="font-medium text-[color:var(--kub-text)]">{shortHint ?? modeFeedback}</span>
          </div>
        )}

        {/* The composer is three capsules floating over the conversation, the
            way Telegram draws it on iOS 26: a round attach button, a field
            capsule holding the text and the emoji button, and a round send or
            record button. The field's glass is one layer spanning the space
            between the two round buttons, so nothing is re-parented, the
            textarea keeps its ref and its sizing, and the composer measures
            the way it always has. The field's rim takes the accent while the
            text has focus: that rim is the field's focus indicator. */}
        <div ref={composerRowRef} className="group/composer relative flex items-end gap-2">
          {recording && holdRecorderState ? (
            <ComposerRecordingRow
              mode={holdRecorderState.mode}
              phase={holdRecorderState.phase}
              hold={readRecordingHold(holdTravel)}
              pointerType={recorderPointerTypeRef.current}
              durationMs={holdElapsedMs}
              cancelProgress={slideCancelProgress(holdTravel.dx)}
              lockFill={lockProgress(holdTravel.dy)}
              followX={slideFollowX(holdTravel.dx)}
              preview={recordingPreview}
              onCancel={cancelRecorderHold}
              onPause={pauseLockedRecording}
              onSend={sendLockedRecording}
            />
          ) : (
            <>
          {/* 3.25rem is a round button and the gap beside it, on each side. */}
          <KubGlassLayer className="left-[3.25rem] right-[3.25rem] rounded-[1.375rem] border border-[color:var(--glass-line)] group-has-[textarea:focus]/composer:border-[color:var(--kub-cyan)]" />
          <button
            onClick={() => { setShowAttach(!showAttach); setShowEmoji(false); }}
            className={cn(
              "kub-interactive group/capsule relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-colors",
              FOCUS_RING,
              showAttach ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-text)]"
            )}
            aria-label="Прикрепить"
          >
            <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
            <KubIcon name="attach" size={22} className="relative" />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder="Сообщение…"
            rows={1}
            className="relative min-w-0 flex-1 bg-transparent resize-none outline-none text-base sm:text-sm leading-6 py-2.5 pl-4 max-h-[140px] overflow-y-auto text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
          />

          <button
            onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); }}
            className={cn(
              "kub-interactive relative flex h-11 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:text-[color:var(--kub-cyan)]",
              FOCUS_RING,
              showEmoji ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
            )}
            aria-label="Эмодзи"
          >
            <KubIcon name="smile" size={20} />
          </button>

            </>
          )}

          {recording && holdRecorderState ? (
            // While the finger is down the button stays under it; once the
            // recording is locked the row carries its own controls instead.
            holdRecorderState.phase === "holding" ? recorderButton : null
          ) : hasText || hasAttachments || hasForwardDraft ? (
            <button
              onClick={handleSend}
              disabled={isAttachmentBusy}
              className={cn(
                "kub-interactive relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-all",
                FOCUS_RING,
                isAttachmentBusy
                  ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
                  : "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan hover:brightness-110"
              )}
              aria-label="Отправить"
            >
              {isAttachmentBusy ? (
                <>
                  {/* Busy, it has no fill of its own, so it keeps the capsule
                      the other two buttons stand on. */}
                  <KubGlassLayer className={CAPSULE_GLASS} />
                  <KubIcon name="spinner" size={18} className="relative animate-spin" />
                </>
              ) : (
                <KubIcon name="send" size={18} className="ml-0.5" />
              )}
            </button>
          ) : (
            <button
              type="button"
              data-testid="composer-recorder-button"
              data-recorder-mode={recorderMode}
              onContextMenu={handleRecorderContextMenu}
              onPointerDown={handleRecorderPointerDown}
              onPointerMove={handleRecorderPointerMove}
              onPointerUp={handleRecorderPointerUp}
              onPointerCancel={handleRecorderPointerCancel}
              disabled={isAttachmentBusy}
              className={cn(
                "kub-interactive group/capsule relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-all select-none touch-none",
                FOCUS_RING,
                isAttachmentBusy
                  ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
                  : recorderMode === "video"
                  ? "bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)] hover:bg-[color-mix(in_srgb,var(--kub-pink)_26%,transparent)]"
                  : "text-[color:var(--kub-text)]"
              )}
              aria-label={recorderMode === "video" ? "Видеосообщение" : "Голосовое"}
              title={recorderMode === "video" ? "Видеосообщение" : "Голосовое"}
            >
              {/* The video mode keeps its pink wash, which a glass layer would cover. */}
              {recorderMode !== "video" && <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />}
              <KubIcon
                name={recorderMode === "video" ? "video" : "microphone"}
                size={22}
                className="relative"
              />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function AttachmentTray({
  chatId,
  attachments,
  onRemove,
  onRetry,
  onCancel,
  onRerecord,
}: {
  chatId: string;
  attachments: StagedAttachment[];
  onRemove?: (attachmentId: string) => void;
  onRetry?: (attachmentId: string) => void;
  onCancel?: (attachmentId: string) => void;
  onRerecord?: (attachmentId: string) => void;
}) {
  return (
    <div data-testid="staged-attachment-tray" className="mb-2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-raised)] px-2 py-2">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {attachments.map((attachment) => {
          const busy = attachment.status === "uploading" || attachment.status === "sending";
          const failed = attachment.status === "failed";
          const isVoice = attachment.kind === "voice";
          const isVideoMessage = attachment.kind === "video_message";
          return (
            <div
              key={attachment.id}
              data-testid="staged-attachment-item"
              className={cn(
                "relative flex min-w-[210px] shrink-0 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-2",
                isVideoMessage ? "min-w-[min(390px,calc(100vw-2rem))] max-w-[min(430px,calc(100vw-2rem))]" : isVoice ? "max-w-[320px]" : "max-w-[260px]"
              )}
            >
              {isVoice ? (
                <VoiceAttachmentPreview attachment={attachment} busy={busy} failed={failed} />
              ) : isVideoMessage ? (
                <VideoMessageAttachmentPreview chatId={chatId} attachment={attachment} busy={busy} failed={failed} />
              ) : (
                <>
                  <AttachmentThumb attachment={attachment} />
                  <div className="min-w-0 flex-1">
                    <AttachmentMeta attachment={attachment} failed={failed} />
                  </div>
                </>
              )}
              <div className="flex shrink-0 items-center gap-1">
                {(isVoice || isVideoMessage) && !busy && onRerecord && (
                  <button
                    type="button"
                    onClick={() => onRerecord(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover"
                    aria-label={isVideoMessage ? "Перезаписать видео-сообщение" : "Перезаписать голосовое"}
                    title="Перезаписать"
                  >
                    <KubIcon name={isVideoMessage ? "video" : "microphone"} size={15} />
                  </button>
                )}
                {failed && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover"
                    aria-label="Повторить отправку"
                    title="Повторить"
                  >
                    <KubIcon name="rotate" size={15} />
                  </button>
                )}
                {busy && onCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] kub-raise-hover"
                    aria-label="Отменить загрузку"
                    title="Отменить"
                  >
                    <KubIcon name="close" size={15} />
                  </button>
                ) : (
                  onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(attachment.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] kub-raise-hover"
                      aria-label="Убрать вложение"
                      title="Убрать"
                    >
                      <KubIcon name="close" size={15} />
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: StagedAttachment }) {
  const icon = attachment.kind === "image"
    ? "image"
    : attachment.kind === "video"
    ? "video"
    : attachment.kind === "audio" || attachment.kind === "voice"
    ? "voice"
    : "file";

  if (attachment.kind === "image" && attachment.previewUrl) {
    return (
      <img
        src={attachment.previewUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
        draggable={false}
      />
    );
  }

  if (attachment.kind === "video" && attachment.previewUrl) {
    return (
      <video
        src={attachment.previewUrl}
        data-testid="staged-regular-video-preview"
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
        muted
        playsInline
      />
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--kub-surface-3)] text-[color:var(--kub-cyan)]">
      <KubIcon name={icon} size={19} />
    </div>
  );
}

function VideoMessageAttachmentPreview({
  chatId,
  attachment,
  busy,
  failed,
}: {
  chatId: string;
  attachment: StagedAttachment;
  busy: boolean;
  failed: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const mediaPlayback = useChatMediaPlayback();
  const mediaPlaybackRef = useRef(mediaPlayback);
  const durationMs = attachment.durationMs ?? 0;
  const playbackItem = useMemo<ChatMediaPlaybackItem | null>(() => {
    if (!attachment.previewUrl) return null;
    return {
      id: attachment.id,
      chatId,
      kind: "video_message",
      url: attachment.previewUrl,
      title: "Видеосообщение",
      subtitle: "Предпросмотр перед отправкой",
      durationMs,
      isStaged: true,
    };
  }, [attachment.id, attachment.previewUrl, chatId, durationMs]);

  useEffect(() => {
    mediaPlaybackRef.current = mediaPlayback;
  }, [mediaPlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPause = () => setPlaying(false);
    const sync = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationMs / 1000;
      setProgress(duration > 0 ? Math.min(1, Math.max(0, video.currentTime / duration)) : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      if (playbackItem) mediaPlaybackRef.current.activate(playbackItem, video);
      sync();
    };
    const finish = () => {
      setPlaying(false);
      video.currentTime = 0;
      setProgress(0);
    };
    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    video.addEventListener("ended", finish);
    return () => {
      video.pause();
      mediaPlaybackRef.current.closeIfCurrent(attachment.id);
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("ended", finish);
    };
  }, [attachment.id, attachment.previewUrl, durationMs, playbackItem]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video || !playbackItem) return;
    if (!playing) setPlaying(true);
    mediaPlayback.toggle(playbackItem, video);
  };
  const activePlaying = mediaPlayback.isCurrent(attachment.id) ? mediaPlayback.isPlaying : playing;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        data-testid="staged-video-message-playback-toggle"
        onClick={toggle}
        disabled={!attachment.previewUrl || busy}
        className="relative h-40 w-40 shrink-0 overflow-visible rounded-full bg-black focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)] disabled:cursor-not-allowed disabled:opacity-70 sm:h-48 sm:w-48"
        aria-label={activePlaying ? "Пауза предпросмотра" : "Просмотреть видеосообщение"}
      >
        <VideoCircleProgressRing progress={mediaPlayback.isCurrent(attachment.id) ? mediaPlayback.progress : progress} testId="staged-video-message-progress-ring" />
        <span data-testid="staged-video-message-large-preview" className="absolute inset-0 overflow-hidden rounded-full">
          <span data-testid="staged-video-message-preview" className="absolute inset-0">
            {attachment.previewUrl ? (
              <video
                ref={videoRef}
                src={attachment.previewUrl}
                className="h-full w-full object-cover"
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white">
                <KubIcon name="video" size={18} />
              </div>
            )}
          </span>
        </span>
        <span className="absolute bottom-2 right-2 flex items-center justify-center rounded-full text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/65 backdrop-blur">
            <KubIcon name={activePlaying ? "pause" : "play"} size={16} />
          </span>
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-white backdrop-blur">
          {formatDurationLabel(durationMs)}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-[color:var(--kub-text)]">Видео-сообщение</span>
          <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">
            {formatDurationLabel(durationMs)}
          </span>
        </div>
        <div className="mt-1 text-[12px] leading-snug text-[color:var(--kub-muted)]">
          Нажмите на круг, чтобы просмотреть перед отправкой.
        </div>
        <div className={cn("mt-1 truncate text-[12px] text-[color:var(--kub-muted)]", failed && "text-[color:var(--kub-danger-text)]")}>
          {attachment.error ?? attachmentStatusLabel(attachment.status)}
        </div>
        <StagedAttachmentTransferProgress attachment={attachment} />
      </div>
    </div>
  );
}

function AttachmentMeta({
  attachment,
  failed,
}: {
  attachment: StagedAttachment;
  failed: boolean;
}) {
  return (
    <>
      <div className="truncate text-xs font-medium text-[color:var(--kub-text)]">
        {attachment.name}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-[color:var(--kub-muted)]">
        <span className="shrink-0">
          {attachment.uncompressed
            ? `${formatAttachmentSize(attachment.size)} без сжатия`
            : attachment.optimized && attachment.originalSize && attachment.originalSize > attachment.size
            ? `${formatAttachmentSize(attachment.size)} после сжатия`
            : formatAttachmentSize(attachment.size)}
        </span>
        <span className="shrink-0">·</span>
        <span className={cn("truncate", failed && "text-[color:var(--kub-danger-text)]")}>
          {attachment.error ?? attachmentStatusLabel(attachment.status)}
        </span>
      </div>
      <StagedAttachmentTransferProgress attachment={attachment} />
    </>
  );
}

function VoiceAttachmentPreview({
  attachment,
  busy,
  failed,
}: {
  attachment: StagedAttachment;
  busy: boolean;
  failed: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const durationMs = attachment.durationMs ?? 0;
  const { settings } = useAudioSettings();

  useEffect(() => {
    void applyAudioOutputDevice(audioRef.current, settings.selectedOutputDeviceId);
  }, [attachment.previewUrl, settings.selectedOutputDeviceId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationMs / 1000;
      setProgress(duration > 0 ? Math.min(1, audio.currentTime / duration) : 0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const finish = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("ended", finish);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [durationMs, attachment.previewUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !attachment.previewUrl) return;
    if (playing) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  };

  return (
    <div data-testid="staged-voice-preview" className="flex min-w-0 flex-1 items-center gap-2">
      <audio ref={audioRef} src={attachment.previewUrl ?? undefined} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        disabled={!attachment.previewUrl || busy}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={playing ? "Пауза предпросмотра" : "Прослушать голосовое"}
      >
        <KubIcon name={playing ? "pause" : "play"} size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-[color:var(--kub-text)]">Голосовое</span>
          <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">
            {formatDurationLabel(durationMs)}
          </span>
        </div>
        <VoicePlaybackProgress progress={progress} />
        <div className={cn("mt-1 truncate text-[12px] text-[color:var(--kub-muted)]", failed && "text-[color:var(--kub-danger-text)]")}>
          {attachment.error ?? attachmentStatusLabel(attachment.status)}
        </div>
        <StagedAttachmentTransferProgress attachment={attachment} />
      </div>
    </div>
  );
}

function attachmentStatusLabel(status: StagedAttachment["status"]): string {
  if (status === "uploading") return "Загрузка…";
  if (status === "sending") return "Отправка…";
  if (status === "failed") return "Ошибка";
  if (status === "cancelled") return "Отменено";
  return "Готово к отправке";
}

function formatDurationLabel(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
