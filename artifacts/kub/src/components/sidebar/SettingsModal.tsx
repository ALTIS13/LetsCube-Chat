"use client";

import { Fragment, useId, useRef, useState, type ReactNode } from "react";
import type { Theme } from "@/hooks/useTheme";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useTheme } from "@/hooks/useTheme";
import { usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import { usePush } from "@/hooks/usePush";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { useIsAdmin, useIsManagerOrAdmin } from "@/hooks/useRole";
import { KubButton, KubIcon, KubModal, KubSwitch, type KubIconName } from "@/components/kub";
import { PhoneSection } from "./PhoneSection";
import { AudioSettingsSection } from "./AudioSettingsSection";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";
import { ReleaseDistributionSection } from "@/components/settings/ReleaseDistributionSection";
import { StorageSection } from "@/components/settings/StorageSection";
import { ProfileDecorationSection } from "@/components/settings/ProfileDecorationSection";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage, validateAvatarUploadImage } from "@/lib/mediaUpload";
import { cacheControlFor } from "@/lib/mediaCacheControl";
import { getBuildMetadata } from "@/lib/monitoring";
import { getVisibleReleaseVersion } from "@/lib/releaseVersionLabel";
import {
  audioSummary,
  decorationSummary,
  presenceHint,
  presenceSummary,
  pushStatusAction,
  pushStatusSummary,
  shouldShowCounter,
  themeSummary,
  visibleSettingsSections,
  type SettingsSectionId,
} from "@/lib/settingsRows";
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

/** The heavy sections, which stay unmounted until their row is opened. */
type DisclosureId = "phone" | "decoration" | "audio" | "application";

