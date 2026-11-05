# Bounded AAC Compatibility

Owner Codex coordinator, Task3/D376. Stage: verified source and Realme browser;
release integration follows separately. Native45 remains the last public APK at
this source checkpoint. No database, Auth, provider or private media was touched.

## Implementation

Native conversion remains first. After its ownership/cleanup settles, only a
qualified codec failure or unsupported audio decoder may request one fresh PCM
attempt. Execute EncodingError does not reveal audio versus video origin; no
broader Error-message matching or arbitrary retry was introduced. Abort, I/O,
initialization, cleanup and output failures do not gain an original-file fallback.

The existing MPL-2.0 Mediabunny1.56.1 composable Conversion and AudioBufferSource
are reused, without a dependency upgrade, decoder registry mutation, server-side
transcoding or copied Telegram code. [Upstream/source decision](2026-11-05-media-upstream.md).

Admission is intentionally narrow: MP4/AVC, one video plus one AAC-LC mono48k
track, recognized two-byte ASC, bounded contiguous packets, unambiguous edit-list
mapping, no unsupported offset/rate/extra track. Maximum input8MiB, duration15s,
video921,600pixels with each dimension at most1280, PCM3MiB, accounted copies12MiB,
output8MiB. Limits are checked before own buffer allocations; they are not a
general adversarial-browser OOM guarantee or a measurement of process peak memory.

Complete Web Audio decoding never plays, resumes, connects to speakers or uses
the microphone. Selected sample frames are copied into a separate buffer and
rebased to zero. Non-abortable decode retains ownership until settlement and
awaited context close; stale completion cannot apply. Video and PCM audio pumps
share a fresh bounded StreamTarget, honor backpressure and settle together on
failure/cancel. Reopening checks track identity/count, dimensions, codecs,
timestamps, durations and absence of source tags. No silent audio dropping or
raw unedited upload is reported as success.

The bounded fallback uses fastStart:false rather than the native path's
in-memory faststart layout, avoiding an unaccounted muxer buffer. This small-file
compatibility tradeoff is not faststart parity or universal streaming acceptance.

## Evidence

Coordinator first ran the actual Chromium conversion with a one-shot native
AudioDecoder.decode EncodingError:1test/1behavioral RED. Final same case passes;
real generated input has red/green/blue scenes and220/440/880Hz segments. Only the
selected green/440Hz middle survives. Independent complete-source/result Web
Audio correlation is above0.98 at the selected frame offset, detecting a shifted
waveform rather than merely a matching tone. These are actual encoded bytes,
not synthetic successful decoder return values.

Final affected source/helper/UI command42/42 passes (native13, PCM11, editor18).
Complete Chromium/WebKit conversion file8/8 passes, including ordinary native,
no-op identity, rotation, video-only, cancellation and loaded-copy omission.
WebKit without encoders correctly stays unsupported; it is not physical Safari
acceptance. Typecheck and independent read-only review pass. Helper tests execute
real installed mux/demux and StreamTarget; invented packet payloads are expressly
not codec evidence. UI pixels remain unchanged; existing actual editor matrices
ran390/1440, both themes.

Actual RealmeRMX3830/Android15, Yandex26.3.2.108/Chromium144: untouched native first
path followed by exactly one observed product WebAudio decode. Output320x240,
11,330B,8video packets ending0.8s, audio ending0.810667s with expected AAC padding,
38audio packets/38,912decoded frames and isolated440Hz. The output oracle uses
Web Audio because native AAC AudioDecoder is the failing component; the input
generator, visual-sample and encoded-timestamp oracles are retained.

An initial immediate wake check refused before browser launch; exact mapping and
server cleanup passed. Fresh unlocked readback and a bounded dismissal wait
admitted the actual run. First PASS lacked branch instrumentation, so a separate
changed-observer run established exactly one product decode, rather than calling
a possible native-only success fallback proof. Source hashes are identical
before/after both accepted runs. All owned browsers/server/exact reverse mapping
settled and HOME returned; no application install, personal-screen capture,
account access or broad device/network change occurred.

Private technical receipts: primary `.ops-private/video-pcm-20261105/`, accepted
branch-observed receipt2b34b016deb4c11714f63360. Earlier refused/partial records
remain intact. This is a synthetic local-browser codec case, not authenticated
upload/retry/receive/save, installed Capacitor, every AAC input or iPhone proof.

## Next

Integrate reviewed source into web and next legitimate Android candidate with
normal signer/Firebase/custody/retained-data gates. Keep the wider authenticated
mixed-album journey and Apple codec/device matrix open; do not replay accepted
cold-photo, notification or updater cohorts for unrelated coverage claims.
