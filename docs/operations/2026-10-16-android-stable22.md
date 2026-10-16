# Android Stable 0.1.21

Owner: coordinator. Stage: published and verified. Product commit:
`75096aa30427fdf551fd0c3bdcb7d9eee7fbd5c5`, integrated onto main80e4069e without
merging the divergent root branch. No SQL reapply or package identity change.

## Published Artifact

- Android Stable0.1.21/build22, mandatory=false.
- APK7737623 bytes; SHA256
  `45beef75f557ef3d32409023142fec11f11fe8839146440b4e8f6c040b084f8d`.
- [Public APK](https://api.letscube.ru/releases/files/android/0.1.21/letscube-0.1.21.apk).
- Real completion: sw.js9a1685a2f8049cf7, Vite28.77s, Gradle40s.
- Original production signer/v2, canonical manifest, Firebase4/4, QA flagsfalse,
  logging none, embedded local bundle,35 eligible packaged files, APK/AAB web,
  configuration and native DEX parity, AAB signature pass. Known private inputs
  and common secret formats were scanned without exposing values.
- Server publication runs with exact RELEASE_ROOT, prior-catalog compare and
  rollback copy under the existing lock. Public manifest and streamed APK bytes
  were independently verified at2026-10-16T18:50:15.839Z. Previous0.1.20 APK and
  manifest remain. Rollback manifest is retained under the owned22 directory in
  the release root's .ops-backups; restore only against the known current hash.

## Actual Acceptance

Realme RMX3830, Android15, isolated owned QA package; ordinary path, no QA authority
flags. Production package/build20, its test namespace, CE/DE identities and user
list remained unchanged. A063 was excluded.

1. Ordinary rendered login, protocol1, Settings message choice, encrypted native
   readback, close/reopen persistence pass.
2. Three natural messages through the normal owned QA API exercise actual FCM.
   Readable sender/body and generic public lock-screen projection pass.
3. The OS card's original PendingIntent is sent once: exact action tuple,
   message route, visible row, read retirement and chat-scoped card removal pass.
4. Settings none is durably confirmed; a fresh real FCM card is generic and its
   original PendingIntent still routes/read-cleans correctly.
5. Separate rendered logout confirms signed-out UI, no native capability,
   authenticated EMPTY/protocol0 and no card. Independent DB observation:
   zero fresh recipient sessions, two new Android rows, zero enabled, choice none.
6. Three exact own canaries are soft-deleted using delete_messages_for_everyone;
   two temporary QA packages are removed. Sender sessions are closed locally.

The initial test host refused Android15 topResumedActivity; a later test assumed
one hardware BACK always means root chat list. Neither refusal is overwritten or
relabelled PASS. Accepted rich/none phases were retained, not replayed. Logout was
verified separately with rendered UI. Direct DELETE cleanup was refused and
read-only reconciliation found all three canaries unchanged; normal soft-delete
RPC then completed. No RLS bypass or direct SQL mutation was used.

## Web And Source

Binding/controller101/101 and release-tool9/9 pass on the main-based tree;
earlier native/crypto/omission and1440/390 both-theme Settings pixel evidence is
reused for unchanged inputs. Five staged own-tree aliases resolve. Independent
reviews cover source closure, receiver/consent/session and artifact input delta.

Single healthy product image75096aa3 has actual public/container JS+SW parity.
Entry index-C0XpxIEl.js SHA256
`e1c8beb4b1e1713a25509ec61afbbdfdf599d716f76e8a4cdfb912b47464d919`;
SW SHA256`4d56b86827c42968724e32e6d484dfbb6efb7d7c88038895b6614417d4b99160`.
Previous80e4069e image and entry are retained. Anonymous home/login smoke passes
at1440/390, dark/light: zero page errors and zero mutation requests, no personal
session, screenshots, traces or video.

## Boundaries And Next

This is not a physical SystemUI tap, all-OEM or all-platform native acceptance.
The cold observation proves process absence before sender Auth, not atomic absence
at dispatch. Locked-device OS policy, media/group cases, credential expiry and
long-session/OEM matrix remain separate D-335 acceptance work. SDK remains sole
refresh owner; uncertain or expired access falls back to generic, never a late
notification upgrade. Default remains none until explicit confirmed choice.

Windows/iOS native packages were not re-signed or republished in this Android
slice; shared web is deployed. Do not present this as completion of all backlog.
Next: item87's measured current-client opening/switch latency and bounded tester
media intake, plus the named D-335 matrix. Reuse accepted evidence.
