"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import type { MessageWithSender } from "@/types/database";
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { useMuteState } from "@/hooks/useMuteState";
import { KubIcon, type KubIconName } from "@/components/kub";

const DRAFT_PREFIX = "kub:draft:";
const draftKey = (chatId: string) => `${DRAFT_PREFIX}${chatId}`;

const EMOJI_PANEL = [
  "😀","😂","🥰","😎","🤔","😭","🔥","❤️","👍","👏",
  "🎉","🚀","💯","✨","🙏","😅","🤣","😊","😍","🥳",
  "😤","🤯","😱","🤩","😴","🥺","😇","🤗","😏","😬",
];

interface MessageInputProps {
  chatId: string;
  replyTo: MessageWithSender | null;
  onCancelReply: () => void;
  onSend: (content: string) => void;
  onEdit?: (messageId: string, newContent: string) => Promise<void>;
  onSendVoice?: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  onTyping?: () => void;
}

export function MessageInput({ chatId, replyTo, onCancelReply, onSend, onEdit, onSendVoice, onTyping }: MessageInputProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasText = text.trim().length > 0;
  const supabase = createClient();
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const addMessage = useAppStore((s) => s.addMessage);
  const editingMessage = useAppStore((s) => s.editingMessage);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const isEditing = editingMessage !== null && editingMessage.chat_id === chatId;
  const muteState = useMuteState(chatId);
  const preEditTextRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!isEditing || !editingMessage) return;
    if (preEditTextRef.current === null) preEditTextRef.current = text;
    setText(editingMessage.content ?? "");
    setTimeout(() => textareaRef.current?.focus(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage?.id]);

  const exitEditMode = useCallback(() => {
    setEditingMessage(null);
    setText(preEditTextRef.current ?? "");
    preEditTextRef.current = null;
  }, [setEditingMessage]);

  const uploadAndSend = useCallback(async (file: File) => {
    if (!userId) return;
    setUploading(true);
    setShowAttach(false);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from("media").upload(path, file);
      if (error) { console.error("Upload error:", error); return; }
      const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const type = isImage ? "image" : isVideo ? "video" : "file";
      const { data: newMsg } = await supabase.from("messages").insert({
        chat_id: chatId,
        user_id: userId,
        type,
        media_url: publicUrl,
        content: file.name,
      }).select("*, sender:profiles!user_id(*), reactions(*)").single();
      if (newMsg) addMessage(chatId, newMsg as never);
      await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    } finally {
      setUploading(false);
    }
  }, [chatId, userId, supabase, addMessage]);

  const handleLocation = useCallback(() => {
    setShowAttach(false);
    if (!navigator.geolocation) { alert("Геолокация не поддерживается"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onSend(`📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`);
      },
      () => alert("Не удалось определить местоположение")
    );
  }, [onSend]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isEditing && editingMessage && onEdit) {
      await onEdit(editingMessage.id, trimmed);
      setEditingMessage(null);
      setText(preEditTextRef.current ?? "");
      preEditTextRef.current = null;
    } else {
      onSend(trimmed);
      setText("");
      if (typeof window !== "undefined") localStorage.removeItem(draftKey(chatId));
    }
    setShowEmoji(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [text, onSend, isEditing, editingMessage, onEdit, setEditingMessage, chatId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
    onTyping?.();
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

  if (showVoice) {
    return (
      <div className="flex-shrink-0 px-3 pb-3 pt-2 bg-[var(--kub-chat-bg)]">
        <VoiceRecorder
          onSend={async (blob, durMs, mime) => {
            try { await onSendVoice?.(blob, durMs, mime); }
            finally { setShowVoice(false); }
          }}
          onCancel={() => setShowVoice(false)}
        />
      </div>
    );
  }

  const attachItems: Array<{ icon: KubIconName; label: string; tone: string; action: () => void }> = [
    { icon: "image",   label: "Фото или видео", tone: "var(--kub-cyan)",   action: () => photoInputRef.current?.click() },
    { icon: "file",    label: "Файл",            tone: "var(--kub-pink)",   action: () => fileInputRef.current?.click() },
    { icon: "camera",  label: "Камера",          tone: "var(--kub-danger)", action: () => cameraInputRef.current?.click() },
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

      <input ref={photoInputRef} type="file" accept="image/*,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
      <input ref={fileInputRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />

      {showAttach && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
          <div className="mx-3 mb-2 rounded-2xl shadow-2xl relative z-20 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft">
            {attachItems.map(({ icon, label, tone, action }) => (
              <button
                key={label}
                onClick={action}
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

      {uploading && (
        <div className="mx-3 mb-1 text-xs px-3 py-1.5 rounded-xl bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          Загрузка…
        </div>
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
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{replyTo.content}</div>
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

          <button
            onClick={hasText ? handleSend : () => { setShowVoice(true); setShowEmoji(false); setShowAttach(false); }}
            className={cn(
              "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all",
              hasText
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan hover:brightness-110"
                : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
            )}
            aria-label={hasText ? "Отправить" : "Записать голосовое"}
          >
            {hasText ? <KubIcon name="send" size={18} className="ml-0.5" /> : <KubIcon name="microphone" size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}
