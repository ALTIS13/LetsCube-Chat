"use client";

import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode } from "react";

import { KubIcon, KubTooltip, type KubIconName } from "@/components/kub";
import { AnchoredLayer } from "@/components/ui/AnchoredLayer";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import {
  DEFAULT_AUDIO_DEVICE_ID,
  settingsForProcessingMode,
  useAudioSettings,
} from "@/hooks/useAudioSettings";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import {
  setVoiceDeafened,
  setVoiceMuted,
  useVoiceCall,
  useVoiceSpeechRevoked,
} from "@/hooks/useVoiceCall";
import { supportsAudioOutputSelection } from "@/lib/audioOutput";
import {
  AUDIO_DEFAULT_INPUT_LABEL,
  AUDIO_DEFAULT_OUTPUT_LABEL,
  AUDIO_DEVICE_NAMES_NOTE,
  AUDIO_INPUT_LABEL,
  AUDIO_MODE_SEGMENTS,
  AUDIO_OUTPUT_LABEL,
  audioDeviceOptions,
} from "@/lib/audioSettingsSurface";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import type { BoxEdges } from "@/lib/messageMenuPlacement";
import { micControlWords } from "@/lib/micGate";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

/**
 * The bar at the foot of the chat list, in Discord's shape (tracker item 40).
 *
 * The owner, 2026-09-20: «кнопка мой профиль и настройки по сути дублируют
 * друг друга, тогда лучше перенять подход к интерфейсу от discord». Discord's
 * bar carries three separate things, and that is why nothing on it duplicates:
 *
 *  - **the face and the name** open a menu of their own — the person's own
 *    profile, and the way into editing it — rather than a second door into
 *    settings;
 *  - **the microphone and the headphones** are toggles, in place, each with a
 *    chevron that chooses the device. They work with no call at all, and the
 *    next call starts the way they were left (`lib/voiceSelfAudio.ts`);
 *  - **the gear** is the full settings.
 *
 * From `md` only, like the folder rail beside it: a phone has its bottom
 * navigation, and Discord's own phone app replaces this bar with a different
 * one (reference-clients §17.1).
 *
 * It spans the whole left region, rail and list, rather than the list alone,
 * and the reason is width rather than looks: the list can be dragged down to a
 * 66-point strip of faces, and a bar that narrow would have room for the face
 * and nothing else — the microphone, the one control a person reaches for mid
 * sentence, would be the first thing to go. Across the rail it keeps 139
 * points at the narrowest, which holds the face and both toggles.
 *
 * What was read rather than remembered, in Discord's web bundle, build 621195,
 * on 2026-09-28 (reference-clients §21): the chevrons are always there and a
 * right-click on either button opens the same menu; the gear goes straight to
 * the voice settings while a call is connected; the face's popout leads with
 * «Редактировать профиль», its header opens the full profile and copies the
 * username; and the panel says «В голосовом чате» under the name during a call.
 * Where ours differs, the reason is in §21.
 */

type PanelMenu = "identity" | "input" | "output";

/**
 * Where a menu opens: centred on what was pressed, and above the whole panel
 * rather than above the button, so the menu stands clear of the bar instead of
 * sitting on its top edge.
 */
function edgesOf(element: HTMLElement | null, panel: HTMLElement | null): BoxEdges | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  const top = panel ? Math.min(box.top, panel.getBoundingClientRect().top) : box.top;
  return { top, bottom: box.bottom, left: box.left, right: box.right };
}