/**
 * The settings screen.
 *
 * It is one scrolling column of rows under quiet headings, not a set of tabs.
 * Four tabs held twelve controls between them, so whichever one a person landed
 * on looked almost empty while three quarters of the screen was behind a guess
 * about which tab owned what. Every row here states what it controls and what
 * it is currently set to on the same line.
 *
 * The four expensive sections — phone, decoration, audio, release — are
 * disclosures rather than always-drawn panels. That is not only density: each
 * of them reaches for something on mount (a query, an achievement fetch, the
 * device list), and under tabs none of them ran until you opened their tab.
 * Rendering the children only while a row is open keeps exactly that, and
 * closing a row unmounts it the way leaving a tab used to.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { currentUser, setCurrentUser } = useAppStore();
  const supabase = createClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const privacy = usePrivacyPreferences();
  const nativeAndroid = isNativeAndroid();
  const desktopWindows = isDesktopApp();
  const { settings: audioSettings } = useAudioSettings();
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
  const [openSections, setOpenSections] = useState<ReadonlySet<DisclosureId>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldPrefix = useId();
  const avatarInputId = `profile-avatar-input-${currentUser?.id ?? "self"}`;

  const toggleSection = (id: DisclosureId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      .upload(path, preparedFile, {
        contentType: preparedFile.type,
        upsert: false,
        cacheControl: cacheControlFor(path),
      });
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

  const pushAction = pushStatusAction(pushStatus, { nativeAndroid });
  const buildVersionLabel = getVisibleReleaseVersion(getBuildMetadata().version);
  const presenceExplanation = presenceHint(privacy.preferences.presenceVisible);

  const sectionContent: Record<SettingsSectionId, ReactNode> = {
    profile: (
      <SettingsGroup title="Профиль">
        <TextFieldRow
          idPrefix={fieldPrefix}
          field="name"
          icon="user"
          label="Имя"
          required
          value={fullName}
          onChange={setFullName}
          placeholder="Ваше имя"
          maxLength={PROFILE_LIMITS.fullNameMax}
        />
        <TextFieldRow
          idPrefix={fieldPrefix}
          field="username"
          icon="atSign"
          label="Никнейм"
          value={username}
          onChange={(value) => setUsername(normalizeUsername(value))}
          placeholder="буквы, цифры, точка, _"
          maxLength={PROFILE_LIMITS.usernameMax}
        />
        <TextFieldRow
          idPrefix={fieldPrefix}
          field="bio"
          icon="info"
          label="О себе"
          value={bio}
          onChange={setBio}
          placeholder="Несколько слов о себе"
          maxLength={PROFILE_LIMITS.bioMax}
        />
        {/* Phone verification is open to every account. The section used to be
            hidden behind `isAdmin` while the gateway and the database gates were
            administrator-only; all three had to be opened together, or the
            feature stayed unreachable. When the policy is off the gateway answers
            `disabled` and `PhoneSection` says so, so hiding the section is not
            what communicates that. */}
        <DisclosureRow
          id="phone"
          icon="phone"
          title="Телефон"
          open={openSections.has("phone")}
          onToggle={toggleSection}
        >
          <PhoneSection />
        </DisclosureRow>
        <DisclosureRow
          id="decoration"
          icon="crown"
          title="Оформление"
          value={decorationSummary(currentUser.profile_frame, currentUser.profile_background)}
          open={openSections.has("decoration")}
          onToggle={toggleSection}
        >
          <ProfileDecorationSection />
        </DisclosureRow>
      </SettingsGroup>
    ),

    notifications: (
      <SettingsGroup title="Уведомления">
        <SettingsRow
          icon={pushStatus === "active" ? "notifications" : "notificationsOff"}
          iconTone={pushStatus === "active" ? "accent" : "muted"}
          label="Push-уведомления"
          value={pushStatusSummary(pushStatus, { nativeAndroid, desktopWindows })}
        >
          {pushAction === "disable" && (
            <KubButton size="sm" variant="secondary" onClick={disablePush}>
              Выключить
            </KubButton>
          )}
          {pushAction === "enable" && (
            <KubButton size="sm" onClick={enablePush}>
              Включить
            </KubButton>
          )}
        </SettingsRow>
        {pushStatus !== "native_unavailable" && (
          <>
            <PreferenceSwitchRow
              label="Сообщения"
              checked={pushPreferences.message_push_enabled}
              disabled={loadingPreferences || pushStatus !== "active"}
              onChange={(value) => void setPushPreference("message_push_enabled", value)}
            />
            <PreferenceSwitchRow
              label="Задачи"
              checked={pushPreferences.task_push_enabled}
              disabled={loadingPreferences || pushStatus !== "active"}
              onChange={(value) => void setPushPreference("task_push_enabled", value)}
            />
            <PreferenceSwitchRow
              label="Приглашения"
              checked={pushPreferences.invite_push_enabled}
              disabled={loadingPreferences || pushStatus !== "active"}
              onChange={(value) => void setPushPreference("invite_push_enabled", value)}
            />
          </>
        )}
        {pushMessage && <RowNote>{pushMessage}</RowNote>}
      </SettingsGroup>
    ),

    privacy: (
      <SettingsGroup title="Конфиденциальность">
        <SettingsRow
          icon={privacy.preferences.presenceVisible ? "eye" : "eyeOff"}
          iconTone={privacy.preferences.presenceVisible ? "accent" : "muted"}
          label="Статус «в сети»"
          value={presenceSummary(privacy.preferences.presenceVisible)}
          hint={presenceExplanation}
        >
          <KubSwitch
            aria-label="Показывать, когда я в сети"
            checked={privacy.preferences.presenceVisible}
            disabled={privacy.loading}
            onCheckedChange={(next) => void privacy.setPresenceVisible(next)}
          />
        </SettingsRow>
        {privacy.error && (
          <RowNote tone="danger">Не удалось сохранить настройку. Попробуйте ещё раз.</RowNote>
        )}
      </SettingsGroup>
    ),

    application: (
      <SettingsGroup title="Приложение">
        <SettingsRow
          icon={resolvedTheme === "dark" ? "themeDark" : "themeLight"}
          iconTone="accent"
          label="Тема"
          value={themeSummary(theme, resolvedTheme)}
        >
          <div
            role="radiogroup"
            aria-label="Выбор темы"
            className="flex shrink-0 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-0.5"
          >
            {THEME_OPTIONS.map(({ value, label, icon }) => {
              const selected = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  title={label}
                  onClick={() => setTheme(value)}
                  className={cn(
                    // D-047: 36x32 before this. `kub-icon-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]` gives the radio the same
                    // 32px pointer floor and 44px touch floor as every other icon control.
                    "kub-icon-action h-8 w-9 rounded-md transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                    selected
                      ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                      : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                  )}
                >
                  <KubIcon name={icon} size={14} />
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <DisclosureRow
          id="audio"
          icon="microphone"
          title="Звук"
          value={audioSummary(audioSettings)}
          open={openSections.has("audio")}
          onToggle={toggleSection}
        >
          <AudioSettingsSection />
        </DisclosureRow>
        <DisclosureRow
          id="application"
          icon="cloud"
          title="Обновления"
          value={buildVersionLabel}
          open={openSections.has("application")}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            <ReleaseDistributionSection />
            {/* The section guards itself too; this keeps the spacer from being the
                one thing the browser build still renders here. */}
            {desktopWindows && <StorageSection />}
          </div>
        </DisclosureRow>
      </SettingsGroup>
    ),

    service: (
      <SettingsGroup title="Сервис">
        <button
          type="button"
          onClick={() => { onClose(); setLocation("/admin"); }}
          className={cn(
            ROW_GRID,
            "kub-interactive text-left transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          )}
        >
          <KubIcon name="shield" size={16} className="text-[color:var(--kub-pink)]" />
          <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 text-sm text-[color:var(--kub-text)]">Админ-панель</span>
            <span className="min-w-0 text-xs text-[color:var(--kub-muted)]">Пользователи, баны, мьюты</span>
          </span>
          <KubIcon name="chevronRight" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
        </button>
      </SettingsGroup>
    ),
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title="Настройки"
      icon={<KubIcon name="settings" size={16} />}
      size="xl"
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
      <div className="flex items-center gap-3 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-3 kub-grid-subtle sm:px-4">
        <div className="relative shrink-0">
          {uploadingAvatar ? (
            // Same 64px box as the avatar it stands in for. The old placeholder
            // was 96px against an 80px avatar, so starting an upload nudged the
            // whole header.
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]">
              <KubIcon name="spinner" size={22} className="text-[color:var(--kub-cyan)]" />
            </div>
          ) : (
            <UserAvatar user={currentUser} size="lg" />
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
              // D-047: 28x28 before this, and it is the only way to change the
              // picture on a phone.
              "kub-icon-action absolute -bottom-0.5 -right-0.5 h-7 w-7 cursor-pointer rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:brightness-95",
              "transition-transform duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] hover:scale-110",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
              uploadingAvatar && "pointer-events-none opacity-60",
            )}
            aria-label="Сменить фото"
            aria-disabled={uploadingAvatar}
          >
            <KubIcon name="camera" size={13} />
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

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">
            {currentUser.full_name ?? "Без имени"}
          </div>
          {currentUser.username && (
            <div className="truncate text-xs text-[color:var(--kub-muted)]">@{currentUser.username}</div>
          )}
        </div>

        {currentUser.avatar_url && (
          <KubButton
            variant="ghost"
            size="sm"
            onClick={handleRemoveAvatar}
            leftIcon={<KubIcon name="delete" size={12} />}
            className="shrink-0 text-[color:var(--kub-danger-text)]"
          >
            Удалить фото
          </KubButton>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)] sm:mx-4">
          {error}
        </div>
      )}

      <div className="pb-4">
        {visibleSettingsSections({ isStaff }).map((id) => (
          <Fragment key={id}>{sectionContent[id]}</Fragment>
        ))}
      </div>
    </KubModal>
  );
}

