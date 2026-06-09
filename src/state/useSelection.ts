import { useCallback, useState } from "react";

/** Multi-select state for bulk operations in library/collection views. */
export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, toggleSelect, clearSelection };
}
