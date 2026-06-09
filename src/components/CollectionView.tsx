import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  Check,
  Folder,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Book, Collection, Device } from "../types";
import type { EnrichJob } from "../enrichPool";
import type { useLibraryPrefs } from "../hooks/useLibraryPrefs";
import { sortBooks } from "../util/sort";
import { Cover } from "./Cover";
import { BookGrid, BookList } from "./BookGrid";
import { SelectionBar } from "./SelectionBar";
import { SortMenu, ViewSwitcher } from "./LibraryView";

interface CollectionViewProps {
  collectionId: number;
  allBooks: Book[];
  allFolders: Collection[];
  enrichingIds: Set<number>;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onBulkEnrich: () => void;
  onBulkSendToDevice: (device: Device) => void;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
  onEnrich: (id: number) => void;
  onContextMenu: (b: Book, e: React.MouseEvent) => void;
  onAuthorClick: (name: string) => void;
  onSeriesClick: (name: string) => void;
  onBack: () => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onAddBooks: (ids: number[]) => Promise<void>;
  onRemoveFromCollection: (bookId: number) => Promise<void>;
  devices: Device[];
  batchJob: EnrichJob | null;
  onCancelBatch: () => void;
  prefs: ReturnType<typeof useLibraryPrefs>["prefs"];
  updatePrefs: ReturnType<typeof useLibraryPrefs>["update"];
}

