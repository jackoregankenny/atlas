import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import {
  Library as LibraryIcon,
  Settings as SettingsIcon,
  Search,
  Sparkles,
  X,
  Plus,
  FilePlus2,
  FolderPlus,
  Database,
  LayoutGrid,
  Rows3,
  Grid2x2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  CheckCircle2,
  BookOpen,
  Bookmark,
  Tag,
  Circle,
  Folder,
  Trash2,
  Send,
  FileType2,
  Tablet,
  ArrowLeft,
  Pencil,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  MoreHorizontal,
  Download,
  FolderOpen,
} from "lucide-react";
import { listBooks, importPaths, enrichBook, deleteBook, getBook, appPaths } from "./api";
import { VaultPicker } from "./components/VaultPicker";
import type { Book, BookStatus, ImportReport } from "./types";
import { BookDetail } from "./components/BookDetail";
import { DropZone } from "./components/DropZone";
import { ToastStack, type Toast } from "./components/Toasts";
import { CommandPalette } from "./components/CommandPalette";
import { Cover } from "./components/Cover";
import { Popover, MenuItem, MenuSeparator, MenuLabel } from "./components/Popover";
import { ContextMenu } from "./components/ContextMenu";
import { BookActionMenu, type BookActionHandlers } from "./components/BookActionMenu";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { ColorPicker } from "./components/ColorPicker";
import { HoverPill } from "./components/HoverPill";
import { EditMetadataModal } from "./components/EditMetadataModal";
import {
  revealInFinder,
  sendToDevice,
  setFinished as apiSetFinished,
  addTag,
  removeTag,
  migrateOrphanFiles,
  listBookFiles,
  openBookFile,
  convertBook,
  exportAnnotationsMarkdown,
  writeTextFile,
} from "./api";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  useTheme,
  type Theme,
  type AccentValue,
  ACCENT_SWATCHES,
} from "./hooks/useTheme";
import {
  useLibraryPrefs,
  type SortField,
  type ViewMode,
} from "./hooks/useLibraryPrefs";
import { useUiPrefs, type ChromeStyle } from "./hooks/useUiPrefs";
import { sortBooks } from "./util/sort";
import { useDevices } from "./hooks/useDevices";
import { useFolders } from "./hooks/useFolders";
import { startEnrichBatch, type EnrichJob } from "./enrichPool";
import { withViewTransition } from "./util/viewTransition";
import "./App.css";

const Reader = lazy(() =>
  import("./components/Reader").then((m) => ({ default: m.Reader }))
);

type View = "library" | "collection" | "settings";
type StatusFilter = "all" | BookStatus;

let toastIdCounter = 1;

// Pop-out reader window: the URL is `index.html?reader=<id>` and we render
// nothing but the Reader. Closing it closes the window.
function StandaloneReader({ bookId }: { bookId: number }) {
  const [book, setBook] = useState<Book | null>(null);
  useEffect(() => {
    getBook(bookId).then((b) => b && setBook(b));
  }, [bookId]);
  const close = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* not in Tauri */
    }
  }, []);
  if (!book) {
    return <div className="reader-fallback"><span>Opening…</span></div>;
  }
  return (
    <Suspense fallback={<div className="reader-fallback"><span>Opening reader…</span></div>}>
      <Reader book={book} onClose={close} standalone />
    </Suspense>
  );
}

export default function App() {
  const readerParam = useMemo(() => {
    const id = new URLSearchParams(window.location.search).get("reader");
    const n = id ? Number(id) : NaN;
    return Number.isFinite(n) ? n : null;
  }, []);
  if (readerParam != null) {
    return <StandaloneReader bookId={readerParam} />;
  }
  return <MainApp />;
}

