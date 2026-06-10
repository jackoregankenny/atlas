import type { Book, BookStatus } from "../types";

export interface FilterCriteria {
  status: "all" | BookStatus;
  tag: string | null;
  author: string | null;
  series: string | null;
  query: string;
}

/** Pure library filter — the logic behind useFilters, kept separate so it
 *  can be unit-tested without React. */
export function applyFilters(books: Book[], c: FilterCriteria): Book[] {
  let arr = books;
  if (c.status !== "all") {
    arr = arr.filter((b) => b.status === c.status);
  }
  if (c.tag) {
    arr = arr.filter((b) => b.tags.includes(c.tag!));
  }
  if (c.author) {
    arr = arr.filter((b) => b.authors.includes(c.author!));
  }
  if (c.series) {
    arr = arr.filter((b) => b.series === c.series);
  }
  const q = c.query.trim().toLowerCase();
  if (q) {
    arr = arr.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.authors.some((a) => a.toLowerCase().includes(q)) ||
        (b.series ?? "").toLowerCase().includes(q)
    );
  }
  return arr;
}
