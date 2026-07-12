# LETSCUBE Native Release Catalog And Distribution Design

Date: 2026-07-12
Status: draft for implementation review; product direction approved

## Objective

Make iOS Home Screen PWA the only installed PWA target, while Android uses a
dedicated APK and Windows uses a dedicated EXE. Provide a self-hosted release
catalog so clients can check whether a native package exists, compare versions
where a packaged runtime is available, and start a download from a Russian
server without depending on GitHub Releases or another foreign SaaS.

Normal browser access remains supported on Windows and Android. The product UI
must not offer PWA installation on those platforms.

## Domain Decision

Use `https://api.letscube.ru/releases/`.

The hostname already resolves to the LETSCUBE production server and is recorded
as a reserved future API endpoint. It currently has no Coolify route, so
Traefik serves its default self-signed certificate. The rollout must create an
explicit Coolify/Traefik route and obtain a valid public TLS certificate before
clients use it.

No new DNS record is required. The release catalog owns only `/releases/`, so
other future API paths can be routed independently later.

## Server Architecture

Use a small read-only static HTTP service rather than an authenticated upload
API:

- persistent host root: `/srv/letscube/releases`;
- public artifact root: `/srv/letscube/releases/public`;
- manifests under `/releases/v1/{platform}/{channel}.json`;
- artifacts under `/releases/files/{platform}/{version}/...`;
- supported platforms: `android` and `windows`;
- initial channel: `stable`;
- Nginx or an equivalently small static container runs read-only;
- Coolify/Traefik terminates TLS for `api.letscube.ru`;
- manifest responses use `Cache-Control: no-cache` and ETag;
- immutable versioned artifacts use long-lived cache headers;
- directory listing is disabled.

Publishing is SSH-only. There is no public HTTP upload or manifest mutation
endpoint. A repository-managed server script receives platform, channel,
version and artifact path, validates them, computes size and SHA-256, copies the
artifact to a temporary name, renames it atomically, and atomically replaces the
manifest. The script never reads application secrets and never logs credentials.

The `techadmin` user receives only the filesystem group access and narrowly
scoped sudo command needed to run the publisher. Release files remain outside
the Git repository and outside application containers.

## Manifest Contract

