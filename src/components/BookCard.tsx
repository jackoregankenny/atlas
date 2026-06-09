import { memo } from "react";
import { Check, Sparkles } from "lucide-react";
import type { Book } from "../types";
import { Cover } from "./Cover";

export interface BookCardProps {
  book: Book;
  enriching: boolean;
  selected: boolean;
  inSelectionMode: boolean;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
  onEnrich: (id: number) => void;
  onContextMenu: (b: Book, e: React.MouseEvent) => void;
  onToggleSelect: (id: number) => void;
  onAuthorClick: (name: string) => void;
  onSeriesClick: (name: string) => void;
  compact?: boolean;
}

/**
 * Memoized: with stable callbacks from the state hooks, a change to one
 * book's enriching/selected state re-renders only that card, not the whole
 * grid. Matters at hundreds-to-thousands of visible cards.
 */
export const BookCard = memo(function BookCard({
  book,
  enriching,
  selected,
  inSelectionMode,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onToggleSelect,
  onAuthorClick,
  onSeriesClick,
  compact,
}: BookCardProps) {
  const progress = book.progress_percent ?? 0;
  return (
    <article
      className={`card ${selected ? "card-selected" : ""}`}
      onClick={() => {
        if (inSelectionMode) onToggleSelect(book.id);
        else onOpen(book.id);
      }}
      onMouseEnter={() => onHover(book.id)}
      onContextMenu={(e) => onContextMenu(book, e)}
    >
      <div className="cover">
        <Cover path={book.cover_path} title={book.title} size="card" />
        <button
          className={`card-check ${selected ? "checked" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(book.id); }}
          title={selected ? "Deselect" : "Select"}
        >
          {selected && <Check size={9} strokeWidth={3.5} />}
        </button>
        {book.status === "finished" && !selected && (
          <div className="cover-finished" title="Finished">
            <Check size={11} strokeWidth={3} />
          </div>
        )}
        {progress > 0 && book.status !== "finished" && (
          <div className="cover-progress">
            <div className="cover-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        {!compact && !inSelectionMode && (
          <button
            className="card-action"
            onClick={(e) => {
              e.stopPropagation();
              onEnrich(book.id);
            }}
            disabled={enriching}
            title="Enrich"
          >
            <Sparkles size={11} strokeWidth={2.2} />
            {enriching ? "…" : "Enrich"}
          </button>
        )}
      </div>
      {!compact && (
        <div className="meta">
          <div className="title" title={book.title}>
            {book.title}
          </div>
          <div className="authors" title={book.authors.join(", ")}>
            {book.authors.length ? (
              book.authors.map((a, i) => (
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
              "Unknown"
            )}
          </div>
          {book.series && (
            <a
              className="series link-series"
              onClick={(e) => {
                e.stopPropagation();
                onSeriesClick(book.series!);
              }}
            >
              {book.series}
              {book.series_index != null ? ` #${book.series_index}` : ""}
            </a>
          )}
        </div>
      )}
    </article>
  );
});
