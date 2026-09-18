import { KubNotice, KubSwitch } from "@/components/kub";
import { InfoHint } from "@/components/settings/InfoHint";
import { useDesktopAutostart } from "@/hooks/useDesktopAutostart";
import { isDesktopApp } from "@/lib/platform/desktop";
import {
  describeAutostartDisagreement,
  describeAutostartState,
  isDesktopAutostartAvailable,
  isStartMinimizedSwitchEnabled,
  isStartMinimizedSwitchOn,
} from "@/lib/platform/desktopAutostart";

/**
 * Whether LETSCUBE starts when Windows signs the person in, and whether that
 * launch opens a window.
 *
 * Renders nothing outside the Windows shell, and nothing inside a shell whose
 * bridge does not carry these two methods yet — a control that does nothing is
 * the defect this project spends most of its register on, and a browser has no
 * sign-in entry to talk about at all.
 *
 * **Drawn as a group of rows and not as a card**, which is why it looks unlike
 * the two cards it sits between. Two switches are a group of rows, and rule 11
 * of `docs/operations/interface-material.md` says a nested box inside a sheet
 * carries no perimeter: it is separated by a step of material, measured at 27
 * in the dark theme and 26 in the light. This is the vocabulary the sound
 * settings were rebuilt into, heading and `divide-y` included, and
 * `tests/unit/edge-vocabulary.test.mjs` refuses a new perimeter in that colour
 * by name — it went red on the first draft, which copied `StorageSection`'s
 * outline. `ReleaseDistributionSection` and `StorageSection` keep theirs for
 * now; the ratchet only moves downwards, and this section is not the commit
 * that takes them off.
 *
 * Laid out without a single viewport breakpoint, also on purpose. This block is
 * drawn inside the chat-list column, which the person drags between 260 and 540
 * points (`lib/desktopChatList.ts`), so no `sm:` can predict its width — that is
 * D-222, and the neighbouring `StorageSection` is one of its recorded
 * instances. The only fixed-width cell here is the switch, which cannot wrap,
 * and nothing in this block is a `rounded-full` box around text that can.
 */
export function WindowsStartupSection() {
  const autostart = useDesktopAutostart();

  if (!isDesktopApp() || !autostart || !isDesktopAutostartAvailable()) return null;

  const { state, errorMessage, commandPending, apply } = autostart;
  const disagreement = describeAutostartDisagreement(state);
  const minimizedAvailable = isStartMinimizedSwitchEnabled(state, commandPending);

  return (
    <section data-testid="desktop-autostart-card">
      {/* The explanation belongs to the block, so it hangs off the heading —
          the placement `InfoHint` itself documents for a letter-spaced section
          title. Put beside the row label instead, it wrapped onto a line of its
          own under «Запускать вместе с Windows», which is what the first
          capture at 1440 showed: a lone ⓘ floating under the label. */}
      <h4 className="mb-1.5 flex items-center gap-x-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        Запуск с Windows
        <InfoHint
          term="Запуск с Windows"
          text="Закрытое приложение не может зазвонить при входящем звонке и не должно. Если LETSCUBE запускается вместе с Windows, он уже работает — и звонок, и сообщение приходят сразу."
        />
      </h4>
      <div className="overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-[color:var(--kub-text)]">
              Запускать вместе с Windows
            </div>
            <div
              className="mt-0.5 text-xs leading-snug text-[color:var(--kub-muted)]"
              data-testid="desktop-autostart-summary"
            >
              {describeAutostartState(state)}
            </div>
          </div>
          <KubSwitch
            aria-label="Запускать LETSCUBE вместе с Windows"
            checked={Boolean(state?.enabled)}
            disabled={!state || commandPending}
            onCheckedChange={(next) => {
              void apply({ enabled: next, startMinimized: Boolean(state?.startMinimized) });
            }}
            data-testid="desktop-autostart-enabled"
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-[color:var(--kub-text)]">Сразу в трей, без окна</div>
            <div className="mt-0.5 text-xs leading-snug text-[color:var(--kub-muted)]">
              {state?.enabled
                ? "LETSCUBE запустится молча и будет ждать у часов — окно откроется по значку в трее."
                : "Доступно, когда включён запуск вместе с Windows."}
            </div>
          </div>
          <KubSwitch
            aria-label="Запускать сразу в трей, без окна"
            checked={isStartMinimizedSwitchOn(state)}
            disabled={!minimizedAvailable}
            onCheckedChange={(next) => {
              void apply({ enabled: true, startMinimized: next });
            }}
            data-testid="desktop-autostart-minimized"
          />
        </div>

        {disagreement && (
          <p
            className="px-3 py-2 text-xs leading-snug text-[color:var(--kub-danger-text)]"
            data-testid="desktop-autostart-disagreement"
          >
            {disagreement}
          </p>
        )}
      </div>

      {errorMessage && (
        <KubNotice
          tone="danger"
          className="mt-1.5 rounded-lg"
          role="alert"
          data-testid="desktop-autostart-error"
        >
          {errorMessage}
        </KubNotice>
      )}
    </section>
  );
}
