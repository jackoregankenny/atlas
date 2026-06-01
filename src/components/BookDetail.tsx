import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Copy as CopyIcon,
  Folder,
  Images as ImagesIcon,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  Tag as TagIcon,
  X,
} from "lucide-react";
import {
  addTag,
  coverUrl,
  getBook,
  removeTag,
  setFinished,
  setRating,
} from "../api";
import type { Book, Device } from "../types";
import { sanitizeDescription } from "../util/sanitizeHtml";
import { formatAdded, formatIsbn, formatPubDate, formatRelative } from "../util/format";
import { Book3D } from "./Book3D";
import { useDominantColor } from "../hooks/useDominantColor";
import { Popover } from "./Popover";
import { BookActionMenu, type BookActionHandlers } from "./BookActionMenu";
import { StarRating } from "./StarRating";
import { ErrorBoundary } from "./ErrorBoundary";
import { CoverPicker } from "./CoverPicker";
import { rgbString, readableForeground } from "../util/dominantColor";

interface Props {
  bookId: number | null;
  /** If provided, render immediately from cache; refetch in background. */
  initial?: Book | null;
  onClose: () => void;
  onRead: (book: Book) => void;
  onEnrich: (id: number) => void;
  onChange: () => void;
  onAuthorClick?: (name: string) => void;
  onSeriesClick?: (name: string) => void;
  enriching: boolean;
  actions: BookActionHandlers;
  devices: Device[];
  folders: import("../types").Collection[];
  onAddToFolder: (folderId: number, bookId: number) => Promise<void> | void;
  onRemoveFromFolder: (folderId: number, bookId: number) => Promise<void> | void;
  onCreateFolder: (name: string) => Promise<number>;
}

