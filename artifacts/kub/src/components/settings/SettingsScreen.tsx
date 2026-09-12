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
import { KubButton, KubIcon, KubSwitch, type KubIconName } from "@/components/kub";
import { PhoneSection } from "@/components/sidebar/PhoneSection";
import { AudioSettingsSection } from "@/components/sidebar/AudioSettingsSection";
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
  SETTINGS_SECTION_TITLES,
  audioSummary,
  decorationSummary,
  presenceHint,
  presenceSummary,
  pushStatusAction,
  pushStatusSummary,
  shouldShowCounter,
  themeSummary,
  visibleSettingsSections,
  type SettingsRowId,
  type SettingsSectionId,
} from "@/lib/settingsRows";
import {
  PROFILE_LIMITS,
  normalizeFullName,
  normalizeUsername,
  validateFullName,
  validateUsername,
} from "@/lib/profileValidation";

/**
 * The settings screen itself, with no container of its own.
 *
 * It used to be the body of `SettingsModal`, and that was fine while a dialog
 * was the only way to see it. Since D-160 there are two forms — the list
 * column's panel from `md`, and the dialog below it — and a screen that lives
 * inside one presentation cannot be rendered by the other without importing its
 * markup. So the state, the handlers and the rows moved here and both forms
 * take them from the same place, exactly as `useChatMessageSearch` is shared by
 * the two forms of in-chat search.
 *
 * Nothing about what a row *does* changed in the move: the same validation, the
 * same save, the same avatar upload, the same disclosures that stay unmounted
 * until opened. `visibleRows` is the only thing that is new, and `null` — which
 * is what the dialog passes — means "draw all of them", so the form that has no
 * search behaves exactly as it did.
 */

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: KubIconName }> = [
  { value: "system", label: "Системная", icon: "themeSystem" },
  { value: "dark", label: "Тёмная", icon: "themeDark" },
  { value: "light", label: "Светлая", icon: "themeLight" },
];

/** The heavy sections, which stay unmounted until their row is opened. */
type DisclosureId = "phone" | "decoration" | "audio" | "application";

export interface SettingsScreen {
  ready: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  isStaff: boolean;
  save: () => Promise<void>;
  body: (visibleRows: ReadonlySet<SettingsRowId> | null) => ReactNode;
  identity: ReactNode;
}

/**
 * All of the screen's state and every one of its rows.
 *
 * A hook rather than a component because both forms need the save button — the
 * dialog puts it in its footer, the column pins it under its own rows — and a
 * button that cannot see `saving` and `saved` is a button that lies.
 */
export function useSettingsScreen({ onClose }: { onClose: () => void }): SettingsScreen {
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

  if (!currentUser) {
    return {
      ready: false,
      saving: false,
      saved: false,
      error: null,
      isStaff: false,
      save: async () => {},
      body: () => null,
      identity: null,
    };
  }

  const pushAction = pushStatusAction(pushStatus, { nativeAndroid });
  const buildVersionLabel = getVisibleReleaseVersion(getBuildMetadata().version);
  const presenceExplanation = presenceHint(privacy.preferences.presenceVisible);

  const identity = (
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
  );

  const body = (visibleRows: ReadonlySet<SettingsRowId> | null): ReactNode => {
    const shows = (id: SettingsRowId) => visibleRows === null || visibleRows.has(id);

    const sectionContent: Record<SettingsSectionId, ReactNode> = {
      profile: (
        <SettingsGroup id="profile">
          {shows("name") && (
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
          )}
          {shows("username") && (
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
          )}
          {shows("bio") && (
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
          )}
          {/* Phone verification is open to every account. The section used to be
              hidden behind `isAdmin` while the gateway and the database gates were
              administrator-only; all three had to be opened together, or the
              feature stayed unreachable. When the policy is off the gateway answers
              `disabled` and `PhoneSection` says so, so hiding the section is not
              what communicates that. */}
          {shows("phone") && (
            <DisclosureRow
              id="phone"
              icon="phone"
              title="Телефон"
              open={openSections.has("phone")}
              onToggle={toggleSection}
            >
              <PhoneSection />
            </DisclosureRow>
          )}
          {shows("decoration") && (
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
          )}
        </SettingsGroup>
      ),

      notifications: (
        <SettingsGroup id="notifications">
          {shows("push") && (
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
          )}
          {pushStatus !== "native_unavailable" && (
            <>
              {shows("push-messages") && (
                <PreferenceSwitchRow
                  label="Сообщения"
                  checked={pushPreferences.message_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("message_push_enabled", value)}
                />
              )}
              {shows("push-tasks") && (
                <PreferenceSwitchRow
                  label="Задачи"
                  checked={pushPreferences.task_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("task_push_enabled", value)}
                />
              )}
              {shows("push-invites") && (
                <PreferenceSwitchRow
                  label="Приглашения"
                  checked={pushPreferences.invite_push_enabled}
                  disabled={loadingPreferences || pushStatus !== "active"}
                  onChange={(value) => void setPushPreference("invite_push_enabled", value)}
                />
              )}
            </>
          )}
          {pushMessage && shows("push") && <RowNote>{pushMessage}</RowNote>}
        </SettingsGroup>
      ),

      privacy: (
        <SettingsGroup id="privacy">
          {shows("presence") && (
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
          )}
          {privacy.error && shows("presence") && (
            <RowNote tone="danger">Не удалось сохранить настройку. Попробуйте ещё раз.</RowNote>
          )}
        </SettingsGroup>
      ),

      application: (
        <SettingsGroup id="application">
          {shows("theme") && (
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
          )}
          {shows("audio") && (
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
          )}
          {shows("updates") && (
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
          )}
        </SettingsGroup>
      ),

      service: (
        <SettingsGroup id="service">
          {shows("admin") && (
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
          )}
        </SettingsGroup>
      ),
    };

    // A section whose every row was filtered out draws nothing — not an empty
    // heading over a blank strip, which is what a search that matched a section
    // title and none of its rows would otherwise leave behind.
    const sectionHasRows: Record<SettingsSectionId, boolean> = {
      profile: ["name", "username", "bio", "phone", "decoration"].some((id) => shows(id as SettingsRowId)),
      notifications: ["push", "push-messages", "push-tasks", "push-invites"].some((id) => shows(id as SettingsRowId)),
      privacy: shows("presence"),
      application: ["theme", "audio", "updates"].some((id) => shows(id as SettingsRowId)),
      service: shows("admin"),
    };

    return visibleSettingsSections({ isStaff })
      .filter((id) => sectionHasRows[id])
      .map((id) => <Fragment key={id}>{sectionContent[id]}</Fragment>);
  };

  return {
    ready: true,
    saving,
    saved,
    error,
    isStaff,
    save: handleSave,
    body,
    identity,
  };
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

function SettingsGroup({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  return (
    <section className="px-3 pt-4 sm:px-4" data-settings-section={id}>
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        {SETTINGS_SECTION_TITLES[id]}
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

/** The error banner both forms show above the rows. */
export function SettingsErrorNotice({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mx-3 mt-3 rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)] sm:mx-4">
      {error}
    </div>
  );
}
