interface AlbumTarget {
  kind: string;
  clientMessageId: string;
  albumId?: string;
  albumIndex?: number;
  albumCount?: number;
}

/** Keep each media item addressable while linking a single visual selection. */
export function prepareMediaAlbumTargets<T extends AlbumTarget>(targets: readonly T[]): T[] {
  if (
    targets.length < 2 || targets.length > 10 ||
    targets.some((target) => target.kind !== "image" && target.kind !== "video") ||
    targets.some((target) => target.albumId !== undefined) ||
    !targets[0]?.clientMessageId
  ) return [...targets];

  const albumId = targets[0].clientMessageId;
  return targets.map((target, albumIndex) => ({
    ...target,
    albumId,
    albumIndex,
    albumCount: targets.length,
  }));
}
