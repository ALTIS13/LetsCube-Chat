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
- [ ] Native push plan converted into schema/function proposal.

## Phone and auth

- [ ] SMS provider selected.
- [ ] SMS provider configured in Supabase Auth.
- [ ] Real phone OTP test completed.
- [ ] Password recovery checked after domain change.
- [ ] Auth callback checked after domain change.

## Monitoring

- [ ] Sentry/self-host decision completed.
- [ ] DSN configured only in deployment env.
- [ ] Redaction verified in a safe QA event.

## Native packaging

- [ ] Android Capacitor wrapper added.
- [ ] Android debug APK tested.
- [ ] Android release signing configured outside repo.
- [ ] iOS Capacitor wrapper added.
- [ ] iOS TestFlight build tested.
- [ ] Windows packaging technology selected.
- [ ] Windows signed installer tested.
- [ ] Deep links tested on all target platforms.
- [ ] Native permissions copy reviewed.
- [ ] Store privacy metadata prepared.

## Infrastructure

- [ ] Self-host rehearsal completed.
- [ ] Cloud-to-self-host data restore completed.
- [ ] Storage migration verified.
- [ ] Edge Functions deployed on self-hosted backend.
- [ ] Cron jobs verified.
- [ ] Backup job configured.
- [ ] Restore drill completed.
- [ ] Cutover plan approved.
- [ ] Rollback plan approved.

## Product polish

- [ ] Club visual style pass.
- [ ] Mobile physical-device QA.
- [ ] Long-session QA.
- [ ] Performance pass on low-end devices.
- [ ] Accessibility pass on high-traffic flows.
