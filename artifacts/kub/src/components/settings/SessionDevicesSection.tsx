"use client";

import { KubNotice, KubSwitch } from "@/components/kub";
import type { SessionDevicesState } from "@/hooks/useSessionDevices";
import {
  SESSION_DEVICE_CALLS_HINT,
  SESSION_DEVICE_CALLS_LABEL,
  SESSION_DEVICE_CURRENT_LABEL,
  SESSION_DEVICE_EMPTY_HINT,
  SESSION_DEVICE_NO_CURRENT_HINT,
  describeLastSeen,
  describeUserAgent,
} from "@/lib/sessionDevices";
import { cn } from "@/lib/utils";

/**
 * Where this account is signed in, and which of those places may ring.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`. The rules are
 * `lib/sessionDevices.ts`, pure and covered by
 * `tests/unit/session-devices.test.mts`; the three database functions are
 * `hooks/useSessionDevices.ts`. What is here is the drawing.
 *
 * **Drawn as a group of rows and not as a card**, following
 * `WindowsStartupSection` next door: rule 11 of
 * `docs/operations/interface-material.md` says a nested box inside a sheet
 * carries no perimeter and is separated by a step of material instead, and
 * `tests/unit/edge-vocabulary.test.mjs` refuses a new perimeter in that colour
 * by name.
 *
 * **No viewport breakpoint anywhere**, also on purpose. This block renders
 * inside the chat-list column, which the person drags between 260 and 540
 * points, so no `sm:` can predict its width — that is D-222. The only fixed
 * cell is the switch, which cannot wrap.
 *
 * ## Two lines per device and then the switch, rather than one line
 *
 * The compact form — name on the left, switch on the right — was the first
 * draft and it loses the one word that matters. The switch on such a row is
 * unlabelled: its meaning would have to be carried by a sentence somewhere
 * above it, and a person scanning a list of devices reads the device names, not
 * the paragraph. So the device is a heading of its own and the switch keeps its
 * own words, «Принимать звонки», once per device. It is Telegram's own shape
 * for the same screen, and at 260 points it is the only one that does not put a
 * label and its control on opposite ends of a line.
 *
 * ## What is not here
 *
 * **«Завершить сеанс».** Telegram's list has it; this one does not, by the
 * migration's own decision — signing another device out is a security action
 * with its own failure modes, and what was asked for is the call switch. The
 * vocabulary for it does not exist in `lib/sessionDevices.ts` either, so adding
 * the button means writing the words on purpose.
 *
 * **The address is printed and goes no further.** `session_devices_list`
 * returns it because «where» is half of what makes such a list useful — the
 * same half Telegram shows — and this is the one screen entitled to it. It is
 * never to appear in a screenshot, a fixture or a report.
 *
 * ## The data belongs to the screen, not to this block
 *
 * `useSessionDevices` is called by `SettingsScreen` and handed down, which is
 * the shape `BlockedPeopleSection` next door already has and for the same
 * reason: the closed row prints the count, so the screen has to hold the list
 * whether or not anybody opens the disclosure. A hook of its own here would
 * give the row nothing to say until it had been opened once.
 */
export function SessionDevicesSection({
  devices,
  loading,
  failed,
  error,
  pending,
  onSetCalls,
}: Pick<SessionDevicesState, "devices" | "loading" | "failed" | "error" | "pending"> & {
  readonly onSetCalls: SessionDevicesState["setCalls"];
}) {
  const now = Date.now();
  const anyCurrent = devices.some((device) => device.isCurrent);

  return (
    <section data-testid="session-devices-card">
      <p className="mb-2 px-1 text-xs leading-snug text-[color:var(--kub-muted)]">
        {SESSION_DEVICE_CALLS_HINT}
      </p>

      {failed && error && (
        <KubNotice tone="danger" className="rounded-lg" role="alert" data-testid="session-devices-error">
          {error}
        </KubNotice>
      )}

      {!failed && devices.length === 0 && (
        <p
          className="px-1 text-xs leading-snug text-[color:var(--kub-muted)]"
          data-testid="session-devices-empty"
        >
          {loading ? "Загружаем…" : SESSION_DEVICE_EMPTY_HINT}
        </p>
      )}

      {devices.length > 0 && (
        <ul
          className="overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise"
          data-testid="session-devices-list"
        >
          {devices.map((device) => {
            const label = describeUserAgent(device.userAgent);
            return (
              <li
                key={device.sessionId}
                className="px-3 py-2.5"
                data-testid="session-device"
                data-current={device.isCurrent ? "true" : "false"}
                data-calls={device.callsEnabled ? "on" : "off"}
                data-pending={pending.has(device.sessionId) ? "true" : "false"}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="min-w-0 max-w-full text-sm font-medium text-[color:var(--kub-text)]"
                    // The whole string, for a device the patterns only half
                    // recognised. It is the reader's own and it never leaves
                    // this screen.
                    title={label.raw || undefined}
                    data-testid="session-device-title"
                  >
                    {label.title}
                  </span>
                  {device.isCurrent && (
                    // A chip with no perimeter: a tint over the material, the
                    // same form the call band's wash takes, so rule 1 is not
                    // broken by a second surface.
                    <span
                      className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--kub-accent-text)]"
                      data-testid="session-device-current"
                    >
                      {SESSION_DEVICE_CURRENT_LABEL}
                    </span>
                  )}
                </div>

                <div
                  className="mt-0.5 text-xs leading-snug text-[color:var(--kub-muted)]"
                  data-testid="session-device-meta"
                >
                  {describeLastSeen(device.refreshedAt, now)}
                  {device.ip ? ` · ${device.ip}` : ""}
                </div>

                {/* Only where nothing was recognised. A string somebody may
                    still recognise is worth more to them than «Неизвестное
                    устройство» alone, and a confident wrong name is worth
                    less than either. `break-all` because a user agent has no
                    spaces to break on in the places a narrow column needs. */}
                {label.kind === "unknown" && label.raw && (
                  <div
                    className="mt-0.5 break-all text-[11px] leading-snug text-[color:var(--kub-muted)]"
                    data-testid="session-device-raw"
                  >
                    {label.raw}
                  </div>
                )}

                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                  <span
                    className={cn(
                      "min-w-0 text-sm",
                      device.callsEnabled
                        ? "text-[color:var(--kub-text)]"
                        : "text-[color:var(--kub-muted)]",
                    )}
                  >
                    {SESSION_DEVICE_CALLS_LABEL}
                  </span>
                  <KubSwitch
                    aria-label={`${SESSION_DEVICE_CALLS_LABEL}: ${label.title}`}
                    checked={device.callsEnabled}
                    onCheckedChange={(next) => void onSetCalls(device.sessionId, next)}
                    data-testid="session-device-calls"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The state the migration designed for: an access token with no
          `session_id` claim, so nothing can be pointed at. The list is still
          exactly right and every switch still works, which is what this says
          instead of leaving an unexplained absence. */}
      {devices.length > 0 && !anyCurrent && (
        <p
          className="mt-2 px-1 text-xs leading-snug text-[color:var(--kub-muted)]"
          data-testid="session-devices-no-current"
        >
          {SESSION_DEVICE_NO_CURRENT_HINT}
        </p>
      )}
    </section>
  );
}
