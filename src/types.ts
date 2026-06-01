export type BookStatus = "unread" | "reading" | "finished";

export interface Book {
  id: number;
  title: string;
  authors: string[];
  series: string | null;
  series_index: number | null;
  cover_path: string | null;
  language: string | null;
  pub_date: string | null;
  added_at: string;
  file_path: string | null;
  isbn: string | null;
  description: string | null;
  progress_percent: number | null;
  progress_cfi: string | null;
  finished_at: string | null;
  status: BookStatus;
  tags: string[];
  rating: number | null;
  folder_ids: number[];
  /** JSON string: `{"title": true, ...}`. Field-level manual override
   * flags — drives the "auto" pill in the edit-metadata modal and gates
   * enrichment. Null when the user hasn't edited anything. */
  manual_fields: string | null;
  has_original: boolean;
}

export interface TagRow {
  name: string;
  count: number;
}

export interface Collection {
  id: number;
  name: string;
  kind: "manual" | "smart";
  count: number;
}

export type DeviceKind = "kindle" | "kobo" | "pocketbook" | "boox" | "remarkable" | "generic";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  root: string;
  books_dir: string;
}

export interface ImportReport {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface EnrichOutcome {
  matched: boolean;
  fields_updated: number;
  cover_fetched: boolean;
  tags_added: number;
}

export interface AppPaths {
  data_dir: string;
  covers_dir: string;
  db_path: string;
  library_root: string;
  /** True only on the very first launch on this machine. Frontend
   *  uses it to show the welcome / vault-picker modal. */
  first_run: boolean;
}
