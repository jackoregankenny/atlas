import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ePub, { Book as EpubBook, Rendition, Location } from "epubjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Minus,
  Plus,
  Sun,
  Moon,
  BookOpen,
  X,
  Columns,
  AlignJustify,
  List,
  Type,
  Highlighter,
  Trash2,
  PictureInPicture2,
} from "lucide-react";
import {
  updateProgress,
  listHighlights,
  addHighlight as apiAddHighlight,
  deleteHighlight as apiDeleteHighlight,
  type Highlight,
} from "../api";
import type { Book } from "../types";
import { Popover } from "./Popover";

// Render colours for the four highlight palette slots. Stored as
// plain colour names in the manifest so a future Atlas (or a
// hand-edit) can theme them however it likes.
const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "rgba(255, 224, 102, 0.45)",
  mint: "rgba(120, 220, 170, 0.40)",
  blue: "rgba(140, 180, 255, 0.40)",
  pink: "rgba(255, 170, 200, 0.45)",
};
const DEFAULT_HIGHLIGHT_COLOR = "yellow";

// First-open reading tips. Flag is shared across every book and the pop-out
// window, so the coachmark is shown exactly once per machine.
const READER_HINTS_KEY = "atlas-reader-hints-seen";

type Theme = "dark" | "sepia" | "light";
type Flow = "paginated" | "scrolled-doc";
type FontChoice = "default" | "serif" | "sans" | "mono";

const THEME_COLORS: Record<Theme, { bg: string; fg: string; link: string }> = {
  dark: { bg: "#0f1115", fg: "#d8dbe3", link: "#9aa6ff" },
  sepia: { bg: "#f4ecd8", fg: "#3b2f1f", link: "#7a3b1c" },
  light: { bg: "#fbfbfb", fg: "#1a1c22", link: "#4858d8" },
};

const FONT_STACK: Record<FontChoice, string | null> = {
  default: null,
  serif: 'Literata, Georgia, "Times New Roman", serif',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
};

interface Props {
  book: Book;
  onClose: () => void;
  /** When true, the reader is the sole content of a popped-out window:
   *  hide the close + pop-out buttons (closing the window is enough). */
  standalone?: boolean;
}

