interface AlbumTarget {
  kind: string;
  clientMessageId: string;
  albumId?: string;
  albumIndex?: number;
  albumCount?: number;
}

/** Keep each media item addressable while linking a single visual selection. */
export function prepareMediaAlbumTargets<T extends AlbumTarget>(targets: readonly T[]): T[] {
  const grouped = [...targets];
  let start = 0;
  while (start < targets.length) {
    if (!isNewVisualTarget(targets[start])) {
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < targets.length && isNewVisualTarget(targets[end])) end += 1;
    for (let batchStart = start; batchStart < end; batchStart += 10) {
      const albumCount = Math.min(10, end - batchStart);
      if (albumCount < 2) continue;
      const albumId = targets[batchStart].clientMessageId;
      for (let albumIndex = 0; albumIndex < albumCount; albumIndex += 1) {
        const targetIndex = batchStart + albumIndex;
        grouped[targetIndex] = { ...targets[targetIndex], albumId, albumIndex, albumCount };
      }
    }
    start = end;
  }
  return grouped;
}

function isNewVisualTarget(target: AlbumTarget): boolean {
  return (target.kind === "image" || target.kind === "video") &&
    target.albumId === undefined && Boolean(target.clientMessageId);
}
