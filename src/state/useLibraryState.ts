import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listBooks, importPaths, migrateOrphanFiles, setTaskbarProgress } from "../api";
import type { Book, ImportReport } from "../types";
import type { PushToast } from "./useToasts";

/**
 * The book list itself plus everything that mutates it wholesale: initial
 * load, refresh-after-mutation, and the import pipeline (drag-drop and
 * file/folder pickers both end in `runImport`).
 */
export function useLibraryState(pushToast: PushToast) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
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
      // Mirror onto the dock/taskbar; total is unknown, so indeterminate.
      setTaskbarProgress(null, true).catch(() => {});
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
        setTaskbarProgress(null).catch(() => {});
      }
    },
    [refresh, pushToast]
  );

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

  return { books, setBooks, loaded, importing, refresh, runImport, onPickImport };
}
