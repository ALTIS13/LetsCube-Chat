import { useCallback, useEffect, useState } from "react";
import { reportError } from "@/lib/monitoring";
import { isDesktopApp } from "@/lib/platform/desktop";
import {
  describeDesktopAutostartError,
  isDesktopAutostartAvailable,
  normalizeAutostartRequest,
  readDesktopAutostartState,
  setDesktopAutostart,
  toDesktopAutostartErrorCode,
  type DesktopAutostartRequest,
  type DesktopAutostartState,
} from "@/lib/platform/desktopAutostart";

/**
 * The Windows sign-in setting, read from the registry rather than remembered.
 *
 * Deliberately simpler than `useDesktopStorage`: there is no shared store here
 * because the two switches have exactly one mount, and no polling because the
 * registry does not change behind the panel's back within a session. What it
 * does have is a re-read on focus — a person who turns the entry off in the
 * Windows task manager typically comes straight back to this window, and the
 * switch has to be showing what Windows now says rather than what it last
 * wrote. That is the whole contract of this setting.
 */
export function useDesktopAutostart() {
  const [state, setState] = useState<DesktopAutostartState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const available = isDesktopApp() && isDesktopAutostartAvailable();

  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      setState(await readDesktopAutostartState());
      setErrorMessage(null);
    } catch (reason) {
      const code = toDesktopAutostartErrorCode(reason);
      setErrorMessage(describeDesktopAutostartError(code));
      reportError(reason instanceof Error ? reason : new Error(code), {
        category: "desktop_autostart",
        operation: "read",
      });
    }
  }, [available]);

  useEffect(() => {
    if (!available) return;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [available, refresh]);

  const apply = useCallback(
    async (request: DesktopAutostartRequest) => {
      if (!available) return false;
      setCommandPending(true);
      try {
        // The shell answers with what it read back, so the switches move to the
        // measured state and never to the requested one.
        setState(await setDesktopAutostart(normalizeAutostartRequest(request)));
        setErrorMessage(null);
        return true;
      } catch (reason) {
        const code = toDesktopAutostartErrorCode(reason);
        setErrorMessage(describeDesktopAutostartError(code));
        reportError(reason instanceof Error ? reason : new Error(code), {
          category: "desktop_autostart",
          operation: "write",
        });
        // A refused write leaves the registry wherever it actually is, which is
        // not necessarily where the switches are drawn.
        void refresh();
        return false;
      } finally {
        setCommandPending(false);
      }
    },
    [available, refresh],
  );

  if (!available) return null;
  return { state, errorMessage, commandPending, apply, refresh };
}
