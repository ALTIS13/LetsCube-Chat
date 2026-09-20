# Reference Clients: Which Discord, Which Telegram, And Which Of Ours

Written 2026-09-20. Read this before writing «Discord does X» or «Telegram does
Y» anywhere in this repository.

## Why this file exists

The owner asks us to adopt Telegram's and Discord's approaches, and on
2026-09-20 he added the constraint that makes the comparison honest:

> «Учти что у Discord также есть веб версия и какие-то функции там исполнены
> иначе» — and, correcting the framing the same night, «Мы не только веб
> приложение, настольное должно быть настольным и т.д.»

Both halves matter, and they are different points.

1. **«Discord does X» is not a fact until it says which client.** Discord ships
   web, desktop, mobile and an embedded client. Telegram ships six clients
   written by different people. A claim that names no client is a claim about
   nothing.
2. **«A browser cannot, therefore we do not» is not a conclusion.** We ship four
   surfaces. A capability a page cannot have may still be available to a native
   process. The question is never «can the web do it» — it is «which of our four
   can do it, and is it drawn there».

Four separate pieces of work on 2026-09-20 compared against a desktop client
while building for a browser, and at least one was about to adopt a control a
browser cannot implement. That is what this file is for.

## How to read a claim here

Every claim carries a confidence mark:

| Mark | Means |
| --- | --- |
| **OFFICIAL** | First-party documentation, help centre, or published source |
| **SHIPPED** | Read out of a bundle or a repository. The build or commit is named |
| **COMMUNITY** | Forum, blog, screenshot, third-party report |
| **UNESTABLISHED** | Could not be confirmed. This is a first-class answer |

«I could not establish this» is worth more than a confident guess. This project
has been burned by confident wrong claims; see section 11.

**Everything marked SHIPPED for Discord below was read on 2026-09-20 from
`discord.com/app`, stable channel, `BUILD_NUMBER` 615980, `VERSION_HASH`
2ae1bc1225ba4bf504c4d700814c349182721466, main bundle
`/assets/web.d793fc00a2d44795.js`.** Section 12 says how to repeat the read.

---

## 1. The single most useful fact in this document

**Discord's web client and Discord's desktop client are the same bundle.**
Telegram's clients are not.

SHIPPED, build 615980, module 574381. De-minified, with the original names
restored — the shipped source is one line of mangled identifiers:

> `const native = window.DiscordNative;`
> `const isPlatformEmbedded = native != null;`
> `const platform = native != null ? native.process.platform : "";`

That is the whole web/desktop split. One renderer, served from one URL, which
asks at runtime whether Electron injected `window.DiscordNative`. `isWindows()`
tests `platform` against `/^win/`; `isWeb()` is the absence of a platform.
`isDesktop()` is Windows or macOS or Linux. Note that `platform` can also be
`"ios"` or `"android"`, so `isPlatformEmbedded` is true inside Discord's mobile
webviews too — it means «a native host injected a bridge», not «desktop».

The consequences run through every section below:

- **Anything purely in the renderer is identical on Discord web and Discord
  desktop.** Layout, clamps, keyboard handling, component rendering. Comparing
  «Discord web versus Discord desktop» on those is a distinction without a
  difference.
- **The differences are a native module layer**, reached through
  `isPlatformEmbedded` and through a second `MediaEngine` implementation. The
  Windows desktop app ships **17 separately versioned native modules**
  (OFFICIAL, from Discord's own update manifest, read 2026-09-20): `discord_voice`,
  `discord_krisp`, `discord_hook`, `discord_overlay2`, `discord_media`,
  `discord_game_utils`, `discord_utils`, `discord_spellcheck`, `discord_rpc`,
  `discord_dispatch`, `discord_cloudsync`, `discord_erlpack`, `discord_zstd`,
  `discord_sekrit`, `discord_vigilante`, `discord_modules`, `discord_desktop_core`.
- **Discord mobile is a different application.** Nothing read out of the web
  bundle says anything about it. Most of our unqualified «Discord» claims turn
  out to be true of the renderer (web plus desktop) and false or unknown on
  mobile — see section 11.

Telegram is the opposite shape: **Desktop (tdesktop), Android, iOS, macOS,
Web A and Web K are six separate codebases**, two of which — the webapps — are
independently written by different authors, share no code, and differ from each
other in what they can do. There, «which client» changes the answer constantly.
Section 10.

**The rule this gives us:** when quoting Discord, say «Discord's renderer (web
and desktop)» or «Discord mobile». When quoting Telegram, name the one client.

---

## 2. The two axes

### Ours

| | browser | PWA (iPhone/iPad) | Tauri (Windows) | Android APK |
| --- | --- | --- | --- | --- |
| Rendering | the page | the page, standalone | WebView2. `frontendDist` bundles **only** the startup shell; the main window navigates to the remote `https://app.letscube.ru/` | Android WebView (Capacitor 8.3.4) |
| Native bridge | none | none | **26 Rust commands** (SHIPPED, see below) | Capacitor plugins: `@capacitor/app`, `geolocation`, `push-notifications` |
| Window chrome | browser's | none | **ours** — `decorations: false`, custom titlebar, min 960x640, default 1360x860 |  system |
| Tray | no | no | **yes** — `TrayIconBuilder` | n/a |
| Autostart | no | no | **yes** — `desktop_get_autostart` / `desktop_set_autostart` | n/a |
| Updates | reload / service worker | reload / service worker | **signed updater**, minisign pubkey in `tauri.conf.json`, NSIS passive install | APK from the release catalogue |
| Identity | — | — | `ru.letscube.messenger`, NSIS, current-user install | `com.kub.messenger` |

The Tauri shell is **not** «a browser tab in a frame». SHIPPED, from
`windows-tauri/src-tauri/src/lib.rs:1888`, the commands already exposed to the
page:

`retry_main`, `startup_accept_peer_change`, `begin_startup_qa`,
`desktop_get_update_state`, `desktop_get_update_channel`,
`desktop_set_update_channel`, `desktop_check_update`, `desktop_install_update`,
`desktop_show_main`, `desktop_is_main_foreground`, `desktop_notify`,
`desktop_remove_notification`, `desktop_take_pending_notification_route`,
`desktop_start_dragging`, `desktop_minimize`, `desktop_toggle_maximize`,
`desktop_is_maximized`, `desktop_close_to_tray`, `desktop_get_autostart`,
`desktop_set_autostart`, `desktop_get_storage_state`,
`desktop_set_storage_location`, `desktop_set_cache_limit`,
`desktop_clear_cache`, `startup_start_dragging`, `startup_minimize`,
`startup_toggle_maximize`, `startup_close_to_tray`.

It also pins the node's certificate fingerprint between runs
(`PEER_TRUST_FILE`), routes deep links (`letscube-notification`), and owns a
startup preflight. **The bridge exists and is real. The question for any new
capability is not whether we can add a command — it is whether the capability is
worth one.**

What is conspicuously **absent** from that list, and relevant below: no audio or
voice command, no global hotkey registration, no raw socket, no media encoder,
no filesystem streaming.

### Theirs

| Product | Clients | Relationship |
| --- | --- | --- |
| Discord | web, desktop (Electron), mobile (iOS/Android), embedded/Activities | web and desktop are **one bundle**; mobile is separate; embedded is the same bundle with `__OVERLAY__` |
| Telegram | Desktop (tdesktop, C++/Qt), Android (DrKLO), iOS, **macOS (TelegramSwift, separate)**, **Web A** (Ajaxy/telegram-tt), **Web K** (morethanwords/tweb), plus **Telegram Air** (Web A wrapped in Tauri) | **six separate codebases**; the two webapps are by different authors and share no code |

---

## 3. Where our four surfaces will always differ, in mechanism

Name the mechanism once here and the same argument need not be had four more
times. A capability is **page-possible** if a document in a WebView can have it,
**native-possible** if a process outside the WebView can, and **surface-bound**
where it needs something only one operating system offers.

