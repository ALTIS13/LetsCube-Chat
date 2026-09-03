"use client";

import { useState, useRef } from "react";
import type { Theme } from "@/hooks/useTheme";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useTheme } from "@/hooks/useTheme";
import { usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import { usePush } from "@/hooks/usePush";
import { useIsAdmin, useIsManagerOrAdmin } from "@/hooks/useRole";
import { KubButton, KubIcon, KubModal, KubSwitch, type KubIconName } from "@/components/kub";
import { PhoneSection } from "./PhoneSection";
import { AudioSettingsSection } from "./AudioSettingsSection";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";
import { ReleaseDistributionSection } from "@/components/settings/ReleaseDistributionSection";
import { ProfileDecorationSection } from "@/components/settings/ProfileDecorationSection";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage, validateAvatarUploadImage } from "@/lib/mediaUpload";
import {
  PROFILE_LIMITS,
  normalizeFullName,
  normalizeUsername,
  validateFullName,
  validateUsername,
} from "@/lib/profileValidation";

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: KubIconName }> = [
  { value: "system", label: "Системная", icon: "themeSystem" },
  { value: "dark", label: "Тёмная", icon: "themeDark" },
  { value: "light", label: "Светлая", icon: "themeLight" },
];

type SettingsTab = "general" | "profile" | "audio" | "application";

