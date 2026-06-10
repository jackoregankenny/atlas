import { describe, expect, it } from "vitest";
import { applyFilters } from "./filter";
import { sortBooks } from "./sort";
import type { Book } from "../types";

function book(over: Partial<Book>): Book {
  return {
    id: 1,
    title: "Untitled",
    authors: [],
    series: null,
    series_index: null,
    cover_path: null,
    language: null,
    pub_date: null,
    added_at: "2026-01-01 00:00:00",
    file_path: null,
    isbn: null,
    description: null,
    progress_percent: null,
    progress_cfi: null,
    finished_at: null,
    status: "unread",
    tags: [],
    rating: null,
    folder_ids: [],
    manual_fields: null,
    has_original: false,
    ...over,
  };
}

const LIBRARY: Book[] = [
  book({ id: 1, title: "Dune", authors: ["Frank Herbert"], series: "Dune", status: "finished", tags: ["sf"], pub_date: "1965", rating: 5, progress_percent: 100 }),
  book({ id: 2, title: "Dune Messiah", authors: ["Frank Herbert"], series: "Dune", status: "reading", tags: ["sf"], pub_date: "1969", progress_percent: 40 }),
  book({ id: 3, title: "Piranesi", authors: ["Susanna Clarke"], status: "unread", tags: ["fantasy"], pub_date: "2020-09-15", rating: 4 }),
  book({ id: 4, title: "Éducation sentimentale", authors: ["Gustave Flaubert"], status: "unread", pub_date: "1869" }),
];

const NONE = { status: "all", tag: null, author: null, series: null, query: "" } as const;

describe("applyFilters", () => {
  it("returns everything with no criteria", () => {
    expect(applyFilters(LIBRARY, { ...NONE })).toHaveLength(4);
  });

  it("filters by status", () => {
    const out = applyFilters(LIBRARY, { ...NONE, status: "reading" });
    expect(out.map((b) => b.id)).toEqual([2]);
  });

  it("filters by tag, author, and series", () => {
    expect(applyFilters(LIBRARY, { ...NONE, tag: "sf" })).toHaveLength(2);
    expect(applyFilters(LIBRARY, { ...NONE, author: "Susanna Clarke" })).toHaveLength(1);
    expect(applyFilters(LIBRARY, { ...NONE, series: "Dune" })).toHaveLength(2);
  });

  it("query matches title, author, and series, case-insensitively", () => {
    expect(applyFilters(LIBRARY, { ...NONE, query: "piranesi" })).toHaveLength(1);
    expect(applyFilters(LIBRARY, { ...NONE, query: "HERBERT" })).toHaveLength(2);
    expect(applyFilters(LIBRARY, { ...NONE, query: "dune" })).toHaveLength(2);
  });

  it("treats whitespace-only query as empty", () => {
    expect(applyFilters(LIBRARY, { ...NONE, query: "   " })).toHaveLength(4);
  });

  it("stacks criteria with AND semantics", () => {
    const out = applyFilters(LIBRARY, {
      ...NONE,
      series: "Dune",
      status: "finished",
    });
    expect(out.map((b) => b.id)).toEqual([1]);
  });
});

describe("sortBooks", () => {
  it("sorts by title with base sensitivity (accents fold)", () => {
    const out = sortBooks(LIBRARY, "title", "asc");
    expect(out[0]!.title).toBe("Dune");
    // É collates near E, not after Z.
    expect(out.map((b) => b.id).indexOf(4)).toBeLessThan(3);
  });

  it("sorts by year extracted from messy pub_date strings", () => {
    const out = sortBooks(LIBRARY, "year", "asc");
    expect(out.map((b) => b.pub_date)).toEqual(["1869", "1965", "1969", "2020-09-15"]);
  });

  it("descending puts highest rating first (ties keep stable order)", () => {
    const desc = sortBooks(LIBRARY, "rating", "desc").map((b) => b.rating ?? 0);
    for (let i = 1; i < desc.length; i++) {
      expect(desc[i - 1]!).toBeGreaterThanOrEqual(desc[i]!);
    }
    expect(desc[0]).toBe(5);
  });

  it("does not mutate the input array", () => {
    const before = LIBRARY.map((b) => b.id);
    sortBooks(LIBRARY, "title", "desc");
    expect(LIBRARY.map((b) => b.id)).toEqual(before);
  });
});
