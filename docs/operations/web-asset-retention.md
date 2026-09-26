# Web hashed-asset retention

Status: source ready, production storage attachment pending verification.

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

The Coolify write connector must authenticate before steps 3 and 5 can be
automated. A source deploy alone is not evidence that retention is active.

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
