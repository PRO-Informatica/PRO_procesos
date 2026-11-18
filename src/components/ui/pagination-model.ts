export function paginationModel(page: number, pageSize: number, total: number) {
  const count = Math.max(0, Math.trunc(total));
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(count / size));
  const currentPage = Math.max(1, Math.min(pageCount, Math.trunc(page) || 1));
  const windowSize = Math.min(5, pageCount);
  const firstPage = Math.max(1, Math.min(currentPage - 2, pageCount - windowSize + 1));
  return {
    currentPage,
    pageCount,
    firstItem: count ? (currentPage - 1) * size + 1 : 0,
    lastItem: Math.min(currentPage * size, count),
    pages: Array.from({ length: windowSize }, (_, index) => firstPage + index),
  };
}

export function paginationHref(href: string, page: number, pageParam = "page") {
  const [pathAndQuery, hash] = href.split("#", 2);
  const queryIndex = pathAndQuery.indexOf("?");
  const path = queryIndex < 0 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex < 0 ? "" : pathAndQuery.slice(queryIndex + 1));
  if (page === 1) params.delete(pageParam);
  else params.set(pageParam, String(page));
  const query = params.toString();
  return `${path}${query ? `?${query}` : path ? "" : "?"}${hash === undefined ? "" : `#${hash}`}`;
}

export function parsePaginationTarget(value: string, pageCount: number): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page : null;
}
