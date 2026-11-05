# Task4: External encrypted backup readback

2026-11-05, coordinator. Read-only evidence on the exact LETSCUBE host and
the documented private encrypted backup repository.

- Both production timers are active and persistent. On November 5 the local
  job started 00:48:50Z and finished 00:49:03Z; the offsite job started
  02:12:24Z and finished 02:12:34Z. Both returned status 0. Their next
  scheduled runs were November 6 00:58:10Z and 02:23:17Z, respectively.
- Seven-day structured journal readback (only exact unit, job result and
  timestamp) recorded seven successful starts for each job and no other
  recorded result. Longest interval between successful completions was
  1,457 minutes locally and 1,466 minutes offsite. This is observed job
  cadence, not proof of every archive's content or capture watermark.
- The current private GitHub main and exact host backup worktree agree on
  commit `ced600934c26ae77402744d5544966de5652a704` and tree
  `520cbca4a986abc315c31485ea8c8fbff7307d94`. The tree is not truncated
  and contains one encrypted chunk for the 00:48:50Z capture.
- Independently read all 43,735,684 ciphertext bytes through the authenticated
  [GitHub raw blob API](https://docs.github.com/en/rest/git/blobs#get-a-blob).
  The age header, Git blob identity, byte count and SHA-256 in the published
  encrypted manifest matched. Ciphertext stayed in process memory; no file
  was saved or decrypted. Neither the producer nor backup sync was invoked.
- The separate `letscube-offsite-backup.timer` is loaded but inactive and
  disabled. Redacted server configuration inventory found the mode key
  but none of the three destination keys documented for rclone/restic/Borg.
  Do not enable it without a pinned dedicated destination and restore proof.

This resolves the earlier remote-read refusal for **this snapshot**. The
observed lag from local start to external job completion was 83m44s; it is
not a guaranteed RPO. Current GitHub force-push behavior does not establish
historical retention or immutability. Snapshot restore, independent
retention, and capture-watermark/RPO guarantees still need evidence; the
accepted sealed-only recovery is unchanged.
