import { useEffect } from "react";
import { getBook } from "../api";
import type { Book } from "../types";
import type { Theme } from "../hooks/useTheme";
import type { ViewMode } from "../hooks/useLibraryPrefs";
import type { PushToast } from "./useToasts";
import type { StatusFilter } from "./useFilters";

export type View = "library" | "collection" | "settings";

interface Deps {
  view: View;
  readingBook: Book | null;
  refresh: () => Promise<void>;
  pushToast: PushToast;
  onPickImport: (m: "files" | "folder") => void;
  onExportHighlights: () => void;
  onRevealVault: () => void;
  focusFilter: () => void;
  setLayout: (v: ViewMode) => void;
  setTheme: (t: Theme) => void;
  setView: (v: View) => void;
  setStatusFilter: (s: StatusFilter) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSelectedId: (id: number | null) => void;
  setReadingBook: (b: Book | null) => void;
}

/**
 * Everything that arrives from outside the React tree: native menubar
 * events, atlas:// deep links, vault-sync notifications, and the dynamic
 * window title. Kept together so MainApp reads as pure wiring.
 */
export function useAppEvents(deps: Deps) {
  const {
    view,
    readingBook,
    refresh,
    pushToast,
    onPickImport,
    onExportHighlights,
    onRevealVault,
    focusFilter,
    setLayout,
    setTheme,
    setView,
    setStatusFilter,
    setPaletteOpen,
    setShortcutsOpen,
    setSelectedId,
    setReadingBook,
  } = deps;

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
              focusFilter();
              break;

            // View — layout
            case "menu:view-grid":
              setLayout("grid");
              break;
            case "menu:view-compact":
              setLayout("compact");
              break;
            case "menu:view-list":
              setLayout("list");
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
  }, [
    onPickImport,
    onExportHighlights,
    onRevealVault,
    focusFilter,
    setLayout,
    setTheme,
    setView,
    setStatusFilter,
    setPaletteOpen,
    setShortcutsOpen,
  ]);

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
  }, [setSelectedId, setReadingBook]);
}
