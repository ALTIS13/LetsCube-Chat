# Offline Android Gallery

Owner: Codex coordinator. Stage: RELEASED at product `85025f59`, Android
Stable0.1.38/build39 and shared-web build `7d22d125aa0f30b1`. Base `b1196535`;
rollback38 retained, mandatory=false. Next: actual authenticated mounted large-
original receive/open/cold-reopen/save/hash journey and real Apple audio.
[Bounded plan and decisions](../superpowers/plans/2026-10-25-offline-gallery.md).

## Cause And Implementation

Stable38 can read cached originals, but native save still receives the HTTPS
source and requires another download. Cold object-backed rows also lose media
menu actions because a missing temporary URL was classified as plain text.

The managed URL registry now grants an exact Blob lease. Explicit native save
feeds <=256KiB chunks into one private <=32MiB/120s UUID staging session. Offsets,
actual stored length and SHA-256 are checked before the existing Android10+
MediaStore pending/commit transaction. No JS-supplied path/content URI, network
redirection or broad media-library permission is added. Abort/startup/lifecycle
cleanup is scoped to private owned files. Privacy retirement fences late writes;
admitted native finish is an explicit user copy, not a cache item erased at logout.

Viewer and menu use the cached original first. Old native APIs resolve an online
fallback lazily through the canonical signed-mode resolver, never raw columns.
Blob MIME wins; stable filename and known MIME travel from the message object
independently of current signed-URL availability. Original != preview.

Viewer save now shows an actual spinner and visible local pending/success/error
status, without relying on a global toast behind its portal or shifting the photo.
Success expires after3s, error after5s. No unrelated global layer is raised.

## Source And UI Evidence

- Final affected JS74/74, zero skips; TypeScript passes. Four limit/chunk/retirement/
  abort omission mutants fail as intended.
- Initial JVM22/22 and4 limit/hash mutants pass; final fix wave25/25, zero skips.
  Input-close deletion and same-process owner-lock recovery go RED before repair.
  A compiled forbidden-API linkage guard also goes RED, not physical Android proof.
- Actual mounted app cold viewer+menu4/4 at1440/390, both themes. Omitting the real
  viewer local-byte binding gives zero local finishes and fails. Final metadata/
  resolver repairs pass both affected dark-width cases again. No unchanged text-
  cache/native37 acceptance is replayed.
- Exact synthetic viewer UI8/8, inspected pending/result pixels1440/390 in both
  themes. Held append carries421785 original PNG bytes with exact SHA/filename;
  retirement aborts without finish or HTTPS fallback. Spinner/live status are
  painted while the viewer stays open; geometry stays within0.5px. No duplicate
  global toast, external request, popup, download or runtime error. One success
  expiry check passes; no repeated timing matrix or personal capture.

## Review Repairs

One independent integrated review found four gaps; one fix wave covers them with
genuine failing cases and green affected checks:

1. Android rejects `Files.getFileStore` under SELinux. Initialization now uses
   provider-supported attribute views and owned POSIX permissions, not mount
   inspection. [Android source](https://android.googlesource.com/platform/prebuilts/fullsdk/sources/+/refs/heads/androidx-constraintlayout-release/android-35/sun/nio/fs/LinuxFileSystemProvider.java).
2. Cleanup errors could skip owner-lock release; input-close errors could skip
   deletion. Those actions are independently attempted, preserving primary and
   suppressed failures without deleting an identity-mismatched replacement.
3. Old-bridge fallback used a raw/stale stored URL. It now lazily resolves that
   original through the existing mode-aware resolver and fences retirement after
   the await. Supported local export does not resolve/download unnecessarily.
4. A signed-only cold viewer lost its name and could label binary WebP/WebM as
   JPEG/MP4. Both actual viewer bindings carry filename/MIME/resolver; Blob MIME
   takes precedence over hints without re-encoding original bytes.

No new SQL, dependency, identity, signing policy or PC network change. This is
bounded source/privacy review, not a security certification.

## Release And Actual Native Acceptance

- Source `85025f59fc92568ed01473575c6114fee31664ad`, clean original-signer build:
  Vite37.75s/Gradle36s, embedded SW `0645a87d39019229`. Four Firebase values,
  QA flags false, APKv2, APK/AAB assets and native DEX parity pass. No remote
  `server.url`, client service-role credential or package identity change.
- APK7,833,977B SHA-256
  `611bea310c02c482b1f78add535790fabfc8021eb01fa7d8e262ae0d761215b7`;
  AAB7,468,556B SHA-256
  `39e18149513e5487161fd1d20e86b71274b5dcd2580c8a2222bee055613bb905`.
- Realme RMX3830 retained-data38->39 at13:06:28Z: exact installed APK, UID,
  firstInstall/data, guest foreground and fatal0 pass; no target clear/uninstall.
  Screen wake dismissed the swipe keyguard; the guarded PIN runner refused
  before entry. No credential or personal screen was captured.
- Actual gallery canary at13:10:40Z runs the real TS sender/managed registry in
  the installed WebView, calls the actual Capacitor plugin and reads actual
  owned MediaStore rows with WiFi/data OFF. A structured524,289B PNG travels in
  three chunks; a tiny valid8x8 WebM travels in one. Both readbacks have exact
  original bytes/SHA/MIME/size and IS_PENDING=0; image/video decoders accept them.
  Abort and deliberately wrong SHA publish no row. These are synthetic assets,
  not an authenticated received-message journey or large-camera codec matrix.
- Exact owned UUID rows and part files are absent after cleanup; temporary
  helper removed, original WiFi/data restored and normal MainActivity returned.
  Private helper first refused its min29 signature-verification default; a
  separate attempt explicitly verifies APKv2 as well as v3 without weakening
  the original-signer gate. Both failed attempts remain, no device effects.
- Stable39 publication/full public APK bytes pass13:12:57Z, mandatory=false;
  previous38 catalog/artifact retained. Six catalog highlights pass the actual
  parser. [Public APK](https://api.letscube.ru/releases/files/android/0.1.38/letscube-0.1.38.apk).
  AAB is retained locally, not submitted to a store.
- Coolify `gwkkl3aev33juahs4a1q7nkb` finished13:14:45Z. Exact sole-healthy
  image85025f59/public HTML/entry/SW bytes match at13:15:19Z. Old entry lacked
  `local_media_export_retired` and `localCapabilities`; the new public entry
  contains both and matches the running container at13:15:21Z. Native and web
  SW IDs differ because their build environments differ; each is bound to its
  own exact asset receipt. No Windows/Apple native binary was rebuilt.

## Remaining Boundaries

Native compilation, signer/Firebase/assets, installed WebView-to-plugin and
actual saved gallery bytes are accepted above. No authenticated
large-media journey, real Apple audio, broad OEM/codec matrix or killed-process
pending-gallery recovery is inferred. Files above32MiB keep ordinary online
export; no unlimited offline cache claim. Android before10 keeps its online
HTTPS/SAF path; local gallery requires10+. Generic documents/audio export and
the wider Task3 backlog remain separate.
