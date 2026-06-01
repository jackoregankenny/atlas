import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { Cover } from "./Cover";
import type { Book } from "../types";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  books: Book[];
  actions?: PaletteAction[];
  onClose: () => void;
  onSelect: (id: number) => void;
}

type Row =
  | { kind: "action"; action: PaletteAction; score: number }
  | { kind: "book"; book: Book; score: number };

export function CommandPalette({
  open,
  books,
  actions = [],
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();

    // Actions: when empty query, show all actions; otherwise score-filter.
    const actionRows: Row[] = [];
    for (const a of actions) {
      if (!q) {
        actionRows.push({ kind: "action", action: a, score: 1 });
      } else {
        const s = scoreAction(q, a);
        if (s > 0) actionRows.push({ kind: "action", action: a, score: s });
      }
    }
    actionRows.sort((a, b) => b.score - a.score);

    // Books
    const bookRows: Row[] = [];
    if (!q) {
      books.slice(0, 30).forEach((b, i) =>
        bookRows.push({ kind: "book", book: b, score: 1000 - i })
      );
    } else {
      for (const b of books) {
        const s = fuzzyScore(q, b);
        if (s > 0) bookRows.push({ kind: "book", book: b, score: s });
      }
      bookRows.sort(
        (a, b) =>
          (b.kind === "book" ? b.score : 0) -
          (a.kind === "book" ? a.score : 0)
      );
      bookRows.splice(40);
    }

    return [...bookRows, ...actionRows];
  }, [books, actions, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const runRow = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "action") row.action.run();
    else onSelect(row.book.id);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        runRow(rows[active]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, active, onClose, onSelect]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // Find section boundaries for headers
  const firstActionIdx = rows.findIndex((r) => r.kind === "action");
  const hasBooks = rows.some((r) => r.kind === "book");
  const hasActions = firstActionIdx !== -1;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={16} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search books, run actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            <>
              {hasBooks && <div className="palette-section">Books</div>}
              {rows.map((row, i) => {
                const headerBeforeActions =
                  hasActions && i === firstActionIdx ? (
                    <div key="hdr-actions" className="palette-section">
                      Actions
                    </div>
                  ) : null;
                return (
                  <div key={rowKey(row)}>
                    {headerBeforeActions}
                    {row.kind === "action" ? (
                      <button
                        data-idx={i}
                        className={`palette-row palette-row-action ${i === active ? "active" : ""}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => runRow(row)}
                      >
                        <div className="palette-action-icon">
                          {row.action.icon}
                        </div>
                        <div className="palette-meta">
                          <div className="palette-title">{row.action.label}</div>
                          {row.action.hint && (
                            <div className="palette-sub">{row.action.hint}</div>
                          )}
                        </div>
                        {i === active && (
                          <CornerDownLeft size={14} className="palette-enter" />
                        )}
                      </button>
                    ) : (
                      <button
                        data-idx={i}
                        className={`palette-row ${i === active ? "active" : ""}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => runRow(row)}
                      >
                        <div className="palette-thumb">
                          <Cover
                            path={row.book.cover_path}
                            title={row.book.title}
                            size="palette"
                          />
                        </div>
                        <div className="palette-meta">
                          <div className="palette-title">{row.book.title}</div>
                          <div className="palette-sub">
                            {row.book.authors.join(", ") || "Unknown"}
                            {row.book.series && (
                              <span className="palette-series">
                                {" · "}
                                {row.book.series}
                              </span>
                            )}
                          </div>
                        </div>
                        {i === active && (
                          <CornerDownLeft size={14} className="palette-enter" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">↵</kbd> run
          </span>
          <span className="palette-foot-spacer" />
          <span>
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </span>
        </div>
      </div>
    </div>
  );
}

function rowKey(row: Row): string {
  return row.kind === "action" ? `a:${row.action.id}` : `b:${row.book.id}`;
}

function scoreAction(q: string, a: PaletteAction): number {
  const label = a.label.toLowerCase();
  const keywords = (a.keywords ?? "").toLowerCase();
  let score = 0;
  if (label.startsWith(q)) score += 80;
  else if (label.includes(q)) score += 50;
  if (keywords.includes(q)) score += 25;
  if (score === 0 && subsequence(q, label)) score += 8;
  return score;
}

function fuzzyScore(q: string, book: Book): number {
  const title = book.title.toLowerCase();
  const authors = book.authors.join(", ").toLowerCase();
  const series = (book.series ?? "").toLowerCase();
  const tags = book.tags.map((t) => t.toLowerCase());

  let score = 0;
  if (title.startsWith(q)) score += 100;
  else if (title.includes(q)) score += 60;

  if (authors.includes(q)) score += 30;
  if (series.includes(q)) score += 20;

  for (const tag of tags) {
    if (tag === q) score += 40;
    else if (tag.startsWith(q)) score += 25;
    else if (tag.includes(q)) score += 15;
  }

  if (score === 0) {
    if (subsequence(q, title)) score += 5;
  }
  return score;
}

function subsequence(q: string, hay: string): boolean {
  let i = 0;
  for (const c of hay) {
    if (c === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}
