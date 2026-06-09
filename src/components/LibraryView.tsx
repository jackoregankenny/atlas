import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  Download,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  Keyboard,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import type { Book, Collection, Device } from "../types";
import type { EnrichJob } from "../enrichPool";
import type { SortField, ViewMode, useLibraryPrefs } from "../hooks/useLibraryPrefs";
import { Popover, MenuItem, MenuSeparator, MenuLabel } from "./Popover";
import { BookGrid, BookList } from "./BookGrid";
import { SelectionBar } from "./SelectionBar";

export interface LibraryViewProps {
  books: Book[];
  loaded: boolean;
  total: number;
  query: string;
  onQuery: (q: string) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
  importing: boolean;
  onPickImport: (m: "files" | "folder") => void;
  batchJob: EnrichJob | null;
  onCancelBatch: () => void;
  onEnrichAllMissing: () => void;
  enrichingIds: Set<number>;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
  onEnrich: (id: number) => void;
  onContextMenu: (b: Book, e: React.MouseEvent) => void;
  onAuthorClick: (name: string) => void;
  onSeriesClick: (name: string) => void;
  authorFilter: string | null;
  seriesFilter: string | null;
  onClearAuthor: () => void;
  onClearSeries: () => void;
  tagCounts: { name: string; count: number }[];
  tagFilter: string | null;
  onSetTagFilter: (t: string | null) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onBulkEnrich: () => void;
  onBulkAddToCollection: (collectionId: number) => void;
  onBulkSendToDevice: (device: Device) => void;
  folders: Collection[];
  devices: Device[];
  prefs: ReturnType<typeof useLibraryPrefs>["prefs"];
  updatePrefs: ReturnType<typeof useLibraryPrefs>["update"];
  onExportHighlights: () => void;
  onRevealVault: () => void;
  onOpenShortcuts: () => void;
}

const SORT_LABELS: Record<SortField, string> = {
  title: "Title",
  author: "Author",
  added: "Recently added",
  year: "Year published",
  progress: "Reading progress",
  rating: "Rating",
};

export function LibraryView({
  books,
  loaded,
  total,
  query,
  onQuery,
  filterRef,
  importing,
  onPickImport,
  batchJob,
  onCancelBatch,
  onEnrichAllMissing,
  enrichingIds,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onAuthorClick,
  onSeriesClick,
  authorFilter,
  seriesFilter,
  onClearAuthor,
  onClearSeries,
  tagCounts,
  tagFilter,
  onSetTagFilter,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onBulkEnrich,
  onBulkAddToCollection,
  onBulkSendToDevice,
  folders,
  devices,
  prefs,
  updatePrefs,
  onExportHighlights,
  onRevealVault,
  onOpenShortcuts,
}: LibraryViewProps) {
  const inSelectionMode = selectedIds.size > 0;
  const hasActiveFilter = !!(query.trim() || authorFilter || seriesFilter || tagFilter);
  return (
    <>
      <header className="topbar" data-tauri-drag-region>
        <div className="search-field">
          <Search size={13} strokeWidth={2} className="search-icon" />
          <input
            ref={filterRef}
            type="text"
            placeholder="Filter library…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query ? (
            <button
              className="search-clear icon-btn"
              onClick={() => onQuery("")}
              title="Clear"
            >
              <X size={11} strokeWidth={2.4} />
            </button>
          ) : (
            <kbd className="kbd search-kbd">/</kbd>
          )}
        </div>

        <div className="topbar-status">
          {importing
            ? "Importing…"
            : `${books.length}${query ? ` of ${total}` : ""} ${
                total === 1 ? "book" : "books"
              }`}
        </div>
        {authorFilter && (
          <FilterPill label={`by ${authorFilter}`} onClear={onClearAuthor} />
        )}
        {seriesFilter && (
          <FilterPill label={seriesFilter} onClear={onClearSeries} />
        )}
        {tagFilter && (
          <FilterPill label={tagFilter} onClear={() => onSetTagFilter(null)} />
        )}

        <div className="topbar-actions">
          <TagsMenu tagCounts={tagCounts} tagFilter={tagFilter} onSetTagFilter={onSetTagFilter} />
          <SortMenu prefs={prefs} updatePrefs={updatePrefs} />
          <ViewSwitcher view={prefs.view} setView={(v) => updatePrefs({ view: v })} />
          {batchJob ? (
            <div className="batch-progress">
              <div className="progress-bar slim mini">
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      batchJob.total ? (batchJob.done / batchJob.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <span>
                {batchJob.done}/{batchJob.total}
              </span>
              <button onClick={onCancelBatch}>Cancel</button>
            </div>
          ) : (
            <button
              className="icon-btn-text"
              onClick={onEnrichAllMissing}
              disabled={total === 0}
              title="Enrich missing covers and authors"
            >
              <Sparkles size={13} strokeWidth={2} />
              <span>Enrich</span>
            </button>
          )}
          <MoreMenu
            onExportHighlights={onExportHighlights}
            onRevealVault={onRevealVault}
            onOpenShortcuts={onOpenShortcuts}
          />
        </div>
      </header>
      {books.length === 0 ? (
        !loaded ? (
          <SkeletonGrid compact={prefs.view === "compact"} />
        ) : (
          <EmptyState
            hasFilter={hasActiveFilter}
            onPickImport={onPickImport}
            importing={importing}
          />
        )
      ) : prefs.view === "list" ? (
        <BookList
          books={books}
          enrichingIds={enrichingIds}
          selectedIds={selectedIds}
          inSelectionMode={inSelectionMode}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onHover={onHover}
          onEnrich={onEnrich}
          onContextMenu={onContextMenu}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
        />
      ) : (
        <BookGrid
          books={books}
          enrichingIds={enrichingIds}
          selectedIds={selectedIds}
          inSelectionMode={inSelectionMode}
          compact={prefs.view === "compact"}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onHover={onHover}
          onEnrich={onEnrich}
          onContextMenu={onContextMenu}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
        />
      )}
      {inSelectionMode && (
        <SelectionBar
          count={selectedIds.size}
          folders={folders}
          devices={devices}
          batchRunning={batchJob != null}
          onBulkEnrich={onBulkEnrich}
          onBulkAddToCollection={onBulkAddToCollection}
          onBulkSendToDevice={onBulkSendToDevice}
          onClear={onClearSelection}
        />
      )}
    </>
  );
}

