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
| Discord web | reload; the served bundle carries `BUILD_NUMBER` and `VERSION_HASH` | nothing, normally. Plus a standing `DOWNLOAD_NAG`. INHERITED / SHIPPED |
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
followed by a fallback map; **the fallback map's hashes are stale and 404.**
Only the ternary entries resolve.

`support.discord.com` and `discord.com/developers` sit behind Cloudflare and
refuse scripted fetches; use a real browser. `discord.com/developers/docs/...`
now redirects to `docs.discord.com/developers/...` — the `/docs/` segment is
gone, so older links in our notes are stale.

---

## 13. What could not be established

Stated plainly, with what would settle each.

| Question | Status | What would settle it |
| --- | --- | --- |
| Whether Discord's voice settings panel **hides** or **greys** each unsupported control | **UNESTABLISHED.** The capability gate is proven; the panel component lives in a lazy chunk I could not fetch before being rate-limited. The device-selector pattern in section 8 is a data point, not the whole panel | fetch the voice-settings chunk from an unthrottled connection, or look at the panel in a browser signed in to Discord |
| The English label text for these settings in build 615980 | **UNESTABLISHED.** Strings are hash-keyed and live in per-feature locale chunks | same |
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
