# Signed media web canary, 2026-09-27

Status: active on the production web build; the `media` bucket remains public.
Android was explicitly put on hold by the owner, so no APK was changed or
tested in this stage.

## Change and verification

- Source commit `11a3bff9` passes `VITE_MEDIA_SIGNED_URLS` through the live
  Dockerfile build stage. The default remains `public`; Coolify's normal web
  environment is set to `signed` as a build-time variable.
- Deployment `gl4relu0w7lo1iq5fjwyzali` finished from that commit. One web
  container is healthy. The served entry `/assets/index-DdKlCMSF.js` contains
  `VITE_MEDIA_SIGNED_URLS:"signed"`; its HTTPS bytes match the file in the
  mounted named asset volume. The previous entry still returns 200 with an
  immutable cache header. The required-volume startup guard remains active.
- A read-only QA member signed an original media object uploaded by a different
  member; its `HEAD` returned 200. A QA account outside the chat could not sign
  the same object. A five-second link worked before expiry, returned 400 after
  six seconds, and a new signature returned 200. No media bytes or message
  bodies were read into the report. The browser resolver passed on desktop and
  mobile Chromium against the QA session before this production build.
- The production `storage.buckets` row for `media` still reads `public = true`.
  No storage policy, database row, Android bundle or native release changed.

## Limits and next gate

The `signed` mode still permits a public-URL fallback. It measures signing
without risking blank media on an installed client. It is **not** a privacy
fix while the bucket remains public. The real-member probe covered one
original object; it did not establish production preview/avatar coverage,
account-switch UI behavior, long-session refresh in an authenticated deployed
browser, or upload performance. The local store and mode tests cover those
mechanics in isolation, not production acceptance.

Before `signed-only` and a private bucket: verify representative message
previews, chat and user avatars, downloads and refresh with authenticated web
clients; then provide a compatible Android release and prove installed-client
upgrade. Do not change the bucket while Android is on hold. A private-bucket
switch also needs a verified database backup, rollback and a real access check.

## Rollback

Set the Coolify web build-time variable `VITE_MEDIA_SIGNED_URLS` to `public`
and redeploy the same source, or roll back to the previous healthy web image.
Changing only the running environment cannot change an already-built Vite
bundle. Keep the named `/assets` volume and its mount guard intact so open
tabs can load their previous hashed assets. Confirm the new public entry and
one healthy container after rollback. The bucket is already public; no
database rollback is involved in this canary.
