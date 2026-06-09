import { useEffect, useRef } from "react";

interface Handlers {
  togglePalette: () => void;
  focusFilter: () => void;
  importFiles: () => void;
  importFolder: () => void;
  toggleShortcuts: () => void;
  cycleView: () => void;
  cycleTheme: () => void;
  goLibrary: () => void;
  goSettings: () => void;
}

/**
 * Global key handler. The help sheet for these lives in src/shortcuts.ts —
 * keep HELP_GROUPS in sync when changing bindings here.
 */
export function useKeyboardShortcuts(h: Handlers) {
  const handlers = useRef(h);
  handlers.current = h;
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
        handlers.current.togglePalette();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handlers.current.focusFilter();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        handlers.current.importFolder();
        return;
      }
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        handlers.current.importFiles();
        return;
      }

      if (inField) return;

      if (e.key === "?") {
        e.preventDefault();
        handlers.current.toggleShortcuts();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        handlers.current.focusFilter();
        return;
      }
      if (e.key === "v") {
        e.preventDefault();
        handlers.current.cycleView();
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        handlers.current.cycleTheme();
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
          handlers.current.goLibrary();
        } else if (e.key === "s") {
          e.preventDefault();
          handlers.current.goSettings();
        }
        gPressed.current = false;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
