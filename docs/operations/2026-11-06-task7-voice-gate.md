# Task7: Voice rollout gate readback

2026-11-06 MSK. Read-only checks on the exact LETSCUBE database, Edge
container and public Android catalog. No call or push was sent.

- At capture, Android Stable was `0.1.46` / 47, optional. The installed
  Realme candidate was `0.1.48` / 49. Later Stable50 has a separate
  [release record](2026-11-06-android50-stable.md) and did not enable call
  delivery. Do not infer a call rollout from the application version.
- `private.voice_push_dispatch_config` singleton is false. Both exact
  voice recovery/cleanup jobs are inactive, occupied wake slots and
  active claims are zero, and authenticated clients cannot claim work.
- In the live Edge container, the exact enable key is absent, so the
  documented default-off branch remains effective. The check emitted
  only a key-presence count and boolean, not environment values.

This refreshes the [disabled rollout evidence](2026-09-21-android-call-rollout.md)
without issuing a drain. Real background, terminated-process, denial and
group participant cases still need separately scoped device/provider proof;
do not replay accepted prior lifecycle cases or enable global delivery to
simulate a canary.
