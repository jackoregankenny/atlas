# Atlas — feature roadmap

Deep dive on the v1 gaps from [STATUS.md](STATUS.md). For each: what it is, user flow, technical sketch, schema/IPC deltas, dependencies, effort estimate, and why it matters.

Effort scale: **S** (≤ 1 day), **M** (2–4 days), **L** (≥ 1 week).

---

## 1. Tantivy full-text search · **L**

### Why it matters
The current filter is a substring scan over titles/authors/series in JS. At 5k+ books with descriptions it stutters; at 50k+ it's unusable. Tantivy gives sub-100ms search across the full EPUB body for any library size — and it's the same engine that powers `meilisearch`, so the relevance model is solid.

### User flow
- Single search input in the topbar (already exists) widens its scope. Cmd+K palette becomes the "jump to known book" affordance; the topbar becomes "find anything across the library".
- Search results show snippets with **bold-highlighted matches**, similar to how iA Writer renders search.
- Faceted filters: status, tag, author, language — applied alongside the text query.

### Technical sketch
- Add `tantivy` crate (~3MB of code, compiles fast).
- Index location: `<app_data_dir>/index/`.
- Schema: `book_id (i64 stored)`, `title (text)`, `authors (text)`, `series (text)`, `description (text)`, `body (text)`, `tags (text indexed)`, `language (string facet)`, `status (string facet)`.
- Indexing pipeline: on import, extract all `<text>` content from EPUB XHTML pages → strip tags → push to Tantivy. Same on enrich (description changes).
- Re-index command: `atlas reindex` (CLI + Settings button). Idempotent.
- IPC: `search_library(query, filters, limit, offset) → { hits: [{book_id, score, snippets}] }`.
- Frontend: results view replaces the grid when a query is active; clicking a hit opens the detail panel. Snippets render via `<mark>` against a small content fragment.

### Schema changes
None to SQLite. Add `index_version INTEGER` to `meta` table so we can re-index on schema bumps.

### Dependencies
- `tantivy = "0.22"`
- HTML-to-text helper (or roll a tiny stripper).

### Risks
- First-time indexing of a 5k-book library takes minutes. Background it, show progress in topbar.
- Tantivy compile time noticeable in dev — fine for release.

---

## 2. Annotations UI · **M**

### Why it matters
Highlight + note is the killer feature for non-fiction readers. The brief specifies CFI-addressed annotations with five colors, cross-library search, and Markdown export in Readwise format. Schema is already in place.

### User flow
- Inside the reader, select text → small floating toolbar appears (5 color swatches + "Add note").
- Picking a color creates the annotation. Clicking again on highlighted text re-opens the same toolbar with a "Remove" option.
- A new **Annotations** view (left nav, below Settings cog or as a top-level item) lists all annotations across the library: book cover thumb, quoted text, optional note, color dot, "open at this position" button.
- Search within annotations.
- Per-book annotations panel inside the reader (toggle right-side drawer).