function MainApp() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Vault picker state — opens automatically on first launch, or
  // from Settings → Switch Vault. `mode` is null when closed.
  const [vaultPicker, setVaultPicker] = useState<{
    mode: "welcome" | "switch";
    currentPath: string | null;
  } | null>(null);
  const [view, setView] = useState<View>("library");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [enrichingIds, setEnrichingIds] = useState<Set<number>>(new Set());
  const [batchJob, setBatchJob] = useState<EnrichJob | null>(null);
  const batchHandleRef = useRef<{ cancel: () => void } | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCache = useRef<Map<number, Book>>(new Map());
  const [, bumpCache] = useState(0);
  const [readingBook, setReadingBook] = useState<Book | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    book: Book;
    pos: { x: number; y: number };
  } | null>(null);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [toasts, setToasts] = useState<Toast[]>([]);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const { theme, setTheme, cycle: cycleTheme, accent, setAccent } = useTheme();
  const { prefs, update: updatePrefs, cycleView } = useLibraryPrefs();
  const ui = useUiPrefs();
  const { devices } = useDevices();
  const folderApi = useFolders();

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const pushToast = useCallback(
    (kind: Toast["kind"], text: string, ttl?: number) => {
      const id = toastIdCounter++;
      setToasts((t) => [...t, { id, kind, text, ttl }]);
    },
    []
  );
  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  );

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
      detailCache.current.clear();
    } catch (e) {
      console.error("listBooks failed", e);
      pushToast("error", `Load failed: ${e}`);
    } finally {
      setLoaded(true);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Check first_run on mount and open the welcome picker if so. The
  // user can't dismiss the welcome modal — Atlas needs to know where
  // its library lives before doing anything else useful.
  useEffect(() => {
    let cancelled = false;
    appPaths()
      .then((p) => {
        if (cancelled) return;
        if (p.first_run) {
          setVaultPicker({ mode: "welcome", currentPath: null });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Dynamic window title: reflects what the user is doing so Cmd-Tab /
  // Mission Control labels are useful.
  useEffect(() => {
    let cancelled = false;
    const next = readingBook
      ? `Atlas — ${readingBook.title}`
      : view === "settings"
        ? "Atlas — Settings"
        : view === "collection"
          ? "Atlas — Collection"
          : "Atlas";
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        await getCurrentWindow().setTitle(next);
      } catch {
        /* ignore (e.g. browser preview) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, readingBook]);

  // One-shot at startup: any book whose canonical file lives outside the
  // managed library folder gets copied in. Silent on success; surface a toast
  // only if we actually did something or hit an error.
  const didMigrate = useRef(false);
  useEffect(() => {
    if (didMigrate.current) return;
    didMigrate.current = true;
    migrateOrphanFiles()
      .then((report) => {
        if (report.moved > 0) {
          refresh();
          pushToast(
            "success",
            `Moved ${report.moved} book${report.moved === 1 ? "" : "s"} into the library folder`
          );
        }
        if (report.missing > 0) {
          pushToast(
            "info",
            `${report.missing} book${report.missing === 1 ? "'s file is" : "s' files are"} missing on disk`
          );
        }
      })
      .catch(() => {});
  }, [refresh, pushToast]);

  const runImport = useCallback(
    async (paths: string[]) => {
      setImporting(true);
      try {
        const report: ImportReport = await importPaths(paths);
        await refresh();
        const parts = [
          `${report.imported} added`,
          report.skipped ? `${report.skipped} duplicate` : null,
          report.failed ? `${report.failed} failed` : null,
        ].filter(Boolean);
        pushToast(
          report.failed ? "error" : "success",
          `Imported · ${parts.join(", ")}`
        );
      } catch (e) {
        pushToast("error", `Import failed: ${e}`);
      } finally {
        setImporting(false);
      }
    },
    [refresh, pushToast]
  );

  // Export every highlight in the library to a Markdown file the user
  // picks via the save dialog. Same logic the File → Export Highlights
  // menu item uses; lifted here so the topbar More menu can share it.
  const onExportHighlights = useCallback(async () => {
    try {
      const { exportAnnotationsMarkdown, writeTextFile } = await import("./api");
      const md = await exportAnnotationsMarkdown(null);
      if (!md.trim()) {
        pushToast("info", "No highlights to export yet");
        return;
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "atlas-highlights.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, md);
      pushToast("success", "Highlights exported");
    } catch (e) {
      pushToast("error", `Export failed: ${e}`);
    }
  }, [pushToast]);

  const onRevealVault = useCallback(async () => {
    try {
      const { revealVaultInFileManager } = await import("./api");
      await revealVaultInFileManager();
    } catch (e) {
      pushToast("error", `Reveal failed: ${e}`);
    }
  }, [pushToast]);

  const onPickImport = useCallback(
    async (mode: "files" | "folder") => {
      try {
        const selection = await open({
          multiple: mode === "files",
          directory: mode === "folder",
          filters:
            mode === "files"
              ? [{ name: "EPUB", extensions: ["epub"] }]
              : undefined,
        });
        if (!selection) return;
        const paths = Array.isArray(selection) ? selection : [selection];
        await runImport(paths);
      } catch (e) {
        pushToast("error", `Import failed: ${e}`);
      }
    },
    [runImport, pushToast]
  );

  // Vault reconcile pushed deltas from .atlas/library.json into SQLite
  // during startup — refresh so the UI reflects whatever a sibling
  // device wrote since we last ran. See docs/VAULTS.md.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{
          updated: number;
          collections_created: number;
        }>("library-updated", (event) => {
          const { updated, collections_created } = event.payload;
          refresh();
          const bits = [
            updated > 0 ? `${updated} book${updated === 1 ? "" : "s"}` : null,
            collections_created > 0
              ? `${collections_created} collection${collections_created === 1 ? "" : "s"}`
              : null,
          ].filter(Boolean);
          if (bits.length) {
            pushToast("info", `Synced from vault · ${bits.join(", ")}`);
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => unlisten?.();
  }, [refresh, pushToast]);

  // Listen for native menubar events emitted from Rust (see src-tauri/src/lib.rs).
  // Every accelerator the menu exposes flows through here, so all
  // shortcuts have a single source of truth and Help → Search picks
  // them up on macOS automatically.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("menu", async (event) => {
          switch (event.payload) {
            // File
            case "menu:import":
              onPickImport("files");
              break;
            case "menu:import-folder":
              onPickImport("folder");
              break;
            case "menu:export-highlights":
              onExportHighlights();
              break;
            case "menu:reveal-vault":
              onRevealVault();
              break;

            // Edit
            case "menu:find":
              filterInputRef.current?.focus();
              filterInputRef.current?.select();
              break;

            // View — layout
            case "menu:view-grid":
              updatePrefs({ view: "grid" });
              break;
            case "menu:view-compact":
              updatePrefs({ view: "compact" });
              break;
            case "menu:view-list":
              updatePrefs({ view: "list" });
              break;

            // View — theme
            case "menu:theme-dark":
              setTheme("dark");
              break;
            case "menu:theme-light":
              setTheme("light");
              break;
            case "menu:theme-system":
              setTheme("system");
              break;

            // View — Reader highlights panel. Reader listens on the
            // window for this event; we dispatch unconditionally and
            // the Reader, if mounted, picks it up.
            case "menu:toggle-highlights":
              window.dispatchEvent(new CustomEvent("atlas:toggle-highlights"));
              break;

            // Go
            case "menu:library":
              setStatusFilter("all");
              setView("library");
              break;
            case "menu:filter-reading":
              setStatusFilter("reading");
              setView("library");
              break;
            case "menu:filter-unread":
              setStatusFilter("unread");
              setView("library");
              break;
            case "menu:filter-finished":
              setStatusFilter("finished");
              setView("library");
              break;
            case "menu:search":
              setPaletteOpen(true);
              break;

            // App / Window
            case "menu:settings":
              setView("settings");
              break;
            case "menu:shortcuts":
              setShortcutsOpen(true);
              break;
          }
        });
      } catch {
        /* not running in Tauri */
      }
    })();
    return () => unlisten?.();
  }, [onPickImport, updatePrefs, setTheme, pushToast, onExportHighlights, onRevealVault]);

  /**
   * Handle incoming atlas:// URLs.
   *
   *   atlas://book/id/<n>        → open detail panel
   *   atlas://book/id/<n>?read=1 → also start the reader
   *
   * Backend forwards both cold-start and warm deep-links here.
   */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("deep-link", async (event) => {
          const raw = event.payload;
          try {
            const url = new URL(raw);
            if (url.protocol !== "atlas:") return;
            // URL parses atlas://book/id/123 with hostname="book"
            // and pathname="/id/123" on most engines.
            const parts = (url.pathname || "").split("/").filter(Boolean);
            if (url.hostname === "book" && parts[0] === "id" && parts[1]) {
              const id = Number(parts[1]);
              if (!Number.isFinite(id)) return;
              setSelectedId(id);
              if (url.searchParams.get("read") === "1") {
                const fresh = await getBook(id);
                if (fresh) setReadingBook(fresh);
              }
            }
          } catch {
            /* malformed URL — ignore */
          }
        });
      } catch {
        /* not running in Tauri */
      }
    })();
    return () => unlisten?.();
  }, []);

  const onEnrich = useCallback(
    async (id: number) => {
      setEnrichingIds((s) => new Set(s).add(id));
      try {
        const out = await enrichBook(id);
        await refresh();
        if (out.matched) {
          const bits = [
            out.fields_updated && `${out.fields_updated} fields`,
            out.cover_fetched && "cover",
            out.tags_added && `${out.tags_added} tag${out.tags_added === 1 ? "" : "s"}`,
          ].filter(Boolean);
          pushToast(
            "success",
            bits.length ? `Enriched · ${bits.join(" + ")}` : "Already complete"
          );
        } else {
          pushToast("info", "No match found");
        }
      } catch (e) {
        pushToast("error", `Enrich failed: ${e}`);
      } finally {
        setEnrichingIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh, pushToast]
  );

  const onEnrichAllMissing = useCallback(() => {
    const targets = books.filter((b) => !b.cover_path || b.authors.length === 0);
    if (targets.length === 0) {
      pushToast("info", "Everything already has covers and authors");
      return;
    }
    const handle = startEnrichBatch(
      targets.map((b) => b.id),
      (job) => setBatchJob(job)
    );
    batchHandleRef.current = handle;
    handle.promise.then((final) => {
      batchHandleRef.current = null;
      setBatchJob(null);
      refresh();
      if (final.cancelled) {
        pushToast("info", `Stopped · ${final.matched}/${final.done} matched`);
      } else {
        pushToast(
          "success",
          `Enriched · ${final.matched}/${final.total} matched${
            final.errors ? `, ${final.errors} errors` : ""
          }`
        );
      }
    });
  }, [books, refresh, pushToast]);

  const cancelBatch = useCallback(() => {
    batchHandleRef.current?.cancel();
  }, []);

  const onBulkEnrich = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    clearSelection();
    const handle = startEnrichBatch(ids, (job) => setBatchJob(job));
    batchHandleRef.current = handle;
    handle.promise.then((final) => {
      batchHandleRef.current = null;
      setBatchJob(null);
      refresh();
      if (final.cancelled) {
        pushToast("info", `Stopped · ${final.matched}/${final.done} matched`);
      } else {
        pushToast(
          "success",
          `Enriched · ${final.matched}/${final.total} matched${
            final.errors ? `, ${final.errors} errors` : ""
          }`
        );
      }
    });
  }, [selectedIds, clearSelection, refresh, pushToast]);

  const onBulkAddToCollection = useCallback(
    async (collectionId: number) => {
      try {
        for (const id of selectedIds) {
          await folderApi.addBook(collectionId, id);
        }
        refresh();
        const col = folderApi.folders.find((f) => f.id === collectionId);
        pushToast(
          "success",
          `Added ${selectedIds.size} book${selectedIds.size === 1 ? "" : "s"} to "${col?.name ?? "collection"}"`
        );
        clearSelection();
      } catch (e) {
        pushToast("error", `Failed: ${e}`);
      }
    },
    [selectedIds, folderApi, refresh, clearSelection, pushToast]
  );

  const onBulkSendToDevice = useCallback(
    async (device: (typeof devices)[number]) => {
      const ids = [...selectedIds];
      clearSelection();
      pushToast("info", `Sending ${ids.length} book${ids.length === 1 ? "" : "s"} to ${device.name}…`);
      let succeeded = 0;
      for (const id of ids) {
        try {
          await sendToDevice(id, device.id);
          succeeded++;
        } catch {
          /* continue */
        }
      }
      pushToast(
        succeeded === ids.length ? "success" : "error",
        `Sent ${succeeded}/${ids.length} to ${device.name}`
      );
    },
    [selectedIds, clearSelection, pushToast]
  );

  const onHover = useCallback(
    (id: number | null) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
      if (id == null) {
        if (selectedId != null) setHoverId(null);
        return;
      }
      // Warm the detail cache regardless of whether the panel is open — even a
      // short delay (150ms) covers most accidental cursor crossings.
      if (!detailCache.current.has(id)) {
        prefetchTimer.current = setTimeout(async () => {
          try {
            const fresh = await getBook(id);
            if (fresh) {
              detailCache.current.set(id, fresh);
              bumpCache((n) => n + 1);
            }
          } catch {
            /* ignore */
          }
        }, 150);
      }
      // Only swap the preview when the detail panel is already open.
      if (selectedId != null) {
        hoverTimer.current = setTimeout(() => setHoverId(id), 80);
      }
    },
    [selectedId]
  );

  useEffect(() => {
    if (selectedId == null) setHoverId(null);
  }, [selectedId]);

  const previewId = hoverId ?? selectedId;
  const previewBook = useMemo(
    () =>
      previewId != null
        ? detailCache.current.get(previewId) ??
          books.find((b) => b.id === previewId) ??
          null
        : null,
    [books, previewId]
  );

  const onContextMenu = useCallback((book: Book, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ book, pos: { x: e.clientX, y: e.clientY } });
  }, []);

  const onToggleFinishedCtx = useCallback(
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
    [pushToast]
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
    async (book: Book, device: typeof devices[number]) => {
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

  const onAddTagCtx = useCallback(
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

  const onRemoveTagCtx = useCallback(
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
    [refresh, pushToast]
  );

  const onEditMetadata = useCallback((b: Book) => setEditingBook(b), []);

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

  // ===== Keyboard shortcuts =====
  const gPressed = useRef(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t as HTMLElement).isContentEditable);

      // global modifiers
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        const input = filterInputRef.current;
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        onPickImport("folder");
        return;
      }
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        onPickImport("files");
        return;
      }

      if (inField) return;

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        filterInputRef.current?.focus();
        return;
      }
      if (e.key === "v") {
        e.preventDefault();
        cycleView();
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        cycleTheme();
        return;
      }
      if (e.key === "g") {
        gPressed.current = true;
        setTimeout(() => (gPressed.current = false), 800);
        return;
      }
      if (gPressed.current) {
        if (e.key === "l") {
          e.preventDefault();
          setView("library");
        } else if (e.key === "s") {
          e.preventDefault();
          setView("settings");
        }
        gPressed.current = false;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPickImport, cycleView, cycleTheme]);

  const bookActions: BookActionHandlers = useMemo(
    () => ({
      onRead: (b) => setReadingBook(b),
      onShowDetails: (b) => setSelectedId(b.id),
      onToggleFinished: onToggleFinishedCtx,
      onEnrich: (b) => onEnrich(b.id),
      onAddTag: onAddTagCtx,
      onRemoveTag: onRemoveTagCtx,
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
      onToggleFinishedCtx,
      onEnrich,
      onAddTagCtx,
      onRemoveTagCtx,
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

  const filteredSorted = useMemo(() => {
    let arr = books;
    if (statusFilter !== "all") {
      arr = arr.filter((b) => b.status === statusFilter);
    }
    if (tagFilter) {
      arr = arr.filter((b) => b.tags.includes(tagFilter));
    }
    if (authorFilter) {
      arr = arr.filter((b) => b.authors.includes(authorFilter));
    }
    if (seriesFilter) {
      arr = arr.filter((b) => b.series === seriesFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          (b.series ?? "").toLowerCase().includes(q)
      );
    }
    return sortBooks(arr, prefs.sortField, prefs.sortDir);
  }, [
    books,
    query,
    statusFilter,
    tagFilter,
    authorFilter,
    seriesFilter,
    prefs.sortField,
    prefs.sortDir,
  ]);

  const statusCounts = useMemo(() => {
    const c = { all: books.length, unread: 0, reading: 0, finished: 0 };
    for (const b of books) c[b.status] += 1;
    return c;
  }, [books]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) for (const t of b.tags) map.set(t, (map.get(t) ?? 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [books]);

  const paletteActions = useMemo<
    import("./components/CommandPalette").PaletteAction[]
  >(
    () => [
      {
        id: "import-files",
        label: "Import files…",
        hint: "Add EPUBs from disk",
        keywords: "add new epub upload",
        icon: <FilePlus2 size={14} strokeWidth={2} />,
        run: () => onPickImport("files"),
      },
      {
        id: "import-folder",
        label: "Import folder…",
        hint: "Add every EPUB in a folder",
        keywords: "add directory bulk",
        icon: <FolderPlus size={14} strokeWidth={2} />,
        run: () => onPickImport("folder"),
      },
      {
        id: "enrich-missing",
        label: "Enrich books missing metadata",
        hint: "Fetch covers & authors from Open Library",
        keywords: "open library metadata cover author",
        icon: <Sparkles size={14} strokeWidth={2} />,
        run: () => onEnrichAllMissing(),
      },
      {
        id: "cycle-view",
        label: "Cycle library view",
        hint: "Grid · Compact · List",
        keywords: "layout grid list compact display",
        icon: <LayoutGrid size={14} strokeWidth={2} />,
        run: () => cycleView(),
      },
      {
        id: "cycle-theme",
        label: "Cycle theme",
        hint: "Dark · Light · System",
        keywords: "dark light mode appearance",
        icon:
          theme === "light" ? (
            <Sun size={14} strokeWidth={2} />
          ) : theme === "dark" ? (
            <Moon size={14} strokeWidth={2} />
          ) : (
            <Monitor size={14} strokeWidth={2} />
          ),
        run: () => cycleTheme(),
      },
      {
        id: "open-settings",
        label: "Open settings",
        keywords: "preferences config",
        icon: <SettingsIcon size={14} strokeWidth={2} />,
        run: () => setView("settings"),
      },
      {
        id: "show-shortcuts",
        label: "Show keyboard shortcuts",
        keywords: "help keys cheatsheet",
        icon: <Keyboard size={14} strokeWidth={2} />,
        run: () => setShortcutsOpen(true),
      },
    ],
    [onPickImport, onEnrichAllMissing, cycleView, cycleTheme, theme]
  );

  return (
    <div className="atlas-shell">
      <Sidebar
        view={view}
        setView={setView}
        statusFilter={statusFilter}
        setStatusFilter={(s) => {
          setStatusFilter(s);
          setView("library");
        }}
        statusCounts={statusCounts}
        folders={folderApi.folders}
        activeCollectionId={activeCollectionId}
        onSelectCollection={(id) => {
          setActiveCollectionId(id);
          setView("collection");
          clearSelection();
        }}
        onCreateFolder={folderApi.create}
        onDeleteFolder={async (id) => {
          await folderApi.remove(id);
          if (activeCollectionId === id) {
            setActiveCollectionId(null);
            setView("library");
          }
          refresh();
        }}
        onRenameFolder={async (id, name) => {
          await folderApi.rename(id, name);
          refresh();
        }}
        devices={devices}
        importing={importing}
        onPickImport={onPickImport}
        onOpenPalette={() => setPaletteOpen(true)}
        theme={theme}
        setTheme={setTheme}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <main className="main">
        {view === "library" ? (
          <Library
            books={filteredSorted}
            loaded={loaded}
            total={books.length}
            query={query}
            onQuery={setQuery}
            filterRef={filterInputRef}
            importing={importing}
            onPickImport={onPickImport}
            batchJob={batchJob}
            onCancelBatch={cancelBatch}
            onEnrichAllMissing={onEnrichAllMissing}
            enrichingIds={enrichingIds}
            onOpen={setSelectedId}
            onHover={onHover}
            onEnrich={onEnrich}
            onContextMenu={onContextMenu}
            onAuthorClick={(a) => setAuthorFilter(a)}
            onSeriesClick={(s) => setSeriesFilter(s)}
            authorFilter={authorFilter}
            seriesFilter={seriesFilter}
            onClearAuthor={() => setAuthorFilter(null)}
            onClearSeries={() => setSeriesFilter(null)}
            tagCounts={tagCounts}
            tagFilter={tagFilter}
            onSetTagFilter={(t) => {
              setTagFilter(t);
              setView("library");
            }}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onClearSelection={clearSelection}
            onBulkEnrich={onBulkEnrich}
            onBulkAddToCollection={onBulkAddToCollection}
            onBulkSendToDevice={onBulkSendToDevice}
            folders={folderApi.folders}
            devices={devices}
            prefs={prefs}
            updatePrefs={(p) => withViewTransition(() => updatePrefs(p))}
            onExportHighlights={onExportHighlights}
            onRevealVault={onRevealVault}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        ) : view === "collection" && activeCollectionId != null ? (
          <CollectionScreen
            collectionId={activeCollectionId}
            allBooks={books}
            allFolders={folderApi.folders}
            enrichingIds={enrichingIds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onClearSelection={clearSelection}
            onBulkEnrich={onBulkEnrich}
            onBulkSendToDevice={onBulkSendToDevice}
            onOpen={setSelectedId}
            onHover={onHover}
            onEnrich={onEnrich}
            onContextMenu={onContextMenu}
            onAuthorClick={(a) => { setAuthorFilter(a); setView("library"); }}
            onSeriesClick={(s) => { setSeriesFilter(s); setView("library"); }}
            onBack={() => { setView("library"); setActiveCollectionId(null); clearSelection(); }}
            onRename={async (id, name) => { await folderApi.rename(id, name); refresh(); }}
            onDelete={async (id) => {
              await folderApi.remove(id);
              setActiveCollectionId(null);
              setView("library");
              clearSelection();
              refresh();
            }}
            onAddBooks={async (ids) => {
              for (const bid of ids) await folderApi.addBook(activeCollectionId, bid);
              refresh();
            }}
            onRemoveFromCollection={async (bid) => {
              await folderApi.removeBook(activeCollectionId, bid);
              refresh();
            }}
            devices={devices}
            batchJob={batchJob}
            onCancelBatch={cancelBatch}
            prefs={prefs}
            updatePrefs={(p) => withViewTransition(() => updatePrefs(p))}
          />
        ) : (
          <Settings
            theme={theme}
            setTheme={setTheme}
            accent={accent}
            setAccent={setAccent}
            ui={ui}
            onExportAllAnnotations={() => onExportAnnotations()}
            onSwitchVault={async () => {
              try {
                const paths = await appPaths();
                setVaultPicker({ mode: "switch", currentPath: paths.library_root });
              } catch {
                setVaultPicker({ mode: "switch", currentPath: null });
              }
            }}
          />
        )}
      </main>

      <BookDetail
        bookId={previewId}
        initial={previewBook}
        onClose={() => setSelectedId(null)}
        onRead={(b) => setReadingBook(b)}
        onEnrich={onEnrich}
        onChange={refresh}
        onAuthorClick={(a) => {
          setAuthorFilter(a);
          setSelectedId(null);
        }}
        onSeriesClick={(s) => {
          setSeriesFilter(s);
          setSelectedId(null);
        }}
        enriching={previewId != null && enrichingIds.has(previewId)}
        actions={bookActions}
        devices={devices}
        folders={folderApi.folders}
        onAddToFolder={async (fid, bid) => {
          await folderApi.addBook(fid, bid);
          refresh();
        }}
        onRemoveFromFolder={async (fid, bid) => {
          await folderApi.removeBook(fid, bid);
          refresh();
        }}
        onCreateFolder={folderApi.create}
      />

      {readingBook && (
        <Suspense
          fallback={
            <div className="reader-fallback">
              <span>Opening reader…</span>
            </div>
          }
        >
          <Reader
            book={readingBook}
            onClose={() => {
              setReadingBook(null);
              refresh();
            }}
          />
        </Suspense>
      )}

      <CommandPalette
        open={paletteOpen}
        books={books}
        actions={paletteActions}
        onClose={() => setPaletteOpen(false)}
        onSelect={(id) => setSelectedId(id)}
      />
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      {vaultPicker && (
        <VaultPicker
          mode={vaultPicker.mode}
          currentPath={vaultPicker.currentPath}
          onClose={() => setVaultPicker(null)}
          onPicked={(path) => {
            setVaultPicker(null);
            if (!path) return;
            // Switch mode: we set the new vault but haven't relaunched
            // yet. Surface a toast so the user knows they need to.
            pushToast(
              "info",
              "Restart Atlas to open the new vault — File → Quit then reopen.",
              8000,
            );
          }}
        />
      )}
      <DropZone onDrop={runImport} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <ContextMenu pos={ctxMenu?.pos ?? null} onClose={() => setCtxMenu(null)}>
        {ctxMenu && (
          <BookActionMenu
            book={ctxMenu.book}
            enriching={enrichingIds.has(ctxMenu.book.id)}
            close={() => setCtxMenu(null)}
            devices={devices}
            handlers={{
              ...bookActions,
              hasOriginal: ctxMenu.book.has_original,
            }}
          />
        )}
      </ContextMenu>

      {editingBook && (
        <EditMetadataModal
          book={editingBook}
          manualFields={parseManualFields(editingBook.manual_fields)}
          onSaved={() => refresh()}
          close={() => setEditingBook(null)}
        />
      )}
    </div>
  );
}

/** Tolerantly parse `manual_fields` JSON from the backend. Falls back
 *  to an empty object on malformed input so the modal never breaks. */
function parseManualFields(s: string | null): Record<string, boolean> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/* ===== Sidebar ===== */
interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
  statusCounts: { all: number; unread: number; reading: number; finished: number };
  folders: import("./types").Collection[];
  activeCollectionId: number | null;
  onSelectCollection: (id: number) => void;
  onCreateFolder: (name: string) => Promise<number>;
  onDeleteFolder: (id: number) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  devices: import("./types").Device[];
  importing: boolean;
  onPickImport: (m: "files" | "folder") => void;
  onOpenPalette: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onOpenShortcuts: () => void;
}

function Sidebar({
  view,
  setView,
  statusFilter,
  setStatusFilter,
  statusCounts,
  folders,
  activeCollectionId,
  onSelectCollection,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  devices,
  importing,
  onPickImport,
  onOpenPalette,
  theme,
  setTheme,
  onOpenShortcuts,
}: SidebarProps) {
  const inLib = view === "library";
  return (
    <aside className="sidebar" data-tauri-drag-region>
      <button
        className="sidebar-search"
        onClick={onOpenPalette}
        title="Search library"
      >
        <Search size={13} strokeWidth={2} />
        <span>Search</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <HoverPill
        className="sidebar-scroll"
        selector="button"
        skip=".active"
        activeSelector="nav button.active, .folder-row.active .folder-main"
      >
        <nav>
          <button
            className={
              inLib && statusFilter === "all" ? "active" : ""
            }
            onClick={() => {
              setStatusFilter("all");
            }}
          >
            <LibraryIcon size={14} strokeWidth={2} />
            <span>All books</span>
            <span className="count">{statusCounts.all}</span>
          </button>
          <button
            className={
              inLib && statusFilter === "reading" ? "active" : ""
            }
            onClick={() => setStatusFilter("reading")}
          >
            <BookOpen size={14} strokeWidth={2} />
            <span>Reading</span>
            <span className="count">{statusCounts.reading}</span>
          </button>
          <button
            className={
              inLib && statusFilter === "unread" ? "active" : ""
            }
            onClick={() => setStatusFilter("unread")}
          >
            <Circle size={14} strokeWidth={2} />
            <span>Unread</span>
            <span className="count">{statusCounts.unread}</span>
          </button>
          <button
            className={
              inLib && statusFilter === "finished" ? "active" : ""
            }
            onClick={() => setStatusFilter("finished")}
          >
            <CheckCircle2 size={14} strokeWidth={2} />
            <span>Finished</span>
            <span className="count">{statusCounts.finished}</span>
          </button>
        </nav>

        {devices.length > 0 && (
          <>
            <div className="sidebar-section-title">Devices</div>
            <nav className="sidebar-devices">
              {devices.map((d) => (
                <div key={d.id} className="sidebar-device" title={d.root}>
                  <span className="device-dot" />
                  <span>{d.name}</span>
                </div>
              ))}
            </nav>
          </>
        )}

        <FoldersSection
          folders={folders}
          activeId={view === "collection" ? activeCollectionId : null}
          onSelect={onSelectCollection}
          onCreate={onCreateFolder}
          onDelete={onDeleteFolder}
          onRename={onRenameFolder}
        />

      </HoverPill>

      <div className="sidebar-footer">
        <Popover
          align="start"
          side="top"
          trigger={
            <button className="primary sb-import" disabled={importing}>
              <Plus size={13} strokeWidth={2.4} />
              <span>Import</span>
              <span className="sb-chevron">▾</span>
            </button>
          }
        >
          {(close) => (
            <div className="menu">
              <MenuItem
                icon={<FilePlus2 size={14} strokeWidth={2} />}
                label="Files…"
                shortcut="⌘I"
                onClick={() => {
                  close();
                  onPickImport("files");
                }}
              />
              <MenuItem
                icon={<FolderPlus size={14} strokeWidth={2} />}
                label="Folder…"
                shortcut="⌘⇧I"
                onClick={() => {
                  close();
                  onPickImport("folder");
                }}
              />
              <MenuSeparator />
              <MenuItem
                icon={<Database size={14} strokeWidth={2} />}
                label="From Calibre…"
                disabled
              />
            </div>
          )}
        </Popover>

        <div className="sidebar-row">
          <button
            className={`sb-mini ${view === "settings" ? "active" : ""}`}
            onClick={() => setView("settings")}
            title="Settings"
          >
            <SettingsIcon size={13} strokeWidth={2} />
          </button>
          <Popover
            align="start"
            side="top"
            trigger={
              <button className="sb-mini" title="Theme">
                {theme === "light" ? (
                  <Sun size={13} strokeWidth={2} />
                ) : theme === "dark" ? (
                  <Moon size={13} strokeWidth={2} />
                ) : (
                  <Monitor size={13} strokeWidth={2} />
                )}
              </button>
            }
          >
            {(close) => (
              <div className="menu">
                <MenuLabel>Theme</MenuLabel>
                <MenuItem
                  icon={<Moon size={14} strokeWidth={2} />}
                  label="Dark"
                  active={theme === "dark"}
                  onClick={() => {
                    setTheme("dark");
                    close();
                  }}
                />
                <MenuItem
                  icon={<Sun size={14} strokeWidth={2} />}
                  label="Light"
                  active={theme === "light"}
                  onClick={() => {
                    setTheme("light");
                    close();
                  }}
                />
                <MenuItem
                  icon={<Monitor size={14} strokeWidth={2} />}
                  label="System"
                  active={theme === "system"}
                  onClick={() => {
                    setTheme("system");
                    close();
                  }}
                />
              </div>
            )}
          </Popover>
          <button className="sb-mini" onClick={onOpenShortcuts} title="Shortcuts (?)">
            <Keyboard size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ===== Library ===== */
interface LibraryProps {
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
  onBulkSendToDevice: (device: import("./types").Device) => void;
  folders: import("./types").Collection[];
  devices: import("./types").Device[];
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

interface FoldersSectionProps {
  folders: import("./types").Collection[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<number>;
  onDelete: (id: number) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
}

function FoldersSection({
  folders,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: FoldersSectionProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (renamingId != null) renameRef.current?.focus();
  }, [renamingId]);

  const commitAdd = async () => {
    const v = name.trim();
    if (!v) { setAdding(false); return; }
    await onCreate(v);
    setName("");
    setAdding(false);
  };

  const cancelAdd = () => { setName(""); setAdding(false); };

  const commitRename = async () => {
    const v = renameVal.trim();
    if (v && renamingId != null) await onRename(renamingId, v);
    setRenamingId(null);
    setRenameVal("");
  };

  return (
    <>
      <div className="sidebar-section-title sidebar-section-title-row">
        <span>Collections</span>
        <button
          className="section-add"
          onClick={() => setAdding(true)}
          title="New collection"
        >
          <Plus size={11} strokeWidth={2.4} />
        </button>
      </div>
      <nav className="sidebar-folders">
        {folders.map((f) => {
          const isRenaming = renamingId === f.id;
          return (
            <div
              key={f.id}
              className={`folder-row ${activeId === f.id ? "active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setRenamingId(f.id);
                setRenameVal(f.name);
              }}
            >
              {isRenaming ? (
                <div className="folder-edit-row">
                  <input
                    ref={renameRef}
                    className="folder-edit-input"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") {
                        setRenamingId(null);
                        setRenameVal("");
                      }
                    }}
                  />
                  <button
                    className="folder-edit-confirm"
                    onClick={commitRename}
                    disabled={!renameVal.trim()}
                    title="Rename"
                  >
                    <Check size={11} strokeWidth={2.6} />
                  </button>
                  <button
                    className="folder-edit-cancel"
                    onClick={() => { setRenamingId(null); setRenameVal(""); }}
                    title="Cancel"
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ) : (
                <button className="folder-main" onClick={() => onSelect(f.id)}>
                  <Folder size={12} strokeWidth={2} />
                  <span>{f.name}</span>
                  <span className="count">{f.count}</span>
                </button>
              )}
              {!isRenaming && (
                <button
                  className="folder-delete"
                  title="Delete collection"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await ask(`Delete "${f.name}"?`, {
                      title: "Delete collection",
                      kind: "warning",
                      okLabel: "Delete",
                      cancelLabel: "Cancel",
                    });
                    if (ok) onDelete(f.id);
                  }}
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
        {adding && (
          <div className="folder-new-row">
            <FolderPlus size={12} strokeWidth={2} className="folder-new-icon" />
            <input
              ref={inputRef}
              className="folder-edit-input"
              value={name}
              placeholder="Collection name…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd();
                else if (e.key === "Escape") cancelAdd();
              }}
            />
            <button
              className="folder-edit-confirm"
              onClick={commitAdd}
              disabled={!name.trim()}
              title="Create"
            >
              <Check size={11} strokeWidth={2.6} />
            </button>
            <button
              className="folder-edit-cancel"
              onClick={cancelAdd}
              title="Cancel"
            >
              <X size={11} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </nav>
    </>
  );
}

function Library({
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
}: LibraryProps) {
  const inSelectionMode = selectedIds.size > 0;
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
          <FilterPill
            label={`by ${authorFilter}`}
            onClear={onClearAuthor}
          />
        )}
        {seriesFilter && (
          <FilterPill
            label={seriesFilter}
            onClear={onClearSeries}
          />
        )}
        {tagFilter && (
          <FilterPill
            label={tagFilter}
            onClear={() => onSetTagFilter(null)}
          />
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
            hasFilter={!!query.trim()}
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
        <div
          className={`grid ${prefs.view === "compact" ? "grid-compact" : ""}`}
          onMouseLeave={() => onHover(null)}
        >
          {books.map((b) => (
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
              compact={prefs.view === "compact"}
            />
          ))}
        </div>
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

function SortMenu({
  prefs,
  updatePrefs,
}: {
  prefs: LibraryProps["prefs"];
  updatePrefs: LibraryProps["updatePrefs"];
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

function ViewSwitcher({
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

/* ===== Book card / list ===== */
interface BookCardProps {
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

function BookCard({
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
}

function BookList({
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
}: {
  books: Book[];
  enrichingIds: Set<number>;
  selectedIds: Set<number>;
  inSelectionMode: boolean;
  onToggleSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
  onEnrich: (id: number) => void;
  onContextMenu: (b: Book, e: React.MouseEvent) => void;
  onAuthorClick: (name: string) => void;
  onSeriesClick: (name: string) => void;
}) {
  return (
    <div className="list" onMouseLeave={() => onHover(null)}>
      <div className="list-head">
        <span></span>
        <span>Title</span>
        <span>Author</span>
        <span>Series</span>
        <span>Progress</span>
      </div>
      {books.map((b) => {
        const pct = b.progress_percent ?? 0;
        const sel = selectedIds.has(b.id);
        return (
          <div
            key={b.id}
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
              disabled={enrichingIds.has(b.id)}
              title="Enrich"
            >
              <Sparkles size={12} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SelectionBar({
  count,
  folders,
  devices,
  batchRunning,
  onBulkEnrich,
  onBulkAddToCollection,
  onBulkSendToDevice,
  onClear,
  removeLabel,
  onBulkRemove,
}: {
  count: number;
  folders: import("./types").Collection[];
  devices: import("./types").Device[];
  batchRunning: boolean;
  onBulkEnrich: () => void;
  onBulkAddToCollection: (id: number) => void;
  onBulkSendToDevice: (device: import("./types").Device) => void;
  onClear: () => void;
  removeLabel?: string;
  onBulkRemove?: () => Promise<void>;
}) {
  return (
    <div className="selection-bar">
      <span className="sel-count">
        <span className="sel-count-num">{count}</span>
        {" "}{count === 1 ? "book" : "books"} selected
      </span>
      <div className="sel-sep" />
      <div className="sel-actions">
        {folders.length > 0 && (
          <Popover
            align="center"
            side="top"
            trigger={
              <button className="sel-btn">
                <Folder size={13} strokeWidth={2} />
                <span>Add to collection</span>
              </button>
            }
          >
            {(close) => (
              <div className="menu">
                <MenuLabel>Add to collection</MenuLabel>
                {folders.map((f) => (
                  <MenuItem
                    key={f.id}
                    icon={<Folder size={14} strokeWidth={2} />}
                    label={f.name}
                    onClick={() => { onBulkAddToCollection(f.id); close(); }}
                  />
                ))}
              </div>
            )}
          </Popover>
        )}
        <button
          className="sel-btn"
          onClick={onBulkEnrich}
          disabled={batchRunning}
          title={batchRunning ? "Enrichment already running" : "Enrich selected books"}
        >
          <Sparkles size={13} strokeWidth={2} />
          <span>Enrich</span>
        </button>
        <Popover
          align="center"
          side="top"
          trigger={
            <button className="sel-btn">
              <FileType2 size={13} strokeWidth={2} />
              <span>Convert</span>
            </button>
          }
        >
          {() => (
            <div className="menu">
              <MenuLabel>Convert to</MenuLabel>
              <MenuItem label="KEPUB (Kobo) — coming soon" disabled />
              <MenuItem label="AZW3 (Kindle) — coming soon" disabled />
              <MenuItem label="PDF — coming soon" disabled />
              <MenuItem label="Markdown — coming soon" disabled />
            </div>
          )}
        </Popover>
        <Popover
          align="center"
          side="top"
          trigger={
            <button className="sel-btn">
              <Send size={13} strokeWidth={2} />
              <span>Send to Kindle</span>
            </button>
          }
        >
          {(close) => (
            <div className="menu">
              <MenuLabel>Send to device</MenuLabel>
              {devices.length === 0 ? (
                <>
                  <div className="menu-empty">No device connected</div>
                  <div className="menu-hint">Plug in a Kindle or Kobo via USB.</div>
                </>
              ) : (
                devices.map((d) => (
                  <MenuItem
                    key={d.id}
                    icon={<Tablet size={14} strokeWidth={2} />}
                    label={d.name}
                    onClick={() => { onBulkSendToDevice(d); close(); }}
                  />
                ))
              )}
            </div>
          )}
        </Popover>
        {removeLabel && onBulkRemove && (
          <button className="sel-btn sel-btn-danger" onClick={onBulkRemove}>
            <Trash2 size={13} strokeWidth={2} />
            <span>{removeLabel}</span>
          </button>
        )}
      </div>
      <div className="sel-sep" />
      <button className="sel-clear" onClick={onClear} title="Clear selection">
        <X size={13} strokeWidth={2.4} />
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

function SkeletonGrid({ compact }: { compact: boolean }) {
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

function EmptyState({
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
        <p>Try a different search.</p>
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

/* ===== CollectionScreen ===== */
interface CollectionScreenProps {
  collectionId: number;
  allBooks: Book[];
  allFolders: import("./types").Collection[];
  enrichingIds: Set<number>;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onBulkEnrich: () => void;
  onBulkSendToDevice: (device: import("./types").Device) => void;
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
  devices: import("./types").Device[];
  batchJob: EnrichJob | null;
  onCancelBatch: () => void;
  prefs: ReturnType<typeof useLibraryPrefs>["prefs"];
  updatePrefs: ReturnType<typeof useLibraryPrefs>["update"];
}

function CollectionScreen({
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
}: CollectionScreenProps) {
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
        <div
          className={`grid ${prefs.view === "compact" ? "grid-compact" : ""}`}
          onMouseLeave={() => onHover(null)}
        >
          {sorted.map((b) => (
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
              compact={prefs.view === "compact"}
            />
          ))}
        </div>
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

/* ===== BookPickerModal ===== */
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

function Settings({
  theme,
  setTheme,
  accent,
  setAccent,
  ui,
  onExportAllAnnotations,
  onSwitchVault,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: AccentValue;
  setAccent: (v: AccentValue) => void;
  ui: ReturnType<typeof useUiPrefs>;
  onExportAllAnnotations: () => void;
  onSwitchVault: () => void;
}) {
  const [currentVault, setCurrentVault] = useState<string>("");
  useEffect(() => {
    appPaths()
      .then((p) => setCurrentVault(p.library_root))
      .catch(() => {});
  }, []);
  return (
    <div className="settings-page">
      <div className="settings-titlebar" data-tauri-drag-region />
      <div className="settings-wrap">
        <h2>Settings</h2>

        <section className="settings-section">
          <h3>Vault</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Current vault</div>
              <div className="settings-desc">
                Atlas stores your library here. Put this folder in iCloud,
                Dropbox, or Syncthing to follow you across devices.
              </div>
              <div className="settings-path">{currentVault || "…"}</div>
            </div>
            <button className="settings-btn" onClick={onSwitchVault}>
              Switch…
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Theme</div>
              <div className="settings-desc">
                Dark, light, or match your system preference.
              </div>
            </div>
            <div className="seg">
              {(["dark", "light", "system"] as Theme[]).map((t) => (
                <button
                  key={t}
                  className={theme === t ? "active" : ""}
                  onClick={() => setTheme(t)}
                >
                  {t === "dark" ? (
                    <Moon size={13} strokeWidth={2} />
                  ) : t === "light" ? (
                    <Sun size={13} strokeWidth={2} />
                  ) : (
                    <Monitor size={13} strokeWidth={2} />
                  )}
                  <span>{t[0]!.toUpperCase() + t.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Accent color</div>
              <div className="settings-desc">
                Used for primary buttons, status, focus rings, and active
                states throughout the app.
              </div>
            </div>
            <div className="swatch-row">
              {ACCENT_SWATCHES.map((s) => {
                const isActive = (accent ?? null) === s.rgb;
                return (
                  <button
                    key={s.id}
                    className={`swatch ${isActive ? "active" : ""}`}
                    style={s.rgb ? { background: `rgb(${s.rgb})` } : undefined}
                    onClick={() => setAccent(s.rgb)}
                    title={s.label}
                    aria-label={s.label}
                  >
                    {!s.rgb && <Check size={11} strokeWidth={2.6} />}
                    {isActive && s.rgb && <Check size={11} strokeWidth={2.6} />}
                  </button>
                );
              })}
              {(() => {
                const isCustom =
                  !!accent &&
                  !ACCENT_SWATCHES.some((s) => s.rgb === accent);
                return (
                  <Popover
                    align="end"
                    trigger={
                      <button
                        className={`swatch swatch-custom ${isCustom ? "active" : ""}`}
                        style={
                          isCustom
                            ? { background: `rgb(${accent})` }
                            : undefined
                        }
                        title="Custom color"
                        aria-label="Custom color"
                      >
                        {isCustom ? (
                          <Check size={11} strokeWidth={2.6} />
                        ) : (
                          <span className="swatch-custom-glyph" aria-hidden />
                        )}
                      </button>
                    }
                  >
                    {() => (
                      <ColorPicker
                        value={accent}
                        onChange={(rgb) => setAccent(rgb)}
                      />
                    )}
                  </Popover>
                );
              })()}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Interface</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Button style</div>
              <div className="settings-desc">
                Soft 3D uses gradients and depth. Flat is a single fill, no
                shadows — quieter and easier on the eyes.
              </div>
            </div>
            <div className="seg">
              {(
                [
                  { id: "soft", label: "Soft 3D" },
                  { id: "flat", label: "Flat" },
                ] as { id: ChromeStyle; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  className={ui.prefs.chrome === opt.id ? "active" : ""}
                  onClick={() => ui.setChrome(opt.id)}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Visual flourishes</div>
              <div className="settings-desc">
                Idle book drift, paper grain, hero color glow, and hover lifts.
                Turn off for a calmer, more utilitarian interface.
              </div>
            </div>
            <div className="seg">
              <button
                className={ui.prefs.flourishes ? "active" : ""}
                onClick={() => ui.setFlourishes(true)}
              >
                <span>On</span>
              </button>
              <button
                className={!ui.prefs.flourishes ? "active" : ""}
                onClick={() => ui.setFlourishes(false)}
              >
                <span>Off</span>
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Annotations</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Export all annotations</div>
              <div className="settings-desc">
                Save every highlight + note across your library as one
                Markdown file (Readwise format).
              </div>
            </div>
            <button className="seg" onClick={onExportAllAnnotations}>
              Export…
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>About</h3>
          <p className="muted">Atlas v0.1 · local-first EPUB library</p>
        </section>
      </div>
    </div>
  );
}
