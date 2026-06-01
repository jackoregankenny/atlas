import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppPaths,
  Book,
  Collection,
  Device,
  EnrichOutcome,
  ImportReport,
  TagRow,
} from "./types";

export const listBooks = (): Promise<Book[]> => invoke("list_books");
export const getBook = (id: number): Promise<Book | null> =>
  invoke("get_book", { id });
export const bookCount = (): Promise<number> => invoke("book_count");
export const importPaths = (paths: string[]): Promise<ImportReport> =>
  invoke("import_paths", { paths });
export const deleteBook = (id: number): Promise<void> =>
  invoke("delete_book", { id });
export const appPaths = (): Promise<AppPaths> => invoke("app_paths");
export const enrichBook = (id: number): Promise<EnrichOutcome> =>
  invoke("enrich_book", { id });

export interface CoverCandidate {
  url: string;
  thumb_url: string;
  source: string;
}
export const coverCandidates = (id: number): Promise<CoverCandidate[]> =>
  invoke("cover_candidates", { id });
export const setBookCover = (id: number, url: string): Promise<string> =>
  invoke("set_book_cover", { id, url });
export const updateProgress = (
  id: number,
  cfi: string,
  percent: number
): Promise<void> => invoke("update_progress", { id, cfi, percent });
export const setFinished = (id: number, finished: boolean): Promise<void> =>
  invoke("set_finished", { id, finished });
export const listTags = (): Promise<TagRow[]> => invoke("list_tags");
export const addTag = (id: number, name: string): Promise<void> =>
  invoke("add_tag", { id, name });
export const removeTag = (id: number, name: string): Promise<void> =>
  invoke("remove_tag", { id, name });
export const revealInFinder = (id: number): Promise<void> =>
  invoke("reveal_in_finder", { id });
export const setRating = (id: number, rating: number | null): Promise<void> =>
  invoke("set_rating", { id, rating });
export const listDevices = (): Promise<Device[]> => invoke("list_devices");
export const sendToDevice = (
  id: number,
  deviceId: string
): Promise<{ dest: string }> =>
  invoke("send_to_device", { id, deviceId });
export const migrateOrphanFiles = (): Promise<{
  moved: number;
  missing: number;
  errors: string[];
}> => invoke("migrate_orphan_files");

export const listCollections = (): Promise<Collection[]> =>
  invoke("list_collections");
export const createCollection = (name: string): Promise<number> =>
  invoke("create_collection", { name });
export const renameCollection = (id: number, name: string): Promise<void> =>
  invoke("rename_collection", { id, name });
export const deleteCollection = (id: number): Promise<void> =>
  invoke("delete_collection", { id });
export const addToCollection = (
  collectionId: number,
  bookId: number
): Promise<void> => invoke("add_to_collection", { collectionId, bookId });
export const removeFromCollection = (
  collectionId: number,
  bookId: number
): Promise<void> => invoke("remove_from_collection", { collectionId, bookId });

export const coverUrl = (path: string | null): string | null =>
  path ? convertFileSrc(path) : null;

/** Force-write the vault manifest (.atlas/library.json). Returns the path. */
export const writeVaultManifest = (): Promise<string> =>
  invoke("write_vault_manifest");

// ─── highlights ─────────────────────────────────────────────────────

export interface Highlight {
  uuid: string;
  book_id: number;
  cfi_range: string;
  text: string;
  note: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export const listHighlights = (bookId: number): Promise<Highlight[]> =>
  invoke("list_highlights", { bookId });

export const addHighlight = (
  bookId: number,
  cfiRange: string,
  text: string,
  color?: string,
  note?: string,
): Promise<Highlight> =>
  invoke("add_highlight", {
    bookId,
    cfiRange,
    text,
    color: color ?? null,
    note: note ?? null,
  });

export const updateHighlight = (
  uuid: string,
  fields: { note?: string | null; color?: string | null },
): Promise<void> =>
  invoke("update_highlight", {
    uuid,
    note: fields.note ?? null,
    color: fields.color ?? null,
  });

export const deleteHighlight = (uuid: string): Promise<void> =>
  invoke("delete_highlight", { uuid });

// ─── edit metadata + files ──────────────────────────────────────────

/**
 * Patch shape for `updateBookMetadata`. Omit a field to leave it
 * untouched. For nullable fields, pass `null` to clear them.
 *
 *   { title: "New Title" }                  // just rename
 *   { series: null, series_index: null }    // detach from series
 *   { authors: ["A", "B"] }                 // replace author list
 */
export interface MetadataPatch {
  title?: string;
  authors?: string[];
  series?: string | null;
  series_index?: number | null;
  language?: string | null;
  isbn?: string | null;
  pub_date?: string | null;
  description?: string | null;
}

export const updateBookMetadata = (
  id: number,
  patch: MetadataPatch
): Promise<void> => invoke("update_book_metadata", { id, patch });

export const clearManualField = (id: number, field: string): Promise<void> =>
  invoke("clear_manual_field", { id, field });

export interface BookFile {
  id: number;
  path: string;
  role: "canonical" | "original" | "export";
  format: string;
  size: number;
}

export const listBookFiles = (id: number): Promise<BookFile[]> =>
  invoke("list_book_files", { id });

export const openBookFile = (id: number, fileId: number): Promise<void> =>
  invoke("open_book_file", { id, fileId });

/** Export a book's canonical EPUB to another format using Atlas's
 *  built-in Rust-native converters. Returns the output path.
 *  `format` is "markdown", "html", or "text". */
export const convertBook = (id: number, format: string): Promise<string> =>
  invoke("convert_book", { id, format });

/** Render highlights as Markdown in Readwise format. Pass a book id
 *  for a single book, or null/undefined for everything. Returns "" if
 *  there's nothing to export. */
export const exportAnnotationsMarkdown = (
  bookId: number | null
): Promise<string> => invoke("export_annotations_markdown", { bookId });

/** Write a UTF-8 string to a user-picked path. Pair with the dialog
 *  plugin's `save()` — that returns the path the user chose. */
export const writeTextFile = (path: string, contents: string): Promise<void> =>
  invoke("write_text_file", { path, contents });

/** Reveal the vault root in the OS file manager (Finder / Explorer /
 *  default xdg). Cross-platform via the opener plugin. */
export const revealVaultInFileManager = async (): Promise<void> => {
  const paths = await appPaths();
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(paths.library_root);
};

// ─── vault registry (Phase 3) ───────────────────────────────────────

export interface VaultEntry {
  path: string;
  name: string;
  last_opened: string;
}
export interface VaultRegistry {
  current: string | null;
  vaults: VaultEntry[];
}
export interface CloudSuggestion {
  label: string;
  base: string;
  suggested: string;
}
export interface VaultValidation {
  exists: boolean;
  has_manifest: boolean;
  is_dir: boolean;
}

export const listVaults = (): Promise<VaultRegistry> => invoke("list_vaults");
export const cloudDriveSuggestions = (): Promise<CloudSuggestion[]> =>
  invoke("cloud_drive_suggestions");
export const validateVaultPath = (path: string): Promise<VaultValidation> =>
  invoke("validate_vault_path", { path });
export const setCurrentVault = (path: string): Promise<VaultRegistry> =>
  invoke("set_current_vault", { path });
export const forgetVault = (path: string): Promise<VaultRegistry> =>
  invoke("forget_vault", { path });
/** Quit & relaunch — required after switching vaults. */
export const relaunchApp = (): Promise<void> => invoke("relaunch_app");
