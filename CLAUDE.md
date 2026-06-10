# Atlas — codebase map

Local-first EPUB library manager. Tauri 2 shell; React 19 + TypeScript
frontend in `src/`; Rust backend in `src-tauri/src/`. Product brief in
[BRIEF.md](BRIEF.md), feature status vs. the brief in [STATUS.md](STATUS.md).

## Architecture in one paragraph

The Rust side owns all data: SQLite (books/files/tags/collections/highlights,
WAL mode, migration runner in `db.rs`) plus a portable vault manifest
(`.atlas/library.json`, see `manifest.rs` and docs/VAULTS.md) that lets a
library sync across machines via Dropbox/iCloud with no server. The frontend
talks to it through `#[tauri::command]`s in `commands.rs`, wrapped one-to-one
by typed functions in `src/api.ts`. The React tree is wiring only — every
domain lives in a hook under `src/state/`, every screen in a component under
`src/components/`.

## Frontend layout

- `src/App.tsx` — shell wiring only (~600 lines). If you're adding state
  here, it probably belongs in a `src/state/` hook instead.
- `src/state/` — one hook per domain:
  - `useLibraryState` — book list, refresh, import pipeline
  - `useFilters` — status/tag/author/series/query filtering (query is
    deferred via `useDeferredValue`); pure logic lives in `src/util/filter.ts`
  - `useEnrichment` — single + batch Open Library enrichment
  - `useSelection` — multi-select for bulk ops
  - `useDetailPreview` — detail-panel selection, hover prefetch cache
  - `useBookActions` — every per-book action; returns the
    `BookActionHandlers` bundle used by context menu / detail panel
  - `useAppEvents` — native menu events, atlas:// deep links, vault-sync
    notifications, window title
  - `useKeyboardShortcuts` — global key handler; help text lives in
    `src/shortcuts.ts` (keep both in sync)
- `src/components/` — screens and widgets. `LibraryView` (toolbar + grid),
  `BookGrid`/`BookList`/`BookCard` (incremental rendering: 120-item batches
  via IntersectionObserver sentinel + `content-visibility` on cards),
  `Sidebar`, `CollectionView`, `SettingsView`, `Reader` (epub.js; locations
  cached in localStorage per book), `BookDetail`.
- `src/styles/` — 20 per-surface CSS files imported in cascade order from
  `App.css`. Tokens (colors, spacing, motion curves) live in `tokens.css`.

## Rust layout

- `commands.rs` — the IPC surface. Thin: validate, call a module, map errors
  to strings.
- `library.rs` — book CRUD + import. `list_books` deliberately omits
  `description` (the detail panel refetches via `get_book`); import is
  rayon-parallel with the UNIQUE(content_hash) constraint arbitrating dedup
  races. Unit tests at the bottom of the file.
- `db.rs` — schema + migrations. Every pooled connection gets
  `foreign_keys=ON` and `busy_timeout` via `with_init`.
- `manifest.rs` / `vaults.rs` — vault manifest write/reconcile, tombstones.
- `enrich.rs` — Open Library lookups with a 30-day response cache.
- `devices.rs` — USB e-reader detection (volume heuristics; 2023+ Kindles
  are MTP-only and undetectable this way) and send-to-device. Kindle sends
  convert EPUB→AZW3 via detected `ebook-convert`; Kobo sends use `kepubify`
  when present. Tools are detect-and-use, never bundled (brief §3).
- `epub.rs` — OPF metadata + cover extraction.
- `convert.rs` — Rust-native EPUB→text/markdown/html exporters.

## Conventions

- "Collection" in the data layer and API; the UI calls them folders in places —
  prefer "collection" for anything new.
- Frontend mutations: optimistic where cheap (status, rating), otherwise
  mutate → `refresh()` → toast. Errors always toast; never silent.
- TS types in `src/types.ts` mirror Rust structs by hand — if you change
  `BookRow`, update `Book` (and vice versa).

## Commands

```bash
pnpm tauri dev      # run the app
pnpm run build      # typecheck + bundle frontend
pnpm test           # vitest unit tests
cd src-tauri && cargo test   # Rust unit tests
```

CI (`.github/workflows/ci.yml`) runs all of the above on push/PR. Releases
(`.github/workflows/release.yml`) build installers for a `v*` tag.
