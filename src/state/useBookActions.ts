import { useCallback, useMemo, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  deleteBook,
  revealInFinder,
  sendToDevice,
  setFinished as apiSetFinished,
  addTag,
  removeTag,
  listBookFiles,
  openBookFile,
  convertBook,
  exportAnnotationsMarkdown,
  writeTextFile,
} from "../api";
import type { Book, Device } from "../types";
import type { BookActionHandlers } from "../components/BookActionMenu";
import type { PushToast } from "./useToasts";

interface Deps {
  refresh: () => Promise<void>;
  setBooks: React.Dispatch<React.SetStateAction<Book[]>>;
  pushToast: PushToast;
  onEnrich: (id: number) => void;
  setSelectedId: (id: number | null) => void;
  setReadingBook: (b: Book | null) => void;
}

/**
 * Every per-book action shared by the context menu, the detail panel's
 * action menu, and the command palette. Returns the `BookActionHandlers`
 * bundle those components consume, plus the bits of state they manage
 * (context-menu anchor, edit-metadata modal target).
 */
export function useBookActions({
  refresh,
  setBooks,
  pushToast,
  onEnrich,
  setSelectedId,
  setReadingBook,
}: Deps) {
  const [ctxMenu, setCtxMenu] = useState<{
    book: Book;
    pos: { x: number; y: number };
  } | null>(null);
  const [editingBook, setEditingBook] = useState<Book | null>(null);

  const onContextMenu = useCallback((book: Book, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ book, pos: { x: e.clientX, y: e.clientY } });
  }, []);

  const onToggleFinished = useCallback(
    async (book: Book) => {
      const wasFinished = book.status === "finished";
      const nextStatus: Book["status"] = wasFinished ? "unread" : "finished";
      // Optimistic: flip locally, fire IPC, rollback on failure.
      setBooks((prev) =>
        prev.map((b) => (b.id === book.id ? { ...b, status: nextStatus } : b))
      );
      try {
        await apiSetFinished(book.id, !wasFinished);
        pushToast("success", wasFinished ? "Marked as unread" : "Marked as finished");
      } catch (e) {
        setBooks((prev) =>
          prev.map((b) => (b.id === book.id ? { ...b, status: book.status } : b))
        );
        pushToast("error", `Update failed: ${e}`);
      }
    },
    [setBooks, pushToast]
  );

  const onCopyIsbn = useCallback(
    (book: Book) => {
      if (!book.isbn) return;
      navigator.clipboard.writeText(book.isbn).then(
        () => pushToast("success", "ISBN copied"),
        () => pushToast("error", "Copy failed")
      );
    },
    [pushToast]
  );

  const onReveal = useCallback(
    async (book: Book) => {
      if (!book.file_path) return;
      try {
        await revealInFinder(book.id);
      } catch (e) {
        pushToast("error", `Reveal failed: ${e}`);
      }
    },
    [pushToast]
  );

  const onSendDevice = useCallback(
    async (book: Book, device: Device) => {
      pushToast("info", `Sending to ${device.name}…`);
      try {
        await sendToDevice(book.id, device.id);
        pushToast("success", `Sent "${book.title}" to ${device.name}`);
      } catch (e) {
        pushToast("error", `Send failed: ${e}`);
      }
    },
    [pushToast]
  );

  const onAddTag = useCallback(
    async (id: number, name: string) => {
      try {
        await addTag(id, name);
        await refresh();
      } catch (e) {
        pushToast("error", `Tag failed: ${e}`);
      }
    },
    [refresh, pushToast]
  );

  const onRemoveTag = useCallback(
    async (id: number, name: string) => {
      try {
        await removeTag(id, name);
        await refresh();
      } catch (e) {
        pushToast("error", `Tag failed: ${e}`);
      }
    },
    [refresh, pushToast]
  );

  const onDelete = useCallback(
    async (id: number) => {
      try {
        await deleteBook(id);
        setSelectedId(null);
        await refresh();
        pushToast("success", "Removed from library");
      } catch (e) {
        pushToast("error", `Remove failed: ${e}`);
      }
    },
    [refresh, setSelectedId, pushToast]
  );

  /** Save annotations to a .md file via the OS save dialog. `book` is
   *  undefined for the all-books export. No-op when there's nothing
   *  to write; toasts both the empty case and success. */
  const onExportAnnotations = useCallback(
    async (book?: Book) => {
      try {
        const md = await exportAnnotationsMarkdown(book?.id ?? null);
        if (!md) {
          pushToast("info", "No annotations to export yet.");
          return;
        }
        const defaultName = book
          ? `${book.title} — annotations.md`
          : "Atlas annotations.md";
        const dest = await saveDialog({
          defaultPath: defaultName,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!dest) return;
        await writeTextFile(dest, md);
        pushToast("success", `Saved to ${dest.split(/[\\/]/).pop()}`);
      } catch (e) {
        pushToast("error", `Export failed: ${e}`);
      }
    },
    [pushToast]
  );

  /** Convert book → format via Rust-native exporter, register as export, toast. */
  const onConvert = useCallback(
    async (b: Book, fmt: "markdown" | "html" | "text") => {
      pushToast("info", `Converting "${b.title}" to ${fmt}…`);
      try {
        const out = await convertBook(b.id, fmt);
        const name = out.split(/[\\/]/).pop() ?? out;
        pushToast("success", `Exported ${name}`);
      } catch (e) {
        pushToast("error", `Convert failed: ${e}`);
      }
    },
    [pushToast]
  );

  /**
   * Opens the first `role='original'` sidecar via the OS default app.
   * Originals only exist for non-EPUB imports (pandoc-converted PDFs,
   * docx, mobi, etc.), so the menu item is disabled when `has_original`
   * is false.
   */
  const onOpenOriginal = useCallback(
    async (b: Book) => {
      try {
        const files = await listBookFiles(b.id);
        const original = files.find((f) => f.role === "original");
        if (!original) {
          pushToast("info", "No original file kept for this book.");
          return;
        }
        await openBookFile(b.id, original.id);
      } catch (e) {
        pushToast("error", `Open failed: ${e}`);
      }
    },
    [pushToast]
  );

  /**
   * Puts an `atlas://book/id/<n>` URL in the clipboard. The scheme
   * isn't registered yet (see task #4 — deep-link plugin) but the
   * format is stable, so links copied today will open correctly once
   * the handler ships.
   */
  const onCopyBookLink = useCallback(
    async (b: Book) => {
      const url = `atlas://book/id/${b.id}`;
      try {
        await navigator.clipboard.writeText(url);
        pushToast("success", "Book link copied");
      } catch {
        pushToast("error", "Clipboard write failed");
      }
    },
    [pushToast]
  );

  const onEditMetadata = useCallback((b: Book) => setEditingBook(b), []);

  const bookActions: BookActionHandlers = useMemo(
    () => ({
      onRead: (b) => setReadingBook(b),
      onShowDetails: (b) => setSelectedId(b.id),
      onToggleFinished,
      onEnrich: (b) => onEnrich(b.id),
      onAddTag,
      onRemoveTag,
      onCopyIsbn,
      onReveal,
      onSendDevice,
      onDelete: (b) => onDelete(b.id),
      onEditMetadata,
      onOpenOriginal,
      onCopyBookLink,
      onConvert,
      onExportAnnotations: (b) => onExportAnnotations(b),
    }),
    [
      setReadingBook,
      setSelectedId,
      onToggleFinished,
      onEnrich,
      onAddTag,
      onRemoveTag,
      onCopyIsbn,
      onReveal,
      onSendDevice,
      onDelete,
      onEditMetadata,
      onOpenOriginal,
      onCopyBookLink,
      onConvert,
      onExportAnnotations,
    ]
  );

  return {
    bookActions,
    ctxMenu,
    setCtxMenu,
    onContextMenu,
    editingBook,
    setEditingBook,
    onExportAnnotations,
  };
}