export function Reader({ book, onClose, standalone = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("atlas-theme") as Theme) || "dark"
  );
  const [fontSize, setFontSize] = useState<number>(
    () => Number(localStorage.getItem("atlas-font-size")) || 110
  );
  const [lineHeight, setLineHeight] = useState<number>(
    () => Number(localStorage.getItem("atlas-line-height")) || 160
  );
  const [fontChoice, setFontChoice] = useState<FontChoice>(
    () => (localStorage.getItem("atlas-font-choice") as FontChoice) || "serif"
  );
  const [forceColors, setForceColors] = useState<boolean>(
    () => localStorage.getItem("atlas-force-colors") === "1"
  );
  const [flow, setFlow] = useState<Flow>(
    () => (localStorage.getItem("atlas-flow") as Flow) || "paginated"
  );
  const [pct, setPct] = useState<number>(book.progress_percent ?? 0);
  const [chapter, setChapter] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  // True once epub.js locations exist (generated or loaded from cache) —
  // unlocks accurate percentages and click-to-seek on the progress bar.
  const [locReady, setLocReady] = useState(false);

  // Highlights are kept as the source-of-truth list; the rendition's
  // annotation overlay is kept in sync from this state so we never
  // diverge. Loaded once on book mount and then mutated optimistically.
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  // First-open coachmark — surfaced once the first book actually renders.
  const [showHints, setShowHints] = useState(false);
  // Pending selection awaiting "Highlight" confirmation.
  const [pending, setPending] = useState<{
    cfiRange: string;
    text: string;
  } | null>(null);
  // Right-click context menu over the current selection. Replaces the
  // floating bar when present — same data, richer actions.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    cfiRange: string;
    text: string;
  } | null>(null);
  // Stores the unregister fn for each annotation so we can swap colors
  // or delete without rebuilding everything.
  const annotationCleanup = useRef<Map<string, () => void>>(new Map());

  // The native View → Show Highlights menu item dispatches this on
  // window. Toggle is fine even when Reader isn't mounted — App's
  // listener simply has nothing visible to affect.
  useEffect(() => {
    const onToggle = () => setPanelOpen((v) => !v);
    window.addEventListener("atlas:toggle-highlights", onToggle);
    return () => window.removeEventListener("atlas:toggle-highlights", onToggle);
  }, []);

  const fileUrl = useMemo(
    () => (book.file_path ? convertFileSrc(book.file_path) : null),
    [book.file_path]
  );

  useEffect(() => {
    if (!fileUrl || !containerRef.current) return;
    setReady(false);
    setLoadError(null);
    const epubBook = ePub(fileUrl);
    bookRef.current = epubBook;
    const rendition = epubBook.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow,
      spread: "auto",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    applyTheme(rendition, {
      theme,
      fontSize,
      lineHeight,
      fontChoice,
      forceColors,
    });

    const start = book.progress_cfi ?? undefined;
    rendition
      .display(start)
      .then(() => setReady(true))
      .catch((e: unknown) => {
        // A bad saved CFI shouldn't brick the book — retry from the top.
        if (start) {
          rendition
            .display()
            .then(() => setReady(true))
            .catch((e2: unknown) => setLoadError(describeEpubError(e2)));
        } else {
          setLoadError(describeEpubError(e));
        }
      });
    // Corrupt archives often fail before display's promise settles.
    epubBook.opened.catch((e: unknown) => setLoadError(describeEpubError(e)));

    // Locations give us accurate progress % and a seekable progress bar.
    // Generation walks the whole spine (slow on big books), so cache the
    // result per book and load it instantly on the next open.
    const locKey = `atlas-locations-${book.id}`;
    const cachedLocations = localStorage.getItem(locKey);
    if (cachedLocations) {
      try {
        epubBook.locations.load(cachedLocations);
        setLocReady(true);
      } catch {
        localStorage.removeItem(locKey);
      }
    }
    if (!cachedLocations) {
      epubBook.ready
        .then(() => epubBook.locations.generate(1024))
        .then(() => {
          try {
            localStorage.setItem(locKey, epubBook.locations.save());
          } catch {
            /* quota — locations still work for this session */
          }
          setLocReady(true);
        })
        .catch(() => {});
    }

    rendition.on("relocated", (loc: Location) => {
      const percent = loc.start?.percentage ? loc.start.percentage * 100 : 0;
      setPct(percent);
      const cfi = loc.start?.cfi;
      if (cfi) {
        updateProgress(book.id, cfi, percent).catch(() => {});
      }
      // Any UI anchored to the previous page makes no sense after a turn.
      setCtxMenu(null);
      setPending(null);
    });

    epubBook.loaded.navigation
      .then((nav) => {
        setToc(flattenToc(nav.toc));
        rendition.on("relocated", (loc: Location) => {
          const href = loc.start?.href;
          if (href) {
            const item = nav.toc.find(
              (t) => t.href.startsWith(href) || href.startsWith(t.href)
            );
            setChapter(item?.label?.trim() ?? "");
          }
        });
      })
      .catch(() => {});

    // Text-selection capture. epub.js fires this whenever a non-empty
    // selection settles in the rendered iframe — we stash it as
    // `pending` and a small floating bar offers to save the highlight.
    rendition.on("selected", (cfiRange: string, contents: unknown) => {
      let text = "";
      try {
        const win = (contents as { window: Window }).window;
        const sel = win.getSelection();
        text = sel ? sel.toString().trim() : "";
      } catch {
        /* ignore — best effort */
      }
      if (!text || !cfiRange) return;
      setPending({ cfiRange, text });
    });

    // Native-feeling right-click menu over a live selection AND
    // two-finger swipe page turn. Each rendered section gets its own
    // iframe Document, so listeners attach on `rendered`. We translate
    // iframe-local coords to viewport coords so the floating menu
    // lands under the cursor.
    type Contents = {
      window: Window & { frameElement: HTMLIFrameElement | null };
      document: Document;
      cfiFromRange?: (r: Range) => string;
    };

    // Per-iframe wheel accumulator. Two-finger swipe on a trackpad
    // (mac, Windows precision, libinput) shows up as a stream of
    // wheel events with horizontal-dominant deltas. We integrate
    // until a threshold and then turn the page once. Stops short of
    // hijacking vertical scrolling in scrolled-doc flow.
    let swipeAccum = 0;
    let swipeTimer: ReturnType<typeof setTimeout> | null = null;
    const SWIPE_THRESHOLD = 90;
    const onWheel = (e: WheelEvent) => {
      if (renditionRef.current !== rendition) return;
      // Use the closure's `flow` snapshot — this effect re-runs on
      // flow change, so we'll re-attach.
      if (flow !== "paginated") return;
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaX) < 1) return;
      swipeAccum += e.deltaX;
      if (swipeTimer) clearTimeout(swipeTimer);
      swipeTimer = setTimeout(() => {
        swipeAccum = 0;
      }, 250);
      if (swipeAccum > SWIPE_THRESHOLD) {
        rendition.next();
        swipeAccum = 0;
      } else if (swipeAccum < -SWIPE_THRESHOLD) {
        rendition.prev();
        swipeAccum = 0;
      }
    };

    // Wheel events on the outer pane (gutter, edges) — the iframes
    // each get their own listener via `rendered` below.
    const outer = containerRef.current;
    outer?.addEventListener("wheel", onWheel as EventListener, { passive: true });

    rendition.on("rendered", (_section: unknown, contents: Contents) => {
      const doc = contents.document;
      contents.window.addEventListener("wheel", onWheel as EventListener, {
        passive: true,
      });
      const onContext = (e: MouseEvent) => {
        const sel = contents.window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (!text || !sel || sel.rangeCount === 0) {
          // Suppress the webview's default page-context menu inside
          // the reader regardless — feels like a real reader.
          e.preventDefault();
          return;
        }
        e.preventDefault();
        let cfiRange = "";
        try {
          cfiRange = contents.cfiFromRange?.(sel.getRangeAt(0)) ?? "";
        } catch {
          /* ignore — selection may have collapsed */
        }
        if (!cfiRange) return;
        const frame = contents.window.frameElement;
        const rect = frame?.getBoundingClientRect();
        const x = (rect?.left ?? 0) + e.clientX;
        const y = (rect?.top ?? 0) + e.clientY;
        setPending(null);
        setCtxMenu({ x, y, cfiRange, text });
      };
      doc.addEventListener("contextmenu", onContext);
    });

    return () => {
      outer?.removeEventListener("wheel", onWheel as EventListener);
      if (swipeTimer) clearTimeout(swipeTimer);
      try {
        rendition.destroy();
      } catch {}
      try {
        epubBook.destroy();
      } catch {}
      bookRef.current = null;
      renditionRef.current = null;
      // The cleanups captured the destroyed rendition; dropping them lets
      // the highlight-sync effect re-register everything on the next one.
      annotationCleanup.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, book.id, flow]);

  // Pull existing highlights for this book once per mount. Manifest
  // reconcile may have just folded in remote changes on app launch.
  useEffect(() => {
    let cancelled = false;
    listHighlights(book.id)
      .then((hs) => {
        if (!cancelled) setHighlights(hs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // Sync the rendition's annotation overlay with the highlights state by
  // diffing against what's already registered — adding one highlight to a
  // heavily-annotated book touches one annotation, not all of them. The
  // cleanup map is emptied when the rendition is destroyed, which makes a
  // fresh rendition re-register everything.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const registered = annotationCleanup.current;
    const wanted = new Set(highlights.map((h) => h.uuid));

    for (const [uuid, cleanup] of [...registered]) {
      if (!wanted.has(uuid)) {
        try {
          cleanup();
        } catch {
          /* ignore */
        }
        registered.delete(uuid);
      }
    }

    for (const h of highlights) {
      if (registered.has(h.uuid)) continue;
      const color = HIGHLIGHT_COLORS[h.color] ?? HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR]!;
      try {
        rendition.annotations.add(
          "highlight",
          h.cfi_range,
          { uuid: h.uuid },
          undefined,
          `atlas-hl atlas-hl-${h.color}`,
          { fill: color, "fill-opacity": "1", "mix-blend-mode": "multiply" },
        );
        registered.set(h.uuid, () => {
          try {
            rendition.annotations.remove(h.cfi_range, "highlight");
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* epub.js sometimes throws on cfi that no longer resolves */
      }
    }
  }, [highlights, ready]);

  const highlightSelection = useCallback(
    async (cfiRange: string, text: string, color: string) => {
      try {
        // Drop the visible selection immediately for a calm feel.
        const iframe = containerRef.current?.querySelector("iframe");
        iframe?.contentWindow?.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
      try {
        const created = await apiAddHighlight(book.id, cfiRange, text, color);
        setHighlights((prev) => [...prev, created]);
      } catch (e) {
        console.error("addHighlight failed", e);
      }
    },
    [book.id],
  );

  const onConfirmHighlight = useCallback(
    async (color: string) => {
      if (!pending) return;
      const { cfiRange, text } = pending;
      setPending(null);
      await highlightSelection(cfiRange, text, color);
    },
    [pending, highlightSelection],
  );

  const onDeleteHighlight = useCallback(async (uuid: string) => {
    // Optimistic: drop locally, rollback on failure. The annotations
    // overlay is rebuilt via the sync effect.
    let snapshot: Highlight[] = [];
    setHighlights((prev) => {
      snapshot = prev;
      return prev.filter((h) => h.uuid !== uuid);
    });
    try {
      await apiDeleteHighlight(uuid);
    } catch (e) {
      console.error("deleteHighlight failed", e);
      setHighlights(snapshot);
    }
  }, []);

  // Close the right-click menu when the user pages or hits Escape.
  // The rendition closes on relocated via its own listener; this just
  // covers keyboard dismissal.
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu]);

  const jumpToHighlight = useCallback((cfiRange: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      rendition.display(cfiRange);
    } catch {
      /* ignore */
    }
    setPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!renditionRef.current) return;
    applyTheme(renditionRef.current, {
      theme,
      fontSize,
      lineHeight,
      fontChoice,
      forceColors,
    });
    localStorage.setItem("atlas-theme", theme);
    localStorage.setItem("atlas-font-size", String(fontSize));
    localStorage.setItem("atlas-line-height", String(lineHeight));
    localStorage.setItem("atlas-font-choice", fontChoice);
    localStorage.setItem("atlas-force-colors", forceColors ? "1" : "0");
  }, [theme, fontSize, lineHeight, fontChoice, forceColors]);

  const next = useCallback(() => renditionRef.current?.next(), []);
  const prev = useCallback(() => renditionRef.current?.prev(), []);

  const jumpToToc = useCallback((href: string) => {
    try {
      renditionRef.current?.display(href);
    } catch {
      /* ignore */
    }
    setTocOpen(false);
  }, []);

  /** Click-to-seek on the footer progress bar. Needs locations. */
  const seekTo = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!locReady) return;
      const epubBook = bookRef.current;
      const rendition = renditionRef.current;
      if (!epubBook || !rendition) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      try {
        const cfi = epubBook.locations.cfiFromPercentage(frac);
        if (cfi) rendition.display(cfi);
      } catch {
        /* ignore */
      }
    },
    [locReady]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Escape") onClose();
      else if (
        e.key === "ArrowRight" ||
        e.key === "j" ||
        e.key === "PageDown" ||
        e.key === " "
      ) {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  const toggleFlow = () => {
    const nextFlow: Flow = flow === "paginated" ? "scrolled-doc" : "paginated";
    setFlow(nextFlow);
    localStorage.setItem("atlas-flow", nextFlow);
  };

  const popOut = useCallback(async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `reader-${book.id}-${Date.now()}`;
      const win = new WebviewWindow(label, {
        url: `index.html?reader=${book.id}`,
        title: `Atlas — ${book.title}`,
        width: 900,
        height: 1100,
        minWidth: 500,
        minHeight: 400,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        backgroundColor: "#0c0e13",
      });
      win.once("tauri://error", (e) => {
        console.error("pop-out window failed", e);
      });
      // Hand off: close the in-app reader once the new window exists.
      win.once("tauri://created", () => onClose());
    } catch (e) {
      console.error("popOut failed", e);
    }
  }, [book.id, book.title, onClose]);

  // Surface the first-run reading tips once the book is on screen. The flag
  // guard means it never re-appears after the user has dismissed it once.
  useEffect(() => {
    if (ready && !loadError && !localStorage.getItem(READER_HINTS_KEY)) {
      setShowHints(true);
    }
  }, [ready, loadError]);

  const dismissHints = useCallback(() => {
    setShowHints(false);
    try {
      localStorage.setItem(READER_HINTS_KEY, "1");
    } catch {
      /* private mode / quota — tips just won't be remembered as seen */
    }
  }, []);

  return (
    <div className={`reader reader-${theme} reader-flow-${flow}`}>
      <header className="reader-bar">
        {/* Left: traffic-light spacer doubles as a drag handle. */}
        <div className="reader-bar-left" data-tauri-drag-region />
        <div className="reader-title" data-tauri-drag-region>
          <span className="reader-book">{book.title}</span>
          {chapter && <span className="reader-chapter"> · {chapter}</span>}
        </div>
        <div className="reader-controls">
          <button
            className="icon-btn"
            onClick={() => setFontSize((s) => Math.max(80, s - 10))}
            title="Smaller text"
          >
            <Minus size={14} strokeWidth={2.2} />
          </button>
          <span className="reader-font-readout">{fontSize}%</span>
          <button
            className="icon-btn"
            onClick={() => setFontSize((s) => Math.min(220, s + 10))}
            title="Larger text"
          >
            <Plus size={14} strokeWidth={2.2} />
          </button>
          <button
            className={`icon-btn ${tocOpen ? "active" : ""}`}
            onClick={() => setTocOpen((v) => !v)}
            disabled={toc.length === 0}
            title="Table of contents"
          >
            <List size={14} strokeWidth={2} />
          </button>
          <Popover
            align="end"
            trigger={
              <button className="icon-btn" title="Typography & layout">
                <Type size={13} strokeWidth={2.2} />
              </button>
            }
          >
            {() => (
              <ReaderTypographyMenu
                lineHeight={lineHeight}
                setLineHeight={setLineHeight}
                fontChoice={fontChoice}
                setFontChoice={setFontChoice}
                forceColors={forceColors}
                setForceColors={setForceColors}
                flow={flow}
                toggleFlow={toggleFlow}
              />
            )}
          </Popover>
          <button
            className={`icon-btn ${panelOpen ? "active" : ""}`}
            onClick={() => setPanelOpen((v) => !v)}
            title={`Highlights (${highlights.length})`}
          >
            <Highlighter size={14} strokeWidth={2} />
          </button>
          <div className="reader-theme-group">
            <button
              className={`icon-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
              title="Light"
            >
              <Sun size={14} strokeWidth={2.2} />
            </button>
            <button
              className={`icon-btn ${theme === "sepia" ? "active" : ""}`}
              onClick={() => setTheme("sepia")}
              title="Sepia"
            >
              <BookOpen size={14} strokeWidth={2} />
            </button>
            <button
              className={`icon-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
              title="Dark"
            >
              <Moon size={14} strokeWidth={2.2} />
            </button>
          </div>
          {!standalone && (
            <>
              <div className="reader-bar-divider" />
              <button
                className="icon-btn"
                onClick={popOut}
                title="Open in new window"
              >
                <PictureInPicture2 size={14} strokeWidth={2} />
              </button>
              <button
                className="reader-done"
                onClick={onClose}
                title="Close reader (Esc)"
              >
                <X size={13} strokeWidth={2.4} />
                <span>Done</span>
              </button>
            </>
          )}
        </div>
      </header>
      <div className="reader-stage">
        {!ready && !loadError && <div className="reader-loading">Opening…</div>}
        {loadError && (
          <div className="reader-error" role="alert">
            <h3>Couldn't open this book</h3>
            <p className="reader-error-detail">{loadError}</p>
            <p className="reader-error-hint">
              The EPUB may be corrupt or DRM-protected. Try re-importing it,
              or open the file in another reader to check.
            </p>
            <button className="primary" onClick={onClose}>
              Back to library
            </button>
          </div>
        )}
        {flow === "paginated" && (
          <button
            className="page-edge page-edge-left"
            onClick={prev}
            aria-label="Previous"
          />
        )}
        <div ref={containerRef} className="reader-pane" />
        {flow === "paginated" && (
          <button
            className="page-edge page-edge-right"
            onClick={next}
            aria-label="Next"
          />
        )}
      </div>
      <footer className="reader-foot">
        <div
          className={`progress-bar slim ${locReady ? "seekable" : ""}`}
          onClick={seekTo}
          role={locReady ? "slider" : undefined}
          aria-label={locReady ? "Reading position — click to jump" : undefined}
          aria-valuenow={locReady ? Math.round(pct) : undefined}
          title={locReady ? "Click to jump" : undefined}
        >
          <div
            className="progress-fill"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="reader-pct">{pct ? `${Math.round(pct)}%` : ""}</div>
      </footer>

      {pending && (
        <HighlightSelectionBar
          onPick={onConfirmHighlight}
          onCancel={() => setPending(null)}
        />
      )}

      {ctxMenu && (
        <ReaderContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          text={ctxMenu.text}
          onPick={(color) => {
            const { cfiRange, text } = ctxMenu;
            setCtxMenu(null);
            void highlightSelection(cfiRange, text, color);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {panelOpen && (
        <HighlightsPanel
          highlights={highlights}
          onJump={jumpToHighlight}
          onDelete={onDeleteHighlight}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {tocOpen && (
        <TocPanel
          toc={toc}
          currentChapter={chapter}
          onJump={jumpToToc}
          onClose={() => setTocOpen(false)}
        />
      )}

      {showHints && <ReaderHints onClose={dismissHints} />}
    </div>
  );
}

/** One-time first-open coachmark. Teaches the three things a new reader
 *  can't discover by looking: how to turn pages, that selecting text
 *  highlights, and that the top bar holds typography/theme/contents. */
function ReaderHints({ onClose }: { onClose: () => void }) {
  // Capture Escape ahead of the reader's own window handler so the first
  // Esc dismisses the tips rather than closing the whole reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="reader-hints-scrim" onClick={onClose}>
      <div
        className="reader-hints"
        role="dialog"
        aria-label="Reading tips"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="reader-hints-title">A few ways to read</h3>
        <ul className="reader-hints-list">
          <li>
            <span className="reader-hints-keys">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">→</kbd>
              <kbd className="kbd">Space</kbd>
            </span>
            <span>Turn pages — or click the left and right edges.</span>
          </li>
          <li>
            <span className="reader-hints-icon">
              <Highlighter size={15} strokeWidth={2} />
            </span>
            <span>Select any text to highlight it; right-click for copy &amp; look-up.</span>
          </li>
          <li>
            <span className="reader-hints-icon">
              <Type size={15} strokeWidth={2} />
            </span>
            <span>The top bar sets text size, typeface, theme, and contents.</span>
          </li>
        </ul>
        <div className="reader-hints-foot">
          <button className="primary reader-hints-dismiss" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

/** epub.js NavItems nest via `subitems`; flatten with a depth so the panel
 *  can indent without recursion in JSX. */
function flattenToc(
  items: { label?: string; href: string; subitems?: unknown }[],
  depth = 0
): TocEntry[] {
  const out: TocEntry[] = [];
  for (const item of items) {
    out.push({ label: (item.label ?? "").trim() || "Untitled", href: item.href, depth });
    const subs = item.subitems;
    if (Array.isArray(subs) && subs.length) {
      out.push(...flattenToc(subs, depth + 1));
    }
  }
  return out;
}

function describeEpubError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "The file could not be parsed as an EPUB.";
}

function TocPanel({
  toc,
  currentChapter,
  onJump,
  onClose,
}: {
  toc: TocEntry[];
  currentChapter: string;
  onJump: (href: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="hl-panel toc-panel" aria-label="Table of contents">
      <header className="hl-panel-head">
        <span className="hl-panel-title">Contents</span>
        <button className="icon-btn" onClick={onClose} title="Close panel">
          <X size={13} strokeWidth={2.4} />
        </button>
      </header>
      {toc.length === 0 ? (
        <div className="hl-panel-empty">This book has no table of contents.</div>
      ) : (
        <ul className="hl-list toc-list">
          {toc.map((t, i) => (
            <li key={`${t.href}-${i}`}>
              <button
                className={`toc-item ${t.label === currentChapter ? "active" : ""}`}
                style={{ paddingLeft: `${14 + t.depth * 14}px` }}
                onClick={() => onJump(t.href)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function ReaderContextMenu({
  x,
  y,
  text,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  onPick: (color: string) => void;
  onClose: () => void;
}) {
  // macOS gets a "Look up" affordance via the system `dict://` scheme.
  // On Windows/Linux we skip — there's no universal local dictionary.
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  const truncated = text.length > 32 ? text.slice(0, 32) + "…" : text;

  const openExternal = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      /* fall back to no-op; clipboard works regardless */
    }
  };

  // Reposition so the menu always lands fully on-screen.
  const w = 220;
  const h = isMac ? 260 : 232;
  const left = Math.min(x, window.innerWidth - w - 8);
  const top = Math.min(y, window.innerHeight - h - 8);

  return (
    <>
      {/* Click-catcher: any click outside dismisses, same as a real
          native context menu. Right-click also dismisses (Tauri's
          default page menu doesn't intervene because the iframe
          handler preventDefault'd). */}
      <div className="ctx-catcher" onClick={onClose} onContextMenu={onClose} />
      <div
        className="reader-ctx"
        style={{ left, top }}
        role="menu"
        aria-label="Selection actions"
      >
        <div className="reader-ctx-label">Highlight</div>
        <div className="reader-ctx-swatches">
          {Object.keys(HIGHLIGHT_COLORS).map((c) => (
            <button
              key={c}
              className="hl-swatch"
              style={{ background: HIGHLIGHT_COLORS[c]! }}
              onClick={() => onPick(c)}
              title={c}
              aria-label={`Highlight ${c}`}
            />
          ))}
        </div>
        <div className="menu-sep" />
        <button
          className="reader-ctx-item"
          onClick={() => {
            navigator.clipboard.writeText(text).catch(() => {});
            onClose();
          }}
        >
          <span>Copy</span>
          <span className="reader-ctx-kbd">⌘C</span>
        </button>
        {isMac && (
          <button
            className="reader-ctx-item"
            onClick={() => {
              openExternal(`dict://${encodeURIComponent(text)}`);
              onClose();
            }}
          >
            <span>Look Up “{truncated}”</span>
          </button>
        )}
        <button
          className="reader-ctx-item"
          onClick={() => {
            openExternal(
              `https://www.google.com/search?q=${encodeURIComponent(text)}`,
            );
            onClose();
          }}
        >
          <span>Search Web for “{truncated}”</span>
        </button>
      </div>
    </>
  );
}

function HighlightSelectionBar({
  onPick,
  onCancel,
}: {
  onPick: (color: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="hl-bar" role="toolbar" aria-label="Save highlight">
      <span className="hl-bar-label">Highlight</span>
      {Object.keys(HIGHLIGHT_COLORS).map((c) => (
        <button
          key={c}
          className="hl-swatch"
          style={{ background: HIGHLIGHT_COLORS[c]! }}
          onClick={() => onPick(c)}
          title={c}
          aria-label={`Highlight ${c}`}
        />
      ))}
      <button className="hl-bar-cancel" onClick={onCancel} title="Cancel">
        <X size={13} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function HighlightsPanel({
  highlights,
  onJump,
  onDelete,
  onClose,
}: {
  highlights: Highlight[];
  onJump: (cfiRange: string) => void;
  onDelete: (uuid: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="hl-panel" aria-label="Highlights">
      <header className="hl-panel-head">
        <span className="hl-panel-title">
          Highlights · <span className="hl-panel-count">{highlights.length}</span>
        </span>
        <button className="icon-btn" onClick={onClose} title="Close panel">
          <X size={13} strokeWidth={2.4} />
        </button>
      </header>
      {highlights.length === 0 ? (
        <div className="hl-panel-empty">
          Select text in the book to save your first highlight.
        </div>
      ) : (
        <ul className="hl-list">
          {highlights.map((h) => (
            <li key={h.uuid} className={`hl-item hl-tone-${h.color}`}>
              <button
                className="hl-item-text"
                onClick={() => onJump(h.cfi_range)}
                title="Jump to this passage"
              >
                {h.text}
              </button>
              <div className="hl-item-row">
                <time className="hl-item-time">
                  {new Date(h.created_at + "Z").toLocaleDateString()}
                </time>
                <button
                  className="hl-item-delete"
                  onClick={() => onDelete(h.uuid)}
                  title="Delete highlight"
                >
                  <Trash2 size={11} strokeWidth={2.2} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface TypoProps {
  lineHeight: number;
  setLineHeight: (n: number) => void;
  fontChoice: FontChoice;
  setFontChoice: (c: FontChoice) => void;
  forceColors: boolean;
  setForceColors: (v: boolean) => void;
  flow: Flow;
  toggleFlow: () => void;
}

function ReaderTypographyMenu({
  lineHeight,
  setLineHeight,
  fontChoice,
  setFontChoice,
  forceColors,
  setForceColors,
  flow,
  toggleFlow,
}: TypoProps) {
  return (
    <div className="typo-menu">
      <div className="typo-row">
        <span className="typo-label">Line height</span>
        <div className="typo-stepper">
          <button
            className="icon-btn"
            onClick={() => setLineHeight(Math.max(100, lineHeight - 10))}
          >
            <Minus size={12} strokeWidth={2.2} />
          </button>
          <span className="typo-readout">{lineHeight}%</span>
          <button
            className="icon-btn"
            onClick={() => setLineHeight(Math.min(240, lineHeight + 10))}
          >
            <Plus size={12} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div className="typo-row typo-row-stack">
        <span className="typo-label">Typeface</span>
        <div className="typo-segments">
          {(["default", "serif", "sans", "mono"] as FontChoice[]).map((c) => (
            <button
              key={c}
              className={`typo-seg ${fontChoice === c ? "active" : ""}`}
              onClick={() => setFontChoice(c)}
              data-font={c}
            >
              {c === "default" ? "Publisher" : c[0]!.toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="typo-row typo-row-stack">
        <span className="typo-label">Layout</span>
        <div className="typo-segments">
          <button
            className={`typo-seg ${flow === "paginated" ? "active" : ""}`}
            onClick={() => { if (flow !== "paginated") toggleFlow(); }}
          >
            <Columns size={12} strokeWidth={2} /> Paged
          </button>
          <button
            className={`typo-seg ${flow === "scrolled-doc" ? "active" : ""}`}
            onClick={() => { if (flow !== "scrolled-doc") toggleFlow(); }}
          >
            <AlignJustify size={12} strokeWidth={2} /> Scroll
          </button>
        </div>
      </div>
      <div className="typo-row typo-row-toggle">
        <div>
          <div className="typo-label">Force theme colors</div>
          <div className="typo-hint">
            Overrides publisher styles when text is too dark or light.
          </div>
        </div>
        <button
          className={`switch ${forceColors ? "on" : ""}`}
          onClick={() => setForceColors(!forceColors)}
          role="switch"
          aria-checked={forceColors}
        >
          <span className="switch-knob" />
        </button>
      </div>
    </div>
  );
}

interface ApplyArgs {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  fontChoice: FontChoice;
  forceColors: boolean;
}

function applyTheme(
  rendition: Rendition,
  { theme, fontSize, lineHeight, fontChoice, forceColors }: ApplyArgs
) {
  const colors = THEME_COLORS[theme];
  const family = FONT_STACK[fontChoice];
  const themeName = `atlas-${theme}-${fontChoice}-${forceColors ? "force" : "free"}`;

  // Build a CSS-rule object epub.js accepts as a theme. Selectors can be
  // anything; rules become inline <style> injected into the rendered frame.
  const rules: Record<string, Record<string, string>> = {
    body: {
      background: `${colors.bg} !important`,
      color: `${colors.fg} !important`,
      "line-height": `${lineHeight}%`,
    },
    a: { color: `${colors.link} !important` },
  };
  if (family) {
    rules.body!["font-family"] = `${family} !important`;
    // override stricter selectors that some publishers set
    rules["body, p, div, span, li, h1, h2, h3, h4, h5, h6"] = {
      "font-family": `${family} !important`,
    };
  }
  if (forceColors) {
    rules["*, *::before, *::after"] = {
      color: `${colors.fg} !important`,
      "background-color": "transparent !important",
    };
    rules["body"] = {
      ...rules["body"],
      "background-color": `${colors.bg} !important`,
    };
  }

  rendition.themes.register(themeName, rules as unknown as object);
  rendition.themes.select(themeName);
  rendition.themes.fontSize(`${fontSize}%`);
}