export function UserPanel() {
  const currentUser = useAppStore((s) => s.currentUser);
  const openSettings = useAppStore((s) => s.openSettings);
  const openUserProfile = useAppStore((s) => s.openUserProfile);
  const call = useVoiceCall();
  const speechRevoked = useVoiceSpeechRevoked(call.channelId);
  const { settings, updateSettings } = useAudioSettings();
  const [menu, setMenu] = useState<{ kind: PanelMenu; anchor: BoxEdges } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const identityRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLButtonElement | null>(null);
  const outputRef = useRef<HTMLButtonElement | null>(null);
  const devices = useAudioDevices(menu?.kind === "input" || menu?.kind === "output");
  const outputSelectable = supportsAudioOutputSelection();

  if (!currentUser) return null;

  const inCall = call.phase === "joining" || call.phase === "connected" || call.phase === "reconnecting";
  // A moderator's silence holds the microphone for this call: the control is
  // shown and refused, as the capsule does it, and the line says whose it is.
  const micHeld = inCall && speechRevoked;
  const words = micControlWords({
    activation: settings.micActivation,
    muted: call.micMuted,
    held: false,
    talkKey: settings.micTalkKey,
  });
  const micLabel = micHeld ? "Модератор выключил ваш микрофон" : words.muteLabel;
  const deafenLabel = call.deafened ? "Включить звук" : "Заглушить звук";

  const refs: Record<PanelMenu, typeof identityRef> = { identity: identityRef, input: inputRef, output: outputRef };
  const toggleMenu = (kind: PanelMenu) => {
    if (menu?.kind === kind) {
      setMenu(null);
      return;
    }
    const anchor = edgesOf(refs[kind].current, panelRef.current);
    if (anchor) setMenu({ kind, anchor });
  };
  // Discord opens a button's device menu on a right-click of the button itself
  // as well as on its chevron — one menu, two ways in.
  const menuOnContext = (kind: PanelMenu) => (event: MouseEvent) => {
    event.preventDefault();
    toggleMenu(kind);
  };
  const closeMenu = (returnFocus = false) => {
    const kind = menu?.kind ?? null;
    setMenu(null);
    if (returnFocus && kind) refs[kind].current?.focus();
  };

  const name = currentUser.full_name?.trim() || currentUser.username || "Пользователь";
  const handle = currentUser.username ? `@${currentUser.username}` : null;
  // Discord's second line during a call is «В голосовом чате»; ours says it in
  // the words the call's own bar uses.
  const subtitle = call.phase === "connected" || call.phase === "reconnecting" ? "В разговоре" : handle;

  return (
    <div
      ref={panelRef}
      data-testid="user-panel"
      className="@container relative hidden shrink-0 border-t border-[color:var(--kub-rule)] md:block"
    >
      <div className="flex h-[3.25rem] items-center gap-1 px-2">
        <button
          ref={identityRef}
          type="button"
          onClick={() => toggleMenu("identity")}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "identity"}
          aria-label={`${name}. Управление профилем`}
          data-testid="user-panel-identity"
          className={cn(
            "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left transition-colors kub-raise-hover",
            FOCUS_RING_INSET,
            PRESS_SINK,
            menu?.kind === "identity" && "bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))]",
          )}
        >
          <UserAvatar user={currentUser} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight @max-[12rem]:hidden">
            <span className="truncate text-sm font-semibold text-[color:var(--kub-text)]" data-testid="user-panel-name">
              {name}
            </span>
            {subtitle && (
              <span className="truncate text-xs text-[color:var(--kub-muted)]" data-testid="user-panel-subtitle">
                {subtitle}
              </span>
            )}
          </span>
        </button>

        <AudioToggle
          icon={call.micMuted || micHeld ? "microphoneSlash" : "microphone"}
          silenced={call.micMuted || micHeld}
          label={micLabel}
          title={micHeld ? micLabel : words.muteTitle}
          disabled={micHeld}
          onPress={() => void setVoiceMuted(!call.micMuted)}
          onContextMenu={menuOnContext("input")}
          testId="user-panel-mute"
          chevron={{
            ref: inputRef,
            label: "Настройки ввода",
            open: menu?.kind === "input",
            onPress: () => toggleMenu("input"),
            testId: "user-panel-input-menu",
          }}
        />
        <AudioToggle
          icon={call.deafened ? "headphonesSlash" : "headphones"}
          silenced={call.deafened}
          label={deafenLabel}
          title={deafenLabel}
          onPress={() => void setVoiceDeafened(!call.deafened)}
          onContextMenu={outputSelectable ? menuOnContext("output") : undefined}
          testId="user-panel-deafen"
          chevron={outputSelectable ? {
            ref: outputRef,
            label: "Настройки вывода",
            open: menu?.kind === "output",
            onPress: () => toggleMenu("output"),
            testId: "user-panel-output-menu",
          } : null}
        />
        <KubTooltip label="Настройки">
          <button
            type="button"
            // Straight to the sound while a call is connected, as Discord's gear
            // goes to Voice & Video: that is the thing somebody in a call opens
            // settings for.
            onClick={() => openSettings(call.phase === "connected" ? "audio" : undefined)}
            aria-label="Настройки"
            data-testid="user-panel-settings"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] @max-[10rem]:hidden",
              FOCUS_RING_INSET,
              PRESS_SINK,
            )}
          >
            <KubIcon name="settings" size={18} />
          </button>
        </KubTooltip>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => closeMenu()} />
          <PanelMenuLayer anchor={menu.anchor} onClose={closeMenu} label={
            menu.kind === "identity" ? "Управление профилем" : menu.kind === "input" ? AUDIO_INPUT_LABEL : AUDIO_OUTPUT_LABEL
          }>
            {menu.kind === "identity" ? (
              <>
                {/* Discord's header: the face opens the whole profile, and the
                    username beside it can be copied — which is how somebody
                    is told who to search for. */}
                <div className="flex items-center gap-1 px-1.5 pb-1 pt-1.5" data-testid="user-panel-menu-identity">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      openUserProfile(currentUser.id, "named");
                    }}
                    aria-label={`Открыть профиль. ${name}`}
                    data-testid="user-panel-open-profile"
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left transition-colors kub-raise-hover",
                      FOCUS_RING_INSET,
                    )}
                  >
                    <UserAvatar user={currentUser} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{name}</span>
                      {handle && <span className="truncate text-xs text-[color:var(--kub-muted)]">{handle}</span>}
                    </span>
                    <KubIcon name="chevronRight" size={14} tone="muted" />
                  </button>
                  {handle && (
                    <KubTooltip label="Скопировать имя пользователя">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void copyWithFeedback(handle, {
                          success: "Имя пользователя скопировано",
                          error: "Не удалось скопировать",
                          key: "user-panel-username",
                        })}
                        aria-label="Скопировать имя пользователя"
                        data-testid="user-panel-copy-username"
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]",
                          FOCUS_RING_INSET,
                        )}
                      >
                        <KubIcon name="copy" size={15} />
                      </button>
                    </KubTooltip>
                  )}
                </div>
                <MenuRule />
                <MenuRow
                  icon="edit"
                  testId="user-panel-edit-profile"
                  onPress={() => {
                    closeMenu();
                    openSettings();
                  }}
                >
                  Редактировать профиль
                </MenuRow>
              </>
            ) : menu.kind === "input" ? (
              <>
                <MenuCaption>{AUDIO_INPUT_LABEL}</MenuCaption>
                {audioDeviceOptions(DEFAULT_AUDIO_DEVICE_ID, AUDIO_DEFAULT_INPUT_LABEL, devices?.inputs ?? []).map((device) => (
                  <MenuChoice
                    key={device.deviceId}
                    checked={settings.selectedInputDeviceId === device.deviceId}
                    onPress={() => updateSettings({ selectedInputDeviceId: device.deviceId })}
                    testId="user-panel-input-device"
                  >
                    {device.label}
                  </MenuChoice>
                ))}
                {devices?.namesHidden && <MenuNote>{AUDIO_DEVICE_NAMES_NOTE}</MenuNote>}
                <MenuRule />
                <MenuCaption>Обработка</MenuCaption>
                {AUDIO_MODE_SEGMENTS.filter((segment) => segment.selectable).map((segment) => (
                  <MenuChoice
                    key={segment.mode}
                    checked={settings.processingMode === segment.mode}
                    onPress={() => updateSettings(settingsForProcessingMode(segment.mode))}
                    testId="user-panel-processing"
                  >
                    {segment.label}
                  </MenuChoice>
                ))}
                <MenuRule />
                <SettingsLink onPress={() => { closeMenu(); openSettings("audio"); }} />
              </>
            ) : (
              <>
                <MenuCaption>{AUDIO_OUTPUT_LABEL}</MenuCaption>
                {audioDeviceOptions(DEFAULT_AUDIO_DEVICE_ID, AUDIO_DEFAULT_OUTPUT_LABEL, devices?.outputs ?? []).map((device) => (
                  <MenuChoice
                    key={device.deviceId}
                    checked={settings.selectedOutputDeviceId === device.deviceId}
                    onPress={() => updateSettings({ selectedOutputDeviceId: device.deviceId })}
                    testId="user-panel-output-device"
                  >
                    {device.label}
                  </MenuChoice>
                ))}
                <MenuRule />
                <SettingsLink onPress={() => { closeMenu(); openSettings("audio"); }} />
              </>
            )}
          </PanelMenuLayer>
        </>
      )}
    </div>
  );
}