/**
 * Every row uses this grid, so the icons line up down the column and the
 * controls line up on the right whatever a row happens to carry. `min-h-11`
 * is the 44px a finger needs and, incidentally, the reason a scan down the
 * list is even.
 */
const ROW_GRID =
  "grid w-full min-w-0 grid-cols-[1.125rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 min-h-11 sm:px-4";

/**
 * Text fields keep the same icon column but fix the caption width, so the three
 * inputs start at the same x instead of each one beginning wherever its own
 * word ended.
 */
const FIELD_ROW_GRID =
  "grid w-full min-w-0 grid-cols-[1.125rem_5.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 min-h-11 sm:px-4";

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-3 pt-4 sm:px-4">
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        {title}
      </h3>
      <div className="overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise">
        {children}
      </div>
    </section>
  );
}

function RowIcon({ name, tone }: { name: KubIconName; tone: "accent" | "muted" }) {
  return (
    <KubIcon
      name={name}
      size={16}
      className={tone === "accent" ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"}
    />
  );
}

/**
 * A row: what it controls on the left, what it is set to beside it, the control
 * on the right. `hint` is for the rare fact a person cannot read off the value —
 * it is not a place to restate the label.
 */
function SettingsRow({
  icon,
  iconTone = "muted",
  label,
  value,
  hint,
  children,
}: {
  icon: KubIconName;
  iconTone?: "accent" | "muted";
  label: string;
  value?: string | null;
  hint?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className={ROW_GRID}>
      <RowIcon name={icon} tone={iconTone} />
      <div className="min-w-0">
        {/* Label and value share a line and wrap onto a second one only when the
            value is a sentence rather than a word — which is what the push status
            sometimes is. Nothing is truncated into meaninglessness to hold a line. */}
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="min-w-0 text-sm text-[color:var(--kub-text)]">{label}</span>
          {value && (
            <span className="min-w-0 text-xs text-[color:var(--kub-muted)]">{value}</span>
          )}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-snug text-[color:var(--kub-muted)]">{hint}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A profile field. The input *is* the value, so there is no card, no coloured
 * caption and no permanent counter — the counter appears only once the limit is
 * close enough to matter.
 */
function TextFieldRow({
  idPrefix,
  field,
  icon,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  required,
}: {
  idPrefix: string;
  field: "name" | "username" | "bio";
  icon: KubIconName;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
}) {
  const id = `${idPrefix}-${field}`;
  const counterVisible = shouldShowCounter(value.length, maxLength);
  return (
    <div className={FIELD_ROW_GRID}>
      <RowIcon name={icon} tone="muted" />
      <label
        htmlFor={id}
        className="min-w-0 truncate text-sm text-[color:var(--kub-text)]"
      >
        {label}
        {required && <span className="text-[color:var(--kub-danger-text)]"> *</span>}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        {counterVisible && (
          <span className="shrink-0 tabular-nums text-[12px] text-[color:var(--kub-muted)]">
            {value.length}/{maxLength}
          </span>
        )}
        <input
          id={id}
          data-testid={`settings-field-${field}`}
          type="text"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            // D-047: 232x36 before this. The input is its own box here - it
            // carries the border a finger aims at - so `kub-field` is the right
            // opt-in, and the rule's own requirement that the field fill the box
            // is satisfied by construction.
            "kub-field h-9 w-full min-w-0 rounded-lg border border-transparent bg-[var(--kub-surface)] px-2.5 text-sm text-[color:var(--kub-text)] outline-none",
            "placeholder:text-[color:var(--kub-muted)]",
            "transition-[border-color,box-shadow] duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          )}
        />
      </div>
    </div>
  );
}

function PreferenceSwitchRow({
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
    <div className={ROW_GRID}>
      <span aria-hidden="true" />
      <span className="min-w-0 truncate text-sm text-[color:var(--kub-text)]">{label}</span>
      <KubSwitch
        aria-label={`Push: ${label}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/**
 * A row that opens a section in place.
 *
 * The children are rendered only while it is open, which is what keeps the
 * expensive sections from doing their work when the screen is merely on screen.
 * Only `opacity` and `transform` move when the panel arrives, and both
 * durations come from the motion tokens, so reduced motion collapses them.
 */
function DisclosureRow({
  id,
  icon,
  title,
  value,
  open,
  onToggle,
  children,
}: {
  id: DisclosureId;
  icon: KubIconName;
  title: string;
  value?: string | null;
  open: boolean;
  onToggle: (id: DisclosureId) => void;
  children: ReactNode;
}) {
  const panelId = `settings-panel-${id}`;
  const buttonId = `settings-toggle-${id}`;
  return (
    <div>
      <button
        type="button"
        id={buttonId}
        data-testid={`settings-open-${id}`}
        aria-expanded={open}
        // Only while the panel exists: `aria-controls` pointing at an id that is
        // not in the document is a dangling reference, and the panel is not
        // rendered until the row is opened.
        aria-controls={open ? panelId : undefined}
        onClick={() => onToggle(id)}
        className={cn(
          ROW_GRID,
          "kub-interactive text-left transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
        )}
      >
        <RowIcon name={icon} tone={open ? "accent" : "muted"} />
        <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="min-w-0 text-sm text-[color:var(--kub-text)]">{title}</span>
          {value && <span className="min-w-0 text-xs text-[color:var(--kub-muted)]">{value}</span>}
        </span>
        <KubIcon
          name="chevronDown"
          size={14}
          className={cn(
            "shrink-0 text-[color:var(--kub-muted)] transition-transform duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)]",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          id={panelId}
          data-testid={`settings-section-${id}`}
          role="region"
          aria-label={title}
          className="kub-settings-panel border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-3 sm:px-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function RowNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-xs leading-snug sm:px-4",
        tone === "danger" ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]",
      )}
    >
      {children}
    </p>
  );
}