| Mechanism | browser | PWA | Tauri | Android | Why |
| --- | --- | --- | --- | --- | --- |
| System audio processing bypass / device-level DSP | no | no | native-possible | native-possible | needs a platform audio API (WASAPI, AudioRecord), not `getUserMedia` |
| Global hotkey (push-to-talk with the window unfocused) | **no** | **no** | native-possible | native-possible | a page only receives keys while focused. This is why Telegram's webapps have no push-to-talk |
| Socket options / QoS DSCP marking | **no** | **no** | native-possible | native-possible | a page cannot set IP TOS bits; the browser owns the socket |
| Raw UDP / a real STUN probe | **no** | **no** | native-possible | native-possible | `fetch` and `WebSocket` cannot reach a media port. See D-231 |
| Tray, autostart, window chrome | no | no | **shipped** | n/a | a process outside the page |
| Per-application audio capture / loopback | no | no | native-possible | no | needs a system hook (`discord_hook` is Discord's) |
| Exact encoder cost before encoding | no | no | native-possible | native-possible | `VideoEncoder.isConfigSupported` answers yes/no; `MediaCodec` answers with numbers. See D-175 |
| Streaming upload while still encoding | no | no | native-possible | native-possible | needs a real filesystem and a streaming HTTP body. See D-176 |
| Audio above 100% gain without a gesture-gated `AudioContext` | no | no | native-possible | native-possible | the autoplay policy is relaxable at shell level. See D-227 |
| Signed, blocking, self-installing update | no | no | **shipped** | store/APK | see section 9 |
| Mic / camera / screen capture | yes | partly | yes | yes | `getUserMedia`, `getDisplayMedia` |
| Push when closed | service worker | service worker | native-possible | FCM | |

**Read the «no» columns as «not on this surface», never as «not in this
product».** That is the failure mode section 11 documents.

---

## 4. Subject 1 — Voice settings, web versus desktop

This is the sharpest case, and the bundle answers it exactly rather than
approximately.

Discord's renderer asks a `MediaEngine` whether a feature is supported, and
there are two `MediaEngine` implementations in the same bundle: a native one
(talking to `discord_voice`) and a WebRTC one. **The web one's `supports()` is a
switch with a `default: return false`.** SHIPPED, build 615980:

| Feature | Discord **web** | Discord **desktop** | Mechanism |
| --- | --- | --- | --- |
| `AUTOMATIC_GAIN_CONTROL` | **yes, except Safari** — `return "Safari" !== browser.name` | yes | browser AGC constraint vs native DSP |
| `NOISE_SUPPRESSION` | **yes, except Safari** — same line | yes | same |
| `NOISE_CANCELLATION` (Krisp) | **conditional** — a browser capability check | yes (`discord_krisp` module) | |
| `VOICE_PROCESSING` | **Chrome only** — `return "Chrome" === browser.name` | yes | |
| `AUTOMATIC_VAD` (advanced voice activity) | **no** — hard false | yes | needs the native VAD in `discord_voice` |
| `AUDIO_BYPASS_SYSTEM_INPUT_PROCESSING` (disable system audio processing) | **no** — not in the web switch at all, falls to `default: false` | yes | needs a platform audio API |
| `QOS` (quality of service high packet priority) | **no** — hard false | yes | a page cannot mark packets |
| `ATTENUATION` (global attenuation) | **no** — hard false | **Windows only** — the native engine returns a `/^win/i` test against the reported OS family | see below |
| `VOICE_PANNING` | **no** — hard false | yes | |
| `DEBUG_LOGGING`, audio subsystem selection (legacy / experimental / automatic / deferred switch) | **no** — all hard false | yes | |
| `SPATIAL_AUDIO`, `SAMPLE_PLAYBACK`, `SOUNDSHARE`, `LOOPBACK`, `AEC_DUMP`, `SIMULCAST`, `CONNECTION_REPLAY`, `SCREEN_CAPTURE_KIT` | **no** | varies | |
| `AUDIO_INPUT_DEVICE` / `AUDIO_OUTPUT_DEVICE` | **conditional** | yes | see the warning pattern in section 8 |
| `DESKTOP_CAPTURE` | **yes** — `navigator.mediaDevices?.getDisplayMedia != null` | yes | |
| **No-audio warning** (`silenceWarning`) | **yes — present on web** | yes | **it is not a `supports()` feature at all.** It is app logic over store state: voice channel, RTC connected, mode is voice activity, the setting is on, no input detected, not self-muted, not stage-suppressed |

### The two findings here that contradict what we assumed

**Global attenuation is Windows-only even on Discord's own desktop client.**
SHIPPED — the native `MediaEngine` returns, for both `ATTENUATION` and
`VIDEO_HOOK`, a test that the OS family matches `/^win/i`. It is not a
desktop feature; it is a Windows feature. A macOS or Linux Discord desktop user
does not have it either. Anyone arguing «Discord desktop has attenuation, so our
Tauri build should» is right about the conclusion and wrong about the reason,
and the reason is the part that tells us what it would cost.

**The no-audio warning is not platform-bound.** It sits in the same settings
group as QoS and attenuation in Discord's own UI, which is why it gets grouped
with them in our discussions, but mechanically it is nothing like them: it is a
store predicate with no native dependency and no `supports()` entry. **We can
have it identically on all four surfaces.** If it is missing from any of ours,
that is a gap, not a constraint.

### Defaults, for reference

SHIPPED, the shipped default voice settings object: `echoCancellation: true`,
`noiseSuppression: false`, `automaticGainControl: true`, `noiseCancellation:
true`, `bypassSystemInputProcessing: true`, `silenceWarning: true`,
`attenuation: 0`, `attenuateWhileSpeakingSelf: false`,
`attenuateWhileSpeakingOthers: true`.

Note `noiseSuppression: false` with `noiseCancellation: true` — Discord's
default is Krisp on, browser noise suppression off.

Discord also ships **voice presets** (SHIPPED): `CUSTOM`, `VOICE_ISOLATION` and
`STUDIO`. `STUDIO` sets voice-activity mode with threshold -84, and turns echo
cancellation, noise suppression, AGC and noise cancellation all **off** while
keeping `bypassSystemInputProcessing` on. That is a coherent idea worth
stealing: a named profile that sets several switches at once, rather than
eleven independent toggles. D-261 already proposes the arrangement; the preset
list is the part it does not have.

There is a live server-side experiment named **`2026-08-audio-fidelity`**
(SHIPPED) that caps sample rate and channel count conditionally on whether
Krisp, noise suppression or echo cancellation is active. Dated by its own name
to August 2026. Do not treat Discord's current audio parameters as settled.

### The input-sensitivity indicator, read out of the panel itself

Added 2026-09-20 for D-279. **SHIPPED**, same build 615980 as the rest of this
section, out of chunk **922757** (`/assets/5195a9a856cce50d.js`, module 460773 —
the whole Voice & Video settings page), its CSS `/assets/4c21cb1cd7c8ed01.css`,
and the generic slider in `784585.cef71fb86f53b27c.css`.

**There is no meter under the slider. The bar *is* the slider's track**, and
there are two different indicators depending on «Automatically determine input
sensitivity».

| | Auto (`autoThreshold` on) | Manual (`autoThreshold` off) |
| --- | --- | --- |
| Shape | one block, constant full width | a two-zone track plus a level overlay |
| Colour | `--primary-400` dark / `--primary-200` light, switching to `--green-230` on `speaking__0fc79` | left of the thumb `YELLOW_300` (`#f0b232`), right of it `GREEN_360` (`#23a55a`), both inline raw hex from `unsafe_rawColors` |
| The live level | `aria-valuenow` is literally `100` or `0` — there is no intermediate value | a `fill__0fc79` div painted `var(--opacity-black-24)`, width only, darkening whichever zone it covers |
| Threshold range | — | `[-100, 0]` dBFS, integer steps, rendered `${-((100-e)).toFixed(0)}dB`; the RPC schema pins it as `threshold: e.number().min(-100).max(0)`. Shipped default `-60`, `STUDIO` preset `-84` |

**Four findings, and three of them change what a level meter should do.**

**1. Discord encodes loudness in colour nowhere on this screen.** Three meters,
three mechanisms, zero loudness→colour mappings. Where colour changes it
encodes **gate state**; where position matters it encodes **the threshold**.
Loudness is always width. There is no red anywhere, no clipping zone and no
peak-hold marker: `RED`, `danger`, `clip` and `Peak` appear zero times in the
input-sensitivity region of that chunk.

**2. The gradient runs yellow → green, quiet → loud** — deliberately the
inverse of the broadcast green→amber→red convention, in both the manual slider
and the mic-test pill (`gradientStart: YELLOW_260`, `gradientEnd: GREEN_360`,
module 152567). Louder is *safer*, because the only question this meter asks is
whether you clear a gate. Anyone copying green→red into a VAD meter is encoding
a question Discord is not asking.

**3. Which indicator you meet depends on the surface, and web gets the worse
one.** `ta()` in the main bundle: `autoThreshold: p.isPlatformEmbedded ||
__OVERLAY__`. So a desktop user's default is the binary bar and a browser
user's is the slider-plus-shadow. And `supports(AUTOMATIC_VAD)` is hard-false
on web (see the table above), so the web client does not render the
«Automatically determine input sensitivity» switch at all — a web user cannot
reach the binary indicator even deliberately.

**4. The timings are asymmetric and worth taking.** `transition: width 35ms
ease` for the level — near-instant, it must track a voice — against
`transition: background-color .2s linear` for the state colour, deliberately
lagged so the gate does not strobe. The mic-test pill additionally quantises
its fill to its 8px notch pitch (`8*Math.round(e/8)`), which hides jitter
without lying about the value.

**One thing not to copy.** In manual mode the live level is exposed to
assistive technology **not at all**: the `role="slider"` carries
`aria-valuenow` for the *threshold*, and the level overlay is a bare unlabelled
`div`. Only the auto-mode indicator is a `role="meter"`, and it reports 0 or
100.

**And a second counter-example to section 8's rule, sharper than the device
selector.** The sensitivity fieldset renders whenever the input profile is
`CUSTOM` — `usePredicate: () => i1.Ay.isInputProfileCustom()` — and the mode is
irrelevant to its *presence*. In push-to-talk it is rendered `disabled`: the
switch is disabled, the slider takes `.disabled__4c059 { opacity: .6 }` and
`cursor: not-allowed`, and the level fill's width is forced to `0`. So Discord
**does** draw a greyed, non-functional control here. Ours (D-279) does not, and
that is a decision rather than a coincidence: our threshold is inert in
«Всегда» in a way a person could calibrate against a live bar without
discovering, and a line naming «По голосу» is cheaper to be honest about than a
disabled slider. Section 8's rule stands; this is the counter-example it has to
survive, recorded rather than filed away.

---

## 5. Subject 2 — Layout and resizing

Because web and desktop are one bundle, **every number below is identical on
Discord web and Discord desktop.** Discord mobile is a separate application and
none of this applies to it.

SHIPPED, build 615980:

| | Discord renderer (web = desktop) |
| --- | --- |
| Left region default | **375px** — the store initialises `{ isOpen: true, width: 375 }`, and the restore path falls back to 375 when the stored value does not parse |
| Clamp | **min 264, max 432** — passed to the resize hook as `minDimension: 264, maxDimension: 432` |
| Keyboard on the handle | arrow keys plus or minus 10; `Home` goes to 264; `End` goes to 432; the result is clamped again |
| Handle | 4px wide, `cursor: ew-resize`, `role="separator"`, `tabIndex 0`, `aria-orientation="vertical"`, `aria-label="Resize Sidebar"` |
| Overdrag | the handle rubber-bands: a `--custom-overdrag` scaleX of `1 + min(abs(delta)/76, 0.25)` |
| Threshold classes | a body class at or below 264, another at or above 432 |
| Does it scale with the viewport | **no.** 264 and 432 are constants. There is no viewport term anywhere in the clamp |
| Shell grid | `grid-template-columns: [start] min-content [guildsEnd] min-content [channelsEnd] 1fr [end]` |
| Channel list width | `calc(var(--custom-guild-sidebar-width) - var(--custom-guild-list-width) - 1px)` — so at the 432 maximum the list is 355px beside a 76px rail |
| Collapse | **present in the source and switched off.** The open/closed value is computed and then `&& !1`-ed, so `data-collapsed` is always false, the 76px collapsed path never runs, and the handle's click and its `Enter` key flip a store value that changes nothing |
| Window minimum | `setMinimumSize(800, 500)` — a native call, so desktop only |

**This confirms D-269 and D-270 exactly, including the 355px.** Both were read
off the same build independently and both got it right. The correction is only
the qualifier: these are the renderer's numbers, so they cover web **and**
desktop, and say nothing about mobile.

### The finding that changes what D-270 is arguing

D-270 proposes lowering `CHAT_LIST_MAX_WIDTH` from 540 on the grounds that «ours
is 42% wider than Discord's maximum». The arithmetic is right. But the bundle
shows that 432 is **one constant shared by Discord's web and desktop clients,
with no viewport term and no desktop-specific widening.** It is not a browser
limitation that Discord's desktop build escapes — it is a product decision
Discord applies everywhere.

So adopting 432 is copying a decision, not respecting a constraint. Under the
owner's «настольное должно быть настольным», that is exactly the kind of number
we should be willing to differ on: a 1360x860 desktop window with our own
titlebar is not a 1280 browser tab, and Discord's refusal to scale its clamp
with the viewport is a choice it made for a client that has to work at 800x500.
**D-270 should be presented to the owner as «Discord chose 432 and does not
vary it», not as «Discord's maximum».**

---

### The settings surface, read for D-285 — 2026-09-20, SHIPPED

Read off the same build, 615980, and worth recording separately because **every
class name our earlier notes would have searched for is gone from it.**
`standardSidebarView`, `sidebarRegion`, `contentTransitionWrap`,
`settingsCloseButton`: zero occurrences across 584 CSS files and 1,415 JS
chunks. `contentRegion`/`contentColumn` survive only in a dead composed string
in module `192173` that nothing imports. Discord rebuilt its settings; what
follows is the current shell, from `openUserSettings` (module `766075`) down.

The settings are **`openModalLazy`, not a layer push** — that is the first
correction, and it is the one that makes the rest follow.

| | Discord renderer (web = desktop), build 615980 |
| --- | --- |
| Shell | an **inset sheet**, never `inset: 0`. `.modal_e44912` is `width/height: calc(100% - var(--custom-viewport-padding) * 2)` with `max-width: 1400px` |
| Inset | `--space-40` = **40px** at and below a 1600px window; `calc(--space-40 + --custom-app-top-bar-height)` = **72px** above it |
| Corner, border | `--radius-md` = 12px, `1px solid var(--border-subtle)`, `box-shadow: var(--shadow-high)` |
| Sidebar | **`flex: 0 0 240px`**, `border-inline-end: 1px solid var(--border-muted)`; `<nav aria-label="Settings pages">` |
| Content pane | `flex: 1 1 auto`, `overflow: hidden`, with its own **48px** header |
| Content column | `.panel__6131a { max-width: 696px; min-width: 300px; margin-inline: auto; padding: 0 16px; margin-block: 64px }` — 80px below 1080 |
| ✕ | a real `<button>`, `aria-label="Close"`, last flex child of the **content pane's** 48px header, 8px from its right edge. **No visible ESC hint** — the legacy close button that carries one still ships, but not in settings |
| The dim | a real scrim element, `role="none"`, black at **72.16%** in dark and **52.16%** in light, and **no `backdrop-filter`**: the blur class exists but settings does not request it |
| Animation | opacity 0→1 and `scale(0.9)`→`scale(1)`, react-spring `{mass:1, tension:1000, friction:48}` with a 64ms delay; 300ms mount window; scale pinned to 1 under reduced motion |

**Does a click on the dim close it? Yes, and the owner was right to say so.**
This was the question the work turned on, so here is the chain rather than the
conclusion. The scrim carries an `onClick` that dispatches `MODAL_CLOSE`; the
top modal subscribes and calls `onCloseRequest` unless `dismissable === false`.
Settings never passes `dismissable`, so it is `undefined`, and it does pass
`onCloseRequest`. The click reaches the scrim rather than the wrapper above it
because `.layerContainer__59d0d` is `pointer-events: none` and only the scrim
and the sheet re-assert `auto`. Escape takes the identical path.

**And the two limits on that claim, because they decide whether he can
demonstrate it.** Below a 1080px window the sheet goes **full-bleed** —
`width: 100%; height: 100%; border: none; border-radius: 0` — so there is no
gutter left and only ✕ and Escape work. Above it the clickable band is 40px a
side, widening to `(viewport − 1400) / 2` once the cap binds.

### Discord does not solve narrow-desktop settings, and that is the finding

**There is no breakpoint anywhere that puts its settings into one column by
width.** The complete list of responsive rules on that shell is four: 1600px
drops the inset from 72 to 40, 1080px goes full-bleed *while staying two
columns*, 1080px grows the content column's block margin, and a `max-height:
550px` rule. Nothing else.

The one-column mode exists, and it is gated on **the user agent, not the
viewport**: `.mobile__409aa` is applied from `ua-parser-js` `os.family` ∈
{Android, iOS, Windows Phone} and not a tablet — the same predicate that sets
`body.is-mobile`. So a desktop browser dragged to 320px keeps a 240px sidebar
beside a column with `min-width: 300px` and simply **clips**, because
`.content_e9e3ed` is `overflow: hidden`. Discord solves phones, by UA, and
leaves narrow desktop windows broken.

This matters to us twice. We have no UA gate to lean on — a Tauri window and a
browser tab are the same renderer at the same width — and we ship a 768px
switch to a sheet that Discord has no equivalent of. **So where we differ from
Discord here we are differing from something it did not solve**, not from a
decision it made. D-285 folds the rail into the content below an 860px panel
and keeps the dim clickable down to the 768 switch; both are places Discord
clips or goes full-bleed.

What could not be established: the original source filenames (`.css.map` and
`.js.map` are not served — they return the SPA shell), the computed pixel
values (nothing was run, only read), and whether an experiment swaps module
`382567` wholesale.

---

## 6. Subject 3 — Call controls while in a voice call

Because of section 1, «reachable from where» is the same on Discord web and
Discord desktop for everything in the renderer. What differs is which controls
are **capable**.

| Control | Discord web | Discord desktop | Mechanism |
| --- | --- | --- | --- |
| Mute / deafen | yes | yes | renderer |
| Mute / deafen from the **system tray** | **no** | **yes** | SHIPPED: tray handlers for `SYSTEM_TRAY_TOGGLE_MUTE`, `SYSTEM_TRAY_TOGGLE_DEAFEN` and `SYSTEM_TRAY_OPEN_VOICE_SETTINGS` are all registered inside `if (isPlatformEmbedded)`. The tray icon also tracks call state (deafened / muted / speaking / connected) |
| Mute / deafen / video from the **Windows taskbar thumbnail buttons** | **no** | **yes** | SHIPPED: a thumbar-button updater exists and is desktop-only |
| Camera | yes | yes | gated on `supports(VIDEO)` |
| Screen share | **yes** | yes | `getDisplayMedia` |
| Share a **specific application** window, native picker, share system sound | **no** | **yes** | `SOUNDSHARE`, `NATIVE_SCREENSHARE_PICKER`, `SCREEN_SOUNDSHARE` are native-module features |
| Clips | **no** | yes | SHIPPED: the capability check is literally `isDesktop() && supports(CLIPS) && hasClipsV3Support()` |
| Soundboard | **yes, but differently** | yes | SHIPPED: with `SAMPLE_PLAYBACK` the sound is played through the media engine into the call; on web there is a separate local-audio fallback path. Same button, different mechanism |
| Per-person volume | yes | yes | renderer |
| Native ping | **no** | yes | `NATIVE_PING` false on web, so the renderer falls back to its own ping handling |
| Push-to-talk with the window unfocused | **no** | **yes** | a global hotkey needs a process outside the page |

**For us:** the tray, the taskbar thumbnail buttons and a global push-to-talk key
are all things our Tauri build could have and our browser and PWA cannot. The
tray already exists (`setup_tray`, `desktop_close_to_tray`). Adding call state
to it, and call actions on it, is a small extension of something shipped rather
than a new capability. Recorded here as a gap with a pointer, not as a plan.

---

## 7. Subject 4 — Bots and apps

Telegram's half of this subject is in section 10, with the reply-markup table
that matters most. This section is Discord's.

### The badge

| | |
| --- | --- |
| What it says today | **`APP`**. OFFICIAL — Discord's own developer documentation says apps «appear in servers with an `APP` tag» |
| It used to say | `BOT` |
| When it changed | **April 2024**, around the 17th. SHIPPED behaviour, **COMMUNITY** dating — a cluster of support-forum posts asking for it to be changed back, all dated 17 to 19 April 2024 |
| First-party announcement | **UNESTABLISHED, leaning strongly to none.** It is absent from Discord's April 2024 patch notes — which mention the tag only in a bug fix and still call it «Bot» — absent from May 2024, and absent from the September 2024 apps launch post. The rename is only ever documented retroactively, as a fact of the current UI |
| Verified apps | the same `APP` flair **with a checkmark**. An open developer-forum discussion from 2026-04-23 argues the checkmark is now meaningless because verification was automated. No staff response |
| A third label exists | **`OFFICIAL`**, for system and AutoMod messages. OFFICIAL — confirmed by a 2026-08-04 patch note about an iOS bug that showed `OFFICIAL` where `APP` belonged |

**Where the badge appears, per client, is UNESTABLISHED.** Discord's first-party
docs never enumerate it — every official page says only that apps appear with an
`APP` tag. What *is* established, and is itself the useful part:

> **OFFICIAL, 2026-08-04 patch notes:** a fix for a bug on iOS where «the role
> icon and app/OP tag next to a username in chat appeared in the wrong order
> compared to Web and Android».

So all three clients render it on the message author line, and they disagreed
about its order for some period. Member list, DM list, profile popout and
mention chips are not documented anywhere and would need a screenshot pass.

### Commands and their discovery

OFFICIAL, from Discord's developer documentation — which **describes the API**,
not any client's UI, and makes no per-client statements.

| Type | Discovery |
| --- | --- |
| `CHAT_INPUT` | «shows up when a user types `/`» |
| `USER` | right click or tap on a user |
| `MESSAGE` | right click or tap on a message |
| `PRIMARY_ENTRY_POINT` | opens an app's Activity from the App Launcher |

**The App Launcher is on all clients but on the opposite side of the composer**
— right of the chat bar on desktop and web, **left** on mobile, where it also
adds a type-free command picker. OFFICIAL, from Discord's own 2024 launch post.

Two 2026 changes worth knowing before designing command discovery, both OFFICIAL
from the developer changelog:

- **2026-03-03, context menu commands redesigned**: grouped by application,
  frequently-used at the top, searchable, and the per-type limit raised from
  **5 to 15**.
- **2026-09-11**: fuzzy autocomplete on slash commands (letters may be skipped),
  multiline string options, and the selection persisting across channel
  switches — plus four mobile fixes.

### Components, and the finding that matters for us

Discord's component set is documented OFFICIAL. The load-bearing facts:

- **Components V2 is still opt-in and has never gone flagless.** The flag is
  per-message and **irreversible once set on that message**; setting it disables
  `content` and `embeds`. Legacy components are explicitly not deprecated.
- Container, Section, Text Display, Thumbnail, Media Gallery, File and Separator
  all require the flag. Buttons, selects and the modal components do not.
- Modal components are the live 2026 track: radio groups, checkbox groups and
  checkboxes landed **2026-02-12**, file-type filtering **2026-08-05**. Text
  inputs should now sit inside a `Label`, not an action row.

**The finding: Discord ships no per-client component capability matrix and no
mobile guidance in its component docs at all.** Divergence is real and
continuous, and it surfaces only as monthly bug fixes. OFFICIAL, from Discord's
own 2026 patch notes:

| Date | Client | Defect |
| --- | --- | --- |
| 2026-09-08 | **iPad** | accessory buttons not right-aligned, «leaving them in a ragged column» |
| 2026-08-04 | **iPad** | the same alignment defect, recurred |
| 2026-07-07 | **Desktop** | a long unbroken string in a Section pushed the Thumbnail off-screen instead of wrapping |
| 2026-06-04 | **Android** | a **crash** when selecting a string-select option after the bot edited the menu's options |
| 2026-09-08 | **Android** | tapping a command mention inside an embed field value did not open command details |
| 2026-09-08 | **iOS** | command menu background colours wrong, option pills kept the old text colour after a theme switch |

Two longer-lived, client-specific gaps, both **COMMUNITY** (filed on Discord's
own issue tracker, no staff reply): command mentions inside embeds are not
clickable on mobile — open since **2022-11-13**, nearly four years — and
forwarded Components-V2 messages render on desktop but not mobile. **Scope that
second one narrowly**: it is the forwarding path, not evidence that Components
V2 fails on mobile generally, and no first-party statement says it does.

**What this means for our bot platform.** If Discord — with three first-party
clients and a full-time platform team — cannot keep component rendering
consistent across them and discovers the gaps as monthly bug reports, then our
own bot surfaces will diverge across four shells unless something checks them.
A per-surface rendering check for bot reply markup is worth more than another
component type. Recorded as an observation, not a plan.

---

## 8. The rule: a control that cannot work must be absent, not inert

This rule is ours, and it is repeatedly violated. It is worth stating with
Discord's own answer beside it, because Discord's answer is **not** the binary we
have been arguing about.

Discord does three different things, all SHIPPED in build 615980:

1. **Gate the capability, and hide what depends on it.** The `supports()` switch
   is consulted before rendering the feature at all. This is the common case —
   QoS, attenuation, advanced VAD, the audio subsystem selector.
2. **Keep the control and attach a warning that points at the client that can.**
   The audio device selector carries both `getCanSetDevice: engine =>
   engine.supports(AUDIO_INPUT_DEVICE)` **and** a `getWarningMessage` whose
   formatted string takes an `onDownloadClick` handler. When the browser cannot
   set the device, the user gets an explanation and a link to the desktop app —
   not a hidden control and not a dead one.
3. **Warn in place when the situation, not the control, is the problem.** The
   `VIDEO_UNSUPPORTED_BROWSER` notice fires when you are in a voice channel where
   somebody has video and your engine does not support video. It explains rather
   than hides, because hiding would leave the user wondering where everyone went.

There is also a fourth, which we should note and not copy: the web client shows a
**`DOWNLOAD_NAG`** whose predicate is exactly `!isPlatformEmbedded && !dismissed`
— a standing advertisement for the desktop app on every web session.

**Our rule, restated with that in mind:**

- A control that **cannot work on this surface** is **absent** there. Not drawn
  and greyed, not drawn and silently inert.
- A control that is absent because **another of our surfaces has it** may carry
  one line saying so, at most once per screen. That is Discord's pattern 2, and
  it is honest. It is not a licence for a nag bar.
- A control that is **present but blocked by circumstance** (no device, no
  permission, nobody speaking) stays, and explains. That is pattern 3.
- Deciding between «absent» and «absent with a line» is a product decision and
  belongs to the owner. Deciding to draw a dead control is not a decision, it is
  an omission.

---

## 9. Subject 5 — Updates

Much of the web half of this was established on 2026-09-20 against the live web
bundle by another agent; it is **inherited** here rather than redone, and marked
as such.

| Client | Mechanism | What the user sees |
| --- | --- | --- |
| Discord web | reload, **only ever on a click**; hourly poll of `version.stable.json`, armed on the gateway connection. SHIPPED, read at the source 2026-09-20 — see below | a green download icon in the toolbar, at most once every 7 days on stable / 1 day elsewhere. Nothing else. Plus a standing `DOWNLOAD_NAG` |
| Discord desktop, Windows | **host manifest with per-module versions and binary deltas.** OFFICIAL, read 2026-09-20 from Discord's own update manifest: host `1.0.9059`, with a delta entry from `1.0.9058`, and 17 independently versioned modules each with its own sha256 and full/delta URLs | silent background update, module by module |
| Discord desktop, macOS | `0.0.412`, published `2026-09-14T17:15:31` — OFFICIAL, from Discord's update endpoint | |
| Discord desktop, Linux | `1.0.158`, published `2026-09-14T23:28:40` — OFFICIAL, same endpoint | |
| Discord mobile | app stores | |
| Ours, browser and PWA | reload / service worker | |
| Ours, Tauri | signed updater, minisign public key pinned in `tauri.conf.json`, NSIS `installMode: passive`, channels `stable` and `test` | eight phases, SHIPPED from `desktopUpdates.ts`: idle, checking, current, available, **critical_update_required**, downloading, installing, failed — with `blocking`, `persistent` and `progress` in the presentation type |
| Ours, Android | APK from the release catalogue | |

Two things worth taking from that table.

**Discord's Windows updater is modular and delta-based.** The native voice
engine can be replaced without shipping a new host. That is the shape that makes
a native audio module maintainable, and it is worth knowing before anyone
proposes bundling one into our NSIS installer as a monolith.

**Our desktop updater already has the concept the web cannot have.** D-264 got
this right and it is the model for the whole document: no web build can declare
itself required, so the blocking signal belongs beside the desktop's, which
already has `critical_update_required` and a blocking gate. That is a constraint
stated per-surface, with the capability located on the surface that has it,
rather than written off. Every entry in section 11 should have read like it.

### Telegram's updaters, per client — INHERITED

Read from source and live endpoints on 2026-09-20 by a separate pass. **Cited,
not re-derived.** SHIPPED grade throughout.

| Client | Mechanism |
| --- | --- |
| Desktop | **full package every time, never a binary patch.** An LZMA payload inside an Ed25519-signed envelope, verified **before** decompression. Checks every 8 hours plus 0 to 8 hours of jitter, over **two parallel channels** — an HTTPS endpoint and an MTProto feed — first to produce a loader wins. **Auto-update is compiled out** for Microsoft Store, Mac App Store, Snap and plain distro builds; the whole settings block then disappears and the only affordance opens the store page. Flatpak keeps it and drives it through the XDG portal |
| Android, Play build | **never checks.** The check returns immediately unless the build is standalone or beta. Its only update surface is a **blocking screen that opens the Play Store** |
| Android, direct APK | checks over MTProto with a 24-hour throttle, installs a full APK through a FileProvider |
| iOS | **no in-app updater at all.** A 12-hour poll yields blocking flag, version and text — no document, no URL. The screen's one action opens the App Store |
| **Web A** | polls its version file **every 5 minutes** and shows a reload button. Caches the document **network-first** |
| **Web K** | **does not poll at all.** It tells you *after* the reload, as a local service message built from the repository's own changelog files. **Never caches the document** |

The Web A versus Web K row is the whole document in miniature: same product,
same surface, same problem, two opposite answers — poll and offer a reload,
versus never poll and explain afterwards. Neither is wrong. Both are choices.

### The two-layer update problem, and why it is now ours

**Telegram Air is a Tauri v2 shell around Web A whose `frontendDist` is a remote
base URL** — the shell does **not** bundle the web app. So Air has two layers
that update independently: the web content updates on reload like any page,
and **only the native shell** goes through Tauri's updater (a static-JSON
endpoint, Ed25519, a 10-minute poll, download-and-install then relaunch). The
user sees the *same* «Update Telegram» button in both cases. INHERITED.

**Our Windows build has exactly this shape, and that is worth stating plainly
because it was recently described the other way round.** Verified here,
2026-09-20, SHIPPED:

- `windows-tauri/ui/` — the whole of `frontendDist` — contains only
  `startup.html`, `startup.js`, `startup.css`, the overlay and a logo. **The
  application is not bundled.**
- `lib.rs` opens the bundled startup page at `http://tauri.localhost/startup.html`,
  runs a preflight against `https://app.letscube.ru/`, and then **navigates the
  main window to that remote origin** (`lib.rs:1303`).
- There is no desktop-gated service-worker unregistration in the frontend.

So **our two layers can drift exactly the way Air's can.** The shell version is
`tauri.conf.json`'s `version`, moved by a signed updater with its own channels;
the web content is whatever `app.letscube.ru` serves at that moment. A person
running an old shell against a new web build is a state that exists today.

Three consequences, recorded as observations rather than a plan:

1. **`critical_update_required` governs the shell, not the content.** It can
   block on a stale *shell*. It cannot express «this web build needs a newer
   shell», because the web build is what would have to say so.
2. **The version a bug report quotes is ambiguous** unless it names which layer.
   Air has the same ambiguity and solves it by showing one button for both,
   which is a presentation choice, not a fix.
3. The alternative shape — bundling the frontend into the installer — trades the
   drift for a heavier release and a slower fix path, since every web change
   would then need a signed shell release. **We chose the remote shape. The
   point is to know we chose it.**

### Discord web's update path, read at the source — 2026-09-20, SHIPPED

Build `615980`, channel `stable`, `VERSION_HASH 2ae1bc1225ba4bf504c4d700814c349182721466`,
read from `https://discord.com/assets/web.d793fc00a2d44795.js` (12,082,177 bytes)
and the en-US string table `https://discord.com/assets/fe3ffe9a64a7ff75.js`
(chunk 1868, module 459463). Section 12's method, including its corrected
fallback URL shape, is what reached the string table. The whole path is one
module: **578152, `AutoUpdateManager`**.

**Detection.** The poll is **one hour**, not five minutes:

```js
let E = +d.A.Millis.HOUR, A = 7*d.A.Millis.DAY, h = +d.A.Millis.DAY,
    I = r.w.get("lastNonRequiredUpdateShown", Date.now());
handlePostConnectionOpen(){ this.checkForUpdates(), clearInterval(this._checkInterval),
                            this._checkInterval = setInterval(this.checkForUpdates, E) }
```

It is armed on the **gateway's** `POST_CONNECTION_OPEN`, with one immediate
check, rather than on page load. The request is
`/assets/version.${RELEASE_CHANNEL}.json` with a cache-buster `_` of
`Date.now()/1e3/60/5|0` — **a five-minute bucket, which is a caching detail and
not a poll interval.** Anyone reading this bundle in a hurry will find that `5`
and report it as the frequency; it is not. Fetched live the same day, the
endpoint answers exactly
`{"hash":"2ae1bc1225ba4bf504c4d700814c349182721466","required":false}`, matching
the hash the bundle carries as a **build-time string literal**.

**It never reloads by itself. Established by exhaustion, not by absence of
evidence.** `location.reload` occurs **nine** times in the 12MB bundle; all nine
were read. One is the update path — `quitAndInstall()`, reached only from the
action `AUTO_UPDATER_QUIT_AND_INSTALL`, dispatched from exactly one place, a
click handler on a toolbar download icon. The other eight are a one-time domain
migration, three staff build-override paths, a build-override clear button, the
crash screen's submit-report button, an audio-settings reset, and a
parental/age-verification card's button. Supporting counts, all zero:
`forceReload`, `NOTIFY_UPDATE`, `scheduleUpdate`, `location.replace(`,
`location.assign(`, **`skipWaiting`**, and **`navigator.serviceWorker` — Discord
web registers no service worker at all.**

**The sharpest fact in the whole read:** a build the server marks `required`
takes the *same click path*. `required` skips the throttle and nothing else.
**Discord web has no forced reload of any kind** — not on idle, not when
hidden, not on navigation, not for a required build.

**The throttle, confirmed exactly, with three refinements.**

```js
if (e.body.required || (0,l.kK)()) return this._handleUpdateDownloaded(!1);
let t = "stable" === window.GLOBAL_ENV.RELEASE_CHANNEL ? A : h;
if (Date.now() - I > t) return r.w.set("lastNonRequiredUpdateShown", Date.now()), …
```

Seven days on stable, one day on **every** non-stable channel (the ternary is
`stable ? :`, so «ptb and canary» was right but understated). The refinements:
the store is `window.localStorage` through a wrapper that Discord then
`delete`s off `window` — with an **in-memory fallback** when it throws, so the
throttle silently degrades to per-session in any context where site data is
blocked; the timestamp `I` is read **once at module load**, not per check; and
the second bypass `(0,l.kK)()` is a build-override **cookie**, i.e. staff only.

**What it refuses to interrupt, and the string we had truncated.** The guard is
`RTCConnectionStore.isConnected()` — an **established RTC connection**
(`getState() === RTC_CONNECTED`), not merely having a voice channel selected.
Resolved from the string table:

| hash | string |
| --- | --- |
| `tiu1ly` | Briefly leave voice? |
| `zK+lqW` | Updating Discord while in a voice channel will cause you to leave briefly. **You're probably going to update anyway but, you know, just warning you.** |
| `ETE/oC` | Cancel |
| `QDX/qu` | Update anyway! |

Our notes stopped the body at «leave briefly.» The second sentence is shipped.
`confirmVariant: "critical-primary"`, and the same four hashes are reused by the
build-override modal — so it is a shared «you are in voice, this will interrupt
it» confirmation rather than an update-specific one.

### «Where you were»: the address is the mechanism — 2026-09-20, SHIPPED

Read from the same build. This is the half of the update question that is really
a routing question, and Discord's answer is unambiguous.

**The routes, as the router receives them.** Built by generators in modules
`901123` and `302495`, not written as literals:

```
/channels/:guildId(@me|@favorites|@guilds-empty-nux|@inbox|@guild-upsell-list|\d+)/:channelId(…|\d+)?/:messageId?
/channels/:guildId(…)/:channelId(…)/threads/:threadId/:messageId?
```

**The third segment is the whole restore mechanism.** `MessageManager` (module
`547`) parses the message id **out of `location.pathname`**; with one it calls
`jumpToMessage({… flash:true})` and suppresses the initial scroll
(`avoidInitialScroll: null != r.messageId`), and without one `jumpTargetId`
resolves to `null` and the list lands at the present.

Three consequences worth having in writing, because each of them contradicts an
assumption it is easy to make:

1. **No scroll position is persisted anywhere.** All 58 `scrollTop` sites were
   filtered for storage calls; the one hit is an in-memory settings-panel
   snapshot. Reload `/channels/<g>/<c>` and you are in that channel, **at the
   bottom**.
2. **It does not auto-jump to the first unread on a cold boot**, and in fact
   **no unread-derived jump target exists anywhere in the main bundle.** With no
   message id, `M` always ends at `fetchMessages({limit, jump:{jumpType:
   ANIMATED}})`, which `loadComplete` resolves to `jumpTargetId: s?.messageId ??
   null` — null. `getOldestUnreadMessageId` has exactly **one** read in the
   whole 12MB bundle, and it is a topic-summary highlight picker, never a
   position. The unread is a **clickable banner** instead —
   `NewMessagesBarJumpToNewMessages_`, analytics section `NEW_MESSAGES_BANNER`,
   aria-label «Jump to last unread message», beside a «Mark As Read» button and
   a «New Messages» divider. The two genuine auto-jumps are thread-only: the
   first-ever open of a thread, and a thread with tracked unreads.

   **A correction to an earlier sentence in this section, made the same day.**
   It said «having unreads forces a *fetch*». That is not a general rule: the
   clause is `(0,u.A)(n) && m.Ay.hasUnread(n) && (S=!0)`, and `u.A` (module
   `343328`) is `e === getDMFromUserId("1232523165893132288")` — the DM with
   Discord's own changelog account, and nothing else. Generalising one line of a
   minified conditional is how a reference acquires a rule its subject does not
   have.
3. **Discord web does not persist the last route.** `DefaultRouteStore` (module
   `650048`) persists `lastViewedPath` and handles `SAVE_LAST_ROUTE` — and those
   action names occur **exactly once each in the entire bundle**, in the handler
   map. Nothing dispatches them. `get defaultRoute(){ return … ME }` is
   hardcoded to `/channels/@me`. The store is vestigial: the URL carries
   everything.

**What *is* persisted** is the selection, in `localStorage`:

| store | key | fields that matter here |
| --- | --- | --- |
| `SelectedChannelStore` (309010) | `"SelectedChannelStore"` | `selectedChannelId`, **`selectedVoiceChannelId`**, **`lastConnectedTime`**, `selectedChannelIds` (per-guild map), `mostRecentSelectedTextChannelIds` |
| `SelectedGuildStore` (967198) | `"SelectedGuildStore"` | `selectedGuildId`, `lastSelectedGuildId` |

The per-guild map is why clicking a server icon returns you to the channel you
last had open **in that server**, across a reload.

### Opening a channel and booting on one are two different events — 2026-09-20

This distinction is recorded separately because getting it wrong is what put a
false choice in front of the owner. A first read of the bundle established the
**boot** case and was written up as though it were the whole behaviour; the
owner, who uses the client daily, described the opposite for the **open** case.
Both are true. A reference that names only one of two events is a reference that
will be quoted as a rule.

**Case 1 — cold boot or reload on `/channels/<g>/<c>`. SHIPPED**, build
`615980`. The list lands **at the bottom**, with the unread banner if there are
unreads. `M` is reached through `_initialize(){ subscribe("CONNECTION_OPEN", w) }`,
the per-channel message store is empty or `cached`, so it always fetches, and
the fetch carries no jump target.

**Case 2 — opening a channel in the running app. OWNER REPORT, mechanism
UNESTABLISHED.** Asked directly, the owner answered: «Да, верно, возвращает к
разделителю непрочитанного чтобы можно было прочитать то что упущено с
последнего посещения чата.» That is what he sees, daily. It is **not** graded
SHIPPED, because the code that would do it was looked for and not found: both
paths converge on the same `M` (an in-app open arrives through the action map
entry `CHANNEL_SELECT: x`), and `M` has no branch that derives a position from
unread state.

**What the bundle does show for case 2, SHIPPED, and it is a different
mechanism.** In `M`:

```js
let p = c.A.getOrCreate(n);
p.loadingMore || p.ready && !p.cached ? null != a && (S = !0) : …
```

Re-opening a channel whose in-memory store is already `ready` and not `cached`,
with no message id, leaves the fetch flag false — so `M` does **nothing**: no
fetch, no jump, no scroll reset, and `initialScrollSequenceId`, the counter a
load uses to trigger an initial scroll, is never bumped. A cold boot cannot
reach that branch. So the asymmetry is real and is enough to produce «the place
where I stopped» as **position retention** rather than as a jump to the divider.

The two are distinguishable in use, which is how this gets settled without more
reading: **retention returns you to your spot even with no unreads; a divider
jump only shows itself when there are unreads.** What would settle the mechanism
in code is the lazy chat chunk that consumes `initialScrollSequenceId` and
`jumpTargetId`, which was not fetched. Recorded in section 13.

**No per-channel scroll offset is kept anywhere**, in memory or on disk:
`savedScroll`, `restoreScroll` and `scrollToMessage` are zero occurrences, and
the `scrollPosition` / `scrollOffset` / `anchorId` hits are search UI, settings
panels, and the virtualiser's generic row anchoring. Whatever retention happens
is the store plus the un-bumped sequence id plus a DOM subtree React did not
discard.

### Ours lands on the divider in both cases, and that is a better answer

Not a divergence to excuse — an improvement, in the sense CLAUDE.md section 7
allows, and the reason is a difference in where the fact lives.

**Discord's reading position is a client fact.** Nothing about it is persisted,
there is no unread-derived jump target in the main bundle, and the retention
above dies with the page. So a cold boot genuinely cannot put them back where
they stopped, and landing at the bottom with a banner is the honest answer to
that constraint.

**Ours is a server fact.** `ChatWindow.tsx:691-697` latches the entry position
from `chat.unread_count` and `chat_members.last_read_at` — both read from the
database on every boot — and `MessageList.tsx:453` and `:1295-1300` turn them
into the first unread message and scroll to it. Verified 2026-09-20 by reading
those lines, not assumed. Because the position comes back from the server, **a
reload can land exactly where a click lands**, and the divider, the
«Новые сообщения» chip (`MessageList.tsx:1976-1991`), the jump-to-bottom control
with its count (`:957-960`) and the follow-while-at-bottom behaviour (`:1105`)
are all already in place for both.

The only thing missing was an address to reload *onto*; that is queue item 35's
first piece. Where Discord has one behaviour on open and another on boot, we
have one behaviour, and it is the better of their two.

### The five minutes the owner named: two constants, and which one he meant — 2026-09-20, SHIPPED

The owner's claim was «даже в случае обрыва от канала я гарантировано вернусь в
него по возврату связи в течении 5 минут». Five minutes is a real shipped
Discord number. It is **two** different `3e5` constants in two different stores,
and neither of them is a client-side limit on rejoining after a reload.

**(a) `RTCConnectionStore` (763827) — the drop window, in memory.** On
`VOICE_STATE_UPDATES`, in the branch where there is no live RTC connection:

```js
if (!l && null != v && (0,s.tB)() - v >= 3e5)
    return o.h.wait(()=>n(730852).default.disconnect()), e;
```

`v` is stamped when the connection reaches `RTC_CONNECTED` and refreshed on
every `RTC_CONNECTION_PING`, read against a monotonic clock. So: when the
gateway hands back a voice state for your own session and you have no RTC
connection, **rejoin** — unless your last voice ping is more than five minutes
old, in which case disconnect. `v` is cleared by `LOGOUT` and by a *deliberate*
teardown, so hanging up on purpose forgets it while dropping off does not. That
is what makes it a drop window specifically. **`v` is a module variable: after a
reload it is `null`, the guard does not apply, and the rejoin proceeds with no
client-side limit at all.**

**(b) `SelectedChannelStore` (309010) — the reload-side counterpart, on disk.**
On `CONNECTION_OPEN`:

```js
function k(){ … null != o && Date.now() - o >= 3e5 && (l = null, e = !0); return e }
```

`o` is `lastConnectedTime`, refreshed by a **60-second heartbeat while you are
in voice**; `l` is `selectedVoiceChannelId`. So across a reload, if you were in
voice less than five minutes ago the remembered voice channel survives; past
five minutes it is forgotten.

**Gateway and voice transport, for completeness.** The gateway backoff is
`new Backoff(1e3, 6e4)` — 1s to 60s, jittered — and `_doResume()` sends `RESUME`
with `{token, session_id, seq}`; after four consecutive failures `_reset` nulls
`sessionId` and `seq` and the next attempt is a full `IDENTIFY`. **`sessionId`
and `seq` are heap-only**, conspicuously absent from the persisted snapshot, so
a page reload can never resume the gateway. The voice websocket has its own much
tighter clamp, `new Backoff(1e3, 5e3)`, and its own `Resuming` state.

**Nothing auto-joins voice on startup.** Every `selectVoiceChannel(…)` call site
is a user action — a channel click, the `SWITCH_TO_VOICE_CHANNEL` keybind, an
RPC command, accepting a call — or an auto-*disconnect*: a five-hour idle kick
(`Gh.start(18e6, …)`) and the AFK-channel move. `VOICE_SERVER_UPDATE` is inert
without an existing connection. Zero hits for `resumeVoice`, `autoReconnect`,
`RECONNECT_TIMEOUT`, `disconnectTimeout`, `shouldResume`, `canResume`.

**So the guarantee the owner feels is produced by three things acting together**,
none of which we have: the voice channel id surviving in `localStorage` for five
minutes past the last heartbeat; the gateway re-announcing his voice state on
reconnect; and the server holding that voice state long enough for it to arrive.
Only the first is ours to build. The third is not observable from the bundle —
see section 13.

### Where ours differs from Discord's deliberately, and the reason

Two differences, both departures, both argued rather than preferred. CLAUDE.md
section 7 makes Discord the reference for this subject, so a departure owes a
reason here.

**1. We reload without a click; Discord never does.** The reason is that their
click is cheap and ours is not. Discord's reload returns you to the same channel
— the URL says which — and to the same voice channel, if you were in one within
the last five minutes. Ours returns you to the chat list and ends your call.
When accepting an update costs that much, people do not accept it, which is
exactly what happened: the owner ran a bundle two commits old for as long as his
tab stayed open. So instead of making the offer more insistent we made it
unnecessary **in the one state where it costs nothing** — no call, no
conversation open, and the tab hidden for a minute or untouched for ten
(`appUpdateNotice.ts`, `shouldRestartQuietly`). Where the click *is* expensive
we still do exactly what Discord does: offer, and never act.

The cadence is the second half of the reason, measured rather than felt.
`letscube-web` deployed **242 times in the 30 days to 2026-09-20**, 238 distinct
commits, median gap 28 minutes. Discord's stable channel gets a seven-day
throttle because it is a stable channel; ours ships more often than their
fastest one. That is also why our notice throttle is now an hour rather than
their seven days — and, by coincidence rather than by design, an hour is also
their poll interval.

**This difference expires.** Queue item 35 of
`docs/PRODUCTION_PRIORITY_TRACKER.md` is the standing rule that closes it: once
a reload restores the conversation and rejoins the call, our click is as cheap
as theirs and the automatic reload becomes an ordinary convenience rather than a
compensation.

**2. Our «in a call» is wider than theirs.** Discord's confirmation guards
`RTC_CONNECTED` only. Ours also covers `joining` and `reconnecting`, and any
live ring. `joining` is the state where a reload costs the most — the join is in
flight and there is nothing to return to — and `reconnecting` is their
`Resuming`, which under a reload is unrecoverable for us because we have no
rejoin at all. A ring is somebody calling you right now. The narrower guard is
right for a client that can rejoin; we cannot.


---

## 10. Subject 6 — Telegram's split

Telegram's clients are **separate codebases**. Unlike Discord, naming the client
routinely changes the answer. Read live 2026-09-20 from GitHub,
`web.telegram.org`, `telegram.org` and Apple's lookup API.

**There are six, not five.** `TelegramMessenger/Telegram-iOS` is iOS;
`overtake/TelegramSwift` is a **separate native macOS client**, listed
separately by Telegram (OFFICIAL, telegram.org/apps) and effectively
unmaintained on GitHub — no tags, no releases, last push 2025-09-22.

| Client | Version | Date | Mark |
| --- | --- | --- | --- |
| Desktop (tdesktop) | `v7.2.9` | published 2026-09-17; changelog says 16.09.26 | SHIPPED |
| Android (DrKLO) | **12.10.3 (7089)** | commit 2026-09-17 | SHIPPED |
| iOS | 12.9.4 | 2026-09-12 | OFFICIAL (App Store) |
| **Web A** (Ajaxy/telegram-tt) | **12.0.43** | `/a/version.txt`, last modified 2026-08-28 | SHIPPED (live) |
| **Web K** (morethanwords/tweb) | **2.2 (676)** | `/k/version`, last modified 2026-09-05 | SHIPPED (live) |
| **Telegram Air** (Web A in Tauri) | `air_v2.11.5` | published 2026-08-11 | SHIPPED |

**Three traps when grounding a Telegram version.** Android's GitHub *releases*
are two years stale — `releases/latest` returns 11.4.2 from 2024-11-20, and the
live version appears only in commit subjects. Web K has **zero tags and zero
releases**; its version lives in a committed `.env`. And `telegram-tt`'s tag
stream switched meaning in May 2025 from `v10.x` to `air_v2.x` — the `air_*`
tags are the **desktop wrapper**, not Web A's web version.

### Web A versus Web K — they share no code

| | Web A | Web K |
| --- | --- | --- |
| UI framework | **Teact**, its own React reimplementation | **SolidJS** |
| MTProto | a **GramJS** fork | its own implementation |
| Desktop app | **yes — Telegram Air (Tauri)** | none |
| RTMP live streaming | **no** | **yes** |
| Multi-party conference calls (E2E) | **no** | **yes** — 32 paths, landed 2026-05 to 2026-09 |
| Mono-forum / channel direct messages | **no** (7 spellings checked) | **yes** |
| Communities | shallow — 3 paths | deep — 34+ paths |
| Keyboard-shortcuts settings tab | not found | **yes** (in-page only) |
| Multi-tab sync | master/slave role election | `SharedWorker` plus `BroadcastChannel` |
| Local passcode | AES over three blobs | a general encrypted storage layer plus a lock screen |
| 1:1 voice and video calls | **yes** | **yes** (not a differentiator) |

Two cautions carried over from the research, because both nearly produced false
claims: Web A **does** have 1:1 calls and **does** encrypt local data behind its
passcode — a narrow grep suggested otherwise in each case. And Web K's own
`TELEGRAM_FEATURES.md` **is stale** — it marks conference calls as absent while
the tree has 32 files implementing them. Prefer the tree over the self-report.

### Telegram Air is the precedent for our Tauri shell

This is the most directly useful thing in this section. **Telegram took Web A's
identical web code and wrapped it in Tauri** to restore specific native
capabilities: a tray icon and unread badge (`tauri/src/tray/badge.rs`), native
notifications, window-title and title-bar-overlay control, and the `tg` deep-link
scheme. Bundle targets `app`, `nsis` and `appimage`. SHIPPED.

Two things about it are worth knowing before anyone cites it as an ideal.

**Its identifier ends in `Beta`** (`org.telegram.TelegramAirBeta`), and its own
`docs/TAURI.md` names a real remaining gap: clicking a notification to open the
right chat «is currently not possible», blamed on an upstream plugin issue.
**Our Tauri shell already solves exactly that** —
`desktop_take_pending_notification_route`, `PendingNotificationRoute` and the
deep-link handler route a notification click to a chat. On that specific point
we are ahead of Telegram's own web-in-Tauri desktop app.

**Its updater: two passes read this differently, and both are right.** One
found `createUpdaterArtifacts: false` in `tauri.conf.json` — so Tauri's bundler
does **not** emit the standard signed manifest and signature. The other found
the app calling Tauri's updater against a **static-JSON endpoint with Ed25519
and a 10-minute poll**, then download-and-install and relaunch. Both hold: the
artifacts are produced outside the bundler, and **the live endpoint is a CI
secret**, so the delivery path stays **UNESTABLISHED** from outside.

**Crucially, Air's `frontendDist` is a remote base URL — it does not bundle the
web app.** That gives it two independently updating layers, which is the same
shape as ours. That has its own section: see section 9.

### Capabilities absent from both webapps, with the mechanism

| Capability | Desktop / Android | Webapps | Mechanism |
| --- | --- | --- | --- |
| Separate updater process | tdesktop builds a second executable (`Updater`) | none | a running process cannot replace its own binary |
| Tray icon and unread badge | yes | none in the browser; **Telegram Air adds it back** | no web API for a tray |
| **OS-global keyboard shortcuts** | yes, customizable via a shipped defaults file | Web K has an **in-page** shortcuts tab only; neither can bind OS-global keys | browser keybindings are page-scoped |
| Biometric unlock of the local passcode | Windows Hello, Touch ID, Apple Watch; Android fingerprint | passcode keyed from the typed string only | platform biometric APIs |
| Native spellcheck | yes | browser-native only | OS dictionary APIs |
| Sending live GPS to a bot | **Android only** | neither | see the bot table below |

**And one that cuts the other way, which is why «native» is not a synonym for
«capable»: Telegram Desktop has no secret chats.** Zero paths in the whole `dev`
tree match `secret` or `encrypted` across 6,291 blobs; Android has
`SecretChatHelper.java`. Device-bound E2E chats exist on **Android and iOS
only** — the *desktop* client lacks them too. That is a native-versus-native
line, not a web-versus-native one.

Telegram also ships a first-party admission of a desktop gap:
`lng_bot_share_location_unavailable` — «Sorry, location sharing is currently
unavailable in Telegram Desktop.»

### Bots, per client

**`core.telegram.org/bots/features` describes the platform with no
client-dependency caveats anywhere, and does not describe the bot badge at all.**
That absence is the finding: the docs present bots as uniform, and they are not,
so every difference below is invisible from the documentation and has to be read
out of the clients. Citing that page for a UI claim is citing the wrong thing.

The bot label itself is a plain lowercase word in both native clients: Desktop
`lng_status_bot` is `"bot"`, Android's `Bot` string is `bot`. Desktop also has a
screen-reader-only `lng_sr_bot_verified_badge` = «Verified Bot», and an explicit
**show/hide reply-keyboard control** (`lng_bot_keyboard_show` /
`lng_bot_keyboard_hide`) that is a desktop idiom with no mobile equivalent.

**Reply markup does not render the same.** Read from the two decisive files —
Web A's `ApiKeyboardButton` union and Web K's render switch:

| Button type | Web A | Web K | Desktop | Android |
| --- | --- | --- | --- | --- |
| url, callback, webView, copy, requestPhone, buy, game, switchBotInline | yes | yes | yes | yes |
| **requestPeer** | **no** | yes | yes | yes |
| **requestPoll** | yes | **no** | — | — |
| **userProfile** | yes | **no** | — | — |
| **requestGeoLocation** | **no** | **no** | **refused outright** | **yes** |

Both webapps **degrade rather than break**: Web A has an explicit `unsupported`
button type rendered as a **disabled** button; Web K's switch has a `default`
case. Worth noting against section 8 — Telegram's webapps choose *inert* where
Discord's renderer chooses *hidden* or *explained*.

**Carry this into our bot work.** If a bot's reply markup depends on
`requestGeoLocation` it silently degrades on every surface except Android, and
Telegram Desktop refuses it in so many words.

### Updates, per client

**Moved to section 9**, where it sits beside Discord's and ours. Two details
belong here rather than there because they are about the split: tdesktop builds
its updater as a **separate executable**, compiled in only when the build is not
a store build — so Microsoft Store, Mac App Store, Snap and distro builds ship
**no updater at all, by build condition rather than a runtime check** — and the
2026-09-01 releases record a **signing-key rotation and then a revocation**,
which is what key rotation looks like when it reaches users.

### The places the split already bites this project

| Claim in our docs | True of | Not true of |
| --- | --- | --- |
| Hover actions on a message | **Desktop, Web A, Web K** | the touch clients. See D-071 |
| The client transcodes video and the server does not | Desktop, Android, iOS | **both webapps** — the gap D-175 closed with WebCodecs |
| In-app self-updating | tdesktop's own build | the store builds, which have no updater compiled in |
| A push-to-talk hold key | see below | see below |

**On push-to-talk (D-232), be precise about what is proven.** What is certain is
the mechanism: **a page cannot bind an OS-global key**, and the research confirms
neither webapp can — Web K's shortcuts tab is in-page only. So a hold key on any
web surface can only work *while the window is focused*, which is a materially
different feature from the one the native clients have. Whether Telegram's
webapps ship an in-page push-to-talk at all is **UNESTABLISHED**; I did not
verify it in either repository. The verdict on D-232 in section 11 rests on the
mechanism, not on a source-level absence.

Our own **D-264 is the model entry** in the register: it separates Discord's web
bundle, Telegram Desktop at `dev`, Web A and Web K, and grades each finding.
When in doubt, copy its shape.

---

## 11. The pass over what we have already written

A scan of `docs/INTERFACE_DEFECT_REGISTER.md` (214 matching lines),
`docs/PRODUCTION_PRIORITY_TRACKER.md`, `docs/operations/voice.md` and the last
120 commit messages. **Nothing below has been rewritten.** The verdicts are
recommendations for the lead and the owner.

There are two failure modes, and the second is the more expensive one.

### 10a. Claims that name no client

Roughly 35 are consequential. The five where naming the client changes the
verdict rather than merely improving the sourcing:

| Where | Claim | Verdict |
| --- | --- | --- |
| Register D-269 | «Its channel sidebar does not collapse at all» | **Survives, and is better than it looks.** Verified independently against build 615980: the collapse is in the source and `&& !1`-ed off. Add «web and desktop» — it is one bundle. It is **false of Discord mobile**, where the channel list is a swipe-away drawer, and the entry's rhetorical payload about the owner asking for something the reference lacks does not survive that |
| Register D-270 | «Discord's whole left region stops at 432px; its default is 375px total» | **Numbers confirmed exactly**, including the 355px channel list and the 76px rail. But see section 5: 432 is a product decision applied identically to web and desktop with no viewport term, so it should be put to the owner as «Discord chose 432», not «Discord's maximum» |
| Register D-267 | «Discord keeps [deafen] in the user area at all times» | **Qualify to web and desktop.** The user area is a renderer surface. Discord mobile has no persistent user area carrying deafen; against mobile our in-call-only deafen is parity, not a shortfall |
| Register D-232 | «Discord and Telegram both answer this with a gate and a hold key» | **Survives only for the native clients.** The mechanism is certain: a page cannot bind an OS-global key, so on any web surface a hold key works only while the window is focused — a materially different feature. Confirmed for Telegram: neither webapp can bind global keys, and Web K's shortcuts tab is in-page only. **Whether the webapps ship an in-page push-to-talk at all is UNESTABLISHED.** Either way «Рация» was shipped as parity with something the reference has in full only where it has a native process. Our Tauri and Android builds could have the real thing; our browser and PWA cannot |
| Tracker D-071 | «no hover actions at all, as in Telegram» | **Does not survive.** Telegram Desktop, Web A and Web K all have hover actions. Only the touch clients do not. The decision retired a lane and a line of layout on the desktop shell on the strength of «as in Telegram», meaning «as in Telegram on a phone» |

Honourable mention: the register contains, 200 lines apart, «their client
transcodes and their server does not» (D-176) and the WebCodecs work (D-175)
that exists precisely because Telegram's webapps do **not** transcode. One entry
undercuts the other's premise, and naming the client is the whole fix.

Lower-priority unqualified Discord claims, all of which I believe survive once
«web and desktop» is added, since they are renderer behaviour: the member-list
mute/deafen precedence (D-266), the mute toggle beside the slider (D-267), the
guild banner inside the channel-list panel (D-270), the shell grid (D-270), the
badge on a bot's message (D-263), badges on profile cards (D-168), member-list
ordering (D-168), name colouring in the message list (D-216), popout stacking
order (D-215), the voice-mode vocabulary and slider bottom end (D-232), the
250ms / 10% thresholds (D-217), account badges absent from the member list
(D-213), the bar at the foot of the chat-list column (D-225).

### 10b. Capabilities written off because a browser cannot

**This is the list the owner's correction was about.** Each is a place where an
entry reasoned from the browser to the product, and our Tauri or Android build
was never asked.

| Where | Constraint as stated | Written off |
| --- | --- | --- |
| Register D-231 | «And the browser cannot reach the media ports any other way» | **The entire pre-call connection test.** The entry's stated purpose is «so that nobody builds the dialogue later», and its body does not contain the words Tauri, Android, native, desktop or APK once. A Rust command can send a real STUN binding request to the media port; Android can too. On two of four surfaces the honest test is buildable |
| Register D-175 | «A browser cannot ask its encoder what it will really spend. Android can» | **The exact byte count on the video quality slider.** The entry names Android as the client that can, and never asks whether **our** Android APK could bridge `MediaCodec`. The estimate was measured 6x wrong on incompressible footage |
| Register D-176 | «A browser cannot do this today with WebCodecs the way a native client does» | **Uploading parts while the encoder is still producing them** — which the same paragraph calls «one thing worth copying outright». Both native shells can |
| Register D-227 | a suspended `AudioContext` with no gesture is a call with no sound, «so the range is 0..100%» | **The upper half of the per-person volume slider.** The autoplay-gesture policy is relaxable at shell level. Discord's 0..200% is reachable on both native shells and was capped globally |
| Register D-261 | the option space enumerated as the browser's own constraints plus a paid add-on | **A noise processor we control.** Android exposes `NoiseSuppressor` and `AcousticEchoCanceler`; a bundled RNNoise-class processor is a third option on Tauri. The entry's own finding — that a constraint is a request and `getUserMedia` may ignore it — is the argument for exactly that |

A caveat that keeps this honest: **both native shells are WebViews.** «The
browser cannot» is usually right about the rendering layer. What they have that
the PWA does not is the **bridge** — and section 2 shows the bridge is already
26 commands deep. None of the five entries above considered it.

**The fix in each case is not to build the thing. It is to say which surface it
is missing from.** D-264's update paragraph is the template.

---

## 12. How to repeat the Discord read

No login and no automation is needed; the bundle is public and self-dating.

```bash
curl -s -A "Mozilla/5.0 ... Chrome/140.0.0.0 Safari/537.36" https://discord.com/app -o app.html
grep -oE 'BUILD_NUMBER":"[0-9]+"|RELEASE_CHANNEL":"[a-z]+"|VERSION_HASH":"[a-f0-9]+"' app.html
grep -oE '/assets/web\.[a-f0-9]+\.js' app.html      # the main bundle
```

Then fetch that one file (about 12MB) and search it. Useful anchors:

- `supports(e){switch(e){` — there are two. The one containing
  `"Safari" !== ` is the **web** engine; the one testing the OS family is the
  **native** one.
- `isPlatformEmbedded` — every desktop-only branch.
- `minDimension` / `maxDimension` — the sidebar clamp.
- `DOWNLOAD_NAG`, `VIDEO_UNSUPPORTED_BROWSER` — the notice predicates.

**Two cautions learned doing it.**

Discord's CDN rate-limits bulk fetches. Attempting to pull all ~4,800 lazy
chunks got the connection cut partway through and returned the SPA shell (HTTP
404, about 45KB of HTML) for the rest — which looks exactly like a stale hash
and wastes an hour. Fetch the main bundle and the ~300 chunks referenced from
`app.html`; that is what a browser loads anyway.

The chunk-URL builder `T.u` is a ternary chain of about 246 current entries
followed by a fallback map. This section used to say «the fallback map's hashes
are stale and 404», and that was wrong about the mechanism — it cost one read
and nearly a second. **The hashes are fine; the filename shape differs.** The
ternary arm builds `"" + e + "." + hash + ".js"` and the fallback arm builds
`"" + map[e] + ".js"` — **no chunk-id prefix**. So
`/assets/518264.6f3937c74e05c1d1.js` is a 404 and
`/assets/6f3937c74e05c1d1.js` is a 200. With that corrected all 4,861 JS and
641 CSS fallback entries resolve; 890 of them were fetched on 2026-09-20 with
no throttling trouble, and the voice-settings chunk — a fallback-only entry,
which is why it had been unreachable — came down first try.

`support.discord.com` and `discord.com/developers` sit behind Cloudflare and
refuse scripted fetches; use a real browser. `discord.com/developers/docs/...`
now redirects to `docs.discord.com/developers/...` — the `/docs/` segment is
gone, so older links in our notes are stale.

---

## 13. What could not be established

Stated plainly, with what would settle each.

| Question | Status | What would settle it |
| --- | --- | --- |
| Whether Discord's voice settings panel **hides** or **greys** each unsupported control | **PARTLY SETTLED 2026-09-20.** The chunk was fetched once the URL-shape error in section 12 was corrected. For the input-sensitivity fieldset the answer is **greys**: present whenever the input profile is `CUSTOM`, `disabled` outside voice-activity mode, and absent entirely under the `VOICE_ISOLATION` and `STUDIO` presets. Whether every other control in the panel does the same is still open | read the remaining `buildLayout` entries (`rq, rL, rM, rN, rZ, rB, rX, rY, rI`) in module 460773 of chunk 922757 |
| The English label text for these settings in build 615980 | **SETTLED 2026-09-20 — the method, at least.** Strings are hash-keyed, and the hashes resolve: `n(121312)`/`n(422411)` map locale to chunk, 37 `"en-US"` loaders exist, and fetching all of them yields **28,264 key→string pairs**. Every English label in section 15 came from there. The voice-settings fieldset's own labels were not looked up in this pass, so that one remains open — but it is now a lookup rather than a limitation | read the keys out of the settings chunk against the string table; section 15.6 |
| Whether a first-party announcement of the BOT-to-APP badge rename ever existed | **UNESTABLISHED, leaning strongly to no.** Absent from Discord's April and May 2024 patch notes and from the September 2024 apps launch post. The current label is OFFICIAL — Discord's own developer docs say apps «appear in servers with an `APP` tag» | the 2024 developer-changelog entries (the rendered page truncates at about August 2025), or an archived help-centre snapshot. The Internet Archive was offline on 2026-09-20 |
| Where the APP badge appears per client — member list, DM list, profile popout, mention chips | **UNESTABLISHED.** Discord's first-party docs never enumerate it | a screenshot pass across the three clients. No amount of reading will close this one |
| Whether Components V2 has any **general** mobile limitation | **UNESTABLISHED.** The one citable report is scoped to *forwarded* messages | a first-party statement; none exists |
| Where **Telegram Air** fetches its update manifest | **UNESTABLISHED.** The mechanism is known — static JSON, Ed25519, a 10-minute poll — but **the endpoint is a CI secret** | nothing public will settle it |
| Whether Telegram publishes an official **iOS TestFlight** link | **UNESTABLISHED.** No such URL on telegram.org | a first-party link |
| Whether **Telegram Air** is a product or an experiment | **UNESTABLISHED, leaning experiment.** Not advertised on telegram.org at all, and its bundle identifier ends in `Beta` | a first-party announcement |
| Whether the standalone Android APK's self-update path is in the open-source tree | **UNESTABLISHED.** The telegram.org claim is OFFICIAL; the code path was not located | a content grep of the Android build-variable and loader classes |
| Whether Telegram's webapps ship an **in-page** push-to-talk | **UNESTABLISHED.** Only the global-key mechanism is proven | a content grep of both webapp repositories for the relevant call-settings code |
| Whether Web K handles `requestPoll` and `userProfile` outside its render switch | **UNESTABLISHED.** Absent from the decisive file | a repository-wide content grep, which needs an authenticated GitHub token |
| Whether the same inline keyboard **looks and reflows** the same across Telegram's clients | **UNESTABLISHED.** Button-type coverage is established; visual parity is not | screenshots of one bot's keyboard on all six. No repository read can supply this |
| **How long Discord's server holds a voice state after a gateway session dies** — the number that actually bounds rejoin-after-reload, and the one the owner described as «5 минут» | **UNESTABLISHED.** The client imposes no limit on that path: the in-memory 5-minute gate is `null` after a reload, and the persisted 5 minutes only governs whether the *channel id* is remembered. The rejoin itself waits on the server re-announcing the voice state | observation against a live account — reload, wait N, see whether you are put back — or a first-party statement. No amount of bundle reading will close it |
| Discord's **gateway resume window** (how long `RESUME` with a stale `seq` is accepted) | **UNESTABLISHED** from the bundle. Client-side it is unbounded, and `sessionId`/`seq` are heap-only, so a reload never resumes at all | the same observation, or Discord's own gateway documentation |
| Whether Discord's **voice** websocket has a resume *window* rather than only a resume *state* | **PARTLY.** The `Resuming` state and the 1s–5s backoff are SHIPPED; no timeout constant bounds them in the bundle | a voice-gateway documentation read, or instrumented observation |
| Whether Discord's localStorage **in-memory fallback** fires often enough in practice to degrade the 7-day throttle to per-session | **UNESTABLISHED.** The fallback class is SHIPPED and reachable; how often it is reached is not knowable from source | browser testing with site data blocked |

Two things that **are** established about Discord's bots and are worth recording
here because they bear on our bot work:

- **Components diverge per client continuously**, and Discord publishes no
  per-client component capability matrix and no mobile guidance in its component
  docs. The divergence surfaces only as monthly bug fixes. OFFICIAL, from
  Discord's own 2026 patch notes: an iPad accessory-button alignment defect
  (2026-08-04 and again 2026-09-08), an Android crash selecting a string-select
  option after the bot edited it (2026-06-04), a desktop Section/Thumbnail
  overflow (2026-07-07), and an iOS ordering defect where «the role icon and
  app/OP tag next to a username in chat appeared in the wrong order compared to
  Web and Android» (2026-08-04). **Per-client divergence in components is
  discoverable after shipping, not before — including for Discord itself.**
- **Context menu commands were redesigned 2026-03-03** (OFFICIAL, developer
  changelog): grouped by application, frequently-used first, searchable, and the
  per-type limit raised from 5 to 15. And **2026-09-11** added fuzzy autocomplete
  to slash commands, multiline string options, and selection persistence across
  channel switches. If we are building command discovery, those are the current
  shapes, not the 2023 ones.

---

## 14. The short version

1. Discord web and Discord desktop are **one bundle**; the split is
   `window.DiscordNative` plus 17 native modules. Layout numbers are identical.
   Voice capability is not.
2. Telegram's clients are **six codebases**. Name the one you mean. Its own
   platform docs describe bots as uniform across them, and they are not.
3. Our four surfaces are a browser, a PWA and **two WebViews with a native
   bridge**. The bridge is 26 commands deep already.
4. **Telegram Air is the precedent**: Telegram wrapped its own web client in
   Tauri to get a tray, a badge and native notifications back. Our shell is the
   same idea, and ahead of theirs on notification routing. **Like Air, our shell
   loads the app remotely and does not bundle it** — so shell and content update
   independently and can drift. Section 9.
5. «A browser cannot» is a statement about one of our four surfaces. Finish the
   sentence. And «native» is not a synonym for «capable» — Telegram Desktop has
   no secret chats and refuses to share a location with a bot.
6. A control that cannot work here is **absent** here. Discord's own third
   option — keep it and point at the client that can — is available to us and is
   a product decision, not a default.

---

## 15. Subject 7 — the person behind the conversation, the row menu, and the two searches

Queue item 36. The owner asked for four things on 2026-09-20 with fourteen
Discord screenshots, and the reference is Discord by section 7.

**Provenance for everything marked SHIPPED here.** Read 2026-09-20 from
`discord.com/app`, stable, `BUILD_NUMBER 615980`, `VERSION_HASH
2ae1bc1225ba4bf504c4d700814c349182721466`, main bundle
`/assets/web.d793fc00a2d44795.js` (12,082,177 bytes). The chunk map from `T.u`
resolves **5,108 ids** (247 ternary + 4,861 fallback); **4,321 chunks were
fetched, 132 MB, zero HTTP failures**, at parallelism 6. Module numbers below
are webpack module ids in that build and can be looked up again.

**The locale chunks were read, so English labels below are exact.**
`n(121312)`/`n(422411)` map locales to chunks; 37 `"en-US"` loaders exist, the
main one chunk `1868` (1.42 MB). All 37 give **28,264 key→string pairs**. This
**retires section 13's row** «The English label text for these settings in
build 615980 — UNESTABLISHED. Strings are hash-keyed and live in per-feature
locale chunks». They are hash-keyed, and the hashes resolve.

Ours, below, is read out of this worktree at `00b8e86e` and is SHIPPED in the
same sense.

---

### 15.1 The profile: two surfaces, and the thing that actually keeps them honest

**Discord has two, and a third and a fourth. SHIPPED.** Module **518477** is the
shared vocabulary, and `R7` is the enum the whole family is parameterised on:

```js
R7 = {POPOUT, MODAL, MODAL_V2, SIDEBAR, ACCOUNT_POPOUT, ACTION_SHEET, YOU_SCREEN, EMBED}
RP = {FEATURED, USER_INFO, BOT_INFO, ACTIVITY, MUTUALS, MUTUAL_GUILDS,
      MUTUAL_FRIENDS, BOT_DATA_ACCESS, WIDGETS, WISHLIST, MAIN}
```

Module **207634** is one table keyed by it — POPOUT draws an 80px avatar over a
300×105 banner, MODAL 120 over 600×210, MODAL_V2 120 over 400×140, SIDEBAR 80
over 340×120 — and each presentation passes its own tag into the same three
hooks (`layout`, the locations hook, `themeType`).

**But the bodies are different components**: popout **851588**, human modal
**808261** (MODAL_V2), bot and restricted modals **577593**, sidebar a component
in chunk 192461. They share the leaf components — bio, roles, connections, note,
the overflow menu — not a root.

**So the answer to «why do they not drift» is not the one this project assumed,
and the correction is the single most useful thing in this subject.** They do
not drift because of the **store**, not because of the component. Popout and
modal both read `(0,O.Ay)(userId, guildId)` (module 999291 → `UserProfileStore`,
module **321191**), and both reach one fetch path (module **903209**) which
refuses to ask twice:

```js
if(""===e||c.A.isFetchingProfile(e,f))return Promise.resolve();
…C=Date.now()-(N?.fetchEndedAt??0)>=6e4;
…if(!b&&!M)return Promise.resolve();
```

In flight → no-op. Cached, fresher than **60 seconds**, and no newly-requested
field missing → no-op. The popout is a **view of the same rows**, and a
component that drew something else would be drawing it from the same data.

**The one seam, and it is a real one.** The two sides request different fields:
the popout asks `withMutualFriends` (the list), the modal asks
`withMutualFriendsCount` (the number). So escalating popout→modal *can* refetch
for a field the popout never wanted. Discord accepts that; it is the price of
the small surface being genuinely smaller.

**The escalation control. SHIPPED.** String key `+Xp3hq` = **"View Full
Profile"**. In the popout it is an item inside the overflow («…») menu — not a
button at the bottom — module 984545, `id:"view-profile"`, and its action is:

```js
function K(e){ k?.(); W.dispatch($.jej.POPOUT_CLOSE);
  (0,m.openUserProfileModal)({sourceAnalyticsLocations:V, hideRestrictedProfile:!0, ...M, ...e}) }
```

Close the popout, then open the modal. It is suppressed in the game overlay
(`disableUserProfileLink = __OVERLAY__`). The **sidebar** presentation carries
the same string as a real full-width secondary button. The **modal** does not
carry it at all — its overflow slot (module **722868**) offers «View Main
Profile» / «View Per-server Profile» with the subtext «AKA {displayName}»
instead. There is also a separate **"View Full Bio"** (`YDiPq8`) in the popout's
bio block that opens the modal.

`UserProfileModalManager` (module 403777) is a Flux store keyed
`` `USER_PROFILE_MODAL_KEY:${userId}:${guildId??""}` ``, and the modal is
`openModalLazy` behind **660** chunks where the popout body needs 350 — the
small surface is genuinely cheaper to open.

**The modal's tabs. SHIPPED**, built inside 808261 for humans:

1. **Board** (`laViwx`, `RP.WIDGETS`) — conditional
2. **Activity** (`chq59f`) — unconditional
3. **Wishlist** (`7lZ31J`) — self, or another and visible
4. **N Mutual Friends** — another user only
5. **N Mutual Servers** — another user only

**There is no «user info» tab.** Bio, roles, connections and the note render in
the body, and the tabs are only for the things that are lists. Bots get
`[Bio, N Mutual Servers, Data Access]`. With streamer mode on the whole tab area
is replaced by «Streamer Mode Enabled».

**Where a popout can be opened from. SHIPPED**, by reading the importers of
wrapper module 342296 — ten in the main bundle, about twenty-two more in chunks:
a message author's avatar and username (two separate anchors), the author of a
replied-to message, an interaction's user and its **target** user, a guild
member-list row, a thread member list, a role-settings member row, **a voice or
call participant — popout only when there is exactly one participant**, an
inline `<@id>` mention chip, an avatar facepile, and small 24px avatar buttons.

The **modal** is opened directly, without a popout, by: the `/users/:id` route,
a `discord.com/users/<id>` link clicked inside a message, activity-member rows,
a friend-request notification, and widget cards (which pass `tabSection` and a
`scrollTarget`, so a card opens the modal *on the right tab, scrolled to the
right block*).

Two behaviours in the message renderer worth stealing the thinking from:
**shift-clicking a username inserts a mention instead of opening anything**, and
a blocked or spam message draws a placeholder card rather than an author you can
press.

**UNESTABLISHED:** «bite size» / `bitesize` as a Discord concept — **zero**
matches across the 12 MB main bundle and 132 MB of chunks. So are the
identifiers `UserProfilePopout`, `ProfilePopout`, `UserProfileSections` and
`viewFullProfile`; the real names are `R7` and `RP` in 518477, and
`USER_PROFILE_POPOUT` exists only as the analytics string «user profile popout».

#### The popout is **anchored**, and that is a mechanism rather than a style

Recorded on 2026-09-21, after the first build of our two-tier profile drew the
small surface as a centred modal and a review against the rendered pixels caught
it. Worth stating plainly here, because the reading above describes *what* the
two surfaces are and never said *where* the small one stands.

Discord's popout appears beside the thing you pressed — an avatar, a username, a
mention chip. The conversation behind it is neither moved nor dimmed, and the
message the reader was in the middle of stays lit. That is not decoration:
**it is the entire reason the small tier is cheaper than the large one.** The
popout exists for the glance — a name goes past, a second of context is wanted,
and reading continues — and a centred card takes the eye to the middle of the
screen and hands it back to a conversation that has left attention. A surface
that costs the reader their place is not a cheap surface, whatever it contains.

Two consequences follow, and both are now ours:

1. **Dismissal follows placement.** An anchored popout goes away on a press
   outside it, on Escape, and on a scroll — the last one sharpest, because the
   card is anchored to a box that has just moved. A centred modal's ✕ and
   backdrop are not the same set, and a tier that moves has to take its
   dismissal with it.
2. **A popout with nothing to point at is not a popout.** Where no anchor can be
   supplied, the honest answer is the full surface, not a summary in the middle
   of the screen.

**UNESTABLISHED, and cheap to establish if it ever matters:** Discord's exact
alignment — whether the popout's top is level with the avatar, centred on it, or
merely clamped — was not read out of the bundle. Ours top-aligns, and the reason
is stated where the arithmetic lives (`lib/messageMenuPlacement.ts`): an
avatar's height is the thing about a message row that varies least, so aligning
the tops keeps the card in the same place for every row it is opened from. If a
later read contradicts it, that is a number to change rather than a shape.

#### Ours, and what this changes about the plan

D-283 restored the capability by extracting `MemberCard` and giving it a second
container. What this read corrects is the **reason** that is safe. The D-283
entry says the two surfaces «do not drift because the small one is a summary of
the large one» — that is the *shape*; the **mechanism** is that both read one
store through one gated fetch. Ours does not have that yet: the overlay reads
`profiles` fresh on every open, and the panel reads its own member list. Two
reads of the same row, no shared cache, no in-flight gate.

**So the two-tier design, when it is written, owes a store before it owes a
component.** Building a compact popout beside the card without one would give us
two components reading two queries — which is exactly the drift the
consolidation was defending against, arriving through the door we just opened.

What is worth taking, in order, and each is a mechanic rather than an object:

1. **One profile store with an in-flight gate and a freshness window.** Discord
   uses 60 seconds. Everything else here depends on it.
2. **The small surface as a different component reading the same rows**, not a
   parameterised root. Discord proves the split is maintainable when the data is
   shared; it does not claim the markup should be.
3. **The small surface is anchored to what opened it**, and its dismissal
   follows from that — see the section above, which the first pass of this
   reading omitted and a render caught.
4. **The escalation as one explicit control** that closes the small surface and
   opens the large one. Discord hides it in the overflow menu on the popout and
   promotes it to a full-width button on the sidebar — the same string, placed
   by how much room there is. At 390 that argues for the button.
5. **Tabs only for lists.** Bio, roles and the note belong in the body; the
   tabs are Mutual Friends and Mutual Servers, which are lists, plus the
   activity surfaces. Our card already stacks the group's roles above LETSCUBE's
   badges in the body, which is the same instinct.
6. **A card opened from a specific place may open on a specific tab, scrolled
   to a specific block.** That is what `tabSection` + `scrollTarget` is for and
   it is cheap.

Refused, with the reason: **Board, Wishlist, Connections and Mutual Friends
presuppose objects we do not have** — an activity feed, a wishlist, linked
external accounts and a friends graph. «Mutual servers» has an honest analogue
— groups and channels in common — and that one is worth having.

---

### 15.2 «Глубина функционала не соответствует»: the row menu

**Discord's DM row menu, in shipped order. SHIPPED**, module **385913** (chunk
439778) for a 1:1 DM, `navId:"user-context"`, `aria-label:"User Settings
Actions"`. Right-click and the kebab share one handler (module 715069) and
differ only in the impression name. Group DMs get module **4027**
(`navId:"gdm-context"`). Each has a second variant for the **Favorites**
pseudo-server, `guildId === "373"` (module 349828).

