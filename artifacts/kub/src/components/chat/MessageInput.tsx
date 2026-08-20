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
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";
import { CameraCaptureModal } from "./CameraCaptureModal";
import { VideoMessageRecorderModal } from "./VideoMessageRecorderModal";
import { useChatMediaPlayback, VideoCircleProgressRing, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { useAppStore } from "@/store/app.store";
import { useMuteState } from "@/hooks/useMuteState";
import { KubIcon, type KubIconName } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { applyAudioOutputDevice } from "@/lib/audioOutput";
import { formatReplyMessagePreview } from "@/lib/messagePreview";
import { DEFAULT_MEDIA_QUALITY, MEDIA_QUALITY_OPTIONS, type MediaQuality } from "@/lib/mediaQuality";
import { isNativeApp, microphonePermissionHelp } from "@/lib/platform/capabilities";
import { getMessengerLocationErrorMessage, getMessengerPosition } from "@/lib/platform/geolocation";
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

const DRAFT_PREFIX = "kub:draft:";
const draftKey = (chatId: string) => `${DRAFT_PREFIX}${chatId}`;
const MOBILE_RECORDER_LONG_PRESS_MS = 320;
const RECORDER_TAP_MOVE_PX = 10;
const RECORDER_LOCK_DRAG_PX = 72;

const EMOJI_PANEL = [
  "😀","😂","🥰","😎","🤔","😭","🔥","❤️","👍","👏",
  "🎉","🚀","💯","✨","🙏","😅","🤣","😊","😍","🥳",
  "😤","🤯","😱","🤩","😴","🥺","😇","🤗","😏","😬",
];

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
  mediaQuality?: MediaQuality;
  onMediaQualityChange?: (quality: MediaQuality) => void;
  onStageFiles?: (files: File[], source: "picker" | "paste" | "camera") => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRetryAttachment?: (attachmentId: string) => void;
  onCancelAttachment?: (attachmentId: string) => void;
  draftOverride?: { id: string; text: string } | null;
  focusRequestKey?: number;
  onFocusChange?: (focused: boolean) => void;
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
  mediaQuality = DEFAULT_MEDIA_QUALITY,
  onMediaQualityChange,
  onStageFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onCancelAttachment,
  draftOverride,
  focusRequestKey = 0,
  onFocusChange,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
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
    mode: "voice" | "video";
    locked: boolean;
  } | null>(null);
  const [lockDragProgress, setLockDragProgress] = useState(0);
  const voiceHold = useVoiceRecorder();
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const hasStagedVoice = attachments.some((item) => item.kind === "voice");
  const hasStagedVideoMessage = attachments.some((item) => item.kind === "video_message");
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
    setLockDragProgress(0);
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

  const stagePickedFiles = useCallback((fileList: FileList | null) => {
    if (!fileList?.length || !onStageFiles) return;
    const scopeToken = delayedAttachmentScopeTokenRef.current;
    if (!scopeToken || !composerSendScope.isActive(scopeToken)) return;
    delayedAttachmentScopeTokenRef.current = null;
    onStageFiles(Array.from(fileList), "picker");
    setShowAttach(false);
  }, [composerSendScope, onStageFiles]);

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

  const setActiveHoldRecorder = useCallback((mode: "voice" | "video") => {
    const next = { mode, locked: false };
    holdRecorderStateRef.current = next;
    setHoldRecorderState(next);
  }, []);

  const clearActiveHoldRecorder = useCallback(() => {
    holdRecorderStateRef.current = null;
    setHoldRecorderState(null);
    recorderPointerStartRef.current = null;
    recorderPointerDownAtRef.current = 0;
    setLockDragProgress(0);
  }, []);

  const lockActiveRecording = useCallback(() => {
    const current = holdRecorderStateRef.current;
    if (!current || current.locked) return;
    const next = { ...current, locked: true };
    holdRecorderStateRef.current = next;
    setHoldRecorderState(next);
    setLockDragProgress(1);
  }, []);

  const startVideoHoldRecording = useCallback(() => {
    if (hasStagedVideoMessage) {
      showAppAlert("Сначала отправьте или удалите текущее видеосообщение.", "Видеосообщение");
      return;
    }
    videoRecordingScopeTokenRef.current = composerSendScope.capture();
    videoHoldActiveRef.current = true;
    setActiveHoldRecorder("video");
    setVideoRecorderVariant("round");
    setVideoAutoStart(true);
    setVideoAutoAddOnStop(true);
    setShowVideoMessage(true);
    setShowAttach(false);
    setShowEmoji(false);
  }, [composerSendScope, hasStagedVideoMessage, setActiveHoldRecorder]);

  const stopVideoHoldRecording = useCallback(() => {
    if (!videoHoldActiveRef.current) return;
    setVideoStopSignal((value) => value + 1);
    clearActiveHoldRecorder();
  }, [clearActiveHoldRecorder]);

  const startVoiceHoldRecording = useCallback(async () => {
    if (hasStagedVoice) {
      showAppAlert("Сначала отправьте или удалите текущее голосовое сообщение.", "Голосовое сообщение");
      return;
    }
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
  }, [clearActiveHoldRecorder, composerSendScope, hasStagedVoice, setActiveHoldRecorder, voiceHold.start]);

  const stopVoiceHoldRecording = useCallback(async () => {
    if (!voiceHoldActiveRef.current) return;
    const scopeToken = voiceRecordingScopeTokenRef.current;
    voiceHoldActiveRef.current = false;
    setVoiceHoldActive(false);
    clearActiveHoldRecorder();
    const result = await voiceHold.stop();
    if (!scopeToken || !composerSendScope.isActive(scopeToken)) return;
    if (!result || result.blob.size === 0 || result.durationMs < 1000) {
      if (!result) voiceHold.cancel();
      showAppAlert("Запись слишком короткая или пустая.", "Голосовое сообщение");
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

  const stopLockedRecording = useCallback(() => {
    stopRecorderHold();
  }, [stopRecorderHold]);

  const finishRecorderPointerGesture = useCallback((shouldStop: boolean) => {
    const locked = holdRecorderStateRef.current?.locked === true;
    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = null;
    touchRecordingStartedRef.current = false;
    touchLongPressTriggeredRef.current = false;
    touchPointerMovedRef.current = false;
    recorderPointerStartRef.current = null;
    recorderPointerDownAtRef.current = 0;
    recorderPointerIdRef.current = null;
    if (shouldStop && !locked) stopRecorderHold();
    if (!locked) setLockDragProgress(0);
  }, [stopRecorderHold]);

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
    setLockDragProgress(0);
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

  const handleRecorderPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const startPoint = recorderPointerStartRef.current;
    if (!startPoint) return;
    const dx = event.clientX - startPoint.x;
    const dy = event.clientY - startPoint.y;
    const distance = Math.hypot(dx, dy);
    if (event.pointerType === "touch" && distance > RECORDER_TAP_MOVE_PX) {
      touchPointerMovedRef.current = true;
    }
    const draggedUp = startPoint.y - event.clientY;
    setLockDragProgress(Math.max(0, Math.min(1, draggedUp / RECORDER_LOCK_DRAG_PX)));
    if (!voiceHoldActiveRef.current && !videoHoldActiveRef.current) return;
    if (draggedUp >= RECORDER_LOCK_DRAG_PX) lockActiveRecording();
  }, [lockActiveRecording]);

  const handleRecorderPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const locked = holdRecorderStateRef.current?.locked === true;
    if (event.pointerType === "touch") {
      if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
      const recordingGesture =
        touchRecordingStartedRef.current ||
        touchLongPressTriggeredRef.current ||
        voiceHoldActiveRef.current ||
        videoHoldActiveRef.current;
      if (recordingGesture) {
        finishRecorderPointerGesture(!locked);
        return;
      }
      const elapsedMs = Date.now() - recorderPointerDownAtRef.current;
      const shouldToggleMode = elapsedMs < MOBILE_RECORDER_LONG_PRESS_MS && !touchPointerMovedRef.current;
      recorderPointerStartRef.current = null;
      recorderPointerDownAtRef.current = 0;
      recorderPointerIdRef.current = null;
      touchPointerMovedRef.current = false;
      touchLongPressTriggeredRef.current = false;
      setLockDragProgress(0);
      if (shouldToggleMode) toggleRecorderMode();
      return;
    }
    if (!locked) stopRecorderHold();
    recorderPointerStartRef.current = null;
    recorderPointerDownAtRef.current = 0;
    recorderPointerIdRef.current = null;
  }, [finishRecorderPointerGesture, stopRecorderHold, toggleRecorderMode]);

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
    if (holdRecorderStateRef.current?.locked !== true) stopRecorderHold();
  }, [stopRecorderHold]);

  const handleLocation = useCallback(() => {
    const scopeToken = composerSendScope.capture();
    setShowAttach(false);
    void (async () => {
      let position: Awaited<ReturnType<typeof getMessengerPosition>>;
      try {
        position = await getMessengerPosition();
      } catch (error) {
        if (!composerSendScope.isActive(scopeToken)) return;
        showAppAlert(getMessengerLocationErrorMessage(error), "Геолокация");
        return;
      }
      const { latitude, longitude } = position;
      await runComposerCompletionIfCurrent(composerSendScope, scopeToken, () => (
        onSend(`📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`)
      ));
    })();
  }, [composerSendScope, onSend]);

  const handleSend = useCallback(async () => {
    const sendToken = composerSendScope.capture();
    const currentText = textareaRef.current?.value ?? text;
    const trimmed = currentText.trim();
    if (!trimmed && !hasAttachments) return;
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
        textareaRef.current.style.height = "auto";
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
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [text, hasAttachments, onSend, isEditing, editingMessage, onEdit, setEditingMessage, chatId, composerSendScope]);

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
      if (!isAttachmentBusy && (hasText || hasAttachments)) void handleSend();
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

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

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
      <div className="flex-shrink-0 px-3 pb-3 pt-2 bg-[var(--kub-chat-bg)]">
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-[var(--kub-surface-2)] border border-[color:var(--kub-danger)]/30">
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
      <div className="flex-shrink-0 px-3 pb-3 pt-2 bg-[var(--kub-chat-bg)]">
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

  const attachItems: Array<{ icon: KubIconName; label: string; tone: string; action: () => void }> = [
    { icon: "image",   label: "Фото или видео", tone: "var(--kub-cyan)",   action: () => {
      delayedAttachmentScopeTokenRef.current = composerSendScope.capture();
      photoInputRef.current?.click();
    } },
    { icon: "file",    label: "Файл",            tone: "var(--kub-pink)",   action: () => {
      delayedAttachmentScopeTokenRef.current = composerSendScope.capture();
      fileInputRef.current?.click();
    } },
    { icon: "camera",  label: "Сделать фото",    tone: "var(--kub-danger)", action: () => {
      delayedAttachmentScopeTokenRef.current = composerSendScope.capture();
      setShowCamera(true);
      setShowAttach(false);
      setShowEmoji(false);
    } },
    { icon: "voice",   label: "Голосовое",       tone: "var(--kub-cyan)",   action: () => {
      if (hasStagedVoice) {
        showAppAlert("Удалите текущую запись или используйте «Перезаписать».", "Голосовое сообщение");
        return;
      }
      voiceRecordingScopeTokenRef.current = composerSendScope.capture();
      setShowVoice(true);
      setShowAttach(false);
      setShowEmoji(false);
    } },
    { icon: "video",   label: "Записать видео",   tone: "var(--kub-pink)",   action: () => {
      videoRecordingScopeTokenRef.current = composerSendScope.capture();
      setVideoRecorderVariant("regular");
      setVideoAutoStart(false);
      setVideoAutoAddOnStop(false);
      setShowVideoMessage(true);
      setShowAttach(false);
      setShowEmoji(false);
    } },
    { icon: "mapPin",  label: "Местоположение",  tone: "var(--kub-online)", action: handleLocation },
  ];

  return (
    <div className="flex-shrink-0 bg-[var(--kub-chat-bg)]">
      {showEmoji && (
        <div className="px-3 py-3 grid grid-cols-8 sm:grid-cols-10 gap-1 bg-[var(--kub-surface-2)] border-t border-[color:var(--kub-border-color)]">
          {EMOJI_PANEL.map((emoji) => (
            <button
              key={emoji}
              onClick={() => insertEmoji(emoji)}
              className="text-xl min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] transition-all hover:scale-125 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={(e) => { stagePickedFiles(e.target.files); e.target.value = ""; }} />
      <input ref={fileInputRef} type="file" multiple className="hidden"
        onChange={(e) => { stagePickedFiles(e.target.files); e.target.value = ""; }} />

      <CameraCaptureModal
        key={`camera:${chatId}`}
        open={showCamera}
        onClose={() => {
          if (!renderedDelayedAttachmentScopeToken || !composerSendScope.isActive(renderedDelayedAttachmentScopeToken)) return;
          delayedAttachmentScopeTokenRef.current = null;
          setShowCamera(false);
        }}
        onAddFile={(file) => stageCameraFile(file, renderedDelayedAttachmentScopeToken)}
      />
      <VideoMessageRecorderModal
        key={`video:${chatId}`}
        open={showVideoMessage}
        variant={videoRecorderVariant}
        mediaQuality={mediaQuality}
        autoStart={videoAutoStart}
        autoAddOnStop={videoAutoAddOnStop}
        stopSignal={videoStopSignal}
        locked={holdRecorderState?.mode === "video" && holdRecorderState.locked}
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
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
          <div className="mx-3 mb-2 rounded-2xl shadow-2xl relative z-20 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft">
            {attachItems.map(({ icon, label, tone, action }) => (
              <button
                key={label}
                onClick={action}
                type="button"
                className="flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-text)]"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${tone} 18%, transparent)`,
                    color: tone,
                  }}
                >
                  <KubIcon name={icon} size={15} tone="currentColor" />
                </div>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="px-3 pb-3 pt-2">
        {isEditing && editingMessage && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1 bg-[var(--kub-surface-2)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="edit" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">Редактирование</div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{editingMessage.content}</div>
            </div>
            <button
              onClick={exitEditMode}
              aria-label="Отменить редактирование"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {!isEditing && replyTo && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1 bg-[var(--kub-surface-2)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="reply" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[color:var(--kub-cyan)]">
                {replyTo.sender?.full_name ?? "Вы"}
              </div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{formatReplyMessagePreview(replyTo)}</div>
            </div>
            <button
              onClick={onCancelReply}
              aria-label="Отменить ответ"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <>
            {onMediaQualityChange && attachments.some((attachment) =>
              attachment.kind === "video" || attachment.kind === "video_message"
            ) && (
              <MediaQualitySelector value={mediaQuality} onChange={onMediaQualityChange} />
            )}
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

        {(modeFeedback || holdRecorderState) && (
          <div
            data-testid={holdRecorderState ? "composer-recording-lock-indicator" : "recorder-mode-feedback"}
            className="relative mb-2 flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]"
          >
            {holdRecorderState && (
              <div
                data-testid="composer-recording-lock-rail"
                className="pointer-events-none absolute bottom-full right-2 mb-2 flex flex-col items-center gap-1"
              >
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border shadow-lg backdrop-blur transition",
                    holdRecorderState.locked
                      ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_24%,var(--kub-surface))] text-[color:var(--kub-cyan)]"
                      : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-muted)]"
                  )}
                >
                  <KubIcon name={holdRecorderState.locked ? "check" : "lock"} size={14} />
                </div>
                <div className="relative h-16 w-1.5 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
                  <span
                    data-testid="composer-recording-lock-progress"
                    data-lock-progress={lockDragProgress.toFixed(2)}
                    className="absolute bottom-0 left-0 w-full rounded-full bg-[var(--kub-cyan)] transition-[height]"
                    style={{ height: `${Math.max(8, lockDragProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <span className={cn("h-2 w-2 rounded-full", holdRecorderState ? "animate-pulse bg-[var(--kub-danger)]" : "bg-[var(--kub-cyan)]")} />
            <span className="font-medium text-[color:var(--kub-text)]">
              {holdRecorderState
                ? holdRecorderState.locked
                  ? "Запись зафиксирована"
                  : "Проведите вверх, чтобы зафиксировать"
                : modeFeedback}
            </span>
            {holdRecorderState?.mode === "voice" && (
              <span className="ml-auto tabular-nums text-[color:var(--kub-cyan)]">
                {formatRecorderDuration(voiceHold.durationMs)}
              </span>
            )}
            {holdRecorderState?.mode === "voice" && holdRecorderState.locked && (
              <button
                type="button"
                data-testid="composer-locked-recording-stop"
                onClick={stopLockedRecording}
                className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--kub-danger)] px-2.5 text-[11px] font-semibold text-white transition hover:brightness-110"
              >
                <KubIcon name="pause" size={13} />
                Остановить
              </button>
            )}
          </div>
        )}

        <div className="flex items-end gap-1 rounded-2xl px-2 py-1 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
          <button
            onClick={() => { setShowAttach(!showAttach); setShowEmoji(false); }}
            className={cn(
              "flex-shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:text-[color:var(--kub-cyan)]",
              showAttach ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
            )}
            aria-label="Прикрепить"
          >
            <KubIcon name="attach" size={20} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder="Сообщение…"
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-base sm:text-sm leading-6 py-2 max-h-[140px] overflow-y-auto text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
          />

          <button
            onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); }}
            className={cn(
              "flex-shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:text-[color:var(--kub-cyan)]",
              showEmoji ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
            )}
            aria-label="Эмодзи"
          >
            <KubIcon name="smile" size={20} />
          </button>

          {hasText || hasAttachments ? (
            <button
              onClick={handleSend}
              disabled={isAttachmentBusy}
              className={cn(
                "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all",
                isAttachmentBusy
                  ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
                  : "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan hover:brightness-110"
              )}
              aria-label="Отправить"
            >
              {isAttachmentBusy ? (
                <KubIcon name="spinner" size={18} className="animate-spin" />
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
                "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all select-none touch-none",
                isAttachmentBusy
                  ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
                  : recorderMode === "video"
                  ? "bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)] hover:bg-[color-mix(in_srgb,var(--kub-pink)_26%,transparent)]"
                  : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
              )}
              aria-label={recorderMode === "video" ? "Видеосообщение" : "Голосовое"}
              title={recorderMode === "video" ? "Видеосообщение" : "Голосовое"}
            >
              <KubIcon name={recorderMode === "video" ? "video" : "microphone"} size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaQualitySelector({
  value,
  onChange,
  compact = false,
}: {
  value: MediaQuality;
  onChange: (quality: MediaQuality) => void;
  compact?: boolean;
}) {
  const selectedOption = MEDIA_QUALITY_OPTIONS.find((option) => option.value === value)
    ?? MEDIA_QUALITY_OPTIONS[1];

  return (
    <div
      data-testid="media-quality-selector"
      className={cn(
        "rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-2",
        !compact && "mb-2",
        compact && "bg-[var(--kub-surface)]",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
        <KubIcon name="video" size={13} />
        <span>Качество видео</span>
      </div>
      <div
        className="relative grid grid-cols-3 gap-1 px-1"
        role="radiogroup"
        aria-label="Качество загружаемого видео"
        data-testid="media-quality-track"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[16.67%] right-[16.67%] top-2.5 h-px bg-[var(--kub-border-color)]"
        />
        {MEDIA_QUALITY_OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`media-quality-option-${option.value}`}
              data-state={active ? "active" : "inactive"}
              onClick={() => onChange(option.value)}
              className={cn(
                "group relative z-[1] flex min-w-0 flex-col items-center gap-1 rounded-md px-1 pb-1 pt-0 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]",
                active
                  ? "text-[color:var(--kub-text)]"
                  : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-5 w-5 rounded-full border-2 transition-[border-color,background-color,box-shadow]",
                  active
                    ? "border-[color:var(--kub-cyan)] bg-[color:var(--kub-cyan)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--kub-cyan)_16%,transparent)]"
                    : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] group-hover:border-[color:var(--kub-cyan)]",
                )}
              />
              <span className="block max-w-full truncate text-[11px] font-semibold">{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1 px-1 text-center text-[10px] leading-4 text-[color:var(--kub-muted)]">
        {selectedOption.description}
      </p>
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
    <div data-testid="staged-attachment-tray" className="mb-2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-2">
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]"
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
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]"
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
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur">
          {formatDurationLabel(durationMs)}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-[color:var(--kub-text)]">Видео-сообщение</span>
          <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--kub-muted)]">
            {formatDurationLabel(durationMs)}
          </span>
        </div>
        <div className="mt-1 text-[11px] leading-snug text-[color:var(--kub-muted)]">
          Нажмите на круг, чтобы просмотреть перед отправкой.
        </div>
        <div className={cn("mt-1 truncate text-[11px] text-[color:var(--kub-muted)]", failed && "text-[color:var(--kub-danger)]")}>
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
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-[color:var(--kub-muted)]">
        <span className="shrink-0">
          {attachment.optimized && attachment.originalSize && attachment.originalSize > attachment.size
            ? `${formatAttachmentSize(attachment.size)} после сжатия`
            : formatAttachmentSize(attachment.size)}
        </span>
        <span className="shrink-0">·</span>
        <span className={cn("truncate", failed && "text-[color:var(--kub-danger)]")}>
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
          <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--kub-muted)]">
            {formatDurationLabel(durationMs)}
          </span>
        </div>
        <VoicePlaybackProgress progress={progress} />
        <div className={cn("mt-1 truncate text-[11px] text-[color:var(--kub-muted)]", failed && "text-[color:var(--kub-danger)]")}>
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
