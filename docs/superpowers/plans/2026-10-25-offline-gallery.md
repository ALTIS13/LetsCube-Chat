# Offline Android Gallery Implementation Plan

> Use bounded subagent-driven development or inline execution with one fresh
> final review. This is an approved Task3 continuation, not a new approval gate.

**Goal:** Save an already-open cached image/video into Android's LETSCUBE album
without re-downloading it or handing the user to a browser.

**Architecture:** Keep the existing HTTPS exporter and MediaStore transaction.
Add a private temporary-file staging session fed by bounded Blob chunks through
Capacitor. Only the managed object-URL registry may supply local bytes; retirement
invalidates the lease before native finish. Exported user copies are not cache.

**Tech Stack:** Existing Capacitor, Java file streams/SHA-256, Android MediaStore,
TypeScript Blob/crypto, current React viewer. No new dependency.

**Spec:** [Task3 and global authority](2026-10-18-production-completion.md#task3-media-completion-2529104--105),
[cache contract](../../operations/2026-10-25-media-cache.md).

## Decisions And Constraints

- Owner already delegates routine decisions and release/ADB/SQL after checks.
- Use Android10+ MediaStore for local gallery export. Older shells/API levels
  keep the existing HTTPS/SAF path; unsupported local export never opens a tab.
- Alternatives: full-file base64 would duplicate tens of MiB across the bridge;
  accepting arbitrary file/content URLs weakens the native file boundary. Neither
  is needed. Use one temporary session, 256KiB chunks, 32MiB total, 120s expiry.
- Android's [app-owned MediaStore contract](https://developer.android.com/training/data-storage/shared/media#storage-permission)
  allows this Android10+ export without broad media-library permissions. Keep the
  existing [Capacitor plugin boundary](https://capacitorjs.com/docs/plugins/android).
- Begin binds an ASCII safe media filename, exact MIME, byte length and lowercase
  SHA-256. Append binds opaque UUID and exact offset. Finish validates exact bytes/
  hash before MediaStore publication. No caller-supplied filesystem path or URL.
- Preserve session/account/privacy retirement. JS checks its registry lease after
  every await and immediately before finish. Once native finish is admitted,
  saving is an explicit user copy; logout does not erase an already-saved gallery
  item. Navigation alone must not forge a different source. Preview != original.
- No secrets, captures of personal screens/content, RLS changes, global Java/PATH,
  PC routing, new stores or package identity. Preserve original signer/Firebase.
- Worker source scope is pure staging/source Java and their JVM tests only;
  coordinator owns plugin/TS/UI/release/device. One final integrated reviewer.

## Review Focus

1. Oversized/malformed/duplicate/out-of-order chunks must not accumulate files.
2. Wrong hash, expiry, abort, plugin destruction and process restart must not leave
   a publishable pending item or unbounded staging files.
3. A late callback after privacy retirement must not start/finish another export.
4. UI save from a cached original must use its actual bytes/MIME and keep its
   correct filename; a stale or unknown blob must not trigger a network fallback.
5. Existing online export, old Android shell and ordinary browser/iPhone behavior
   remain intact. Gallery proof needs actual Android bytes, not just a JS stub.

## Task1: Bounded Native Staging And Export

Files: new `android/app/src/main/java/com/kub/messenger/MediaExportStaging.java`,
existing `MediaExportSource.java`, `MediaExportPlugin.java`; focused JVM tests.

Pure-Java interfaces:

```java
MediaExportStaging(File cacheRoot, java.util.function.LongSupplier now)
String begin(MediaExportSource source, long size, String sha256)
void append(String id, long offset, byte[] chunk)
Completed finish(String id) // AutoCloseable; source(), openInput(); close removes file
void abort(String id)
void close()
MediaExportSource.local(String name, String mimeType)
```

`begin` allows one active session; fail closed on an unknown/invalid token without
destroying a different active session. Own temporary directory only, no symlinks
or caller paths. Startup cleanup is restricted to exact owned UUID part files;
storage/expiry errors are visible failures. Completed.close always removes its
file. Local source has no network URI and exact supported MIME/extension match.

Capacitor interfaces (all native IO on existing executor):

```ts
localCapabilities(): Promise<{ version: number; maxBytes: number; chunkBytes: number }>
beginLocal({ fileName, mimeType, size, sha256 }): Promise<{ id: string }>
appendLocal({ id, offset, data }): Promise<{ written: number }>
finishLocal({ id }): Promise<NativeMediaSaveResult>
abortLocal({ id }): Promise<void>
```

- [x] Add focused JVM cases; show RED before adding staging/local source.
- [x] Implement fixed bounds/offset/hash/expiry/abort/recovery and preserve HTTPS.
- [x] Adapt plugin to stream completed input through existing MediaExportGallery.
- [ ] Run JVM/compile checks; mutation controls pin literal limits and wrong hash.

## Task2: Local Byte Lease And Visible Save Wiring

Files: `lib/mediaCache/objectUrls.ts`, new pure `lib/platform/localMediaExport.ts`,
`nativeMediaExport.ts`, viewer and message-save action; focused unit/mounted tests.

Registry `acquire(url)` returns `{ blob, current(), release() } | null`, retaining
the exact entry. Privacy retirement invalidates current even if an export holds
a reference. No foreign/unmanaged URL can be acquired.

Pure sender consumes the local bridge plus `{ blob, fileName, isCurrent }`, validates
metadata/bounds before begin, encodes at most256KiB per append, verifies written
offset, checks lease at each boundary, and aborts any admitted unfinished session.
Do not send the entire Blob/base64 at once. Native/browser errors show the existing
error feedback; unsupported local API may use the old HTTPS path only when online
and an original first-party address still exists. Never retry a rejected local
transfer as an unrelated download.

- [x] Add failing tests for chunk order/bytes, offset mismatch, retirement at each
  await, unsupported bridge, failure cleanup and exact filename/MIME.
- [x] Mount viewer and ordinary message save; keep original/preview distinction.
- [ ] Run affected tests/typecheck and inspect1440/390 both themes; no redesign.
- [ ] One fresh integrated code review, fix important findings with RED->GREEN.

## Task3: Native Acceptance And Release

- [ ] Bump only next Android version/build (0.1.38/39); guarded original-signer/
  Firebase/embedded-source build. Preserve Stable38 artifact and rollback.
- [ ] Realme in-place guest/data retention; bounded synthetic real-WebView bridge
  and MediaStore export with WiFi/data off. Read exact own saved URI bytes/hash,
  remove only that fixture; restore network/helper/normal app in cleanup.
- [ ] Publish readiness-gated Android/shared web, verify public full APK and
  container/content parity; record exact scope and remaining Apple/large QA.

## Resume

Owner: Codex coordinator. Stage: Task1/2 source repairs complete, release pending.
Base `b1196535`. Final JVM25/25 and JS74/74; four JS mutants and prior four JVM
mutants are detected. Actual cold viewer+menu1440/390 themes4/4, final changed
dark cases2/2, omitted viewer binding fails. Actual UI8/8 after a genuine RED
now shows spinner and visible local notices without geometry shift. Four fresh
review findings are repaired with RED->GREEN cases. No source approval is inferred
for unexecuted native boundaries. Next: Native39 signer/build/parity and physical
offline gallery proof, then publication. Stable38 stays current until ready.
Ruling: do not repeat accepted Stable38 text/cache tests or rent a phone merely
to duplicate them. Native export gets its own changed-boundary canary.