Separated into Discord's own groups:

1. **Mark As Read** / **Mark Unread**
2. **Pin** / **Unpin**; **Add to Favorites**
3. *(stage items, null in a DM)*
4. **Open in New Tab**; then for non-bots **Profile**, **Start a Call**, **Ring
   to Call** / **Stop Ringing**, **Add Note** / **Edit Note**, **Add / Change
   Friend Nickname**, **Watch Stream**; then **Close DM**
5. *(User Volume — gated off for a sidebar row)*
6. **Join** / **Invite to Join** / **Invite to Listen Along** / **Ask to Join**,
   when the person has a joinable activity
7. **Frequently Used Commands**, **View Verification Code**, **Invite to
   Server** (a submenu of eligible servers), **Add Friend** / **Remove Friend**,
   **Add Game Friend**, **Remove Game Friend**, **Ignore** / **Unignore**,
   **Block** / **Unblock**
8. **Mute Conversation** / **Unmute Conversation**, submenu *For 15 Minutes /
   For 1 Hour / For 3 Hours / For 8 Hours / For 24 Hours / Until I turn it back
   on*
9. **Remove from Favorites**, `color:"danger"`
10. Six safety-warning items, every one suffixed **«(Experimental)»**
11. **Copy User ID**, **Copy Channel ID** — **developer mode only**:
    `if(__OVERLAY__||!(_||E)||!d.p5||null==t)return null`

