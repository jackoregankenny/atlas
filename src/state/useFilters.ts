import { useDeferredValue, useMemo, useState } from "react";
import type { Book, BookStatus } from "../types";
import type { SortField } from "../hooks/useLibraryPrefs";
import { sortBooks } from "../util/sort";

export type StatusFilter = "all" | BookStatus;

/**
 * All library filtering in one place: status, tag, author, series, and the
 * free-text query. The query is deferred so typing stays responsive — React
 * re-filters the (potentially huge) list at lower priority than the input
 * echo, instead of on every keystroke.
 */
export function useFilters(
  books: Book[],
  sortField: SortField,
  sortDir: "asc" | "desc"
) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query);

  const filteredSorted = useMemo(() => {
    let arr = books;
    if (statusFilter !== "all") {
      arr = arr.filter((b) => b.status === statusFilter);
    }
    if (tagFilter) {
      arr = arr.filter((b) => b.tags.includes(tagFilter));
    }
    if (authorFilter) {
      arr = arr.filter((b) => b.authors.includes(authorFilter));
    }
    if (seriesFilter) {
      arr = arr.filter((b) => b.series === seriesFilter);
    }
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          (b.series ?? "").toLowerCase().includes(q)
      );
    }
    return sortBooks(arr, sortField, sortDir);
  }, [
    books,
    deferredQuery,
    statusFilter,
    tagFilter,
    authorFilter,
    seriesFilter,
    sortField,
    sortDir,
  ]);

  const statusCounts = useMemo(() => {
    const c = { all: books.length, unread: 0, reading: 0, finished: 0 };
    for (const b of books) c[b.status] += 1;
    return c;
  }, [books]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) for (const t of b.tags) map.set(t, (map.get(t) ?? 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [books]);

  return {
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    tagFilter,
    setTagFilter,
    authorFilter,
    setAuthorFilter,
    seriesFilter,
    setSeriesFilter,
    filteredSorted,
    statusCounts,
    tagCounts,
  };
}
