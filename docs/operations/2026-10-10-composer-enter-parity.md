# Software Enter Parity, 2026-10-10

Resume: coordinator; source `6d8f2a55`; physical software-IME, web runtime and
Android Stable 0.1.16/build 17 accepted at 19:10 Moscow. Next: resume the pending
native-preview Task2 rendered Settings acceptance, then Task3 owned-QA lifecycle.
Unfinished native-preview feature commits are excluded.

## Observed Scope

The owner reports phone Enter works on iPhone but not Android. The existing
guard already leaves Enter to phones in portrait/landscape and respects IME
composition. The main message textarea supplied no `enterKeyHint`; the caption
unconditionally requested `send`, contradicting its newline policy. Both now
derive `enter`/`send` from that same `enterSendsHere()` decision. The bot's
separate one-line field is unchanged. A hint labels the keyboard action; it does
not replace the event/send guard.

On Realme's AOSP keyboard the simple offline baseline and caption-send fields
both already inserted a trusted line break. Caption nevertheless displayed a
send arrow; candidate displayed a newline arrow. That simple probe does not
reproduce the whole reported installed-app defect or prove installed iOS PWA.

## Accepted Evidence

- Actual TSX binding RED before the patch; focused tests then111/111, including
  six hint mutants and twelve member-mention mutants. Typecheck passes.
- Actual fictional app, Chromium/WebKit,1440/390,both themes:8 message plus8
  caption cases pass. Message Enter does not send; arrow sends both lines.
  Caption transport is not newly proven. Exact fictional pixels were inspected.
- Twelve additional message cases cover phone landscape, wide tablet and
  simulated standalone; these are browser fixtures, not physical iOS evidence.
- Independent source/harness review accepted both bindings. Mutation anchors
  sit outside expected failures; capture directories are exclusive.
- Android0.1.16/build17 built from `6d8f2a55`; web build `5d7beb3babccecd3`.
  APK7,630,747 bytes, SHA256
  `f8bc6becb7871f05fbfde7795a1f661a2b0058f490df5d8ef8c8223787fbc152`.
  Actual verifier accepts Firebase resources, canonical signature/package,
  non-debug status and approved permissions/exports.
- All35 APK web assets match build/sync bytes; two are explicitly generated
  Cordova shims. Actual compiled JS has both conditional hints.
- Twenty-two native/push inputs retain accepted fingerprint
  `fc09d0ed8ccc51a9aba5c07c74369f50dedf7a899d06065658b11e1866404307`.
  Prior accepted native evidence is reused; no new natural-FCM claim.
- Realme primary0.1.15/build16 APK backed up; same-package update to17 accepted
  without clear/logout, primary CE/DE directory IDs identical. Only owned QA14
  launched; canonical cold launch returned OK and displayed anonymous login.
  No personal chat was opened or captured; A063 untouched.

Private receipts contain hashes/counts/booleans, not credentials or bodies. The
separate React/WebView probe is a fictional offline app with no INTERNET and its
own QA package/signer. Its first mock POST ACK used an array for `.single()`,
causing a fixture error boundary. Corrected object ACK passes the same browser
assertion RED/GREEN, with two sends and retyping. An additional calibrated
packaging defect put backslashes in raw ZIP asset names; Windows extraction
normalized them, but Android returned 404 for the entry module. The repaired
offline APK retains the exact application JS, uses forward-slash entry names,
and passes five bounded ZIP checks/mutants. The failed artifacts remain private.
Do not substitute that harness for canonical APK acceptance.

The fictional full React app then boots on Realme WebView137/AOSP LatinIME.
Four physical checks pass: software Enter produces trusted `insertLineBreak`
with two lines and zero sends; typing the second line preserves it; the actual
send arrow sends once and clears the composer; retyping remains possible.
No Internet permission or personal account is used. This is not Gboard/Samsung,
authenticated production transport, installed iOS PWA or natural-FCM proof.

Both exact-owned QA packages are removed; current user is0 and ephemeral QA14
is absent. Explicit profile removal returned1 after automatic ephemeral removal;
read-only reconciliation confirmed absence without replaying removal. Primary
installed APK matches the candidate and CE/DE directory IDs remain unchanged.
The original full user-identity snapshot was not retained; no equality claim is
made for that missing snapshot. Only the owned profile was targeted.

## Web Runtime

The separately reviewed one-commit source range and43 own-tree aliases passed
before pushing main. The sole healthy running web container uses image
`l64kyyu1sysev2izzjjbizhe:6d8f2a55988bce9bb46b2606222485b04c740249`.
Public `/assets/index-DTX9uhpN.js` and the container's exact JS agree at SHA256
`bd9bfbf916a30387ee0e23e2d836e679fd5fd1d7a031de4b7e5b4348672c05a8`;
SW bytes agree at
`2f5b51e3930bb9c05951b17d101110b1cddbaa9c2e36e78cb8a39ccf16c524e3`.
Both compiled conditional hints are present and the old entry differs. This
accepts the shared web deployment, not new physical Windows/iOS acceptance.

## Publication Gate

Physical Enter/arrow, QA cleanup, Git source review and main image/content
readback are accepted. The exact APK is uploaded to its immutable owned staging
directory. The first publisher refused the staging-directory backup because it
was outside `/srv/letscube/releases/public`; read-only server reconciliation
confirmed no catalog backup or0.1.16 artifact was created and the old catalog's
SHA256 remained
`88127a6c15bf3dcbac0cd4b79360d9667130be74c68ae4854ef3408526b2fd60`.
Preserve the original failed publisher and diagnostics; no blind retry.

V2 received independent review and99/99 focused checks, including the actual
source confinement RED/GREEN and exclusive upload control. Explicit preparation
added `publisher-v2.sh` beside the original, without replacing it. Publication
then passed under the publisher's own lock, with exact old-catalog CAS and
byte-identical backup. Live read-only verification measured directory mode2700
(owner-only700 plus inherited setgid), file600 and both expected catalog hashes.

Android Stable is now0.1.16/build17, nonmandatory. Published catalog SHA256:
`57cfad83e5d56854b2e6ea08187fb58c76e92aca0fc0f942f78505c4aacec065`.
The complete public APK was downloaded and accepted by the real Android release
verifier, including unchanged package/signature and Firebase initialization.
[Public APK](https://api.letscube.ru/releases/files/android/0.1.16/letscube-0.1.16.apk).
The exact previous catalog is retained at
`/srv/letscube/releases/public/.ops-backups/android-0.1.16-build17-enter-parity-20261010/stable-before.json`.
The private reviewed helper's explicit `rollback` mode checks the current catalog
SHA under lock and restores those old bytes atomically; it has not been executed.
Immutable APK files remain, and installed apps are not downgraded by catalog
rollback. No SQL, store identity or certificate change occurred.