**The most transferable fact in this list is not an entry.** It is how much of
it is conditional: `isNonUserBot()`, `isManaged()`, self, the friend / blocked /
ignored relationship, developer mode, `hidePersonalInformation` (streamer mode),
whether the person has a joinable activity, and staff-only flags. The long menu
in a screenshot is the maximum, not the norm — and Discord puts its own
developer affordance behind a setting rather than in front of everybody.

#### Ours, and the separation the owner asked for

Ours, read at `00b8e86e`. Right click, a 520 ms long press, or the `ContextMenu`
key from a focused row; same list, two containers.

| conversation | entries, in order |
| --- | --- |
| private, a person | Открыть · Открыть профиль · Поиск в чате · Закрепить/Открепить · *(Переместить выше/ниже — pinned only)* · Отключить уведомления *(one row; five while the durations are open)* · **Очистить историю у себя** · **Удалить чат у себя** |
| private, a bot | the same, minus «Открыть профиль» (D-283) |
| «Избранное» | Открыть · **Очистить избранное у себя** — two |
| group / channel | Открыть · Информация о группе/канале · Поиск в чате · Закрепить · *(moves)* · уведомления · **Очистить историю у себя** · **Покинуть** or **Удалить** |

**Mechanics we are missing and already have the machinery for:**

