import type { NativePushResult, NativePushTokenRegistration } from "./nativePush";

type Handle = { remove(): Promise<void> };
interface RegistrationPlugin {
  addListener(name: "registration", callback: (token: { value: string }) => void): Promise<Handle>;
  addListener(name: "registrationError", callback: (error: unknown) => void): Promise<Handle>;
  register(): Promise<void>;
}

/** Own each handle as it arrives, including after timeout or a sibling rejection. */
export function waitForNativePushRegistration(
  push: RegistrationPlugin,
  registerToken: NativePushTokenRegistration,
  options: {
    schedule(callback: () => void): number;
    cancel(id: number): void;
    onError(error: unknown): NativePushResult;
  },
): Promise<NativePushResult> {
  return new Promise((resolve) => {
    const handles: Handle[] = [];
    let settled = false;
    let registering = false;
    const remove = (handle: Handle) => { void handle.remove().catch(() => undefined); };
    const own = (handle: Handle) => { if (settled) remove(handle); else handles.push(handle); };
    const finish = (result: NativePushResult) => {
      if (settled) return;
      settled = true;
      options.cancel(timeout);
      handles.splice(0).forEach(remove);
      resolve(result);
    };
    const timeout = options.schedule(() => finish({ status: "native_setup_missing", message: "Не удалось включить уведомления. Попробуйте ещё раз." }));
    Promise.all([
      push.addListener("registration", async (value) => {
        if (settled || registering) return;
        registering = true;
        try {
          const result = await registerToken(value.value);
          finish(result ?? { status: "native_active", message: "Push-уведомления Android включены для этого устройства." });
        } catch (error) { finish(options.onError(error)); }
      }).then(own),
      push.addListener("registrationError", (error) => finish(options.onError(error))).then(own),
    ]).then(() => { if (!settled) return push.register(); return undefined; })
      .catch((error) => finish(options.onError(error)));
  });
}
