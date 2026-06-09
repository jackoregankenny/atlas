import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FilePlus2,
  FolderPlus,
  Keyboard,
  LayoutGrid,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from "lucide-react";
import { getBook, appPaths, sendToDevice } from "./api";
import type { Book, Device } from "./types";
import { VaultPicker } from "./components/VaultPicker";
import { BookDetail } from "./components/BookDetail";
import { DropZone } from "./components/DropZone";
import { ToastStack } from "./components/Toasts";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu } from "./components/ContextMenu";
import { BookActionMenu } from "./components/BookActionMenu";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { EditMetadataModal } from "./components/EditMetadataModal";
import { Sidebar } from "./components/Sidebar";
import { LibraryView } from "./components/LibraryView";
import { CollectionView } from "./components/CollectionView";
import { SettingsView } from "./components/SettingsView";
import { useTheme } from "./hooks/useTheme";
import { useLibraryPrefs } from "./hooks/useLibraryPrefs";
import { useUiPrefs } from "./hooks/useUiPrefs";
import { useDevices } from "./hooks/useDevices";
import { useFolders } from "./hooks/useFolders";
import { useToasts } from "./state/useToasts";
import { useSelection } from "./state/useSelection";
import { useFilters } from "./state/useFilters";
import { useLibraryState } from "./state/useLibraryState";
import { useEnrichment } from "./state/useEnrichment";
import { useDetailPreview } from "./state/useDetailPreview";
import { useBookActions } from "./state/useBookActions";
import { useAppEvents, type View } from "./state/useAppEvents";
import { useKeyboardShortcuts } from "./state/useKeyboardShortcuts";
import { withViewTransition } from "./util/viewTransition";
import "./App.css";

const Reader = lazy(() =>
  import("./components/Reader").then((m) => ({ default: m.Reader }))
);

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

/**
 * Shell wiring only. Each domain lives in a hook under src/state/ —
 * library data, filters, enrichment, selection, detail preview, per-book
 * actions, external events, keyboard shortcuts — and each screen is a
 * component under src/components/.
 */
function MainApp() {
  const [view, setView] = useState<View>("library");
  const [readingBook, setReadingBook] = useState<Book | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);
  // Vault picker state — opens automatically on first launch, or
  // from Settings → Switch Vault. `mode` is null when closed.
  const [vaultPicker, setVaultPicker] = useState<{
    mode: "welcome" | "switch";
    currentPath: string | null;
  } | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { theme, setTheme, cycle: cycleTheme, accent, setAccent } = useTheme();
  const { prefs, update: updatePrefs, cycleView } = useLibraryPrefs();
  const ui = useUiPrefs();
  const { devices } = useDevices();
  const folderApi = useFolders();

  const library = useLibraryState(pushToast);
  const { books, setBooks, loaded, importing, refresh, runImport, onPickImport } = library;

  const filters = useFilters(books, prefs.sortField, prefs.sortDir);
  const selection = useSelection();
  const { selectedIds, toggleSelect, clearSelection } = selection;
  const enrichment = useEnrichment(books, refresh, pushToast);
  const { enrichingIds, batchJob, onEnrich, onEnrichAllMissing, runBatch, cancelBatch } =
    enrichment;
  const preview = useDetailPreview(books);
  const { setSelectedId, previewId, previewBook, onHover, clearCache } = preview;

  // The list payload changed → cached full records may be stale.
  const refreshAndInvalidate = useCallback(async () => {
    await refresh();
    clearCache();
  }, [refresh, clearCache]);

  const actions = useBookActions({
    refresh: refreshAndInvalidate,
    setBooks,
    pushToast,
    onEnrich,
    setSelectedId,
    setReadingBook,
  });
  const { bookActions, ctxMenu, setCtxMenu, onContextMenu, editingBook, setEditingBook } =
    actions;

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

  const focusFilter = useCallback(() => {
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, []);

  useAppEvents({
    view,
    readingBook,
    refresh,
    pushToast,
    onPickImport,
    onExportHighlights,
    onRevealVault,
    focusFilter,
    setLayout: (v) => updatePrefs({ view: v }),
    setTheme,
    setView,
    setStatusFilter: filters.setStatusFilter,
    setPaletteOpen,
    setShortcutsOpen,
    setSelectedId,
    setReadingBook,
  });

  useKeyboardShortcuts({
    togglePalette: () => setPaletteOpen((v) => !v),
    focusFilter,
    importFiles: () => onPickImport("files"),
    importFolder: () => onPickImport("folder"),
    toggleShortcuts: () => setShortcutsOpen((v) => !v),
    cycleView,
    cycleTheme,
    goLibrary: () => setView("library"),
    goSettings: () => setView("settings"),
  });

  // ----- bulk operations (need selection + folders + devices together) -----

  const onBulkEnrich = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    clearSelection();
    runBatch(ids);
  }, [selectedIds, clearSelection, runBatch]);

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
    async (device: Device) => {
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
        statusFilter={filters.statusFilter}
        setStatusFilter={(s) => {
          filters.setStatusFilter(s);
          setView("library");
        }}
        statusCounts={filters.statusCounts}
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
          <LibraryView
            books={filters.filteredSorted}
            loaded={loaded}
            total={books.length}
            query={filters.query}
            onQuery={filters.setQuery}
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
            onAuthorClick={filters.setAuthorFilter}
            onSeriesClick={filters.setSeriesFilter}
            authorFilter={filters.authorFilter}
            seriesFilter={filters.seriesFilter}
            onClearAuthor={() => filters.setAuthorFilter(null)}
            onClearSeries={() => filters.setSeriesFilter(null)}
            tagCounts={filters.tagCounts}
            tagFilter={filters.tagFilter}
            onSetTagFilter={(t) => {
              filters.setTagFilter(t);
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
          <CollectionView
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
            onAuthorClick={(a) => { filters.setAuthorFilter(a); setView("library"); }}
            onSeriesClick={(s) => { filters.setSeriesFilter(s); setView("library"); }}
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
          <SettingsView
            theme={theme}
            setTheme={setTheme}
            accent={accent}
            setAccent={setAccent}
            ui={ui}
            onExportAllAnnotations={() => actions.onExportAnnotations()}
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
        onChange={refreshAndInvalidate}
        onAuthorClick={(a) => {
          filters.setAuthorFilter(a);
          setSelectedId(null);
        }}
        onSeriesClick={(s) => {
          filters.setSeriesFilter(s);
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
          onSaved={() => refreshAndInvalidate()}
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