export function BookDetail({
  bookId,
  initial,
  onClose,
  onRead,
  onEnrich,
  onChange,
  onAuthorClick,
  onSeriesClick,
  enriching,
  actions,
  devices,
  folders,
  onAddToFolder,
  onRemoveFromFolder,
  onCreateFolder,
}: Props) {
  const [book, setBook] = useState<Book | null>(initial ?? null);
  const lastReqId = useRef(0);

  const reload = async (id: number) => {
    const reqId = ++lastReqId.current;
    try {
      const fresh = await getBook(id);
      if (reqId !== lastReqId.current) return; // stale
      if (fresh) setBook(fresh);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (bookId == null) {
      setBook(null);
      return;
    }
    // Render the cached version instantly if available, then refetch.
    if (initial && initial.id === bookId) {
      setBook(initial);
    } else {
      setBook(null);
    }
    reload(bookId);
  }, [bookId, initial, enriching]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        onClose();
      }
    }
    if (bookId != null) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bookId, onClose]);

  const open = bookId != null;

  const toggleFinished = async () => {
    if (!book) return;
    await setFinished(book.id, book.status !== "finished");
    await reload(book.id);
    onChange();
  };

  const handleAddTag = async (name: string) => {
    if (!book) return;
    await addTag(book.id, name);
    await reload(book.id);
    onChange();
  };

  const handleRemoveTag = async (name: string) => {
    if (!book) return;
    await removeTag(book.id, name);
    await reload(book.id);
    onChange();
  };

  const handleRating = async (v: number | null) => {
    if (!book) return;
    const prev = book.rating ?? null;
    // Optimistic: stars snap immediately.
    setBook({ ...book, rating: v });
    try {
      await setRating(book.id, v);
      onChange();
    } catch (e) {
      setBook({ ...book, rating: prev });
      console.error("setRating failed", e);
    }
  };

  const handleCoverChanged = async () => {
    if (!book) return;
    await reload(book.id);
    onChange();
  };

  return (
    <>
      <div className={`detail-backdrop ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`detail-panel ${open ? "open" : ""}`}>
        {open && (
          <>
            <header className="detail-header">
              <button className="icon-btn" onClick={onClose} title="Close (Esc)">
                <X size={16} strokeWidth={2} />
              </button>
            </header>
            {!book ? (
              <div className="detail-body muted">Loading…</div>
            ) : (
              <ErrorBoundary resetKey={book.id}>
                <DetailBody
                  book={book}
                  onRead={onRead}
                  onEnrich={onEnrich}
                  onToggleFinished={toggleFinished}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  onRating={handleRating}
                  onCoverChanged={handleCoverChanged}
                  onAuthorClick={onAuthorClick}
                  onSeriesClick={onSeriesClick}
                  enriching={enriching}
                  actions={actions}
                  devices={devices}
                  folders={folders}
                  onAddToFolder={onAddToFolder}
                  onRemoveFromFolder={onRemoveFromFolder}
                  onCreateFolder={onCreateFolder}
                />
              </ErrorBoundary>
            )}
          </>
        )}
      </aside>
    </>
  );
}

interface BodyProps {
  book: Book;
  onRead: (b: Book) => void;
  onEnrich: (id: number) => void;
  onToggleFinished: () => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
  onRating: (v: number | null) => void;
  onCoverChanged: () => void;
  onAuthorClick?: (name: string) => void;
  onSeriesClick?: (name: string) => void;
  enriching: boolean;
  actions: BookActionHandlers;
  devices: Device[];
  folders: import("../types").Collection[];
  onAddToFolder: (folderId: number, bookId: number) => Promise<void> | void;
  onRemoveFromFolder: (folderId: number, bookId: number) => Promise<void> | void;
  onCreateFolder: (name: string) => Promise<number>;
}

function DetailBody({
  book,
  onRead,
  onEnrich,
  onToggleFinished,
  onAddTag,
  onRemoveTag,
  onRating,
  onCoverChanged,
  onAuthorClick,
  onSeriesClick,
  enriching,
  actions,
  devices,
  folders,
  onAddToFolder,
  onRemoveFromFolder,
  onCreateFolder,
}: BodyProps) {
  const desc = sanitizeDescription(book.description);
  const finished = book.status === "finished";

  const heroBg = coverUrl(book.cover_path);
  const firstDevice = devices[0];
  const dominant = useDominantColor(book.cover_path);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const tintStyle: React.CSSProperties | undefined = (() => {
    const base: Record<string, string> = {};
    if (heroBg) base["--hero-bg"] = `url("${heroBg}")`;
    if (dominant) {
      base["--book-tint-rgb"] = rgbString(dominant);
      base["--book-tint-fg"] = readableForeground(dominant);
    }
    return Object.keys(base).length ? (base as React.CSSProperties) : undefined;
  })();

  return (
    <div
      ref={bodyRef}
      className="detail-body"
      key={book.id}
      data-book-tint={dominant ? "" : undefined}
      style={tintStyle}
    >
      <div className="detail-hero">
        <div className="detail-hero-backdrop" aria-hidden />
        <div className="detail-hero-tint" aria-hidden />
        <div className="detail-cover-wrap detail-cover-3d">
          <Book3D
            coverPath={book.cover_path}
            title={book.title}
            width={172}
            depth={30}
            tint={dominant}
          />
        </div>
      </div>

      <div className="detail-headline">
        <StatusPill status={book.status} />
        <h2 className="detail-title">{book.title}</h2>
        <div className="detail-byline">
          {book.authors.length ? (
            book.authors.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                {onAuthorClick ? (
                  <a className="link-author" onClick={() => onAuthorClick(a)}>
                    {a}
                  </a>
                ) : (
                  a
                )}
              </span>
            ))
          ) : (
            "Unknown author"
          )}
        </div>
        {book.series && (
          <div className="detail-series-line">
            {onSeriesClick ? (
              <a className="link-series" onClick={() => onSeriesClick(book.series!)}>
                {book.series}
                {book.series_index != null ? ` · Book ${book.series_index}` : ""}
              </a>
            ) : (
              <>
                {book.series}
                {book.series_index != null ? ` · Book ${book.series_index}` : ""}
              </>
            )}
          </div>
        )}
        <div className="detail-rating">
          <StarRating value={book.rating} onChange={onRating} />
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="primary"
          disabled={!book.file_path}
          onClick={() => onRead(book)}
        >
          <BookOpen size={14} strokeWidth={2.2} />
          {book.progress_percent && book.progress_percent > 0 && !finished
            ? `Continue · ${Math.round(book.progress_percent)}%`
            : finished
            ? "Re-read"
            : "Read"}
        </button>
        <button
          onClick={onToggleFinished}
          className={`secondary ${finished ? "active" : ""}`}
          title={finished ? "Mark as unread" : "Mark as finished"}
        >
          <CheckCircle2 size={14} strokeWidth={2} />
          {finished ? "Finished" : "Mark read"}
        </button>
        <Popover
          align="end"
          trigger={
            <button className="square" title="Change cover">
              <ImagesIcon size={14} strokeWidth={2} />
            </button>
          }
        >
          {(close) => (
            <CoverPicker
              bookId={book.id}
              onChanged={onCoverChanged}
              close={close}
            />
          )}
        </Popover>
        <button
          className="square"
          onClick={() => onEnrich(book.id)}
          disabled={enriching}
          title="Enrich metadata"
        >
          <Sparkles size={14} strokeWidth={2} />
        </button>
        <button
          className="square"
          onClick={() => actions.onReveal(book)}
          disabled={!book.file_path}
          title="Reveal in Finder"
        >
          <Folder size={14} strokeWidth={2} />
        </button>
        <Popover
          align="end"
          trigger={
            <button className="square" title="More actions">
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
          }
        >
          {(close) => (
            <BookActionMenu
              book={book}
              enriching={enriching}
              close={close}
              mode="secondary"
              devices={devices}
              handlers={actions}
            />
          )}
        </Popover>
      </div>

      {firstDevice && book.file_path && (
        <div className="detail-quick-row">
          <button
            className="secondary device-send"
            onClick={() => actions.onSendDevice(book, firstDevice)}
            title={`Send to ${firstDevice.name}`}
          >
            <Send size={13} strokeWidth={2} />
            <span>Send to {firstDevice.name}</span>
          </button>
        </div>
      )}

      <FolderEditor
        book={book}
        folders={folders}
        onAdd={onAddToFolder}
        onRemove={onRemoveFromFolder}
        onCreate={onCreateFolder}
      />

      <TagEditor
        tags={book.tags}
        onAdd={onAddTag}
        onRemove={onRemoveTag}
      />

      <DetailStats book={book} />

      {desc && (
        <section className="detail-section">
          <div
            className="detail-desc"
            dangerouslySetInnerHTML={{ __html: desc }}
          />
        </section>
      )}

      <section className="detail-facts">
        {book.pub_date && (
          <FactRow label="Published" value={formatPubDate(book.pub_date)} />
        )}
        {book.language && (
          <FactRow label="Language" value={book.language.toUpperCase()} />
        )}
        {book.isbn && (
          <FactRow
            label="ISBN"
            value={
              <button
                className="fact-copy"
                onClick={() => actions.onCopyIsbn(book)}
                title="Copy ISBN"
              >
                <span className="mono">{formatIsbn(book.isbn)}</span>
                <CopyIcon size={11} strokeWidth={2} />
              </button>
            }
          />
        )}
        <FactRow label="Added" value={formatAdded(book.added_at)} />
        {book.finished_at && (
          <FactRow label="Finished" value={formatAdded(book.finished_at)} />
        )}
      </section>

    </div>
  );
}

function DetailStats({ book }: { book: Book }) {
  const pct =
    book.progress_percent != null ? Math.round(book.progress_percent) : null;
  const added = formatRelative(book.added_at);
  const showProgress =
    pct != null && pct > 0 && book.status !== "finished";

  return (
    <section className="detail-stats">
      <div className="stat-card">
        <div className="stat-label">Status</div>
        <div className="stat-value">
          {book.status === "finished"
            ? "Finished"
            : book.status === "reading"
            ? "Reading"
            : "Unread"}
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Added</div>
        <div className="stat-value">{added || "—"}</div>
      </div>
      <div className="stat-card stat-card-progress">
        <div className="stat-label">Progress</div>
        {showProgress ? (
          <>
            <div className="stat-value">{pct}%</div>
            <div className="progress-bar slim">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, pct!)}%` }}
              />
            </div>
          </>
        ) : (
          <div className="stat-value muted">
            {book.status === "finished" ? "100%" : "Not started"}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: Book["status"] }) {
  if (status === "unread") return null;
  const label = status === "finished" ? "Finished" : "Reading";
  return (
    <span className={`status-pill status-${status}`}>
      {status === "finished" && <Check size={11} strokeWidth={2.8} />}
      {label}
    </span>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="fact-row">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value}</span>
    </div>
  );
}