Each platform/channel manifest is a bounded JSON document:

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "channel": "stable",
  "available": true,
  "version": "0.1.0",
  "build": 1,
  "publishedAt": "2026-07-12T00:00:00Z",
  "minimumSupportedVersion": null,
  "mandatory": false,
  "notes": "Internal LETSCUBE release",
  "artifact": {
    "url": "https://api.letscube.ru/releases/files/android/0.1.0/letscube-0.1.0.apk",
    "size": 12345678,
    "sha256": "lowercase-hex-sha256"
  }
}
```

When a package is not published, the manifest remains valid with
`available: false` and `artifact: null`. Clients validate schema version,
platform, channel, SemVer, HTTPS origin, bounded notes, non-negative size and a
64-character lowercase SHA-256 before using the response.

Windows publishing later also places Electron updater metadata and blockmap
files under the same immutable version directory. The product manifest remains
the source for Settings status, while Electron's generic updater consumes its
own generated metadata from the same server.

## Client Detection And Refresh

Add one typed release-catalog client and one shared hook:

- request timeout: 5 seconds;
- cache the last valid response with its fetch timestamp;
- normal refresh TTL: 6 hours;
- recheck when Settings opens if the cache is stale;
- recheck on `online` and visible-app resume, coalesced to one request;
- never block app startup, authentication or chat loading;
- retain a valid cached result when a refresh temporarily fails;
- expose only bounded diagnostic codes to monitoring and friendly Russian copy
  to the UI.

Runtime behavior:

- iPhone/iPad browser or Home Screen: keep the existing PWA install/update and
  Web Push path; do not query Android/Windows packages;
- Android browser: keep normal web access, hide PWA installation, query the
  Android stable manifest and show APK status/download;
- Capacitor Android: compare the installed app version/build from
  `@capacitor/app` with the Android manifest;
- Windows browser: keep normal web access, hide PWA installation, query the
  Windows stable manifest and show EXE status/download;
- future Electron: obtain the installed version through a minimal preload
  bridge, compare it with the Windows manifest, and later delegate verified
  updates to the native updater;
- other browsers: show web access only and no install offer.

SemVer comparison is strict and covered by tests. A malformed or unsupported
version never produces a mandatory-update state.

## Settings UX And Motion

The existing installation block becomes a platform distribution block.

States:

- `checking`: animated status indicator and "Проверяем доступность";
- `preparing`: native package is not published yet;
- `available`: version, release size, release date and download action;
- `current`: packaged client already has the latest version;
- `update_available`: newer package exists;
- `offline_cached`: last known status is shown with a stale marker;
- `unavailable`: friendly retry action, without raw network details;
- `download_handoff`: short animated transition while the browser/system
  download manager receives the URL.

Motion uses opacity/transform, a restrained progress shimmer and existing
LETSCUBE blue/magenta tokens. `prefers-reduced-motion` disables nonessential
animation.

The browser cannot observe the progress of a download after handing an APK/EXE
URL to the operating system. It therefore shows an honest indeterminate handoff
and then "Загрузка передана системе", never fake percentages. Future Electron
updates use real byte progress from the updater. A future Android in-app
downloader may add real progress only together with verified package installation
and Android permission handling.

## Download Safety

- Accept only HTTPS artifact URLs on `api.letscube.ru` under `/releases/files/`.
- Use versioned immutable filenames; never overwrite an existing version.
- Publish SHA-256 and size in the manifest.
- The website starts a system download but cannot claim installation success.
- Android installation still requires normal platform confirmation and may
  require permission to install unknown applications for internal builds.
- Public Android distribution and silent updates are not claimed; Play Store or
  managed distribution remains a separate decision.
- Windows public updates require code signing. Unsigned internal EXE packages
  may be downloaded but are not presented as production-trusted releases.
- No service-role, Firebase server key, signing key or package-signing password
  enters web, APK, EXE, Git or the release manifest.

## Delivery Sequence

1. Align Settings/PWA detection and documentation: iOS PWA only, Android APK,
   Windows EXE.
2. Implement and test the release manifest parser, cache, refresh policy and
   platform-specific Settings states using unavailable manifests first.
3. Add the static release service, host directories, publish script and valid
   TLS route for `api.letscube.ru/releases/`.
4. Publish an internal Android APK manifest and verify status/download on an
   Android browser and inside the APK.
5. Finish Android signing, app links and recovery callback, then publish an
   internal signed APK/AAB.
6. Run the approved Electron capability spike, package an internal NSIS EXE,
   publish its manifest and verify real updater progress before enabling native
   update installation.

## QA And Release Gates

- Unit tests: manifest validation, SemVer comparison, cache expiry, stale
  fallback and platform mapping.
- Playwright: iOS install guidance remains; Windows/Android PWA CTA is absent;
  native package states fit 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915;
  animations respect reduced motion; no horizontal overflow.
- Server smoke: valid TLS, no directory listing, manifest no-cache, immutable
  artifact cache, HEAD/GET size parity and SHA-256 parity.
- Android physical QA: current/update/absent/offline states and system download
  handoff; existing media, geolocation and FCM regressions remain green.
- Windows QA: browser status first; Electron download/update progress only after
  the capability spike and NSIS artifact exist.
- Security guards: no SQL, no secrets in Git, no public write endpoint and no
  service-role use in frontend/native bundles.

## Explicit Non-Goals

- No PWA installation offer for Windows or Android.
- No iOS native application in this sequence.
- No fake progress or silent package installation.
- No release signing material in the repository.
- No public release claim before signed-package and device/installer QA.
