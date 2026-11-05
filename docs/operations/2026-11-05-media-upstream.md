# Media Implementation References

Checked2026-11-05. Scope: Task3 AAC compatibility and media preparation, not a
claim about every Telegram/Discord client or backend. No proprietary source or
GPL implementation is copied into LETSCUBE.

## Telegram Desktop

Inspected public `FileLoadTask::CheckForVideo` in
[localimageloader.cpp, commit302f7caed1e3945e4b5bae89b8eb2d0207c961af](https://github.com/telegramdesktop/tdesktop/blob/302f7caed1e3945e4b5bae89b8eb2d0207c961af/Telegram/SourceFiles/storage/localimageloader.cpp).
It delegates preparation, checks duration and thumbnail dimensions, and refuses
invalid preparation. This is a concrete Desktop preparation boundary, not proof
of a browser AAC fallback or Android implementation. Telegram Desktop is
[GPLv3](https://telegram.org/desktop); its C++ processing code is not incorporated.

Decision: keep explicit validation and distinguish metadata support from actual
conversion success. A failed edit must not be replaced by the unedited original
or silently lose audio. Native Telegram internals are not a drop-in for WebView.

## Existing Mediabunny

Installed1.56.1, MPL-2.0, public notice already present at
`artifacts/kub/public/licenses/MPL-2.0.txt`. No dependency upgrade, new decoder
package, codec download or modified dependency is required for the candidate.

The [official conversion guide](https://mediabunny.dev/guide/converting-media-files#composable-conversions)
documents a video conversion sharing an output with externally supplied audio.
The installed declaration also exposes `composable`, so this does not depend
solely on newer online documentation. [AudioBufferSource](https://mediabunny.dev/guide/media-sources#audiobuffersource)
accepts Web Audio buffers beginning at zero. Use these maintained primitives,
not a new muxer or a global custom-decoder registry.

Candidate contract: settle the failed native attempt; admit only a bounded,
unambiguous source; decode complete audio without playback; select the requested
PCM frames; encode both tracks into a capped fresh output. Validate output
timestamps, retained sound and selected visual interval. Large/unknown/ambiguous
inputs still refuse. Neither metadata budgets nor a synthetic tone test establish
general browser peak-memory safety or support on every platform.

## Discord

The inspected iOS attachment flow remains in [tooling guide](tooling-guide.md).
It establishes explicit selection/send feedback only. No public Discord codec
implementation was verified or copied. Use official API/open-source components
only where their actual scope and licence match; do not invent a shared native
media engine from a screenshot.
