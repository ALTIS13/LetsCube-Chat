# Web hashed-asset retention

Status: the named production volume is attached and the startup mount guard is
active in the sole healthy web container. The source is commit `fa9af510`;
the entrypoint script matches source SHA-256
`fdc3a58874155fc99a315a9027f1ca3cc03fc5d00f018a27ec760a93db04fcbe`.
Retention across two distinct production builds is not yet proven.

The live `letscube-web` Coolify resource is a Dockerfile application, not
`docs/deploy/docker-compose.coolify.yml`. Each image contains only its own
`dist/public/assets`. Open tabs and delayed service-worker installs can still
request an older lazy chunk after a replacement image has taken traffic.
The explicit boot retry recovers from a stale entry document; it does not keep
an already-running tab's old chunks available.

## Contract

- `index.html`, `/`, route fallbacks and `sw.js` are always served from the
  current image. Only public, content-addressed `/assets/` files are retained.
- Coolify mounts one named persistent volume at
  `/usr/share/nginx/html/assets` on every web replacement container. Do not
  mount a volume over the entire web root.
- Before nginx starts, `retain-web-assets.sh` copies the image's current
  assets into that volume. It publishes each new name with an atomic hard link,
  leaves old names untouched and refuses a same-name/different-bytes collision.
  Startup failure keeps a bad release out of traffic.
- `LETSCUBE_REQUIRE_ASSET_VOLUME=1` makes absence of the mount a startup
  failure. Turn it on only after the storage is attached and verified.
- No automatic deletion is enabled. The volume contains no messages, media,
  HTML, service workers, credentials or API responses. Source maps should not
  be emitted by the release build and remain denied by nginx if present.
  Monitor volume size and remaining host disk. Define a retention horizon and
  rollback window before introducing cleanup.

## Activation

1. Record the current running web image, its `/index.html` entry path and a
   checksum of one current `/assets/` file. Confirm the mount list is empty or
   account for any existing mount before changing the resource.
2. Deploy the source containing the entrypoint script while the volume is not
   yet attached. In this stage the script does nothing and the image still
   serves its own files. Check the single healthy image and current entry.
3. In Coolify, add **Persistent Storage > Volume Mount**, name
   `letscube-web-assets`, destination `/usr/share/nginx/html/assets`, with no
   source path. Keep preview deployments isolated. Redeploy the same source.
   Docker's first mount of an empty named volume copies the image directory by
   default; the entrypoint also verifies/publishes those files before nginx.
4. Verify `docker inspect` shows the named volume at that exact destination;
   compare the current entry asset served through HTTPS with the bytes in the
   mounted directory. A missing asset must return 404, not an HTML fallback.
5. Set `LETSCUBE_REQUIRE_ASSET_VOLUME=1` in the web resource and redeploy.
   Confirm the healthy image has the flag and mount. After a subsequent build
   changes the entry hash, request both the old and new asset paths through
   `https://app.letscube.ru`; both must return exact bytes and immutable cache
   headers. Do not declare retention active before this two-build proof.

On 2026-09-27 the owner-team Coolify write token was renewed with `read/write`
scope and a 90-day expiration. The running MCP process still holds its old
environment; use the verified direct API until the Codex app restarts. The
token value is stored only in the Windows user environment, not this repo.

Steps 3-5 were performed against the Dockerfile application at `fa9af510`.
Coolify storage `l64kyyu1sysev2izzjjbizhe-letscube-web-assets` has an empty
host path, destination `/usr/share/nginx/html/assets`, and the preview suffix
enabled. Deployment `dz476mhuvho580ea1guxv3m6` finished with the named
volume mounted read-write. The entry asset `/assets/index-Dd_fcDhO.js` had
SHA-256 `c78a76308370bacf85afa1200ddc0959383559a1c5fa260441296b84f5280533`
both in the mounted directory and over HTTPS; a missing asset returned 404.
After setting `LETSCUBE_REQUIRE_ASSET_VOLUME=1`, deployment
`f7e1ifrmu2ml1r3nkka9gyq2` finished with one healthy replacement container,
the same mounted volume and guard, and the same asset hash and immutable HTTPS
cache header. The prior container was removed. The remaining acceptance gate is
an actual subsequent web build with a different hashed entry: verify that both
old and new asset URLs remain byte-identical to their respective image files.

## Failure and rollback

- If copying fails or a hash collides, inspect the startup error. Do not
  overwrite the existing name or delete the volume to make startup pass.
- Rolling back the image keeps the shared volume: both the restored image's
  assets and the superseded build's assets may be needed by open tabs.
- If the mount itself is unavailable, restore the previous known-good web
  configuration and image. Removing the mount is an emergency availability
  fallback, not an asset-retention rollback; previously retained files then
  become unavailable to the web process.
- `docker volume prune` or unrelated cleanup must not target this volume.

Source checks: `node --test tests/unit/web-asset-retention.test.mjs` and
`sh -n docs/deploy/retain-web-assets.sh`. Production acceptance additionally
requires the two-build HTTPS and running-container mount checks above.

The source rollout passed 7 focused tests, Compose syntax and `nginx -t`.
An isolated A-to-B named-volume run on the production Docker host retained
both files with matching SHA-256; its test volume and fixtures were removed.
The public current asset returned `200` with immutable caching, and a missing
asset returned `404`. Those checks do not substitute for a live mounted
Coolify replacement rollout.
