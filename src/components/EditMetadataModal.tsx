import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X, RotateCcw } from "lucide-react";
import { updateBookMetadata, clearManualField, type MetadataPatch } from "../api";
import type { Book } from "../types";

interface Props {
  book: Book;
  /** JSON object of fields the user has previously edited. */
  manualFields: Record<string, boolean>;
  onSaved: () => void;
  close: () => void;
}

/**
 * Edit-metadata modal. Each field is a controlled input; we diff
 * against the initial book on submit and only send what changed.
 * Nullable fields (everything except title and authors) are cleared by
 * blanking the input.
 *
 * "Reset to auto-detect" per field clears the manual-override flag so
 * the next enrich pass can refill that field from Open Library /
 * Google Books.
 */
export function EditMetadataModal({ book, manualFields, onSaved, close }: Props) {
  const [title, setTitle] = useState(book.title);
  const [authors, setAuthors] = useState(book.authors.join(", "));
  const [series, setSeries] = useState(book.series ?? "");
  const [seriesIndex, setSeriesIndex] = useState(
    book.series_index != null ? String(book.series_index) : ""
  );
  const [language, setLanguage] = useState(book.language ?? "");
  const [isbn, setIsbn] = useState(book.isbn ?? "");
  const [pubDate, setPubDate] = useState(book.pub_date ?? "");
  const [description, setDescription] = useState(book.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const initial = {
    title: book.title,
    authors: book.authors.join(", "),
    series: book.series ?? "",
    seriesIndex: book.series_index != null ? String(book.series_index) : "",
    language: book.language ?? "",
    isbn: book.isbn ?? "",
    pubDate: book.pub_date ?? "",
    description: book.description ?? "",
  };

  const buildPatch = (): MetadataPatch => {
    const patch: MetadataPatch = {};
    if (title.trim() !== initial.title) patch.title = title.trim();
    if (authors !== initial.authors) {
      patch.authors = authors
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (series !== initial.series) patch.series = series.trim() || null;
    if (seriesIndex !== initial.seriesIndex) {
      const parsed = seriesIndex.trim() === "" ? null : Number(seriesIndex);
      patch.series_index = Number.isFinite(parsed as number) ? (parsed as number) : null;
    }
    if (language !== initial.language) patch.language = language.trim() || null;
    if (isbn !== initial.isbn) patch.isbn = isbn.trim() || null;
    if (pubDate !== initial.pubDate) patch.pub_date = pubDate.trim() || null;
    if (description !== initial.description) {
      patch.description = description.trim() || null;
    }
    return patch;
  };

  const save = async () => {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateBookMetadata(book.id, patch);
      onSaved();
      close();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const revert = async (field: string) => {
    try {
      await clearManualField(book.id, field);
      onSaved();
    } catch {
      /* non-fatal */
    }
  };

  const fieldRow = (
    key: string,
    label: string,
    input: React.ReactNode,
    options: { wide?: boolean } = {}
  ) => (
    <div className={`edit-meta-row${options.wide ? " wide" : ""}`}>
      <label className="edit-meta-label">
        {label}
        {manualFields[key] && (
          <button
            type="button"
            className="edit-meta-revert"
            title="Reset to auto-detected; next enrich will refill"
            onClick={() => revert(key)}
          >
            <RotateCcw size={11} />
            <span>auto</span>
          </button>
        )}
      </label>
      {input}
    </div>
  );

  return createPortal(
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="edit-meta"
        role="dialog"
        aria-label="Edit metadata"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="edit-meta-header">
          <span className="edit-meta-title">Edit metadata</span>
          <button className="edit-meta-close" onClick={close} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="edit-meta-body">
          {fieldRow(
            "title",
            "Title",
            <input
              ref={titleRef}
              className="edit-meta-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />,
            { wide: true }
          )}
          {fieldRow(
            "authors",
            "Authors (comma-separated)",
            <input
              className="edit-meta-input"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="e.g. Ursula K. Le Guin, Theodore Sturgeon"
            />,
            { wide: true }
          )}
          <div className="edit-meta-grid">
            {fieldRow(
              "series",
              "Series",
              <input
                className="edit-meta-input"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
              />
            )}
            {fieldRow(
              "series_index",
              "Series #",
              <input
                className="edit-meta-input"
                value={seriesIndex}
                onChange={(e) => setSeriesIndex(e.target.value)}
                inputMode="decimal"
                placeholder="1"
              />
            )}
            {fieldRow(
              "language",
              "Language",
              <input
                className="edit-meta-input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="en"
              />
            )}
            {fieldRow(
              "isbn",
              "ISBN",
              <input
                className="edit-meta-input"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
              />
            )}
            {fieldRow(
              "pub_date",
              "Publication date",
              <input
                className="edit-meta-input"
                value={pubDate}
                onChange={(e) => setPubDate(e.target.value)}
                placeholder="YYYY or YYYY-MM-DD"
              />
            )}
          </div>
          {fieldRow(
            "description",
            "Description",
            <textarea
              className="edit-meta-input edit-meta-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
            />,
            { wide: true }
          )}
        </div>

        {error && <div className="edit-meta-error">{error}</div>}

        <div className="edit-meta-footer">
          <button className="edit-meta-btn" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="edit-meta-btn primary"
            onClick={save}
            disabled={saving}
          >
            {saving && <Loader2 size={13} className="spin" />}
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
