# Offline Android Gallery

Owner: Codex coordinator. Stage: reviewed source repairs complete; candidate39
not built/installed/published yet. Base `b1196535`; public Stable38 stays intact.
Next: original-signer/Firebase/parity build, Realme retained-data upgrade and
actual offline WebView/native/MediaStore byte proof, then gated release.
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

## Evidence Before Native Acceptance

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

## Remaining Boundaries

Native compilation, signer/Firebase/assets, installed WebView-to-plugin and
actual saved gallery bytes remain required before Stable39. No authenticated
large-media journey, real Apple audio, broad OEM/codec matrix or killed-process
pending-gallery recovery is inferred. Files above32MiB keep ordinary online
export; no unlimited offline cache claim. Android before10 keeps its online
HTTPS/SAF path; local gallery requires10+. Generic documents/audio export and
the wider Task3 backlog remain separate.
