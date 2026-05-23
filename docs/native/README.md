# Native Packaging Readiness

KUB is currently a web/PWA application. Native wrappers should be added only
after the web build, PWA behavior, browser push, auth redirects, camera,
microphone, media uploads, and multi-account QA remain stable.

This directory is a pre-native plan. It intentionally does not install
Capacitor, Electron, or Tauri, and it does not change production app logic.

## Recommended order

1. Keep the PWA baseline stable:
   - manifest and icons;
   - service worker update flow;
   - offline/reconnect banner;
   - browser push foundation;
   - no forced reloads.
2. Finish production infrastructure rehearsal:
   - self-host migration dry run;
   - backup/restore drill;
   - push delivery QA;
   - SMS provider setup or documented fallback.
3. Add Android Capacitor wrapper.
4. Add iOS Capacitor wrapper after Android permissions and deep links are
   proven.
5. Choose Windows packaging technology:
   - Tauri for smaller footprint and native shell;
   - Electron for fastest ecosystem and mature desktop APIs.
6. Add native push providers and platform-specific release signing.

## Documents

- [Android Capacitor plan](./ANDROID_CAPACITOR_PLAN.md)
- [iOS Capacitor plan](./IOS_CAPACITOR_PLAN.md)
- [Windows packaging plan](./WINDOWS_PACKAGING_PLAN.md)
- [Native push plan](./NATIVE_PUSH_PLAN.md)
- [Native permissions checklist](./NATIVE_PERMISSIONS_CHECKLIST.md)
- [Native QA checklist](./NATIVE_QA_CHECKLIST.md)

## Do not do yet

- Do not install native dependencies in this stage.
- Do not create platform projects in this stage.
- Do not hardcode production domains.
- Do not move service-role, VAPID private, SMS, signing, or store credentials
  into the repo.
- Do not change Supabase schema for native packaging unless a later task asks
  for a reviewed migration proposal.

## Reference docs

- Capacitor Android: https://capacitorjs.com/docs/android
- Capacitor iOS: https://capacitorjs.com/docs/ios
- Capacitor Push Notifications: https://capacitorjs.com/docs/apis/push-notifications