/**
 * A toggle and, beside it, the chevron that chooses its device — one object,
 * as Discord draws it, so the pair reads as one control with two ends.
 *
 * The chevrons close before anything else as the panel narrows: a device is
 * chosen rarely and the toggle is pressed mid-sentence, and the settings
 * screen is one press away for the rare case.
 */
function AudioToggle({
  icon,
  silenced,
  label,
  title,
  disabled = false,
  onPress,
  onContextMenu,
  testId,
  chevron,
}: {
  icon: KubIconName;
  silenced: boolean;
  label: string;
  title: string;
  disabled?: boolean;
  onPress: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  testId: string;
  chevron: {
    ref: MutableRefObject<HTMLButtonElement | null>;
    label: string;
    open: boolean;
    onPress: () => void;
    testId: string;
  } | null;
}) {
  return (
    <span
      className={cn(
        "flex h-8 shrink-0 items-center rounded-lg transition-colors",
        // The silenced state is a fact about the person, so it is said by the
        // whole control and not only by its glyph — the way Discord tints the
        // pair red — and in the danger tone, which is what the capsule's glyph
        // already uses for the same two states.
        silenced && "bg-[color:color-mix(in_srgb,var(--kub-danger)_14%,transparent)]",
      )}
    >
      <KubTooltip label={title}>
        <button
          type="button"
          onClick={onPress}
          onContextMenu={onContextMenu}
          disabled={disabled}
          aria-pressed={silenced}
          aria-label={label}
          data-testid={testId}
          data-silenced={silenced ? "true" : "false"}
          // Shown and refused while a moderator holds the microphone, the way
          // the capsule and the bar say it.
          data-unavailable={disabled ? "true" : "false"}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors kub-raise-hover disabled:cursor-not-allowed",
            FOCUS_RING_INSET,
            PRESS_SINK,
          )}
        >
          <KubIcon name={icon} size={18} tone={silenced ? "danger" : "muted"} />
        </button>
      </KubTooltip>
      {chevron && (
        <button
          ref={chevron.ref}
          type="button"
          onClick={chevron.onPress}
          aria-haspopup="menu"
          aria-expanded={chevron.open}
          aria-label={chevron.label}
          title={chevron.label}
          data-testid={chevron.testId}
          className={cn(
            "flex h-8 w-4 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] @max-[15rem]:hidden",
            FOCUS_RING_INSET,
            PRESS_SINK,
            chevron.open && "text-[color:var(--kub-text)]",
          )}
        >
          <KubIcon name="chevronUp" size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * The menus the panel opens, above it.
 *
 * `AnchoredLayer` because the panel is at the bottom of the window and can be
 * as narrow as 139 points: a menu positioned inside it would be clipped by the
 * column, and the layer measures itself and opens where it fits. It takes the
 * keyboard when it opens and gives it back to what opened it on Escape.
 *
 * No perimeter: the covering glass is what separates it, as it does for the
 * caption's confirmation (item 42), and the sheet-edge count is a ratchet.
 */
function PanelMenuLayer({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: BoxEdges;
  label: string;
  onClose: (returnFocus?: boolean) => void;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    layerRef.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus();
  }, []);
  return (
    <AnchoredLayer
      anchor={anchor}
      prefer="above"
      layerRef={layerRef}
      role="menu"
      aria-label={label}
      data-kub-menu="true"
      data-testid="user-panel-menu"
      className="kub-glass-strong kub-menu-in z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl py-1"
    >
      {() => children}
    </AnchoredLayer>
  );
}

function MenuRow({
  icon,
  testId,
  onPress,
  children,
}: {
  icon: KubIconName;
  testId: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPress}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[color:var(--kub-text)] transition-colors kub-raise-hover",
        FOCUS_RING_INSET,
      )}
    >
      <KubIcon name={icon} size={16} tone="muted" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function MenuChoice({
  checked,
  onPress,
  testId,
  children,
}: {
  checked: boolean;
  onPress: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onPress}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors kub-raise-hover",
        FOCUS_RING_INSET,
        checked ? "text-[color:var(--kub-text)]" : "text-[color:var(--kub-muted)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <KubIcon name="check" size={14} tone="accent" />}
    </button>
  );
}

function SettingsLink({ onPress }: { onPress: () => void }) {
  return (
    <MenuRow icon="settings" testId="user-panel-audio-settings" onPress={onPress}>
      Настройки звука
    </MenuRow>
  );
}

function MenuCaption({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
      {children}
    </div>
  );
}

function MenuNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-1 text-xs leading-snug text-[color:var(--kub-muted)]">{children}</p>;
}

function MenuRule() {
  return <div className="my-1 border-t border-[color:var(--kub-rule)]" role="separator" />;
}
