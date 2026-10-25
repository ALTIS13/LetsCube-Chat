type Owner = { partition: string; chatId: string };
export function createMediaObjectUrls(options: { create: (blob: Blob) => string; revoke: (url: string) => void }) {
  const entries = new Map<string, { owner: Owner; refs: number }>();
  const releaseOf = (url: string) => {
    let released = false;
    return () => {
      if (released) return; released = true;
      const entry = entries.get(url); if (!entry) return;
      if (--entry.refs === 0) { entries.delete(url); options.revoke(url); }
    };
  };
  return {
    create(blob: Blob, owner: Owner) {
      const url = options.create(blob); entries.set(url, { owner: { ...owner }, refs: 1 });
      return { url, release: releaseOf(url) };
    },
    retain(url: string) {
      const entry = entries.get(url); if (!entry) return () => {};
      entry.refs++; return releaseOf(url);
    },
    retire(partition: string, chatId?: string) {
      for (const [url, entry] of entries) {
        if (entry.owner.partition !== partition || (chatId !== undefined && entry.owner.chatId !== chatId)) continue;
        entries.delete(url); options.revoke(url);
      }
    },
  };
}

export const mediaObjectUrls = createMediaObjectUrls({
  create: blob => URL.createObjectURL(blob), revoke: url => URL.revokeObjectURL(url),
});
