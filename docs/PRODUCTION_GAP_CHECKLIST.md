# Production Gap Checklist

Use this as the remaining gap tracker before native packaging and full
self-host cutover.

## Push

- [ ] Real push delivery QA on desktop browser.
- [ ] Real push delivery QA on installed PWA.
- [ ] Same-chat message grouping checked on target browsers.
- [ ] Task push checked.
- [ ] Invite push checked.
- [ ] Muted chat suppression checked.
- [x] Native push plan converted into schema/function proposal.

## Phone and auth

- [ ] SMS provider selected.
- [ ] SMS provider configured in Supabase Auth.
- [ ] Real phone OTP test completed.
- [x] Password recovery checked after domain change.
- [x] Auth callback checked after domain change.

## Privacy and support

- [x] Public `/privacy` and `/support` routes implemented without auth bypass.
- [x] Privacy policy covers accounts, messages, media, voice/video, explicit
  geolocation, recipients, retention principles and user rights.
- [x] Support schema/RLS/RPC migration rehearsed, backed up and applied.
- [x] Guest support gateway deployed with Yandex SmartCaptcha, HMAC guest
  sessions, origin validation and persistent rate limits.
- [x] Multi-role production RLS smoke passed, including masked contacts and
  atomic claim race.
- [x] Operator workspace and Notification Center support UX complete; local
  five-viewport browser QA passed.
- [x] Production browser QA passed after the frontend deployment.
- [ ] `support@app.letscube.ru` Mailcow mailbox and DNS delivery validated.
- [ ] Support attachment quarantine and malware scanning implemented.
- [ ] Retention/anonymization scheduler and restore drill completed.
- [ ] Russian legal review completed before mass release/store certification.

## Monitoring

- [ ] Sentry/self-host decision completed.
- [ ] DSN configured only in deployment env.
- [ ] Redaction verified in a safe QA event.

## Native packaging

- [x] Android Capacitor wrapper added.
- [x] Android debug APK tested.
- [ ] Android release signing configured outside repo.
- [ ] iOS Capacitor wrapper added.
- [ ] iOS TestFlight build tested.
- [x] Windows packaging technology selected: Tauri 2.
- [x] Windows updater-signed installer and physical cross-version update tested.
- [x] Windows Authenticode production build path fails closed without a signing identity.
- [ ] Windows installer signed with a real Authenticode publisher and SmartScreen checked.
- [ ] Windows sparse package identity/PFN and WNS client channel registration completed.
- [ ] Windows killed-process WNS delivery physically tested.
- [ ] Windows 10 22H2 and alternate Windows 11/WebView2 matrix completed.
- [~] Native Windows offline/long-session runner added; one-hour installed-package run pending.
- [ ] Deep links tested on all target platforms.
- [x] Native permissions copy reviewed.
- [ ] Store privacy metadata prepared.

## Infrastructure

- [ ] Self-host rehearsal completed.
- [x] Cloud-to-self-host data restore completed.
- [x] Storage migration verified.
- [x] Edge Functions deployed on self-hosted backend.
- [x] Cron jobs verified.
- [x] Backup job configured.
- [ ] Restore drill completed.
- [ ] Cutover plan approved.
- [ ] Rollback plan approved.

## Product polish

- [x] Club visual style pass.
- [ ] Mobile physical-device QA.
- [x] Long-session QA.
- [ ] Performance pass on low-end devices.
- [ ] Accessibility pass on high-traffic flows.
- [ ] Large-history message search and permission-aware people search by normalized verified phone.