const SETTINGS_TABS: ReadonlyArray<{ value: SettingsTab; label: string; icon: KubIconName }> = [
  { value: "general", label: "Главное", icon: "settings" },
  { value: "profile", label: "Профиль", icon: "user" },
  { value: "audio", label: "Звук", icon: "microphone" },
  { value: "application", label: "Приложение", icon: "cloud" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { currentUser, setCurrentUser } = useAppStore();
  const supabase = createClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const privacy = usePrivacyPreferences();
  const nativeAndroid = isNativeAndroid();
  const desktopWindows = isDesktopApp();
  const {
    status: pushStatus,
    preferences: pushPreferences,
    loadingPreferences,
    message: pushMessage,
    enable: enablePush,
    disable: disablePush,
    setPreference: setPushPreference,
  } = usePush();
  const isStaff = useIsManagerOrAdmin();
  const isAdmin = useIsAdmin();
  const [, setLocation] = useLocation();

  const [fullName, setFullName] = useState(currentUser?.full_name ?? "");
  const [username, setUsername] = useState(currentUser?.username ?? "");
  const [bio, setBio] = useState(currentUser?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputId = `profile-avatar-input-${currentUser?.id ?? "self"}`;

  const handleSave = async () => {
    if (!currentUser) return;
    const fullNameError = validateFullName(fullName);
    const usernameError = validateUsername(username, { allowReserved: isAdmin });
    if (fullNameError || usernameError) {
      setError(fullNameError ?? usernameError);
      return;
    }
    const cleanFullName = normalizeFullName(fullName);
    const cleanUsername = normalizeUsername(username);
    setSaving(true);
    setError(null);
    // Phone is intentionally NOT updated here — it lives in the
    // RLS-protected `profile_contacts` table and is managed by
    // `<PhoneSection />` below after OTP verification.
    const { data, error: err } = await supabase
      .from("profiles")
      .update({
        full_name: cleanFullName,
        username: cleanUsername || null,
        bio: bio.trim().slice(0, PROFILE_LIMITS.bioMax) || null,
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
    const preparedFile = await prepareAvatarImage(file);
    const preparedValidationError = validateAvatarUploadImage(preparedFile);
    if (preparedValidationError) {
      setError(preparedValidationError);
      setUploadingAvatar(false);
      return;
    }
    const path = avatarUploadPath("user", currentUser.id, preparedFile);
    const { data, error: upErr } = await supabase.storage
      .from("media")
      .upload(path, preparedFile, { contentType: preparedFile.type, upsert: false });
    if (upErr) { setError(mapPgError(upErr)); setUploadingAvatar(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    const { error: profileErr } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", currentUser.id);
    if (profileErr) { setError(mapPgError(profileErr)); setUploadingAvatar(false); return; }
    setCurrentUser({ ...currentUser, avatar_url: publicUrl });
    setUploadingAvatar(false);
  };

  const handleRemoveAvatar = async () => {
    if (!currentUser) return;
    setError(null);
    const { error: err } = await supabase
      .from("profiles")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", currentUser.id);
    if (err) {
      setError(prefixError("Не удалось удалить фото", err));
      return;
    }
    setCurrentUser({ ...currentUser, avatar_url: null });
  };

  if (!currentUser) return null;

  return (
    <KubModal
      open
      onClose={onClose}
      title="Настройки"
      icon={<KubIcon name="settings" size={16} />}
      size="xl"
      contentClassName="p-0"
      footer={activeTab === "profile" ? (
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
      ) : (
        <KubButton variant="secondary" onClick={onClose}>Закрыть</KubButton>
      )}
    >
      <div className="sticky top-0 z-10 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-3 sm:px-4">
        <div
          role="tablist"
          aria-label="Разделы настроек"
          className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--kub-bg)] p-1 sm:grid-cols-4"
        >
          {SETTINGS_TABS.map((tab) => {
            const active = tab.value === activeTab;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] sm:gap-1.5 sm:px-2 sm:text-xs",
                  active
                    ? "bg-[var(--kub-surface-3)] text-[color:var(--kub-text)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                )}
              >
                <KubIcon name={tab.icon} size={13} />
                <span className="min-w-0 truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {activeTab === "profile" && (
        <div role="tabpanel" aria-label="Профиль">
      <div className="flex flex-col items-center gap-4 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-4 py-4 kub-grid-subtle sm:flex-row sm:items-center sm:gap-5 sm:px-5">
        <div className="relative shrink-0">
          {uploadingAvatar ? (
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
              <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
            </div>
          ) : (
            <UserAvatar user={currentUser} size="xl" />
          )}
          <label
            htmlFor={avatarInputId}
            role="button"
            tabIndex={uploadingAvatar ? -1 : 0}
            onKeyDown={(event) => {
              if (uploadingAvatar) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={cn(
              "absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] transition-transform kub-glow-cyan hover:scale-110",
              uploadingAvatar && "pointer-events-none opacity-60",
            )}
            aria-label="Сменить фото"
            aria-disabled={uploadingAvatar}
          >
            <KubIcon name="camera" size={15} />
          </label>
          <input
            id={avatarInputId}
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAvatarChange(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="truncate text-base font-semibold text-[color:var(--kub-text)]">
            {currentUser.full_name ?? "Без имени"}
          </div>
          {currentUser.username && (
            <div className="truncate text-sm text-[color:var(--kub-muted)]">@{currentUser.username}</div>
          )}
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
            Фото и имя видят все, кому вы пишете.
          </p>
        </div>

        {currentUser.avatar_url && (
          <button
            onClick={handleRemoveAvatar}
            className="kub-button kub-interactive flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--kub-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)]"
          >
            <KubIcon name="delete" size={12} />
            Удалить фото
          </button>
        )}
      </div>

      <div className="px-4 py-4 sm:px-5">
        <SectionLabel>Личная информация</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
        <Field
          icon={<KubIcon name="user" size={16} />}
          label="Имя"
          value={fullName}
          onChange={setFullName}
          placeholder="Ваше имя"
          required
          hint={`${fullName.length}/${PROFILE_LIMITS.fullNameMax}`}
          maxLength={PROFILE_LIMITS.fullNameMax}
        />
        <Field
          icon={<KubIcon name="atSign" size={16} />}
          label="Имя пользователя"
          value={username}
          onChange={(v) => setUsername(normalizeUsername(v))}
          placeholder="никнейм (буквы, цифры, ., _)"
          hint={`${username.length}/${PROFILE_LIMITS.usernameMax}`}
          maxLength={PROFILE_LIMITS.usernameMax}
        />
        <div className="sm:col-span-2">
          <Field
            icon={<KubIcon name="info" size={16} />}
            label="О себе"
            value={bio}
            onChange={setBio}
            placeholder="Несколько слов о себе"
            multiline
            hint={`${bio.length}/${PROFILE_LIMITS.bioMax}`}
            maxLength={PROFILE_LIMITS.bioMax}
          />
        </div>
        </div>
      </div>

      {/* Phone verification is open to every account. The section used to be
          hidden behind `isAdmin` while the gateway and the database gates were
          administrator-only; all three had to be opened together, or the
          feature stayed unreachable. When the policy is off the gateway answers
          `disabled` and `PhoneSection` says so, so hiding the section is not
          what communicates that. */}
      <div className="border-t border-[color:var(--kub-border-color)] px-4 py-4 sm:px-5">
        <SectionLabel>Телефон</SectionLabel>
        <PhoneSection />
      </div>

      <div className="border-t border-[color:var(--kub-border-color)] px-4 py-4 sm:px-5">
        <SectionLabel>Оформление</SectionLabel>
        <ProfileDecorationSection />
      </div>
        </div>
      )}

      {activeTab === "audio" && (
      <div role="tabpanel" aria-label="Звук" className="px-4 py-4">
        <AudioSettingsSection />
      </div>
      )}

      {activeTab === "profile" && error && (
        <div className="mx-4 px-3 py-2 rounded-xl text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}

      {activeTab === "general" && (
      <div role="tabpanel" aria-label="Главное" className="px-4 py-4">
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
      )}

      {activeTab === "application" && (
      <div role="tabpanel" aria-label="Приложение" className="px-4 py-4">
        <SectionLabel>Приложение</SectionLabel>
        <ReleaseDistributionSection />
      </div>
      )}

      {activeTab === "application" && isStaff && (
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

      {activeTab === "general" && (
      <div className="px-4 pb-4">
        <SectionLabel>Конфиденциальность</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
            <KubIcon
              name={privacy.preferences.presenceVisible ? "eye" : "eyeOff"}
              size={16}
              className={
                privacy.preferences.presenceVisible
                  ? "text-[color:var(--kub-cyan)]"
                  : "text-[color:var(--kub-muted)]"
              }
            />
            <div className="min-w-0">
              <div className="text-sm text-[color:var(--kub-text)]">Показывать, когда я в сети</div>
              <div className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {privacy.preferences.presenceVisible
                  ? "Собеседники видят точку «в сети» и время последнего входа"
                  : "Время последнего входа не сохраняется. Вас по-прежнему можно найти и написать вам"}
              </div>
            </div>
            <KubSwitch
              aria-label="Показывать, когда я в сети"
              checked={privacy.preferences.presenceVisible}
              disabled={privacy.loading}
              onCheckedChange={(next) => void privacy.setPresenceVisible(next)}
              className="justify-self-end"
            />
          </div>
          {privacy.error && (
            <div className="border-t border-[color:var(--kub-border-color)] px-4 py-2 text-xs text-[color:var(--kub-danger)]">
              Не удалось сохранить настройку. Попробуйте ещё раз.
            </div>
          )}
        </div>
      </div>
      )}

      {activeTab === "general" && (
      <div className="px-4 pb-4">
        <SectionLabel>Уведомления</SectionLabel>
        <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            {pushStatus === "active" ? (
              <KubIcon name="notifications" size={16} className="text-[color:var(--kub-cyan)]" />
            ) : (
              <KubIcon name="notificationsOff" size={16} className="text-[color:var(--kub-muted)]" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[color:var(--kub-text)]">Push-уведомления</div>
              <div className="text-xs text-[color:var(--kub-muted)]">
                {pushStatus === "unsupported" && "Браузер не поддерживает"}
                {pushStatus === "native_unavailable" && (
                  nativeAndroid
                    ? "Android push через Firebase/FCM"
                    : desktopWindows
                      ? "Системные уведомления, пока приложение запущено"
                      : "Системные уведомления пока настроены только для Android"
                )}
                {pushStatus === "denied" && (
                  nativeAndroid
                    ? "Заблокировано в настройках приложения Android"
                    : desktopWindows
                      ? "Заблокировано в настройках приложения Windows"
                      : "Заблокировано в настройках браузера"
                )}
                {pushStatus === "missing_vapid" && "Нужен VAPID public key в конфигурации"}
                {pushStatus === "migration_missing" && "Нужно обновление базы данных"}
                {pushStatus === "inactive" && "Получать уведомления, даже когда вкладка закрыта"}
                {pushStatus === "active" && "Включены"}
              </div>
            </div>
            {pushStatus === "active" ? (
              <div className="col-span-2 min-w-0 sm:col-span-1 sm:justify-self-end">
                <KubButton size="sm" variant="secondary" onClick={disablePush} className="w-full sm:w-auto">
                  Выключить
                </KubButton>
              </div>
            ) : pushStatus === "inactive" || (nativeAndroid && pushStatus === "native_unavailable") ? (
              <div className="col-span-2 min-w-0 sm:col-span-1 sm:justify-self-end">
                <KubButton size="sm" onClick={enablePush} className="w-full sm:w-auto">
                  Включить
                </KubButton>
              </div>
            ) : null}
          </div>
          <div className="min-w-0 border-t border-[color:var(--kub-border-color)] px-4 py-3 space-y-2">
            {pushStatus !== "native_unavailable" && (
              <>
                <PreferenceSwitch
                  label="Сообщения"
                  checked={pushPreferences.message_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("message_push_enabled", value)}
                />
                <PreferenceSwitch
                  label="Задачи"
                  checked={pushPreferences.task_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("task_push_enabled", value)}
                />
                <PreferenceSwitch
                  label="Приглашения"
                  checked={pushPreferences.invite_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("invite_push_enabled", value)}
                />
              </>
            )}
            {pushMessage && (
              <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
                {pushMessage}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
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
    <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
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

function PreferenceSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 w-full max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1">
      <span className="min-w-0 truncate pr-1 text-sm text-[color:var(--kub-text)]">{label}</span>
      <KubSwitch
        aria-label={`Push: ${label}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="justify-self-end"
      />
    </div>
  );
}