- **«Пометить как прочитанное».** `mark_chat_read` and
  `mark_chat_read_through` exist and are called from inside a conversation; the
  row draws an unread badge to 99+; **no menu entry writes it**. Discord leads
  its menu with this one, and it is the single cheapest entry on this page.
  Its opposite — «Отметить непрочитанным» — is a product decision, because it
  needs a watermark the row can be drawn from rather than a write.
- **«Позвонить».** Voice exists and the conversation's header carries the
  control; the row does not. Discord separates **Start a Call** from **Ring to
  Call**, which is worth copying only if our ring is separable; it is one action
  today.
- **«Заблокировать» / «Пожаловаться».** `user_blocks` exists and is reachable
  from the contact card. Discord puts it on the row.
- **«Пригласить в группу».** Our analogue of «Invite to Server», and the
  machinery is `GroupInviteModal`. A submenu of eligible groups is the shape.
- **«Открыть в новой вкладке».** Newly meaningful: a conversation has an
  address as of `054bf8ee`, so this is now a link rather than a wish.

**Discord's object model, not a gap in ours** — and this is the distinction the
owner asked for in point b:

- **Add / Remove from Favorites** is the `"373"` pseudo-server. We have folders,
  and section 7 makes **Telegram** the reference for folders, so ours is already
  answered by a different and deliberate model. Not a missing entry.
