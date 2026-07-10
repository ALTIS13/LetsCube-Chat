# LETSCUBE Native And Desktop Release Design

Date: 2026-07-10
Status: approved

## Objective

Move LETSCUBE from the stable web/PWA baseline to production Android and
Windows packages without duplicating the messenger logic or weakening the
existing security, realtime, notification and media guarantees.

## Approved Delivery Order

1. Close the shared pre-packaging performance and synchronization gate.
2. Produce an Android release candidate from the existing Capacitor project.
3. Complete Android native push, internal routing and physical-device QA.
4. Configure release signing outside Git and produce an internal AAB/APK.
5. Run a Windows capability spike against the same built frontend.
6. Package the Windows client with Electron if the capability spike passes.
7. Add signed installer and self-hosted update delivery only after runtime QA.

## Shared Pre-Packaging Gate

The packaged clients must inherit a stable frontend rather than preserve a
known startup bottleneck. The gate is complete when:

- permission and role discovery uses one authenticated access snapshot rather
  than per-permission RPC fan-out;
- the current RPC implementation remains a compatibility fallback until the
  snapshot migration is applied;
- large-history open, prepend anchoring, reconnect and PWA resume remain
  covered by measured browser QA;
- typecheck, production build, smoke, RLS and database type checks pass or
  have an explicitly documented environmental skip.

## Android Architecture

Keep Capacitor 8 and the existing `android/` project:

- package id remains `com.kub.messenger`;
- visible product name remains `LETSCUBE`;
- built Vite assets remain the primary packaged runtime;
- browser/PWA code paths remain guarded from native-only plugins;
- Firebase configuration and signing material stay local or in trusted secret
  stores and never enter Git;
- in-app notifications remain the source of truth, while FCM is only a
  delivery adapter;
- native notification taps use validated internal routes; external Android
  app links are a separate release requirement.

Android release work includes final icons/splash, versioning, FCM delivery,
foreground/background/killed-state physical QA, app links, password recovery
callback, a release keystore stored outside the repository and an internal
signed AAB/APK.

## Windows Architecture

Use an Electron capability spike before committing to the installer. Electron
is preferred over Tauri for the first Windows client because LETSCUBE relies
heavily on Chromium behavior for camera, microphone, MediaRecorder, file
selection, realtime and media playback. The larger package and memory cost are
accepted to reduce platform divergence.

The Electron shell must:

- package the existing Vite output;
- use `contextIsolation: true` and `nodeIntegration: false`;
- expose only a minimal typed preload bridge;
- enforce a restrictive Content Security Policy and navigation allow-list;
- use a single-instance lock and safe internal route handling;
- provide native Windows notifications, tray/background behavior and a
  self-hosted update channel;
- avoid embedding service credentials or direct privileged backend access.

The first Windows deliverable is an unsigned internal NSIS setup executable.
Public distribution requires a Windows code-signing certificate, signed update
artifacts and install/update/uninstall QA on Windows 10 and Windows 11.

## Explicit Non-Goals

- No rewrite of the React frontend.
- No service-role key in web, Android or Windows bundles.
- No Firebase, signing or database secrets in Git.
- No automatic SQL apply without explicit approval.
- No iOS native packaging in this delivery sequence.
- No release claim before physical-device and installer QA pass.

## Release Evidence

Each stage records commands, measurements, device/OS versions, warnings,
skips, changed files, commit hash and deployment status in the production
tracker and QA results documentation.