export function CollectionView({
  collectionId,
  allBooks,
  allFolders,
  enrichingIds,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onBulkEnrich,
  onBulkSendToDevice,
  onOpen,
  onHover,
  onEnrich,
  onContextMenu,
  onAuthorClick,
  onSeriesClick,
  onBack,
  onRename,
  onDelete,
  onAddBooks,
  onRemoveFromCollection,
  devices,
  batchJob,
  onCancelBatch,
  prefs,
  updatePrefs,
}: CollectionViewProps) {
  const collection = allFolders.find((f) => f.id === collectionId);
  const collectionBooks = useMemo(
    () => allBooks.filter((b) => b.folder_ids.includes(collectionId)),
    [allBooks, collectionId]
  );
  const sorted = useMemo(
    () => sortBooks(collectionBooks, prefs.sortField, prefs.sortDir),
    [collectionBooks, prefs.sortField, prefs.sortDir]
  );

  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const inSelectionMode = selectedIds.size > 0;

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const commitRename = async () => {
    const v = renameVal.trim();
    if (v && collection) await onRename(collectionId, v);
    setRenaming(false);
    setRenameVal("");
  };

  const handleBulkRemove = async () => {
    for (const id of selectedIds) {
      await onRemoveFromCollection(id);
    }
    onClearSelection();
  };

  return (
    <>
      <header className="topbar coll-topbar" data-tauri-drag-region>
        <button className="coll-back" onClick={onBack} title="All books">
          <ArrowLeft size={14} strokeWidth={2} />
          <span>All books</span>
        </button>
        <div className="coll-title-area">
          {renaming ? (
            <div className="coll-rename-row">
              <input
                ref={renameRef}
                className="coll-rename-input"
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") {
                    setRenaming(false);
                    setRenameVal("");
                  }
                }}
              />
              <button
                className="folder-edit-confirm"
                onClick={commitRename}
                disabled={!renameVal.trim()}
                title="Save"
              >
                <Check size={11} strokeWidth={2.6} />
              </button>
              <button
                className="folder-edit-cancel"
                onClick={() => {
                  setRenaming(false);
                  setRenameVal("");
                }}
                title="Cancel"
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            </div>
          ) : (
            <button
              className="coll-name-btn"
              onDoubleClick={() => {
                setRenaming(true);
                setRenameVal(collection?.name ?? "");
              }}
              title="Double-click to rename"
            >
              <Folder size={14} strokeWidth={2} />
              <span className="coll-name">{collection?.name ?? "Collection"}</span>
              <Pencil size={11} strokeWidth={2} className="coll-rename-hint" />
            </button>
          )}
          <span className="coll-count">
            {sorted.length} {sorted.length === 1 ? "book" : "books"}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            className="coll-add-btn icon-btn-text"
            onClick={() => setShowPicker(true)}
          >
            <Plus size={13} strokeWidth={2.4} />
            <span>Add books</span>
          </button>
          <SortMenu prefs={prefs} updatePrefs={updatePrefs} />
          <ViewSwitcher view={prefs.view} setView={(v) => updatePrefs({ view: v })} />
          {batchJob && (
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
          )}
          <button
            className="icon-btn"
            onClick={async () => {
              const ok = await ask(`Delete "${collection?.name}"?`, {
                title: "Delete collection",
                kind: "warning",
                okLabel: "Delete",
                cancelLabel: "Cancel",
              });
              if (ok) onDelete(collectionId);
            }}
            title="Delete collection"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="empty-art">
            <div className="empty-book b1" />
            <div className="empty-book b2" />
            <div className="empty-book b3" />
          </div>
          <h2>This collection is empty</h2>
          <p>Add books from your library to get started.</p>
          <div className="empty-actions">
            <button className="primary" onClick={() => setShowPicker(true)}>
              <Plus size={13} strokeWidth={2.4} />
              Add books
            </button>
          </div>
        </div>
      ) : prefs.view === "list" ? (
        <BookList
          books={sorted}
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
          books={sorted}
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
          folders={[]}
          devices={devices}
          batchRunning={batchJob != null}
          onBulkEnrich={onBulkEnrich}
          onBulkAddToCollection={() => {}}
          onBulkSendToDevice={onBulkSendToDevice}
          onClear={onClearSelection}
          removeLabel="Remove from collection"
          onBulkRemove={handleBulkRemove}
        />
      )}

      {showPicker && (
        <BookPickerModal
          allBooks={allBooks}
          collectionId={collectionId}
          onAdd={async (ids) => {
            await onAddBooks(ids);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

function BookPickerModal({
  allBooks,
  collectionId,
  onAdd,
  onClose,
}: {
  allBooks: Book[];
  collectionId: number;
  onAdd: (ids: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const available = useMemo(
    () => allBooks.filter((b) => !b.folder_ids.includes(collectionId)),
    [allBooks, collectionId]
  );
  const [query, setQuery] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.authors.some((a) => a.toLowerCase().includes(q))
    );
  }, [available, query]);

  const toggle = (id: number) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (pickedIds.size === 0) return;
    setAdding(true);
    try {
      await onAdd([...pickedIds]);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="picker-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="picker-modal">
        <div className="picker-head">
          <span className="picker-heading">Add books to collection</span>
          <div className="picker-search-wrap">
            <Search size={12} strokeWidth={2} className="picker-search-icon" />
            <input
              ref={searchRef}
              className="picker-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon-btn picker-search-clear"
                onClick={() => setQuery("")}
              >
                <X size={10} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="picker-empty">
            {available.length === 0
              ? "All books are already in this collection."
              : "No books match your search."}
          </div>
        ) : (
          <div className="picker-grid">
            {filtered.map((b) => {
              const picked = pickedIds.has(b.id);
              return (
                <button
                  key={b.id}
                  className={`picker-card ${picked ? "picker-card-selected" : ""}`}
                  onClick={() => toggle(b.id)}
                >
                  <div className="picker-cover">
                    <Cover path={b.cover_path} title={b.title} size="card" />
                    <span className={`picker-check ${picked ? "checked" : ""}`}>
                      {picked && <Check size={9} strokeWidth={3.5} />}
                    </span>
                  </div>
                  <div className="picker-meta">
                    <div className="picker-title">{b.title}</div>
                    <div className="picker-author">{b.authors[0] ?? "Unknown"}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="picker-foot">
          <span className="picker-hint">
            {pickedIds.size > 0
              ? `${pickedIds.size} book${pickedIds.size === 1 ? "" : "s"} selected`
              : `${available.length} book${available.length === 1 ? "" : "s"} available`}
          </span>
          <div className="picker-foot-actions">
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={handleAdd}
              disabled={pickedIds.size === 0 || adding}
            >
              {adding
                ? "Adding…"
                : pickedIds.size > 0
                  ? `Add ${pickedIds.size} book${pickedIds.size === 1 ? "" : "s"}`
                  : "Add books"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