### Technical sketch
- Use `epub.js` `rendition.annotations.add(cfiRange, data, callback, "highlight", { fill: color })` for the visual layer.
- Listen for `rendition.on("selected", (cfiRange, contents) => …)` to capture user selection.
- Store: `INSERT INTO annotations (book_id, cfi_start, cfi_end, text, note, color)`. `text` is the highlighted quote (for search + display when the book isn't open).
- Tap into existing schema — already has the right columns.
- IPC: `create_annotation`, `update_annotation_note`, `delete_annotation`, `list_annotations(book_id?)`, `list_all_annotations(query?)`.
- Export: serialize to Markdown chunked by book, mimicking Readwise's format (`# Title — Author\n\n> quote\n\nnote\n\n---`).

### Schema changes
Minor: add `updated_at` to `annotations`. Index on `(book_id, color)` for quick filters.

### Risks
- CFI ranges are fragile across re-flowed layouts. epub.js handles this well in practice.
- Selecting across page boundaries in paginated mode can be unreliable — accept that edge case.

---

## 3. Pandoc integration (detect-and-prompt) · **M**

### Why it matters
Pandoc converts docx/html/markdown/mobi/azw3 to EPUB. The brief explicitly chose detect-and-prompt over bundling to keep install size under 30MB. Without pandoc, Atlas can't accept anything but EPUB.

### User flow
- On first import attempt of a non-EPUB, non-PDF file, show a panel: "Pandoc is needed to convert this format. [Install pandoc] · [Continue without]".
- Install button opens a small dialog with platform-specific instructions and a one-click installer where possible:
  - macOS: `brew install pandoc` (if `brew` exists) else download `.pkg`.
  - Windows: `winget install --id JohnMacFarlane.Pandoc`.
  - Linux: detect package manager (`apt`, `dnf`, `pacman`) and offer command + clipboard copy.
- After install, Atlas re-detects and toasts "Pandoc ready". Conversion proceeds.

### Technical sketch
- Add `which crate` or shell-out to `pandoc --version` on startup; cache result, re-check after install.
- Convert pipeline: `pandoc -f <fmt> -t epub3 -o <tmp.epub> <src>` then run our existing EPUB import on the temp file. Original is preserved as sidecar `<book>.original.<ext>`.
- For mobi/azw3, pandoc may need `ebook-convert` (Calibre) — flag this as a separate dependency.
- Trait: `trait Converter { fn supports(ext) -> bool; fn convert(src, dst) -> Result<()>; }`. Pandoc impl, future Rust-native impl.
- IPC: `detect_pandoc() → { available: bool, version: string? }`, `install_pandoc(method) → AsyncJob`.

### Schema changes
Add `app_meta(key, value)` k/v table so we can persist things like `pandoc_path`.

### Risks
- Pandoc EPUB output is OK but not great for some sources (esp. heavily styled docx). Audit output before declaring "good enough".
- Don't auto-run installers without consent — always prompt with the exact command shown.

---

## 4. Kepubify + export pipeline · **S**

### Why it matters
Kobo readers prefer the `.kepub.epub` format. Kepubify is a small (~3MB) Go binary that converts in-place very quickly. Bundling it is cheap.

### User flow
- Right-click → Convert to → KEPUB (Kobo): produces a sidecar export at the original path with the `.kepub.epub` suffix.
- Detail panel: a "Downloads & Exports" section listing existing exports with re-generate / delete buttons.
- Used by send-to-device for Kobo automatically.

### Technical sketch
- Bundle `kepubify` per platform under `src-tauri/binaries/kepubify-{target}`.
- Tauri 2 supports sidecars: declare in `tauri.conf.json → bundle.externalBin`.
- Wrap with Rust shim: `pub fn epub_to_kepub(src, dst) -> Result<()>`.
- Insert export into `files` table with `role='export', format='kepub'`.

### Schema changes
None.

### Dependencies
- `tauri-plugin-shell` for invoking the sidecar safely.

### Risks
- Cross-platform binary sourcing & signing. Apple notarization is fussy about embedded binaries — sign as part of the bundle.

---

## 5. Send-to-device (Kindle/Kobo USB) · **M**

### Why it matters
The "download from store → drag into Calibre → wait → drag to Kindle" loop is what makes Calibre painful. Atlas should let you connect a Kindle, right-click a book, and have it there in two seconds.

### User flow
- Connect Kindle or Kobo via USB → it appears in the **Send to device** submenu (no longer disabled) and in the sidebar as a section with a green dot and the device name.
- Pick a book → "Send to Kindle Paperwhite". Atlas auto-converts to AZW3 (Kindle) or KEPUB (Kobo) if needed, copies to the device's documents/books folder, toasts.
- Per-device profile remembers preferred format and target subdirectory.

### Technical sketch
- USB mass-storage detection: poll mount points every 2 seconds, match volume labels (`KINDLE`, `KOBOeReader`) and well-known marker files (`system/version.txt` for Kobo, `documents/system/version.txt` for Kindle).
- Cross-platform path resolution:
  - macOS: scan `/Volumes/*`.
  - Windows: enumerate drive letters via Win32 API or wmic.
  - Linux: read `/proc/mounts` filtered to `usb`.
- Once a device is detected, expose `Device { name, kind: Kindle|Kobo|Generic, root_path, preferred_format }`.
- IPC: `list_devices()`, `send_to_device(book_id, device_id)`. Pipeline: detect canonical EPUB → ensure conversion exists → copy bytes → optional drm-free metadata refresh.

### Schema changes
- `devices(id, name, kind, last_serial, preferred_format, target_subdir)` for persisted per-device prefs.

### Dependencies
- Pure stdlib for filesystem polling.
- AZW3 conversion needs pandoc (or Calibre's `ebook-convert`). Without it, fall back to plain EPUB which Kindle Scribe/recent firmware reads.

### Risks
- USB mounts are flaky. Need graceful retry on EACCES (device sleep).
- macOS notarization may need `com.apple.security.device.usb` entitlement for USB-only paths, but mass-storage is just filesystem so should be fine.

---

## 6. OPDS server · **S**

### Why it matters
OPDS turns Atlas into a personal book server. Open KOReader/Moon+/Marvin on a phone/e-reader, point it at `http://your-mac.local:8080/opds`, and your library shows up like a bookstore — with covers, descriptions, and direct downloads.

### User flow
- Settings → Sharing → toggle "Run OPDS server" with port and optional username/password.
- Status indicator shows the URL + LAN IP, with a "Show QR code" for easy phone pairing.
- Off by default. No remote/internet exposure — LAN only.

### Technical sketch
- `axum` server, started on a tokio task from the Tauri setup hook (or on toggle).
- Routes:
  - `GET /opds` → root navigation feed (Recent, By Author, By Series, Unread, All).
  - `GET /opds/recent` → acquisition feed (last 50 books, OPDS Atom + Open Search).
  - `GET /opds/books/{id}/file` → streams the canonical EPUB.
  - `GET /opds/books/{id}/cover` → streams the cover.
  - `GET /opensearch.xml` → required by OPDS clients for search.
- Basic auth via middleware. Bind to all interfaces with a clear warning, or 127.0.0.1 + Bonjour advertisement.

### Schema changes
None.

### Dependencies
- `axum = "0.7"`, `tower-http`, `tokio` (already).

### Risks
- OPDS Atom is fiddly XML. Test against KOReader specifically — it's the strictest client.

---

## 7. Calibre import · **M**

### Why it matters
The single biggest reason a Calibre user can't switch: their existing library. Atlas needs a 5-minute migration that loses nothing.

### User flow
- Settings → Import from Calibre → file picker for the Calibre library folder (containing `metadata.db`).
- Preview screen: "Found 1,247 books, 84 series, 312 authors, 18 tags. Will copy EPUBs as canonical; PDFs/mobi/azw3 will be kept as sidecars (or converted if Pandoc is available)." Toggle: "Copy files into Atlas library" vs "Index in place".
- Progress bar + cancel during import. Final toast: "Imported 1,201 books, skipped 46 duplicates, 0 errors. Calibre tags mapped to Atlas tags."

### Technical sketch
- Read `metadata.db` (SQLite) directly with `rusqlite` (no Calibre dependency).
- Map:
  - `books` → `books` (most fields one-to-one).
  - `authors` + `books_authors_link` → `authors` + `book_authors`.
  - `series` + `books_series_link` → `series` and `series_index`.
  - `tags` + `books_tags_link` → `tags` + `book_tags`.
  - `comments` → `description`.
  - `identifiers` → pick ISBN.
  - `last_modified`/`timestamp` → preserve as `added_at`.
- Walk `<library>/<author>/<book>/` to find EPUB; promote first found as canonical; others as sidecars.
- Mark imports with `source='calibre'` in `app_meta` for tracebacks.

### Schema changes
- Add `source TEXT` to books (nullable) to track origin.

### Risks
- Calibre stores covers as `cover.jpg` next to the file but also caches them — prefer extracting our own from the EPUB for consistency, fall back to Calibre's only if extraction fails.
- Custom columns are common in power users' Calibre libs. We can ignore them in v1 but should at least log them so the user knows nothing was silently dropped.

---

## 8. CLI · **S**

### Why it matters
Power users want to script imports, run nightly enrichments, serve OPDS from a headless box, and pipe `atlas list --filter` into shell tools. The brief promises: `import`, `list`, `show`, `convert`, `send`, `enrich`, `serve`, `search`.

### User flow
```
$ atlas import ~/Downloads/*.epub
Imported 12, skipped 1 (duplicate)

$ atlas list --filter "tag:scifi unread"
[1284] The Three-Body Problem    Liu Cixin
[1290] Project Hail Mary         Andy Weir
...

$ atlas serve --port 9000 &
Atlas OPDS server listening on http://0.0.0.0:9000/opds

$ atlas convert 1284 --to kepub
Wrote /Users/me/Books/Atlas/.../The Three-Body Problem.kepub.epub
```

### Technical sketch
- New binary in the same workspace: `atlas-cli` with `clap` for arg parsing.
- Shares `db`, `library`, `enrich`, etc. modules with the GUI via `src-tauri/src` being a workspace member.
- Opens the same SQLite DB the GUI uses; uses file locking so they cooperate.
- Output: human-friendly default, `--json` for machine parsing.

### Schema changes
None.

### Dependencies
- `clap = "4"`.
- Workspace refactor: extract `db/library/enrich/epub` into a shared `atlas-core` crate; `atlas-cli` + `atlas-tauri` (GUI) both depend on it.

### Risks
- DB writes from CLI while GUI is open: SQLite WAL handles this safely; just make sure both open with the same pragma settings.

---

## 9. Scrolling reader mode · **S**

### Why it matters
Long-form non-fiction reads better as continuous scroll. Foliate, Apple Books, and Readwise Reader all support both modes. epub.js has it built in — we just don't expose it yet.

### User flow
- Reader bar adds a flow toggle between "paginated" (default) and "scrolling".
- Persisted per-book.
- In scrolling mode, the page-edge buttons hide and footer progress updates on scroll.

### Technical sketch
- One-line change to `rendition` config: `flow: "scrolled-doc"` instead of `"paginated"`.
- Save flow preference in `books.reader_flow` or in `reading_progress` as JSON.
- Re-create the rendition on change (epub.js doesn't allow flow switching in place).

### Schema changes
- Optional: `reading_progress.flow TEXT` defaulting to `'paginated'`.

### Risks
- None substantial.

---

## 10. Edit metadata · **S**

### Why it matters
Open Library is wrong sometimes. Wrong cover, wrong author, wrong series order. Without a manual override, users either live with the mistake or delete and reimport. Calibre's metadata editor is one of the few things it does well.

### User flow
- Detail panel → small "Edit" pencil next to the title, or right-click → **Edit metadata**.
- Modal form: title, sort title, authors (chip input with reorder), series + index, language, ISBN, pub date, description (rich-ish), tags. Each field shows the current value with a subtle "source: Open Library / EPUB OPF / manual" caption.
- **Replace cover…** picks a local image or pastes a URL.
- "Revert this field to auto-detected" per field; "Revert all" at the bottom.

### Technical sketch
- New IPC: `update_book_metadata(id, patch)` where patch is `{ title?, authors?, series?, … }`. Setting a value records it as manual; unsetting reverts.
- Add `metadata_overrides JSON` column on books, OR add a `manual_<field> BOOLEAN` flag per editable field (former is simpler).
- On enrich runs, never overwrite fields where `manual_*` is true.
- Cover replace: write to covers dir as `manual-<id>.<ext>`, point `cover_path` at it.

### Schema changes
- `books.manual_fields TEXT` (JSON object: `{"title": true, "cover_path": true, ...}`).

### Risks
- None significant. UX risk: form gets cluttered if every field has a "revert" affordance. Hide it unless the field has been touched.

---

## 11. Open original (sidecar) · **S**

### Why it matters
When Atlas imports a PDF or mobi, the EPUB is canonical but the original is preserved alongside. Power users sometimes want the original — to read in their PDF app of choice, or because the conversion lost a figure.

### User flow
- Right-click → **Open original** (visible only when a sidecar exists).
- Opens via OS default app (Preview, Acrobat, etc.).
- Detail panel: a "Files" section lists canonical + sidecars + exports with row actions (open, reveal, delete export).

### Technical sketch
- Already have the sidecar import path planned in §3 (Pandoc). The list view is just a SELECT on `files WHERE book_id = ?`.
- `open_path(path)` IPC using `tauri-plugin-opener` (already in deps).

### Schema changes
None — `files` table is already in place.

### Risks
- Files in sandboxed locations (downloads, external drives) may not open without prompting. Trust OS behavior.

---

## 12. Atlas URL scheme · **S**

### Why it matters
`atlas://book/<isbn>` or `atlas://book/id/<n>` lets users link to specific books from notes apps, email, or other tools. Pair with **Copy book link** in the right-click menu (already a placeholder).

### User flow
- Right-click → **Copy book link** → URL in clipboard.
- Clicking the URL in any app opens Atlas and jumps to that book's detail panel (or opens the reader if `?read=1`).

### Technical sketch
- Tauri 2 single-instance + deep-link plugins handle this.
- Register `atlas` URL scheme via `tauri.conf.json → plugins.deep-link`.
- On boot, parse URL; route to detail panel (`setSelectedId`) or reader.
- macOS: needs Info.plist `CFBundleURLTypes`. Windows: registry. Tauri's deep-link plugin handles all three.

### Schema changes
None.

### Dependencies
- `tauri-plugin-deep-link`, `tauri-plugin-single-instance`.

### Risks
- macOS sometimes registers conflicting schemes if multiple Atlas builds are installed. Document a manual fix command.

---

## 13. Collections (shelves) · **M**

### Why it matters
Brief §6.6 calls this "smart collections" — a JSON AST query DSL. Tags cover ~80% of the use case, but explicit ordered shelves (Reading list, Course readings, Gift ideas) are how most people actually organize. Schema already exists (`collections`, `collection_books`).

### User flow
- Sidebar gets a **Shelves** section between Tags and Settings.
- Right-click → **Add to shelf ›** submenu, with a "+ New shelf…" entry.
- Each shelf is a sidebar entry with a count. Clicking filters to it. Shelves can be ordered manually (drag-and-drop), and books inside a shelf can be ordered (great for reading lists).
- A second flavor: **smart shelf** — filter chips that auto-update (e.g. `unread + tag:scifi + added-this-month`).

### Technical sketch
- Schema already has `collections(id, name, kind, query)` and `collection_books(collection_id, book_id)`. Add a `position INTEGER` column for ordering inside a collection, and `sort_position` on collections for sidebar order.
- IPC: `create_collection`, `delete_collection`, `add_to_collection`, `remove_from_collection`, `reorder_in_collection`, `list_collections`.
- Smart query DSL (deferred to a phase 2): JSON like `{"and": [{"status": "unread"}, {"tag": "scifi"}]}` compiled to SQL. Start with manual shelves only; the right-click → submenu UX is the same.

### Schema changes
- `collections`: add `sort_position INTEGER DEFAULT 0`, `created_at TEXT DEFAULT (datetime('now'))`.
- `collection_books`: add `position INTEGER NOT NULL DEFAULT 0`, primary key includes position handling.

### Risks
- Drag-and-drop reorder UX needs care (use `position = (prev + next) / 2` fractional positions for cheap inserts).

---

## 14. Per-book rating · **S**

### Why it matters
Five-star ratings are a Calibre staple and useful sort/filter input. Cheap to add.

### User flow
- Detail panel: a row of 5 stars below the title. Hover preview, click to set, click the same star again to clear.
- Sort menu gains "Rating".
- Right-click → **Rate ›** with star options.

### Technical sketch
- `books.rating INTEGER` (0–5, nullable). Update via `set_rating(id, rating)`.

### Schema changes
- `books.rating INTEGER`.

### Risks
- None.

---

## 15. Reading sessions / stats · **M**

### Why it matters
Words like "you've read 4,200 pages this year" turn a library into a personal record. Plus useful for habit-builders. Calibre doesn't do this; Readwise does. Distinguishes Atlas without much work.

### User flow
- Reader logs sessions automatically: start when rendition mounts, end on close or 60s of inactivity. Records book_id, start_at, end_at, start_cfi, end_cfi, percent_delta.
- A new **Stats** view (or section on Settings) shows:
  - Books finished this year / month.
  - Minutes read / day chart (calendar heatmap).
  - Longest streak.
  - Per-book reading-time totals on the detail panel ("4h 12m total reading").
- Optional: a daily reading-time goal with quiet notification.

### Technical sketch
- `reading_sessions(id, book_id, started_at, ended_at, start_cfi, end_cfi, percent_delta)`.
- Aggregations are fast in SQLite — calendar heatmap is `GROUP BY date(started_at)`.

### Schema changes
- New `reading_sessions` table.

### Risks
- Idle detection in the webview is imperfect. Cap sessions at 3h to avoid the "left it open overnight" pollution.

---

## 16. Author and series views · **S**

### Why it matters
Clicking an author name should show all their books. Same for series. Today both are just text on the card. Tiny scope change for big polish gain.

### User flow
- Author name in card meta / detail panel / list view becomes a clickable link.
- Clicking opens a filtered library view scoped to that author (or series) with a clear "Showing all books by Le Guin · Clear" pill in the topbar.
- Sidebar **By author** view (collapsible group) lists author names with counts.

### Technical sketch
- Re-use the existing filter pipeline; add `authorFilter` and `seriesFilter` state.
- Sidebar grouping: derive author list from books in memory; render expandable section.

### Schema changes
None.

### Risks
- Author name normalization is messy ("Le Guin, Ursula K." vs "Ursula K. Le Guin"). Sort field already exists; defer fancy deduping.

---

## 17. Custom cover replacement · **S**

### Why it matters
Mentioned inline with §10 (Edit metadata) but worth its own line. Sometimes Open Library has a worse cover than what you drag in from a Goodreads page.

### User flow
- Detail panel: hover the cover → "Replace cover" overlay button. Click → file picker for image OR paste URL.
- Right-click on cover → **Replace cover…**.

### Technical sketch
- IPC: `set_book_cover(id, source: {kind: "file", path} | {kind: "url", url})`.
- Stores to covers dir, sets `cover_path`, marks `manual_fields.cover_path = true` (so enrich won't overwrite).

### Schema changes
Shares the `manual_fields` from §10.

### Risks
None.

---

## 18. Right-click — connections to features above

The context menu is the discoverability layer; each entry maps to one of these features. Once landed, the placeholder items in `App.tsx` flip from disabled to enabled. Current map:

| Menu item | Feature | Status |
|---|---|---|
| Read / Continue | Reader | ✅ |
| Show details / Book info | Detail panel | ✅ |
| Mark as finished/unread | Read tracking | ✅ |
| Enrich from Open Library | Enrichment | ✅ |
| Tags ›  Add / Remove | Tags | ✅ |
| Send to device ›  Kindle / Kobo | §5 | ⬜ |
| Convert to ›  KEPUB / AZW3 / PDF / MD | §3 + §4 | ⬜ |
| Copy ISBN | clipboard | ✅ |
| Reveal in Finder | OS shell | ✅ |
| Remove from library | delete | ✅ |
| Edit metadata… | §10 | ⬜ |
| Open original | §11 | ⬜ |
| Copy book link | §12 | ⬜ |
| Add to shelf › | §13 | ⬜ |
| Rate › | §14 | ⬜ |
| Replace cover… | §17 | ⬜ |

---

## Suggested sequencing

Roughly ordered by **(value × likelihood-of-being-noticed) ÷ effort**:

1. **Scrolling reader mode** (S) — instant polish, almost free.
2. **Edit metadata** (S) — unblocks user trust in the data; complaint magnet otherwise.
3. **Per-book rating** (S) — instant value, one column.
4. **Author / series views** (S) — discovery; tiny code.
5. **Annotations UI** (M) — biggest feature gap for the target user.
6. **Collections / shelves** (M) — completes the organization story (status + tags + shelves).
7. **Pandoc detect-and-prompt** (M) — unblocks all non-EPUB imports.
8. **Calibre import** (M) — migration trigger.
9. **Kepubify + export** (S) — small surface, sets up...
10. **Send-to-device** (M) — second-biggest reason to leave Calibre.
11. **Reading sessions / stats** (M) — distinguishing feature, demoable.
12. **Replace cover / open original / atlas:// URL** (S each) — pick up alongside related features.
13. **OPDS server** (S) — demo-worthy, finishes "your books everywhere".
14. **Tantivy FTS** (L) — biggest tech project; do it when substring search stops feeling fast.
15. **CLI** (S after workspace split) — last because it benefits from a settled core API.

Stretch / future:
- Custom column types, plugin API, multi-library, audiobook playback, mobile companion app. All deferred per brief §10.
