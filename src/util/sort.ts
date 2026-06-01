import type { Book } from "../types";
import type { SortDir, SortField } from "../hooks/useLibraryPrefs";

export function sortBooks(
  books: Book[],
  field: SortField,
  dir: SortDir
): Book[] {
  const sign = dir === "asc" ? 1 : -1;
  const copy = books.slice();
  copy.sort((a, b) => sign * cmp(a, b, field));
  return copy;
}

function cmp(a: Book, b: Book, field: SortField): number {
  switch (field) {
    case "title":
      return collate(a.title, b.title);
    case "author":
      return collate(a.authors[0] ?? "", b.authors[0] ?? "");
    case "added":
      return (a.added_at ?? "").localeCompare(b.added_at ?? "");
    case "year":
      return year(a.pub_date) - year(b.pub_date);
    case "progress":
      return (a.progress_percent ?? 0) - (b.progress_percent ?? 0);
    case "rating":
      return (a.rating ?? 0) - (b.rating ?? 0);
  }
}

function collate(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function year(d: string | null): number {
  if (!d) return 0;
  const m = d.match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}
