import { memo, useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { Book } from "../types";
import { Cover } from "./Cover";
import { BookCard } from "./BookCard";

/** How many cards render before the first scroll, and per scroll step. */
const BATCH = 120;

interface SharedHandlers {
  onToggleSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
  onEnrich: (id: number) => void;
  onContextMenu: (b: Book, e: React.MouseEvent) => void;
  onAuthorClick: (name: string) => void;
  onSeriesClick: (name: string) => void;
}

interface BookGridProps extends SharedHandlers {
  books: Book[];
  enrichingIds: Set<number>;
  selectedIds: Set<number>;
  inSelectionMode: boolean;
  compact: boolean;
}

/**
 * Incrementally rendered grid: the first BATCH cards mount immediately
 * (fast first paint and fast re-filter regardless of library size); an
 * IntersectionObserver sentinel near the bottom mounts the next BATCH as
 * the user scrolls. Combined with `content-visibility: auto` on .card,
 * off-screen cards also skip layout/paint, so a 10k-book library stays
 * responsive without a windowing library fighting the responsive CSS grid.
 */
export function BookGrid({
  books,
  enrichingIds,
  selectedIds,
  inSelectionMode,
  compact,
  onToggleSelect,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onAuthorClick,
  onSeriesClick,
}: BookGridProps) {
  const [visibleCount, setVisibleCount] = useState(BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + BATCH);
        }
      },
      // Start mounting the next batch well before the user reaches it.
      { rootMargin: "1200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const visible = books.length > visibleCount ? books.slice(0, visibleCount) : books;

  return (
    <div
      className={`grid ${compact ? "grid-compact" : ""}`}
      onMouseLeave={() => onHover(null)}
    >
      {visible.map((b) => (
        <BookCard
          key={b.id}
          book={b}
          enriching={enrichingIds.has(b.id)}
          selected={selectedIds.has(b.id)}
          inSelectionMode={inSelectionMode}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onHover={onHover}
          onEnrich={onEnrich}
          onContextMenu={onContextMenu}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
          compact={compact}
        />
      ))}
      {books.length > visible.length && (
        <div ref={sentinelRef} className="grid-sentinel" aria-hidden />
      )}
    </div>
  );
}

interface BookListProps extends SharedHandlers {
  books: Book[];
  enrichingIds: Set<number>;
  selectedIds: Set<number>;
  inSelectionMode: boolean;
}

export function BookList({
  books,
  enrichingIds,
  selectedIds,
  inSelectionMode,
  onToggleSelect,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onAuthorClick,
  onSeriesClick,
}: BookListProps) {
  const [visibleCount, setVisibleCount] = useState(BATCH * 2);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + BATCH * 2);
        }
      },
      { rootMargin: "1200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const visible = books.length > visibleCount ? books.slice(0, visibleCount) : books;

  return (
    <div className="list" onMouseLeave={() => onHover(null)}>
      <div className="list-head">
        <span></span>
        <span>Title</span>
        <span>Author</span>
        <span>Series</span>
        <span>Progress</span>
      </div>
      {visible.map((b) => (
        <ListRow
          key={b.id}
          book={b}
          enriching={enrichingIds.has(b.id)}
          selected={selectedIds.has(b.id)}
          inSelectionMode={inSelectionMode}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onHover={onHover}
          onEnrich={onEnrich}
          onContextMenu={onContextMenu}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
        />
      ))}
      {books.length > visible.length && (
        <div ref={sentinelRef} className="grid-sentinel" aria-hidden />
      )}
    </div>
  );
}

interface ListRowProps extends SharedHandlers {
  book: Book;
  enriching: boolean;
  selected: boolean;
  inSelectionMode: boolean;
}

const ListRow = memo(function ListRow({
  book: b,
  enriching,
  selected: sel,
  inSelectionMode,
  onToggleSelect,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onAuthorClick,
  onSeriesClick,
}: ListRowProps) {
  const pct = b.progress_percent ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`list-row ${sel ? "list-row-selected" : ""}`}
      onClick={() => {
        if (inSelectionMode) onToggleSelect(b.id);
        else onOpen(b.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (inSelectionMode) onToggleSelect(b.id);
          else onOpen(b.id);
        }
      }}
      onMouseEnter={() => onHover(b.id)}
      onContextMenu={(e) => onContextMenu(b, e)}
    >
      <span className="list-thumb">
        <Cover path={b.cover_path} title={b.title} size="palette" />
        <button
          className={`list-check ${sel ? "checked" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(b.id); }}
          title={sel ? "Deselect" : "Select"}
        >
          {sel && <Check size={9} strokeWidth={3.5} />}
        </button>
      </span>
      <span className="list-title">{b.title}</span>
      <span className="list-author">
        {b.authors.length ? (
          b.authors.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <a
                className="link-author"
                onClick={(e) => {
                  e.stopPropagation();
                  onAuthorClick(a);
                }}
              >
                {a}
              </a>
            </span>
          ))
        ) : (
          "—"
        )}
      </span>
      <span className="list-series">
        {b.series ? (
          <a
            className="link-series"
            onClick={(e) => {
              e.stopPropagation();
              onSeriesClick(b.series!);
            }}
          >
            {b.series}
            {b.series_index != null ? ` #${b.series_index}` : ""}
          </a>
        ) : (
          "—"
        )}
      </span>
      <span className="list-progress">
        {pct > 0 ? (
          <span className="list-progress-wrap">
            <span className="list-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            {Math.round(pct)}%
          </span>
        ) : (
          "—"
        )}
      </span>
      <button
        className="list-enrich icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          onEnrich(b.id);
        }}
        disabled={enriching}
        title="Enrich"
      >
        <Sparkles size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
});