function TagEditor({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const v = val.trim();
    if (v) onAdd(v);
    setVal("");
    setEditing(false);
  };

  return (
    <section className="tag-section">
      <div className="tag-row">
        <TagIcon size={12} strokeWidth={2.2} className="tag-section-icon" />
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button
              className="tag-chip-x"
              onClick={() => onRemove(t)}
              title={`Remove tag "${t}"`}
            >
              <X size={9} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        {editing ? (
          <input
            ref={inputRef}
            className="tag-input"
            value={val}
            placeholder="Add tag…"
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                setVal("");
                setEditing(false);
              }
            }}
          />
        ) : (
          <button className="tag-add" onClick={() => setEditing(true)}>
            <Plus size={11} strokeWidth={2.4} />
            <span>Add tag</span>
          </button>
        )}
      </div>
    </section>
  );
}

function FolderEditor({
  book,
  folders,
  onAdd,
  onRemove,
  onCreate,
}: {
  book: Book;
  folders: import("../types").Collection[];
  onAdd: (folderId: number, bookId: number) => Promise<void> | void;
  onRemove: (folderId: number, bookId: number) => Promise<void> | void;
  onCreate: (name: string) => Promise<number>;
}) {
  // Defensive: backend may have served this book before folder_ids landed,
  // and `folders` can be undefined while the list is still loading.
  const bookFolderIds = book.folder_ids ?? [];
  const allFolders = folders ?? [];
  const inFolders = allFolders.filter((f) => bookFolderIds.includes(f.id));
  const available = allFolders.filter((f) => !bookFolderIds.includes(f.id));

  return (
    <section className="folder-section">
      <div className="folder-chip-row">
        <Folder size={12} strokeWidth={2.2} className="folder-section-icon" />
        {inFolders.map((f) => (
          <span key={f.id} className="folder-chip">
            {f.name}
            <button
              className="folder-chip-x"
              onClick={() => onRemove(f.id, book.id)}
              title={`Remove from "${f.name}"`}
            >
              <X size={9} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        <Popover
          align="start"
          trigger={
            <button className="folder-add" title="Add to folder">
              <Plus size={11} strokeWidth={2.4} />
              <span>{inFolders.length === 0 ? "Add to folder" : "Add"}</span>
            </button>
          }
        >
          {(close) => (
            <FolderPicker
              available={available}
              onPick={async (id) => {
                await onAdd(id, book.id);
                close();
              }}
              onCreate={async (name) => {
                const id = await onCreate(name);
                await onAdd(id, book.id);
                close();
              }}
            />
          )}
        </Popover>
      </div>
    </section>
  );
}

function FolderPicker({
  available,
  onPick,
  onCreate,
}: {
  available: import("../types").Collection[];
  onPick: (id: number) => void | Promise<void>;
  onCreate: (name: string) => void | Promise<void>;
}) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const safe = available ?? [];
  const filtered = val
    ? safe.filter((f) => f.name.toLowerCase().includes(val.toLowerCase()))
    : safe;
  const exactMatch = filtered.some(
    (f) => f.name.toLowerCase() === val.trim().toLowerCase()
  );

  return (
    <div className="menu folder-picker">
      <div className="folder-picker-search">
        <input
          ref={inputRef}
          className="folder-picker-input"
          placeholder="Find or create folder…"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = val.trim();
              if (!v) return;
              const exact = available.find(
                (f) => f.name.toLowerCase() === v.toLowerCase()
              );
              if (exact) await onPick(exact.id);
              else await onCreate(v);
            }
          }}
        />
      </div>
      {filtered.length > 0 && (
        <>
          <div className="menu-sep" />
          {filtered.map((f) => (
            <button
              key={f.id}
              className="folder-picker-item"
              onClick={() => onPick(f.id)}
            >
              <Folder size={13} strokeWidth={2} />
              <span className="folder-picker-name">{f.name}</span>
              <span className="folder-picker-count">{f.count}</span>
            </button>
          ))}
        </>
      )}
      {val.trim() && !exactMatch && (
        <>
          <div className="menu-sep" />
          <button
            className="folder-picker-item folder-picker-create-row"
            onClick={() => onCreate(val.trim())}
          >
            <Plus size={13} strokeWidth={2.2} />
            <span>Create "{val.trim()}"</span>
          </button>
        </>
      )}
    </div>
  );
}
