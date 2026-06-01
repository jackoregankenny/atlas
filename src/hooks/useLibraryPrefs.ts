import { useCallback, useEffect, useState } from "react";

export type ViewMode = "grid" | "compact" | "list";
export type SortField =
  | "title"
  | "author"
  | "added"
  | "year"
  | "progress"
  | "rating";
export type SortDir = "asc" | "desc";

export interface LibraryPrefs {
  view: ViewMode;
  sortField: SortField;
  sortDir: SortDir;
  density: "comfortable" | "compact";
}

const KEY = "atlas-library-prefs";

const DEFAULTS: LibraryPrefs = {
  view: "grid",
  sortField: "title",
  sortDir: "asc",
  density: "comfortable",
};

function load(): LibraryPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useLibraryPrefs() {
  const [prefs, setPrefs] = useState<LibraryPrefs>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  const update = useCallback((patch: Partial<LibraryPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);

  const cycleView = useCallback(() => {
    setPrefs((p) => {
      const order: ViewMode[] = ["grid", "compact", "list"];
      const next = order[(order.indexOf(p.view) + 1) % order.length]!;
      return { ...p, view: next };
    });
  }, []);

  return { prefs, update, cycleView };
}