- **Add Friend, Remove Friend, Friend Nickname, Add Game Friend** presuppose a
  **friends graph**. We have none. «Мы не добавили пункт меню» is the wrong
  reading; the right one is «мы не приняли решение о модели друзей».
- **Watch Stream, Join, Invite to Listen Along, Ask to Join** presuppose an
  **activity and presence model**. That is queue item 37's subject, not this
  one, and it should be decided there.
- **Frequently Used Commands** is the bot model; D-263 owns it.
- **View Verification Code** is Discord's own account plumbing.
- **Copy User ID** is a developer affordance — and Discord agrees: it is behind
  developer mode. Refused, as D-266 already refused it.
- **Speak on Stage / Invite to Speak** — no stages.

**One entry that is a real product decision rather than either:** **Add Note**,
a private annotation about a person, visible only to you. It needs no friends
graph, no servers and no activity. It is the one entry in Discord's menu that we
could have, do not, and have never discussed. Recorded here as a decision to
take, not a gap to close.

---

### 15.3 «Поиск удобно показывает что можно сделать»: two searches

#### Discord's in-chat search. SHIPPED

**Twelve filters parse; nine are offered; three are unreachable.** The grammar
is module **304578**, and the filter words are *localised strings* rather than
literals (`B(e)=e+":"`, `V(e)=RegExp(e+":","i")`):

| token | en-US | answers | API key |
| --- | --- | --- | --- |
| FROM | `from:` | snowflake, `@me`, `name#0000`, `[a-z0-9_.]{2,32}` | `author_id` |
| MENTIONS | `mentions:` | same | `mentions` |
| HAS | `has:` | image, video, link, file, embed, sound, poll, sticker, forward | `has` |
| IN | `in:` | a channel | `channel_id` |
| BEFORE | `before:` | `YYYY-MM-DD` \| `YYYY-MM` \| `YYYY` \| a word | → `max_id` |
| ON | `on:` or `during:` | same | → a snowflake range |
| AFTER | `after:` | same | → `min_id` |
| PINNED | `pinned:` | `true` \| `false` | `pinned` |
| AUTHOR_TYPE | `authorType:` | user, bot, webhook | `author_type` |
| LINK_FROM | `linkFrom:` | a host | `link_hostname` |
| FILE_TYPE | `fileType:` | an extension | `attachment_extension` |
| FILE_NAME | `fileName:` | a name | `attachment_filename` |

Date shortcuts `today, yesterday, week, month, year`; a leading `-` negates an
answer; unmatched text falls into `content`. The eligibility list (module 5990)
is exactly nine in this order — from, in, has, mentions, on, before, after,
authorType, pinned — with `from`/`mentions` dropped under
`hidePersonalInformation`. **`linkFrom`, `fileType` and `fileName` are never in
it.** They parse if typed and nothing offers them.

**That is our own defect, in Discord.** It is the shape
`tests/unit/search-type-filters.test.mjs` was written for — a capability that
exists, is correct, and has no consumer. Worth knowing before we treat Discord's
search as finished.

**The bar is one Slate rich-text input**, `role="combobox"`,
`aria-autocomplete="list"`, max **512** characters (module 742788). Parsed
tokens are **decorated in place** (module 494606 paints FILTER and ANSWER leaves
with different classes), so the filters read as chips *inside* the field rather
than beside it, and backspacing inside a token deletes the whole token.

**Clicking a filter inserts its prefix and does not search. SHIPPED**, module
**618989**:

```js
onSelect(r){ … t({query:`${i} `, performSearch:!1, replace:!1}) }
```

The popout on an empty focused field is **four rows and an escape hatch**:

- **From a specific user** — `from:`, sublabel *user*
- **Sent in a specific channel** — `in:`, *channel*
- **Includes a specific type of data** — `has:`, *link, embed or file*
- **Mentions a specific user** — `mentions:`, *user*
- **More filters** (`diOL4i`), sublabel **«dates, author type, and more»** — or
  **Add search filters** (`M1tf+7`) when nothing else shows — which opens a
  **modal**, not a longer list
- a **History** group: the last five queries from `localStorage`, with a trash
  control *Clear Search History*, suppressed under `hidePersonalInformation`
- in a DM, a leading **Find in {channelName}** row that inserts `in:<channel>`

**The Filters modal** (module 561965, modalKey `"search-filters-modal"`): title
**Filters**, *Cancel* / **Apply Filters**, a **Clear Filters (N)** counting
active values, and fields in order **From** (multi-select, «Sent by any of the
selected users»), **In**, **Has**, **Mentions**, **Date** (a repeatable row of
before/during/after with a calendar, **at most four**, earliest 2015-05-15),
**Author Type**, **Pinned**. Applying writes a query string into the same bar.

**Completions exist and are asymmetric. SHIPPED**, `SearchAutocompleteStore`
(module 692986), three modes. With the cursor **inside** a filter token: one
group of up to **10**. With the cursor **outside** one: up to **3 each**, and
only for `from`, `in` and `mentions` — and **nothing at all until something is
typed**. `from`/`mentions` list people (with `@me` hoisted when the typed text
prefixes «me»); `in` lists channels with the current one hoisted; `has` and
`authorType` list their fixed sets; the date filters show a calendar; `pinned:`
offers literally `true` and `false`.

#### Discord's quick switcher. SHIPPED

**Five prefixes, and no sixth.** Module **926140**:

```js
AT = {USER:"@", TEXT_CHANNEL:"#", VOICE_CHANNEL:"!", GUILD:"*", GAME_PROFILE:"$"}
if(t===AT.USER && e.charAt(1)===AT.USER) return [e.slice(2), rD.USER_GLOBAL];
```

`@@` widens users to everybody. **There is no `>` prefix in this build** — the
map has exactly five entries and the strip regex is generated from them; nothing
resembling a sixth exists in 144 MB. The footer protip (`BGHbLb`) names all
five and links a help-centre article; a **second, stale** string (`qHKbUw`)
still says «Characters like @, #, !, and * will narrow Quick Switcher results»
and has never been updated for `$`. In prefix mode the list gets a mode header —
«Searching Text Channels», «Searching Servers», and so on.

**The empty-query list is four sections, not one. SHIPPED**, module 174768, in
this order: **Previous Channels** (from a persisted history, iterated from index
1 so the current channel is skipped, permission-filtered) · **Drafts**
(`getRecentlyEditedDrafts`, filtered to channels you can still post in) ·
**Mentions** (`getMentionChannelIds()`, iterated **backwards** so the newest is
first) · **Unread Channels** (unread, unmuted, parent-unmuted, plus joined
unread threads).

Then the truncation, which is the detail worth keeping:

```js
let u = r.length>0 ? 3 : 7;
if(s.length>u) s.splice(u);
```

**Previous Channels shows seven when it is the only section and three when
anything else is present.** Headers are their own row type and arrow-key
navigation skips them.

**Scoring. SHIPPED**, module **802842** — a five-step quality ladder multiplied
by a real frecency booster:

```js
exact 10 · prefix 7 · contains 5 · all-tokens-present 3 · fuzzy 1 · none 0
score = 1000 * quality * booster
booster = 1 + frecency/maxFrecency,  + .2 for a friend,  + .1 for somebody you have a DM with
```

so the booster lives in `[1, 2.3]`, invalidated on frecency, relationship and
private-channel version changes, with a locale tie-break.

Two things the bytes say that a screenshot would not, recorded because a later
reader will otherwise re-derive them:

- **`_applicationResults` is computed and never merged.** `updateAllResults`
  spreads eight arrays and applications is not one of them — verified
  byte-exact. Applications are queried, clamped, cleared and counted, and can
  reach the list only through the empty-query branch under a `queryMode` no
  prefix maps to. Dead or nearly dead **in the bundle**; whether a user ever
  sees it is **UNESTABLISHED** without a live client.
- **The result limit is fixed by the first search of a session.** `i = i ?? new
  d.Ay(…, null!=n?100:5, …)` is memoised, so the 100-or-5 chosen by the first
  query's mode sticks until the switcher is destroyed.

#### Ours

- **In-chat search already parses the grammar and offers none of it.**
  `useChatMessageSearch` calls `parseAdvancedSearchQuery(query, "message")`, so
  `from:@anna has:image after:2026-09-01` works inside a conversation today.
  `ChatSearchPanel` renders `SearchFilterChips`, which **returns `null` when
  `parsed.chips.length === 0`** — it *removes* what somebody typed and offers
  nothing. The phone's `ChatSearchBar` is a bare field with the placeholder
  «Поиск в чате…»: no chips, no hint, no menu. **The mechanism is wired and the
  affordance does not exist**, which is precisely the owner's complaint.
- **Our grammar** (`lib/searchQuery.ts`) has six filters — `type:`, `from:`,
  `in:`, `has:` (file, link, image, video, audio), `before:`, `after:` — with
  quoted values and an alias table. Against Discord's twelve we are missing
  `mentions:`, `on:`/`during:`, `pinned:` and `authorType:`; the last two map
  onto things we have (pinned messages, and bots).
- **Global search** has the nine type pills with counts, sections, an active
  index, a dismissible syntax hint, and **Ctrl/Cmd+K** to focus and clear the
  field from `md` up. **On an empty query it shows nothing but the pills and the
  «ПОИСК» heading** — `showEmpty` requires `parsed.query.length > 0`. No recent
  conversations, no unread, no mentions.

**What to take, separated from what it presupposes:**

1. **The empty-focus filter popout, and click-inserts-prefix-without-searching.**
   Four rows, each naming what it does in a sentence with the syntax as the
   sublabel. This is the whole of the owner's «даёт выбрать нужную функцию
   нажатием», it teaches the grammar we already have, and it needs no new
   backend.
2. **Completions for `from:` and `in:`** — people and chats we already list.
   Discord's asymmetry is worth copying too: nothing until something is typed,
   so an empty field is an offer and not a dump.
3. **A «Ещё фильтры» surface.** Discord's is a modal with seven fields, a
   «Clear Filters (N)» counter and a repeatable date row capped at four. At 390
   ours would be a sheet.
4. **The quick switcher's empty state**, which is the honest answer to «Куда
   отправимся?»: recent conversations, then unread, then mentions, with the
   current one skipped and headers the keyboard steps over. **Drafts is a
   section we could have and do not** — we keep composer drafts.
5. **The frecency booster** as a mechanic — a usage score times a match-quality
   ladder — rather than pure recency. The relationship bonuses (+0.2 friend,
   +0.1 DM partner) need a friends graph for the first and are free for the
   second.
6. **The prefix vocabulary as a taught thing.** Ours has no prefixes at all;
   the type pills do that job by pressing. Whether to add prefixes is a real
   choice, and Discord's own stale help string is an argument for keeping the
   vocabulary small: five prefixes and one of them was still undocumented in
   its own hint when this was read.

