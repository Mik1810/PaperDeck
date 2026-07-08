export const SEARCH_PAGE_SIZE = 20;

export function normalizeSearchPage(page: number) {
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
}

export function searchPageOffset(page: number) {
  return (normalizeSearchPage(page) - 1) * SEARCH_PAGE_SIZE;
}
