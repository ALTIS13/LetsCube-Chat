"use client";

import { useState, useRef } from "react";
import type { Theme } from "@/hooks/useTheme";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useTheme } from "@/hooks/useTheme";
import { usePush } from "@/hooks/usePush";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { KubButton, KubIcon, KubModal, type KubIconName } from "@/components/kub";
import { PhoneSection } from "./PhoneSection";
import { AudioSettingsSection } from "./AudioSettingsSection";
import { cn } from "@/lib/utils";
import { mapPgError } from "@/lib/errors";
import { avatarUploadPath, validateAvatarImage } from "@/lib/mediaUpload";

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: KubIconName }> = [
  { value: "system", label: "Системная", icon: "themeSystem" },
  { value: "dark", label: "Тёмная", icon: "themeDark" },
  { value: "light", label: "Светлая", icon: "themeLight" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { currentUser, setCurrentUser } = useAppStore();
  const supabase = createClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { status: pushStatus, enable: enablePush, disable: disablePush } = usePush();
  const isStaff = useIsManagerOrAdmin();
  const [, setLocation] = useLocation();

  const [fullName, setFullName] = useState(currentUser?.full_name ?? "");
  const [username, setUsername] = useState(currentUser?.username ?? "");
  const [bio, setBio] = useState(currentUser?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (!currentUser || !fullName.trim()) { setError("Имя обязательно"); return; }
    setSaving(true);
    setError(null);
    // Phone is intentionally NOT updated here — it lives in the
    // RLS-protected `profile_contacts` table and is managed by
    // `<PhoneSection />` below (OTP / unverified-save flow).
    const { data, error: err } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentUser.id)
      .select("*")
      .single();
    setSaving(false);
    if (err) { setError(mapPgError(err)); return; }
    if (data) setCurrentUser(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAvatarChange = async (file: File) => {
    if (!currentUser) return;
    const validationError = validateAvatarImage(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    const path = avatarUploadPath("user", currentUser.id, file);
    const { data, error: upErr } = await supabase.storage
      .from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { setError(mapPgError(upErr)); setUploadingAvatar(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    const { error: profileErr } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", currentUser.id);
    if (profileErr) { setError(mapPgError(profileErr)); setUploadingAvatar(false); return; }
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
    <KubModal
      open
      onClose={onClose}
      title="Редактировать профиль"
      icon={<KubIcon name="user" size={16} />}
      size="lg"
      contentClassName="p-0"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Закрыть</KubButton>
          <KubButton
            onClick={handleSave}
            disabled={saving}
            loading={saving}
            variant={saved ? "secondary" : "primary"}
            leftIcon={!saving ? <KubIcon name="check" size={13} /> : undefined}
          >
            {saved ? "Сохранено" : "Сохранить"}
          </KubButton>
        </>
      }
    >
      <div className="flex flex-col items-center py-6 gap-3 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)] kub-grid-subtle">
        <div className="relative">
          {uploadingAvatar ? (
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
              <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
            </div>
          ) : (
            <UserAvatar user={currentUser} size="xl" />
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan"
            aria-label="Сменить фото"
          >
            <KubIcon name="camera" size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAvatarChange(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="text-center">
          <div className="font-semibold text-base text-[color:var(--kub-text)]">
            {currentUser.full_name ?? "Без имени"}
          </div>
          {currentUser.username && (
            <div className="text-sm text-[color:var(--kub-muted)]">
              @{currentUser.username}
            </div>
          )}
        </div>

        {currentUser.avatar_url && (
          <button
            onClick={handleRemoveAvatar}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full hover:bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] transition-colors text-[color:var(--kub-danger)]"
          >
            <KubIcon name="delete" size={12} />
            Удалить фото
          </button>
        )}
      </div>

      <div className="px-4 py-4 space-y-1">
        <SectionLabel>Личная информация</SectionLabel>
        <Field
          icon={<KubIcon name="user" size={16} />}
          label="Имя"
          value={fullName}
          onChange={setFullName}
          placeholder="Ваше имя"
          required
        />
        <Field
          icon={<KubIcon name="atSign" size={16} />}
          label="Имя пользователя"
          value={username}
          onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""))}
          placeholder="username (буквы, цифры, _)"
          hint="Люди смогут найти вас по @username"
        />
        <Field
          icon={<KubIcon name="info" size={16} />}
          label="О себе"
          value={bio}
          onChange={setBio}
          placeholder="Несколько слов о себе"
          multiline
          hint={`${bio.length}/70`}
          maxLength={70}
        />
      </div>

      <div className="px-4 py-4 border-t border-[color:var(--kub-border-color)]">
        <SectionLabel>Телефон</SectionLabel>
        <PhoneSection />
      </div>

      <div className="px-4 py-4 border-t border-[color:var(--kub-border-color)]">
        <SectionLabel>Звук</SectionLabel>
        <AudioSettingsSection />
      </div>

      {error && (
        <div className="mx-4 px-3 py-2 rounded-xl text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}

      <div className="px-4 py-4 mt-2 border-t border-[color:var(--kub-border-color)]">
        <SectionLabel>Внешний вид</SectionLabel>
        <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <KubIcon
                name={resolvedTheme === "dark" ? "themeDark" : "themeLight"}
                size={16}
                className="text-[color:var(--kub-cyan)]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[color:var(--kub-text)]">Тема</div>
                {theme === "system" && (
                  <div className="text-xs text-[color:var(--kub-muted)]">
                    Сейчас как в системе: {resolvedTheme === "dark" ? "тёмная" : "светлая"}
                  </div>
                )}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label="Выбор темы"
              className="flex rounded-lg p-0.5 mt-1 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]"
            >
              {THEME_OPTIONS.map(({ value, label, icon }) => {
                const selected = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                      selected
                        ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                        : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
                    )}
                  >
                    <KubIcon name={icon} size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {isStaff && (
        <div className="px-4 py-4 border-t border-[color:var(--kub-border-color)]">
          <SectionLabel>Сервис</SectionLabel>
          <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
            <button
              onClick={() => { onClose(); setLocation("/admin"); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-[var(--kub-surface-3)] transition-colors"
            >
              <KubIcon name="shield" size={16} className="text-[color:var(--kub-pink)]" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[color:var(--kub-text)]">Админ-панель</div>
                <div className="text-xs text-[color:var(--kub-muted)]">
                  Управление пользователями, банами и мьютами
                </div>
              </div>
              <KubIcon name="chevronRight" size={16} className="text-[color:var(--kub-muted)]" />
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-4 border-t border-[color:var(--kub-border-color)]">
        <SectionLabel>Уведомления</SectionLabel>
        <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
          <div className="flex items-center gap-3 px-4 py-3">
            {pushStatus === "active" ? (
              <KubIcon name="notifications" size={16} className="text-[color:var(--kub-cyan)]" />
            ) : (
              <KubIcon name="notificationsOff" size={16} className="text-[color:var(--kub-muted)]" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[color:var(--kub-text)]">Push-уведомления</div>
              <div className="text-xs text-[color:var(--kub-muted)]">
                {pushStatus === "unsupported" && "Браузер не поддерживает"}
                {pushStatus === "denied" && "Заблокировано в настройках браузера"}
                {pushStatus === "inactive" && "Получать уведомления, даже когда вкладка закрыта"}
                {pushStatus === "active" && "Включены"}
              </div>
            </div>
            {pushStatus === "active" ? (
              <KubButton size="sm" variant="secondary" onClick={disablePush}>
                Выключить
              </KubButton>
            ) : pushStatus === "inactive" ? (
              <KubButton size="sm" onClick={enablePush}>
                Включить
              </KubButton>
            ) : null}
          </div>
        </div>
      </div>
    </KubModal>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] px-1 mb-3 text-[color:var(--kub-cyan)]">
      {children}
    </p>
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
  const commonProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    maxLength,
    className: "flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)]",
  };

  return (
    <div className="rounded-xl overflow-hidden mb-1 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 flex-shrink-0 text-[color:var(--kub-cyan)]">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs mb-1 flex items-center justify-between">
            <span className="text-[color:var(--kub-cyan)] font-semibold">
              {label}{required && <span className="text-[color:var(--kub-danger)]"> *</span>}
            </span>
            {hint && <span className="text-[color:var(--kub-muted)]">{hint}</span>}
          </div>
          {multiline ? (
            <textarea {...commonProps} rows={3} className="flex-1 bg-transparent text-sm outline-none w-full resize-none text-[color:var(--kub-text)]" />
          ) : (
            <input {...commonProps} type={type ?? "text"} />
          )}
        </div>
      </div>
    </div>
  );
}