**Refused, with the reason:** `$` game profiles (no games), `*` servers (our
folders are Telegram's model, per section 7), Listen Along and activity rows
(item 37), and Discord's search **History** group **pending a decision** — it is
five past queries in `localStorage`, which is a privacy choice on a shared
computer, and Discord itself suppresses it under streamer mode.

---

### 15.4 The chat list, where we are ahead

The owner judged this one favourably — «исполнен также удобно» — and named the
one thing Discord's DM list lacks that Telegram's has, and that ours has:
**the last message on the row.**

Ours draws, per row: an avatar with an online dot, the name, **the last message
prefixed with its sender's display name**, its time, an unread badge to 99+, a
mute glyph, a group read-receipt mark, a voice-presence mark, and — for pinned
rows — the whole row as a drag grip.

**Discord's DM row content was not established from the bundle** and is recorded
as the owner's observation rather than as a read: this pass followed the menu,
the profile and the two searches, and the row's own markup was not traced.
**UNESTABLISHED** from the bundle; the screenshots are the evidence.

**The rule that follows, and it binds the rest of item 36:** whatever is adopted
from Discord's status and presence presentation must not cost the row its last
message. That line is the reason the list reads as a conversation list rather
than a contact list, and it is the one place in this subject where the argument
runs the other way.

---

### 15.5 What could not be established

| Question | Status | What would settle it |
| --- | --- | --- |
| A «bite size» / bitesize profile concept in Discord | **UNESTABLISHED.** Zero matches in 144 MB | nothing in the client; it is not a shipped identifier |
| Whether Discord's dead `_applicationResults` path is ever visible | **UNESTABLISHED** | a live client; no read will close it |
| Whether the «(Experimental)» safety-warning DM items render for ordinary accounts | **UNESTABLISHED.** The labels are shipped; the gate was not traced | a live account, or the flag's definition |
| What Discord's DM list row itself draws | **UNESTABLISHED from the bundle** | trace the row component, or take the owner's screenshots as COMMUNITY |
| First-party documentation for any of the above | **not attempted** | Cloudflare refuses scripted fetches; section 12 |

---

### 15.6 Two corrections to section 12's method

Both were paid for during this read.

1. **Chunk ids that appear in `n.e()` but are missing from the `u` map are
   *initial* chunks**, which webpack excludes from that map on purpose. They are
   listed in `app.html`. About thirty were chased as stale before this was
   worked out. `.js.map` is a 404 — the SPA shell — so there are no sourcemaps.
2. **The locale chunks are readable and worth reading first.**
   `n(121312)`/`n(422411)` map locale → chunk; 37 `"en-US"` loaders yield 28,264
   key→string pairs. Every hash-keyed label in this section came from there.
   Without it a reader is guessing at `+Xp3hq` and `diOL4i`.

And one repeat of a mistake this project has already recorded: **analysis
scripts written through a Bash heredoc lose backslash escapes** (a module-header
regex silently matched nothing, twice). Write them with a file, and pass
`MSYS2_ARG_CONV_EXCL='*'` when a string key like `/AXYnE` goes through argv, or
Git Bash turns it into a path under the Git installation.
---

## 16. Subject 8 — the type, and the gesture on a message row

**The first reading in this document taken off a physical device rather than a
bundle.** The owner connected an Android phone over ADB on 2026-09-20 and
authorised going anywhere in his account. Everything here is marked **MEASURED
ON DEVICE — 2026-09-20**, which is a stronger mark than SHIPPED for a question
about rendered pixels and about what a finger does, and a weaker one for
anything about code paths that were not exercised.

The device, because every number below is in its units:

| | |
| --- | --- |
| model | `A063` (Nothing Phone 1, `Spacewar`), Android 15 |
| screen | 1080 × 2400, density **420**, so **1 dp = 2.625 device px** |
| system font scale | **0.92** — below default, which matters and is picked up again below |
| Telegram | **12.10.3** (`70892`) |
| Discord | **345.9** stable |
| ours | `com.kub.messenger` **0.1.5** (build 6) |
| Chrome / WebView | 153.0.8010.49 / 151.0.7922.199 |

**The privacy rule this was run under.** Access was authorised; exposure was
not. Telegram's «Настройки чатов» carries a *synthetic* message preview and the
size slider, and that is where the type was measured — it holds nobody's data.
The gesture had to be measured in a real conversation, and was measured
structurally: the accessibility tree filtered to labels already expected, and
single horizontal **scanlines** off the screen, which show where a bubble
begins and ends but cannot carry a sentence. No frame of a conversation was
written to disk, and none is reproduced anywhere.

### 16.1 The type — MEASURED ON DEVICE, 2026-09-20

The tester said «мелко» four times and guessed at the cause: «либо сам формат
шрифта такой». That is four different repairs — face, size, weight, contrast —
so all four were measured rather than one assumed.

**Telegram, at its default setting, dark theme.** The setting reads **16** and
the slider's range is **12 to 30**, established by dragging it to each end and
reading the value back, then restoring it to 16 and verifying the label. That
is **75% to 187.5%** of the default, so the tester's «125%» (= 20) sits
comfortably inside what Telegram offers. Telegram sizes this text in **dp, not
sp**: at font scale 0.92 the rendered em is 16 × 2.625 = 42 device px, which is
what the ink measures, so the system accessibility setting does not reach it.

**Ink, measured on the rendered pixels of both apps on the same screen, same
theme, same threshold**, using the flat-topped `н` for x-height and a round
capital for cap height:

| | Telegram (Roboto 16dp) | ours (Inter 14px) | ours ÷ theirs |
| --- | --- | --- | --- |
| em | 42.0 device px | 36.75 device px | 87.5% |
| x-height (`н`) | **23 px** | **20 px** | **87.0%** |
| cap height | 32 px | 26 px | 81.3% |
| x-height ÷ em | 0.548 | 0.544 | **99.3%** |

**So the face is not the defect, and that is the finding.** Inter's x-height
relative to its em is within 1% of Roboto's as these two engines actually
render them, which is inside the ±1px the measurement can resolve. Adopting
Telegram's face — the tester's own first proposal — would move the readable
height of a line by about nothing. The 13% is the nominal size and only that.

**Nor is contrast**, which was the fourth candidate. Ours is the better of the
two in dark (13.92:1 against Telegram's 13.19:1) and is 18.94:1 in light; the
time beside a message is 7.55:1 in light and 8.19:1 in dark. Weight is 400 on
both sides.

**The face does load, and that was proved rather than assumed.** `Inter` is
fetched from `fonts.googleapis.com` by `index.html`, in the APK's bundled copy
as much as on the web, and `document.fonts.check` answers `true` for a family
that never arrived — the trap this register already carries. It was proved by
laying «Знаешь, который час?» out at 16px with the page's own stack (174.59px)
and again with `Inter` struck out of it (166.55px), which is exactly the width
`Roboto` gives. Different widths, so Inter is the face in use. The corollary is
worth keeping: **the face is a network dependency**. With the font host
unreachable — and the tester's own report opens with a VPN dropping — the
product renders in Roboto, one size down, and `display=swap` means the first
paint is Roboto anyway.

**What we read and what we type disagree, on the same screen.** The message
body is `text-sm leading-relaxed` = 14px/22.75px; the composer is
`text-base sm:text-sm`, which on a phone is **16px/24px**. Confirmed on the
device through its own Chrome against the DEV preview fixture: body 14px,
composer 16px, both Inter 400, `devicePixelRatio` 2.625, `text-size-adjust`
100%. So what he types is 14% larger than what he reads — and 16px is, to the
pixel, Telegram's default for *both*.

**Ours: no text-size setting of any kind.** Telegram's slider is 12–30.

### 16.2 The gesture on a message row — MEASURED ON DEVICE, 2026-09-20

The owner's instruction was «это по аналогии с телеграммом сделай действиями
влево/вправо по сообщению». The measurement says the analogy is half real, and
the half that is not is worth stating plainly rather than relabelling.

**Swipe left is reply. Swipe right does nothing at all.** Under a slow, stepped
drag that provably works in the other direction, a right-hand drag of 300
device px moved the bubble by **zero pixels** and produced no panel, no sheet
and no menu; a fast `input swipe` in that direction did nothing either. There
is no forward gesture in Telegram Android to copy.

The left gesture, in device px and in dp:

| | device px | dp |
| --- | --- | --- |
| slop before the row moves | ~70 | **~27** |
| travel after the slop | 1:1 with the finger | 1:1 |
| maximum travel | 210 | **80** |
| fires between | 120 (no) and 130 (yes) | **46 → 50** |

It fires **during** the drag, not on release, and the row springs back under
the finger. While the finger is down a circular backdrop about 66 device px
(25 dp) across, with a white arrow in it, is drawn in the row's free margin,
vertically centred. A gesture abandoned below the distance does nothing at all.
On commit a reply panel 123 px (47 dp) tall appears above the composer and the
keyboard opens. The same gesture works on a media message.

**Against ours, before D-287 changed anything:** our reply swipe started at 12,
travelled to 64 and fired at 48 — in CSS px, which on this device are dp.
**Our commit distance was already Telegram's** (48 against 46–50, measured
independently). We start sooner and travel less far. What we had no equivalent
of is the right-hand direction, because Telegram has none either.

**Method note, because it changes what the numbers mean.** Each
`adb shell input motionevent` costs 150–300 ms, so these drags took seconds.
They are therefore distance measurements under a slow drag; a fast flick may
commit on velocity and was not separable with this instrument. Since Telegram
commits mid-drag on distance, distance is the governing rule either way. One
drag was slow enough that Telegram read it as a long press and opened the
context menu instead — which is itself a useful reminder that these two
gestures share a beginning.

### 16.3 Where ours now differs on purpose

D-287 adds a right-hand gesture that Telegram does not have, which CLAUDE.md §7
permits as bettering the reference so long as the difference is written down
rather than claimed as adoption. Three deliberate divergences, each with a
reason rather than a preference:

1. **Right is forward.** Ours, not Telegram's. Forwarding was the other thing
   the tester could not reach on a photo, and a photo is where a long press
   does not help, because its opener is a `<button>` and the tap belongs to the
   viewer.
2. **The row starts moving at 12dp, not 27.** The arrow is the only thing that
   tells anybody the gesture exists, and a row that does not move until 27dp
   announces it late.
3. **The action fires on release, not mid-drag.** Telegram can fire early
   because its only outcome is a reply bar, which is cheap to undo. Our right
   half opens a modal, and a modal appearing under a finger that is still
   moving is the wrong kind of surprise.

**One thing neither client can have**, and it is the likeliest reason Telegram
left the direction alone: a swipe that begins inside the system's
gesture-navigation edge is the operating system's back, not the app's. That
falls on the right-hand gesture of a left-aligned bubble, and nothing in a web
view can take it back.

### 16.4 The correction — the right direction was never free

**Written the same day, after the owner read the above: «вправо делать тогда
не надо, в telegram это позволяет выйти из чата.» He is right, and the way the
measurement went wrong is worth more than the conclusion it reached.**

16.2 recorded that a rightward drag moves a Telegram bubble by **zero pixels**
and inferred that the direction was unclaimed. The bubble does not move
**because the whole screen does**: a rightward swipe in a Telegram conversation
is back-to-the-list. Re-measured afterwards on the same device, by asking
whether the composer was still on screen rather than whether the bubble had
moved: **three times out of three from mid-screen**, and again from either
edge, the conversation closed. (One row at a different height did not close it,
twice, and that is unexplained — probably a horizontally-scrollable element
under the finger. It does not change the answer.)

**The lesson, and it belongs in the method section as much as here: the probe
asked «does the message move» when the question was «is the gesture
available».** An element that does not react to a gesture is not evidence that
the gesture is free — something above it may be consuming the whole sequence.
Measure the *outcome*, not the element you expected to react. This is the same
shape as «an empty result means unknown», one layer up: the negative was real,
and it was a negative about the wrong thing.

### 16.5 Android's gesture navigation owns **both** edges — MEASURED, 2026-09-20

Read off both of the owner's phones, because it changes the gesture that is
being **kept**, not only the one that was removed:

| | A063 (Nothing, 1080×2400 @ 420dpi) | RMX3830 (Realme) |
| --- | --- | --- |
| `navigation_mode` | `2` — gesture navigation | `2` — gesture navigation |
| `systemGestures` inset, left | 78px = **30dp** | 60 of 720 = **30dp** |
| `systemGestures` inset, right | 78px = **30dp** | 60 of 720 = **30dp** |
| `mandatorySystemGestures`, bottom | 84px = 32dp | — |
| `back_gesture_inset_scale_*` | `null` — not configured, so 30 is the platform's own | — |

So the back gesture lives at **both** edges: a rightward drag begun at the left
is back, and **a leftward drag begun at the right is also back** — and the
leftward one is our reply swipe.

**Neither app asks for an exemption.** `mSystemGestureExclusion` was empty with
our shell in the foreground and empty with Telegram's, at the moments it was
read. The mechanism exists —
`View.setSystemGestureExclusionRects`, native, capped by Android at 200dp of
vertical extent per edge — and is reachable from a Capacitor shell. We do not
use it.

**What we do instead, and why.** A row swipe **refuses to begin inside either
inset** (`swipeMayStartAt` in `@/lib/messageSwipe`). Refusing is predictable;
starting and being torn away mid-drag is the worst of both. The strip this
costs is smaller than it sounds and was measured rather than assumed: at a
390px viewport a message row spans **12 to 378**, so the overlap with the
insets is about **18px on each side**. An earlier version of the test pressed
at 382 — off the row entirely — and passed with the guard deleted; it is
pinned at 20 and 368 now, with the control at 40.

**Three-button navigation has no edge gestures at all**, and there the refusal
costs that 18px strip for nothing. Only native code can read
`navigation_mode` — the web layer has no standard signal, and
`env(safe-area-inset-*)` does not carry it. One behaviour serves both until
somebody wants the strip back badly enough to plumb it through the bridge.

**UNESTABLISHED, and deliberately so:** whether a drag begun inside the inset
reaches our web layer *at all*. The Chrome-side probe built for it failed its
own mid-screen control — a known-good gesture did not fire either — so it
cannot speak to the edge, and an instrument that cannot produce a positive
proves nothing by a negative. The APK-side probe was abandoned for a different
reason: reading our own conversation through the accessibility tree exposes
message content, which this document's privacy rule does not allow. The
refusal above is therefore belt-and-braces rather than a measured necessity,
and it is cheap enough to keep either way.
---

## 17. Subject 9 — the phone survey: what the shell costs, and where a bot reaches

Same device and same privacy rule as section 16, same day. **MEASURED ON
DEVICE — 2026-09-20** unless a claim says otherwise. This is the first
three-way reading — Telegram 12.10.3, Discord 345.9 and ours, one screen, one
theme — and the disagreements between mobile Discord and the web bundle read on
the same day are the most valuable part of it, because decisions already rest
on the web reading.

Two standing constraints on how to read it. CLAUDE.md §7 gives Telegram the
conversation, media viewing, folders and bots, and Discord everything else — so
outside those areas a Telegram difference is **not** a gap, and is marked as
such below rather than filed as one. And a difference noticed by eye is a
hypothesis: only the ones measured are here.

### 17.1 Mobile Discord disagrees with the web bundle, and that is a finding

**The settings. THEIRS IS DIFFERENT FROM THEIR OWN WEB CLIENT — and ours
followed the web one.** On the phone Discord's settings are a **plain
full-screen scrolling list**: full width (1080), full height, rows of **147 px
= 56 dp**, a back arrow at the top left, section headings between groups, and
drill-down. There is **no rail, no inset overlay and no two-pane**. The web
client's large inset overlay with a left rail — read from bundle 615980 on the
same day, section 5 — is a desktop shape that Discord itself abandons when the
width is a phone's.

That does not overturn D-285, which was about a *desktop* window that was as
narrow as the chat list; it does say the shape has a width below which Discord
stops using it, and we have no equivalent boundary written down. **Worth
recording as a question, not a defect.**

**The bottom band, against item 40's three zones.** Item 40 describes Discord's
desktop bottom bar as avatar/name, the audio toggles and the gear. On the phone
that band is **avatar + name + status at the left** (a button roughly 758 × 84
px) and **one notifications button at the right** (144 × 84 px, badged). **The
gear is not there at all**: tapping the avatar opens a **full-screen «Вы»
sheet** whose own bottom row holds three buttons, of which the rightmost is
«Настройки». A voice connection, when there is one, is a **separate strip
above** the band, full width, about 81 px tall. So on a phone the three zones
become two plus a drill-down, and the audio controls live with the call rather
than with the identity.

**The update notice: the question does not exist on a phone, and saying so is
the answer.** Both apps update through Google Play. There is no in-app
update-and-reload path to compare with the web client's, and the two-layer
update problem of section 9 has no mobile form. **UNESTABLISHED by design** —
nothing was measured because there is nothing there to measure.

**The profile.** Not established on the phone. The web finding (a popout and a
full modal sharing one store) was not re-tested here, and item 36's design
still rests on the web reading alone. **UNESTABLISHED.**

### 17.2 The chat list: structure or filter, which is item 47's question

**Discord's rail is real on a phone, and it is 72 dp of permanent screen.**
Measured: a vertical rail **189 px = 72 dp wide**, pinned to the left edge of
the whole shell, with the direct-messages button at the top and then one
**48 dp avatar per server** in rows of **60 dp**. Thirteen servers are on
screen at rest and the rail scrolls past that — it is an `AbsListView`.

That answers the genuine unknown directly: **the rail is a separation of
kinds, not a cure for volume.** Servers never enter the direct-message list, so
the noise the owner describes cannot form *between* categories. Inside a
category it forms exactly as before: his rail is already a scrolling column of
identical circles, distinguishable only by picture. What the rail buys is
**one gesture** between categories — a tap on the rail is a whole context
switch, always in the same place, never scrolled to.

**Telegram already has type separation, and it is a folder rule rather than a
filter.** Its folder editor has a «Типы чатов» block of five switches —
**Контакты, Не контакты, Группы, Каналы, Боты** — above a list of individual
chats. So «боты отдельно» is expressible today, in Telegram, exactly as the
owner wants it. What it costs is the construction: Настройки → Папки →
Создать папку → Добавить чаты → Боты → назвать → Создать. Six steps, once, and
the result is a **permanent tab** in a strip of **184 px (70 dp) per tab**
across the top of the chat list. Chat rows themselves are **185 px = 70.5 dp**,
and rows that carry a second line run **239 px = 91 dp**.

**So the owner's «небольшая капсула фильтрации по типу чатов» is not a thing
Telegram lacks — it is a thing Telegram makes you build.** That reframes item
47: the complaint is not that type separation is impossible, it is that it is
opt-in, manual, and indistinguishable afterwards from any other folder. He has
six tabs and still says «шум из чатов».

**What each costs, which is what item 47 asked for:**

| | Discord (structure) | Telegram (folder) |
| --- | --- | --- |
| on screen at rest | 72 dp of rail, always | 70 dp of tab strip, always |
| categories that can mix | none — servers and DMs never share a list | all of them, unless a folder is built |
| gestures between categories | **1** (tap a rail avatar) | 1 (tap a tab) **after** the folder exists |
| cost to create a category | none — it is the data model | 6 steps per folder, by hand |
| what a category holds at volume | a scrolling column of 48dp avatars | a scrolling list of 70dp rows |
| bots | no category of their own | **a first-class type switch** |

**The trade, stated rather than resolved — and §7 does not settle it.** §7 gives
folders to Telegram and the shell to Discord, and this question is on the seam,
so it goes to the owner:

- **Structure** (Discord's answer) makes the separation free and permanent, and
  item 45's three shapes already contain it: a server is not a chat and would
  not be in the chat list at all. It costs 72 dp of width forever, and it does
  nothing about volume *within* people-and-groups, which is where «людей тоже и
  групп очевидно не меньше» lives.
- **Filter** (a capsule over one list) costs nothing at rest, keeps one place to
  look, and can separate people from groups from bots — which structure alone
  does not. It is a view, so it forgets; a category is only ever as good as the
  last tap.

The honest reading of his own sentence is that he is asking for **both**:
«у нас тем более будут сервера, групповые чаты и личные сообщения между
людьми». Servers are a structural object (item 45 already makes them one);
people, groups and bots then remain in one list, and that list is where a
capsule earns its place.

**Where bots sit, sub-question 2.** Telegram's chat list gives a bot **the same
row as a person** — no badge, no section — and only the conversation reveals it,
by the shape of its composer (17.3). The one place «бот» is a first-class kind
is the folder type switch. Discord's DM list treatment of bots was **not
established** on this pass. Ours matches Telegram's default: a bot conversation
is a private chat by type, which is precisely why they mix in.

**What folders are then for, sub-question 3.** If type separation becomes
structural plus a capsule, folders stop carrying it and become what they are in
Discord's absence of them: a **personal grouping across types** — «работа»,
«семья» — which is the only job left that neither structure nor a type filter
does. Say it in the product, or folders will be asked to do both and do
neither.

### 17.3 The bot menu button, and what it costs the composer

The owner asked for this specifically. Measured on Telegram's own demo bots
rather than in any personal conversation: `@DurgerKingBot`, Telegram's
published Web App demo, and `@BotFather`.

**There are three shapes in that one slot, and the composer pays a different
price for each.** All four rows measured on the same device, same chat layout:

| the slot holds | text field | against an ordinary chat |
| --- | --- | --- |
| nothing (a chat with a person) | **662 px = 252 dp** | — |
| «Команды бота», a 44 dp icon to the *right* of the field | 536 px = 204 dp | **−48 dp, −19%** |
| «Меню бота» with a default label (BotFather) | 434 px = 165 dp | **−87 dp, −34%** |
| «Меню бота» with the bot's own label (Durger King) | **328 px = 125 dp** | **−127 dp, −50%** |

**A bot with a Web App menu button halves what you can type.** The button sits
at the far left, where the field would start, and it is as wide as the label
the bot chose — 210 px for the default, 316 px for Durger King's. That is the
collision to design around if we adopt anything here: our composer already uses
that position.

**What the button opens, for the Web App shape.** A full-screen web view
**inside** Telegram: a Telegram-drawn header of **283 px (108 dp)** carrying a
back arrow, the bot's name and two more controls, and below it a `WebView` of
**1080 × 2054 px** — the entire rest of the screen. **The conversation is not
underneath**; it is replaced, and the header's back arrow is the way out. The
demo's content is an ordinary product grid with its own buttons, so the bot is
drawing a real application, not a message.

**Consent is asked once, by the client, before any of that.** The first tap
produced a centred dialog of **977 × 497 px** naming the bot and what opening
it would hand over, with «Отмена» and «Открыть». The bot cannot open its own
surface without that.

**Who decides it is there.** The bot does — through the Bot API — and an
ordinary chat has nothing in that position at all. A bot that has never been
started shows neither: before `/start`, the whole composer band is replaced by
a single full-width **«Запустить бота»** button.

**Read against ours (D-263, item 43).** Our bot platform is a chat platform: a
sent `/command` is inert text, a hand-typed `/cmd` in a group is silently
dropped, and a bot's profile answers nothing. So of the three shapes above we
have none — not even the cheapest, the 44 dp «Команды бота» icon, which is the
one that costs the composer least and would answer D-263's first complaint
directly.

**Which reference gives a bot more reach, and at what cost.** Telegram's Web
App is the larger reach by a wide margin: a bot gets the whole screen, an
arbitrary web application, and a client-drawn frame that keeps the user
oriented and asks consent. Discord's answer is narrower but cheaper — its
components (section 7) are drawn *by the client* inside a message, so a bot
composes from a fixed vocabulary and never ships a web application. The cost
follows: Telegram asks a bot author for a hosted web app and asks the client
for a consent flow and a full-screen host; Discord asks for neither and gets
nothing outside the message. **For us the staged reading is that Discord's
in-message components are the reachable next step and Telegram's Web App is a
platform decision**, and §7 leaves bots contested on purpose — the owner rates
Discord's implementation higher «из-за большей кастомизации и удобства».

### 17.4 Two side effects of this pass, recorded so nobody hunts them

- Telegram's message text size was moved to each end of its slider and
  **restored to 16**, verified by reading the label back.
- A chat with `@DurgerKingBot` now exists in the owner's Telegram, because the
  Web App shape cannot be seen before `/start`. Nothing else was sent, and it
  can be deleted.

### 17.5 What this pass did not establish

- ~~**Discord's profile on a phone** — popout versus modal, and whether they
  share a store. Item 36 still rests on the web reading.~~ **Half of this was
  measured on 2026-09-21; see 17.7.** There is no popout on a phone at all, so
  the first half of the question dissolved rather than being answered. Whether a
  store is shared there is still unestablished.
- **How Discord's DM list marks a bot**, if it does.
- **Ours on the same screen for anything but type.** Our row heights, viewer and
  attach flow were not measured on the device this pass; the comparisons in
  17.2 are Telegram against Discord only.
- **Telegram's composer growth ceiling**, which item 46 (e) needs: ours is 140px
  and the reference number was not taken.

### 17.6 The face is now ours — 2026-09-20

Recorded here because it is where the type measurement lives, and because the
reason is **not** the one somebody will assume.

Until this date `index.html` pulled Inter from `fonts.googleapis.com` with
`display=swap` and **nothing was bundled**, in the APK's copy as much as on the
web. So the first paint was always the fallback, a phone with a blocked or slow
network read the product in Roboto indefinitely, and every client announced
itself to a third-party host on every cold load. The tester's report of the same
day opens with a dropped VPN, so **he may have been judging a face we did not
ship**.

It is now served from `/fonts/inter/`: **four files, 174 KB, for all four
weights**. Google serves one *variable* woff2 per subset — verified by hashing
the sixteen files its stylesheet points at and finding four distinct ones — so
`font-weight: 100 900` is the honest declaration and the sixteen-file reading
this project's first attempt produced was 695 KB of the same four files. Greek
and Vietnamese are not shipped; those scripts fall back to the system face, as
every script did before this change.

**The reason is reliability and privacy, not legibility, and 16.1 is what keeps
that honest**: Inter's x-height relative to its em is 0.544 against Roboto's
0.548, a difference inside what the measurement can resolve. Swapping the face
was never going to help the tester read anything. Somebody will ask.


## 18. Subject 10 — the viewer's sequence, the composer's ceiling, and what HD says

**Second device pass, 2026-09-20**, same phone as section 16 (`A063`, Android
15, 1080 x 2400 at density 420, so 1 dp = 2.625 device px; Telegram 12.10.3).
Taken to settle three questions item 46 left open — (b), (c) and the composer —
each of which was about to be answered by taste instead.

**The privacy rule, and how this pass kept it.** The type and the composer were
measured in Telegram's own settings screen and in a chat with a **published demo
bot**, neither of which holds anybody's data. The photo viewer was measured in
the **public channel `@telegram`**, so the pictures crossed are published ones
rather than the owner's. The attach sheet had to be opened over the owner's own
gallery: no frame of it was ever rendered — every capture masked all of the
screen but the two bands being read — and one tap opened the camera by mistake,
whose capture was deleted unviewed in the same breath. Nothing was sent. Every
device capture taken for this pass was deleted once it had been read, and none
is in the repository.

**Two settings of the owner's were changed and both were put back and read
back**: the text-size slider (dragged to 30 and returned to 16, verified by the
label) and the picker's HD badge (toggled to SD and returned to HD, verified by
the glyph).

### 18.1 The photo viewer's sequence — MEASURED ON DEVICE, 2026-09-20

The question item 46 (b) leaves open is not «wire the prop» but **what the
sequence is**: every picture in the conversation, the ones loaded, or the ones
in that message. Telegram answers it in the header.

Opening a picture from the feed of `@telegram` drew:

| | |
| --- | --- |
| header line 1 | the chat's name |
| header line 2 | that item's own date and time |
| below them | **«237 из 244»** |

**244 is the whole chat's media**, orders of magnitude past what the feed had
loaded — Telegram keeps a shared-media index per chat and the viewer browses it.
So the unit is **the chat**, not the message and not the album.

A swipe **left** moved it to **«238 из 244»**. So:

- **forward is left**, which is what `mediaSwipeStep` already does;
- **1 is the oldest**: this item is dated 19 July and the channel's newest post
  is 25 August, so the index rises with recency and «next» walks **towards the
  newer end** — the direction the reader was already travelling down the feed;
- **«N из M» is the wording**, character for character what
  `mediaPositionLabel` has produced since D-171. Nothing to adopt there.

**Where ours differs on purpose (D-288).** The order is chronological and the
count is «N из M», as above. What ours cannot have for nothing is Telegram's
*total*: we keep no per-chat media index, and querying one before the viewer
could open would put a round trip in front of a tap. Ours is therefore the media
of the **loaded conversation**, and stepping off its old end asks the
conversation for its next page of history. The label hedges — «3 из 7+» — which
is the same `+` the counted rows use and is true, where a bare «7» would be a
claim this surface has not read.

Note also that «Общие медиа» is newest-first and its viewer steps that way,
while this one is oldest-first. That is deliberate: **the viewer's order is the
order of the surface that opened it.** Giving the conversation the grid's order
would make «next» walk the reader back up the chat they were reading down.

### 18.2 The composer's ceiling — MEASURED ON DEVICE, 2026-09-20

Measured by typing filler into a demo bot's composer and reading the `EditText`
bounds back after each addition. Nothing was sent; the draft was cleared and the
field verified back at one line.

| lines | height, device px | dp |
| --- | --- | --- |
| 1 (at rest) | 107 | 40.8 |
| 3 | 219 | 83.4 |
| 4 | 275 | 104.8 |
| 5 | 331 | 126.1 |
| 6 | **387** | **147.4** |
| 7+ | 387 — it scrolls | 147.4 |

So the step is **56 device px (21.33 dp)** a line over **51 px of padding**, and
**Telegram Android's composer stops at exactly six lines**. Ours stopped at
five: a fixed 140px over a 24px leading.

**The correction, and it is the useful part.** Section 16.1 and item 46 both
say Telegram's «Размер текста сообщений» slider governs the message body *and*
the composer. **It does not.** Dragged to 30, the composer's resting height
(107 px) and its line step (56 px) came back byte-identical to the readings at
16, while the settings screen's own synthetic preview grew visibly — so the
slider took effect and the composer ignored it. The earlier claim came from
noticing that Telegram's default is 16dp for both and inferring the rest.

What is true is narrower and still useful: **at Telegram's default the two
agree**. Binding ours (D-289) is how we get that agreement at *every* setting
rather than only at one, and CLAUDE.md §7 requires that to be written down as
ours rather than claimed as adoption — which this paragraph is.

### 18.3 What Telegram's HD says, and how long it remembers — MEASURED, 2026-09-20

Item 46 (c). Ours is a per-send pill in the send bar that reads «HD» whether or
not HD is on, with «качество» only in a tooltip a phone never shows.

Telegram's, measured in its picker's photo editor:

- **It is the third of four tools** in the editor's toolbar — crop, draw,
  **HD/SD**, adjust — with the send button outside the capsule to its right.
- **The badge is the state, not the name.** It reads **SD** when the photograph
  will go at the ordinary resolution and **HD** when it will not, in a rounded
  outline box either way.
- **Pressing it says what it will do, in words**, as a tooltip above the
  toolbar: «Фотография будет в **высоком разрешении**.» and
  «Фотография будет в **обычном разрешении**.»
- **The word is «разрешение».** Never «качество», and never «без сжатия» — which
  is the honest description of the mechanism, because HD raises a resolution cap
  and stops no compression. Ours does exactly the same thing (1280 at 0.76
  against 2560 at 0.90) and said «качество», which is what the tester read as
  «без сжатия» and why he expected 5 MB.
- **It is remembered across sends.** Set to SD, backed out of the picker,
  reopened, a photograph opened again: still SD. Restored to HD afterwards.
- **The default state observed was HD.** Ours is SD, by the owner's instruction
  of 2026-09-13 («по стоку загрузку в sd качестве»).

**What was adopted (D-290):** the state badge and the wording, including the
sentence at the moment of pressing — with one line more than Telegram draws,
naming «Отправить без сжатия», because that is the path the tester was actually
reaching for and nothing told him it existed.

**What was not, and is the owner's to settle:** the memory. Ours resets every
send, and `AttachSheet` carries a note saying so deliberately, because D-119's
objection was to a quality question that was asked every time *and* then applied
for ever. Telegram's answer is the middle one — never asked, remembered when
chosen — and the tester's own words («с включенной настройкой HD») say he
expected ours to behave that way. Recorded in the tracker under item 46 rather
than changed here.

### 18.4 What this pass did not establish

- **Telegram's «send as file» path on Android** was not measured: reaching it
  means long-pressing the send button with a photograph selected, and a misread
  there sends somebody's picture. The iOS shape D-119 was built from stands
  unre-verified.
- **The viewer's paging behaviour at the far end of a long chat** — whether
  Telegram loads more media when a finger runs past what it holds — was not
  measured; only that its count is the whole chat's.
- **Our own surfaces were not measured on the device this pass.** Everything
  about ours above is from the source and from the browser at 390 and 1440.

### 17.7 The phone's profile, and the third divergence — MEASURED ON DEVICE, 2026-09-21

17.5 listed «Discord's profile on a phone» as unestablished and said item 36's
design rested on the web reading alone. It no longer does.

**Device and method.** `P212C6000159`, Discord 345.9, 1080x2400 at 420 dpi
(411 x 914 dp). `adb exec-out screencap` only — **no uiautomator**, per the rule
this document records after a WebView handed message text to the accessibility
tree. Captures were analysed in Python for band boundaries and edge colours and
deleted; no content was recorded and none is repeated here. One tap was made
inside a conversation (a message author's avatar) and the device was returned to
its launcher afterwards.

**What a face opens on a phone: the full profile, immediately.**

- The surface is a **page, not a sheet and not a card**. Its banner spans
  x = 0..1079 — the whole 411 dp, edge to edge — so there is no inset and no
  rounded card corner; the ground at the left edge above the banner reads
  rgb(6,5,9) and below it rgb(0,0,0), against the conversation's rgb(15,12,26)
  two taps earlier, so the surface is opaque and the conversation is not behind
  it. There is no scrim.
- Geometry: chrome at about 76 dp from the top, banner top at 114–122 dp and
  about 130 dp tall, the avatar overlapping below it, then the name, then a
  **row of two buttons of 184 dp each** at 16 dp margins with a ~13 dp gutter,
  about 40–45 dp tall, at roughly 415–455 dp down the page. Sections continue to
  the bottom of a scrolling page.
- **No popout is drawn on the way.** The press goes straight to the full
  surface.

**So mobile Discord has one profile tier, and that is the third place it
contradicts its own web bundle** — after the settings shape and the bottom band,
both in 17.1. The pattern is now firm enough to state as a rule for this
project: a Discord shape read from the web bundle is a **desktop** shape until a
phone has been checked, and the phone's answer is usually «one full-screen
surface where the desktop had two».

**What it decided in our design.** `artifacts/kub/src/lib/profileTier.ts`:
below `PROFILE_COMPACT_MIN_WIDTH` (768, this product's `md`) every opener —
a glance or a named act — lands on the full card, and that card is the phone's
whole screen rather than a small centred dialog. The compact tier exists only
where there is a *beside* for it to stand in.

**Still not established, and not guessed at:** whether mobile Discord's profile
and any other surface share a store the way the web client's popout and modal do
(§15.1). Nothing on a phone exposes that, and our own store was built from the
web reading, which is the half that was measurable.