export function SortMenu({
  prefs,
  updatePrefs,
}: {
  prefs: LibraryViewProps["prefs"];
  updatePrefs: LibraryViewProps["updatePrefs"];
}) {
  return (
    <Popover
      align="end"
      trigger={
        <button className="icon-btn-text" title="Sort">
          <ArrowUpDown size={13} strokeWidth={2} />
          <span className="hide-narrow">{SORT_LABELS[prefs.sortField]}</span>
          {prefs.sortDir === "asc" ? (
            <ArrowUp size={11} strokeWidth={2.4} />
          ) : (
            <ArrowDown size={11} strokeWidth={2.4} />
          )}
        </button>
      }
    >
      {(close) => (
        <div className="menu">
          <MenuLabel>Sort by</MenuLabel>
          {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
            <MenuItem
              key={f}
              icon={
                prefs.sortField === f ? (
                  <Check size={14} strokeWidth={2.4} />
                ) : (
                  <span style={{ width: 14 }} />
                )
              }
              label={SORT_LABELS[f]}
              onClick={() => {
                updatePrefs({ sortField: f });
                close();
              }}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<ArrowUp size={14} strokeWidth={2.2} />}
            label="Ascending"
            active={prefs.sortDir === "asc"}
            onClick={() => {
              updatePrefs({ sortDir: "asc" });
              close();
            }}
          />
          <MenuItem
            icon={<ArrowDown size={14} strokeWidth={2.2} />}
            label="Descending"
            active={prefs.sortDir === "desc"}
            onClick={() => {
              updatePrefs({ sortDir: "desc" });
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

export function ViewSwitcher({
  view,
  setView,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  return (
    <div className="view-switch">
      <button
        className={`icon-btn ${view === "grid" ? "active" : ""}`}
        onClick={() => setView("grid")}
        title="Grid"
      >
        <LayoutGrid size={13} strokeWidth={2} />
      </button>
      <button
        className={`icon-btn ${view === "compact" ? "active" : ""}`}
        onClick={() => setView("compact")}
        title="Compact"
      >
        <Grid2x2 size={13} strokeWidth={2} />
      </button>
      <button
        className={`icon-btn ${view === "list" ? "active" : ""}`}
        onClick={() => setView("list")}
        title="List"
      >
        <Rows3 size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Topbar overflow menu — same actions as File / Window menubar so
 *  they're discoverable on Linux/Windows where users don't reach for
 *  the menubar as instinctively as on macOS. The shortcut hints come
 *  through from the same source of truth (lib.rs accelerators). */
function MoreMenu({
  onExportHighlights,
  onRevealVault,
  onOpenShortcuts,
}: {
  onExportHighlights: () => void;
  onRevealVault: () => void;
  onOpenShortcuts: () => void;
}) {
  return (
    <Popover
      align="end"
      trigger={
        <button className="icon-btn" title="More">
          <MoreHorizontal size={14} strokeWidth={2} />
        </button>
      }
    >
      {(close) => (
        <div className="menu">
          <MenuItem
            icon={<Download size={14} strokeWidth={2} />}
            label="Export highlights…"
            shortcut="⌘⇧E"
            onClick={() => {
              close();
              onExportHighlights();
            }}
          />
          <MenuItem
            icon={<FolderOpen size={14} strokeWidth={2} />}
            label="Reveal vault folder"
            onClick={() => {
              close();
              onRevealVault();
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<Keyboard size={14} strokeWidth={2} />}
            label="Keyboard shortcuts"
            shortcut="⌘/"
            onClick={() => {
              close();
              onOpenShortcuts();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

function TagsMenu({
  tagCounts,
  tagFilter,
  onSetTagFilter,
}: {
  tagCounts: { name: string; count: number }[];
  tagFilter: string | null;
  onSetTagFilter: (t: string | null) => void;
}) {
  if (tagCounts.length === 0) return null;
  return (
    <Popover
      align="end"
      trigger={
        <button
          className={`icon-btn-text ${tagFilter ? "active" : ""}`}
          title="Filter by tag"
        >
          <Tag size={13} strokeWidth={2} />
          <span className="hide-narrow">Tags</span>
          {tagFilter && <span className="topbar-tag-badge">{tagFilter}</span>}
        </button>
      }
    >
      {(close) => (
        <div className="menu">
          <MenuLabel>Filter by tag</MenuLabel>
          {tagFilter && (
            <>
              <MenuItem
                icon={<X size={14} strokeWidth={2.2} />}
                label="Clear tag filter"
                onClick={() => {
                  onSetTagFilter(null);
                  close();
                }}
              />
              <MenuSeparator />
            </>
          )}
          {tagCounts.map((t) => (
            <MenuItem
              key={t.name}
              icon={
                tagFilter === t.name ? (
                  <Check size={14} strokeWidth={2.4} />
                ) : (
                  <Bookmark size={14} strokeWidth={2} />
                )
              }
              label={t.name}
              active={tagFilter === t.name}
              onClick={() => {
                onSetTagFilter(tagFilter === t.name ? null : t.name);
                close();
              }}
            />
          ))}
        </div>
      )}
    </Popover>
  );
}

function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-pill" onClick={onClear} title="Clear filter">
      <span>{label}</span>
      <X size={11} strokeWidth={2.4} />
    </button>
  );
}

export function SkeletonGrid({ compact }: { compact: boolean }) {
  const count = compact ? 24 : 12;
  return (
    <div
      className={`grid ${compact ? "grid-compact" : ""} skeleton-grid`}
      aria-busy="true"
      aria-label="Loading library"
    >
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="card skeleton-card">
          <div className="cover">
            <div className="cover-skeleton" />
          </div>
          {!compact && (
            <div className="meta">
              <div className="skeleton-line skeleton-line-title" />
              <div className="skeleton-line skeleton-line-author" />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function EmptyState({
  hasFilter,
  onPickImport,
  importing,
}: {
  hasFilter: boolean;
  onPickImport?: (m: "files" | "folder") => void;
  importing?: boolean;
}) {
  if (hasFilter) {
    return (
      <div className="empty">
        <h2>No matches</h2>
        <p>Try a different search or clear the active filters.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="empty-art">
        <div className="empty-book b1" />
        <div className="empty-book b2" />
        <div className="empty-book b3" />
      </div>
      <h2>Your library is empty</h2>
      <p>Drop EPUBs anywhere on the window — or import from disk.</p>
      {onPickImport && (
        <div className="empty-actions">
          <button
            className="primary"
            disabled={importing}
            onClick={() => onPickImport("files")}
          >
            <Plus size={13} strokeWidth={2.4} />
            Import files
          </button>
          <button
            className="secondary"
            disabled={importing}
            onClick={() => onPickImport("folder")}
          >
            <FolderPlus size={13} strokeWidth={2} />
            Import folder
          </button>
        </div>
      )}
    </div>
  );
}
