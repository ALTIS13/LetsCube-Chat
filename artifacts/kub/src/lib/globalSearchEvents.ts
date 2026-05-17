export const KUB_GLOBAL_SEARCH_OPEN_EVENT = "kub:global-search-open";

export type GlobalSearchOpenDetail = {
  query?: string;
};

export function openGlobalSearch(query?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GlobalSearchOpenDetail>(KUB_GLOBAL_SEARCH_OPEN_EVENT, {
      detail: { query },
    }),
  );
}
