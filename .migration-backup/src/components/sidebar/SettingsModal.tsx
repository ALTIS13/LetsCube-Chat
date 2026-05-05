"use client";

import { useState, useRef } from "react";
import { ArrowLeft, Camera, Check, Trash2, Phone, User, AtSign, Info, Loader2, Sun, Moon, Bell, BellOff } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useTheme } from "@/hooks/useTheme";
import { usePush } from "@/hooks/usePush";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { currentUser, setCurrentUser } = useAppStore();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const { status: pushStatus, enable: enablePush, disable: disablePush } = usePush();

  const [fullName, setFullName] = useState(currentUser?.full_name ?? "");
  const [username, setUsername] = useState(currentUser?.username ?? "");
  const [bio, setBio] = useState(currentUser?.bio ?? "");
  const [phone, setPhone] = useState(currentUser?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (!currentUser || !fullName.trim()) { setError("Имя обязательно"); return; }
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentUser.id)
      .select("*")
      .single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) setCurrentUser(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAvatarChange = async (file: File) => {
    if (!currentUser) return;
    setUploadingAvatar(true);
    const { data, error: upErr } = await supabase.storage
      .from("media")
      .upload(`avatars/${currentUser.id}`, file, { upsert: true });
    if (upErr) { setError(upErr.message); setUploadingAvatar(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", currentUser.id);
    setCurrentUser({ ...currentUser, avatar_url: publicUrl });
    setUploadingAvatar(false);
  };

  const handleRemoveAvatar = async () => {
    if (!currentUser) return;
    await supabase.from("profiles").update({ avatar_url: null }).eq("id", currentUser.id);
    setCurrentUser({ ...currentUser, avatar_url: null });
  };

  if (!currentUser) return null;

  return (
    <div className="fixed inset-0 z-50 flex"
      style={{ background: "var(--tg-bg)" }}>
      <div className="flex flex-col w-full max-w-lg mx-auto h-full"
        style={{ background: "var(--tg-sidebar)" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "var(--tg-header)" }}>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-accent)" }}>
            <ArrowLeft size={20} />
          </button>
          <span className="font-semibold text-sm flex-1" style={{ color: "var(--tg-text)" }}>Редактировать профиль</span>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
            style={{ background: saved ? "rgba(82,193,100,0.2)" : "var(--tg-accent)", color: saved ? "#52c164" : "#fff" }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saved ? "Сохранено!" : "Сохранить"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Avatar section */}
          <div className="flex flex-col items-center py-8 gap-3"
            style={{ background: "var(--tg-header)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="relative">
              <div className="relative">
                {uploadingAvatar ? (
                  <div className="w-24 h-24 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.1)" }}>
                    <Loader2 size={28} className="animate-spin" style={{ color: "var(--tg-accent)" }} />
                  </div>
                ) : (
                  <UserAvatar user={currentUser} size="xl" />
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                  style={{ background: "var(--tg-accent)" }}>
                  <Camera size={15} color="#fff" />
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); e.target.value = ""; }} />
            </div>

            <div className="text-center">
              <div className="font-semibold text-base" style={{ color: "var(--tg-text)" }}>
                {currentUser.full_name ?? "Без имени"}
              </div>
              {currentUser.username && (
                <div className="text-sm" style={{ color: "var(--tg-text-secondary)" }}>
                  @{currentUser.username}
                </div>
              )}
            </div>

            {currentUser.avatar_url && (
              <button onClick={handleRemoveAvatar}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors"
                style={{ color: "#ef4444" }}>
                <Trash2 size={12} />
                Удалить фото
              </button>
            )}
          </div>

          {/* Fields */}
          <div className="px-4 py-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider px-1 mb-3"
              style={{ color: "var(--tg-text-secondary)" }}>Личная информация</p>

            <Field
              icon={<User size={16} />}
              label="Имя"
              value={fullName}
              onChange={setFullName}
              placeholder="Ваше имя"
              required
            />
            <Field
              icon={<AtSign size={16} />}
              label="Имя пользователя"
              value={username}
              onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""))}
              placeholder="username (буквы, цифры, _)"
              hint="Люди смогут найти вас по @username"
            />
            <Field
              icon={<Info size={16} />}
              label="О себе"
              value={bio}
              onChange={setBio}
              placeholder="Несколько слов о себе"
              multiline
              hint={`${bio.length}/70`}
              maxLength={70}
            />
            <Field
              icon={<Phone size={16} />}
              label="Телефон"
              value={phone}
              onChange={setPhone}
              placeholder="+7 999 123 45 67"
              type="tel"
            />
          </div>

          {error && (
            <div className="mx-4 px-3 py-2 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
              {error}
            </div>
          )}

          {/* Appearance section */}
          <div className="px-4 py-4 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider px-1 mb-3"
              style={{ color: "var(--tg-text-secondary)" }}>Внешний вид</p>
            <div className="rounded-2xl overflow-hidden" style={{ background: "var(--tg-input)" }}>
              <div className="flex items-center gap-3 px-4 py-3">
                {theme === "dark" ? (
                  <Moon size={16} style={{ color: "var(--tg-accent)" }} />
                ) : (
                  <Sun size={16} style={{ color: "var(--tg-accent)" }} />
                )}
                <span className="flex-1 text-sm" style={{ color: "var(--tg-text)" }}>Тема</span>
                <div className="flex rounded-full p-0.5" style={{ background: "rgba(0,0,0,0.2)" }}>
                  {(["dark", "light"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setTheme(opt)}
                      className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                      style={{
                        background: theme === opt ? "var(--tg-accent)" : "transparent",
                        color: theme === opt ? "#fff" : "var(--tg-text-secondary)",
                      }}
                    >
                      {opt === "dark" ? "Тёмная" : "Светлая"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Notifications section */}
          <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider px-1 mb-3"
              style={{ color: "var(--tg-text-secondary)" }}>Уведомления</p>
            <div className="rounded-2xl overflow-hidden" style={{ background: "var(--tg-input)" }}>
              <div className="flex items-center gap-3 px-4 py-3">
                {pushStatus === "active" ? (
                  <Bell size={16} style={{ color: "var(--tg-accent)" }} />
                ) : (
                  <BellOff size={16} style={{ color: "var(--tg-text-secondary)" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: "var(--tg-text)" }}>
                    Push-уведомления
                  </div>
                  <div className="text-xs" style={{ color: "var(--tg-text-secondary)" }}>
                    {pushStatus === "unsupported" && "Браузер не поддерживает"}
                    {pushStatus === "denied" && "Заблокировано в настройках браузера"}
                    {pushStatus === "inactive" && "Получать уведомления, даже когда вкладка закрыта"}
                    {pushStatus === "active" && "Включены"}
                  </div>
                </div>
                {pushStatus === "active" ? (
                  <button onClick={disablePush}
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{ background: "rgba(255,255,255,0.08)", color: "var(--tg-text)" }}>
                    Выключить
                  </button>
                ) : pushStatus === "inactive" ? (
                  <button onClick={enablePush}
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{ background: "var(--tg-accent)", color: "#fff" }}>
                    Включить
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon, label, value, onChange, placeholder, hint, multiline, required, type, maxLength,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  required?: boolean;
  type?: string;
  maxLength?: number;
}) {
  const inputStyle = { color: "var(--tg-text)" } as React.CSSProperties;
  const commonProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    maxLength,
    className: "flex-1 bg-transparent text-sm outline-none",
    style: inputStyle,
  };

  return (
    <div className="rounded-2xl overflow-hidden mb-1" style={{ background: "var(--tg-input)" }}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 flex-shrink-0" style={{ color: "var(--tg-accent)" }}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs mb-1 flex items-center justify-between">
            <span style={{ color: "var(--tg-accent)" }}>
              {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
            </span>
            {hint && <span style={{ color: "var(--tg-text-secondary)" }}>{hint}</span>}
          </div>
          {multiline ? (
            <textarea {...commonProps} rows={3}
              className="flex-1 bg-transparent text-sm outline-none w-full resize-none"
              style={inputStyle} />
          ) : (
            <input {...commonProps} type={type ?? "text"} />
          )}
        </div>
      </div>
    </div>
  );
}
