import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBook } from "../api";
import type { Book } from "../types";

/**
 * Detail-panel selection + hover preview. Hovering a card warms a cache of
 * full book records (the list payload omits description) so the panel can
 * render instantly; when the panel is already open, hover also swaps the
 * previewed book after a short dwell.
 */
export function useDetailPreview(books: Book[]) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCache = useRef<Map<number, Book>>(new Map());
  const [, bumpCache] = useState(0);

  const clearCache = useCallback(() => detailCache.current.clear(), []);

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

  return { selectedId, setSelectedId, previewId, previewBook, onHover, clearCache };
}
