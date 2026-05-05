"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Paperclip, Smile, Mic, Send, X, Reply, Pencil, Image as ImageIcon, FileText, Camera, MapPin } from "lucide-react";
import type { MessageWithSender } from "@/types/database";
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

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
  /** Called instead of onSend when an editing session is active. */
  onEdit?: (messageId: string, newContent: string) => Promise<void>;
  onSendVoice?: (blob: Blob, duration: number) => void;
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
  const { currentUser, addMessage, editingMessage, setEditingMessage } = useAppStore();
  const isEditing = editingMessage !== null && editingMessage.chat_id === chatId;
  // Holds the draft we had before entering edit-mode, so we can restore it on cancel.
  const preEditTextRef = useRef<string | null>(null);

  // ── Draft handling: load on chat switch, persist on every keystroke ─────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(draftKey(chatId));
    setText(saved ?? "");
    // Reset edit buffer on chat change.
    preEditTextRef.current = null;
    setEditingMessage(null);
  // We intentionally only run on chatId — text setter is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isEditing) return; // do not pollute draft with edit buffer
    if (text) localStorage.setItem(draftKey(chatId), text);
    else localStorage.removeItem(draftKey(chatId));
  }, [text, chatId, isEditing]);

  // ── Enter edit-mode: stash current draft, load message content ──────────
  useEffect(() => {
    if (!isEditing || !editingMessage) return;
    if (preEditTextRef.current === null) {
      preEditTextRef.current = text;
    }
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
    if (!currentUser) return;
    setUploading(true);
    setShowAttach(false);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${currentUser.id}/${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from("media").upload(path, file);
      if (error) { console.error("Upload error:", error); return; }
      const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const type = isImage ? "image" : isVideo ? "video" : "file";
      const { data: newMsg } = await supabase.from("messages").insert({
        chat_id: chatId,
        user_id: currentUser.id,
        type,
        media_url: publicUrl,
        content: file.name,
      }).select("*, sender:profiles!user_id(*), reactions(*)").single();
      if (newMsg) addMessage(chatId, newMsg as never);
      await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    } finally {
      setUploading(false);
    }
  }, [chatId, currentUser, supabase, addMessage]);

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
      // Clear the persisted draft for this chat.
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

  if (showVoice) {
    return (
      <div className="flex-shrink-0 px-3 pb-3 pt-2" style={{ background: "var(--tg-chat-bg)" }}>
        <VoiceRecorder
          onSend={(blob, dur) => { onSendVoice?.(blob, dur); setShowVoice(false); }}
          onCancel={() => setShowVoice(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex-shrink-0" style={{ background: "var(--tg-chat-bg)" }}>
      {/* Emoji panel */}
      {showEmoji && (
        <div className="px-3 py-3 grid grid-cols-10 gap-1"
          style={{ background: "var(--tg-input)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {EMOJI_PANEL.map((emoji) => (
            <button key={emoji} onClick={() => insertEmoji(emoji)}
              className="text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all hover:scale-125 active:scale-95">
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={photoInputRef} type="file" accept="image/*,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
      <input ref={fileInputRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />

      {/* Attach panel */}
      {showAttach && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
          <div className="mx-3 mb-2 rounded-2xl overflow-hidden shadow-xl relative z-20"
            style={{ background: "var(--tg-context-bg)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              { icon: ImageIcon, label: "Фото или видео", color: "#5288c1", action: () => photoInputRef.current?.click() },
              { icon: FileText,  label: "Файл",            color: "#7c5cbf", action: () => fileInputRef.current?.click() },
              { icon: Camera,    label: "Камера",          color: "#e53e3e", action: () => cameraInputRef.current?.click() },
              { icon: MapPin,    label: "Местоположение",  color: "#38a169", action: handleLocation },
            ].map(({ icon: Icon, label, color, action }) => (
              <button key={label} onClick={action}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors hover:bg-white/8"
                style={{ color: "var(--tg-text)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: color + "33" }}>
                  <Icon size={15} style={{ color }} />
                </div>
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {uploading && (
        <div className="mx-3 mb-1 text-xs px-3 py-1.5 rounded-xl" style={{ background: "var(--tg-input)", color: "var(--tg-text-secondary)" }}>
          Загрузка…
        </div>
      )}

      <div className="px-3 pb-3 pt-2">
        {/* Edit preview takes priority over reply */}
        {isEditing && editingMessage && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1"
            style={{ background: "var(--tg-input)", borderLeft: "2px solid var(--tg-accent)" }}>
            <Pencil size={13} style={{ color: "var(--tg-accent)", flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: "var(--tg-accent)" }}>Редактирование</div>
              <div className="text-xs truncate" style={{ color: "var(--tg-text-secondary)" }}>
                {editingMessage.content}
              </div>
            </div>
            <button onClick={exitEditMode} className="p-1 rounded-full hover:bg-white/10 flex-shrink-0"
              style={{ color: "var(--tg-text-secondary)" }}>
              <X size={13} />
            </button>
          </div>
        )}
        {/* Reply preview (hidden while editing) */}
        {!isEditing && replyTo && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1"
            style={{ background: "var(--tg-input)", borderLeft: "2px solid var(--tg-accent)" }}>
            <Reply size={13} style={{ color: "var(--tg-accent)", flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: "var(--tg-accent)" }}>
                {replyTo.sender?.full_name ?? "Вы"}
              </div>
              <div className="text-xs truncate" style={{ color: "var(--tg-text-secondary)" }}>
                {replyTo.content}
              </div>
            </div>
            <button onClick={onCancelReply} className="p-1 rounded-full hover:bg-white/10 flex-shrink-0"
              style={{ color: "var(--tg-text-secondary)" }}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-end gap-1 rounded-2xl px-2 py-1" style={{ background: "var(--tg-input)" }}>
          <button
            onClick={() => { setShowAttach(!showAttach); setShowEmoji(false); }}
            className="flex-shrink-0 p-2 rounded-full transition-colors mb-0.5"
            style={{ color: showAttach ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}
          >
            <Paperclip size={20} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Сообщение…"
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm leading-6 py-1.5 max-h-[140px] overflow-y-auto"
            style={{ color: "var(--tg-text)" }}
          />

          <button
            onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); }}
            className="flex-shrink-0 p-2 rounded-full transition-colors mb-0.5"
            style={{ color: showEmoji ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}
          >
            <Smile size={20} />
          </button>

          <button
            onClick={hasText ? handleSend : () => { setShowVoice(true); setShowEmoji(false); setShowAttach(false); }}
            className={cn("flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all mb-0.5", hasText ? "" : "hover:bg-white/10")}
            style={{ background: hasText ? "var(--tg-accent)" : "transparent", color: hasText ? "#fff" : "var(--tg-text-secondary)" }}
          >
            {hasText ? <Send size={17} className="ml-0.5" /> : <Mic size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}
