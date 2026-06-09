import { useCallback, useRef, useState } from "react";
import { enrichBook } from "../api";
import type { Book } from "../types";
import { startEnrichBatch, type EnrichJob } from "../enrichPool";
import type { PushToast } from "./useToasts";

/**
 * Single-book and batch enrichment. `enrichingIds` drives per-card spinners;
 * `batchJob` drives the topbar progress bar.
 */
export function useEnrichment(
  books: Book[],
  refresh: () => Promise<void>,
  pushToast: PushToast
) {
  const [enrichingIds, setEnrichingIds] = useState<Set<number>>(new Set());
  const [batchJob, setBatchJob] = useState<EnrichJob | null>(null);
  const batchHandleRef = useRef<{ cancel: () => void } | null>(null);

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

  const runBatch = useCallback(
    (ids: number[]) => {
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
    },
    [refresh, pushToast]
  );

  const onEnrichAllMissing = useCallback(() => {
    const targets = books.filter((b) => !b.cover_path || b.authors.length === 0);
    if (targets.length === 0) {
      pushToast("info", "Everything already has covers and authors");
      return;
    }
    runBatch(targets.map((b) => b.id));
  }, [books, runBatch, pushToast]);

  const cancelBatch = useCallback(() => {
    batchHandleRef.current?.cancel();
  }, []);

  return { enrichingIds, batchJob, onEnrich, onEnrichAllMissing, runBatch, cancelBatch };
}
