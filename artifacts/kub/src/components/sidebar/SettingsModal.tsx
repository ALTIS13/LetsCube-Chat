"use client";

import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { SettingsErrorNotice, useSettingsScreen } from "@/components/settings/SettingsScreen";

/**
 * The settings screen as a dialog — below `md` only, since D-160.
 *
 * From `md` the screen is the list column's body (`SettingsPanel`), because at
 * those widths this dialog was 896px of centred sheet with 272px of dead margin
 * each side at 1440, blurring an application nobody had asked to leave. Below
 * `md` there is no column to move into: the shell is one pane, and `KubModal`'s
 * `mobileSheet` already makes this the full-screen sheet a phone should get. So
 * the dialog stays exactly as it was there.
 *
 * Everything it draws now comes from `useSettingsScreen`, which is the same
 * hook the column renders. `screen.body(null)` means "no filter" — the phone
 * has no search over the settings, and passing `null` is what keeps this form
 * byte-for-byte the screen it was.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const screen = useSettingsScreen({ onClose });

  if (!screen.ready) return null;

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
            onClick={() => void screen.save()}
            disabled={screen.saving}
            loading={screen.saving}
            variant={screen.saved ? "secondary" : "primary"}
            leftIcon={!screen.saving ? <KubIcon name="check" size={13} /> : undefined}
          >
            {screen.saved ? "Сохранено" : "Сохранить"}
          </KubButton>
        </>
      }
    >
      {screen.identity}
      <SettingsErrorNotice error={screen.error} />
      <div className="pb-4">{screen.body(null)}</div>
    </KubModal>
  );
}
