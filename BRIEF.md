# Atlas

A local-first ebook library manager and reader. EPUB-native. Under 30MB. The anti-Calibre.

---

## 1. Vision

EPUB is the format of digital books. Atlas treats it as such. Other formats are inputs to be converted, not first-class citizens. This single decision shapes everything: smaller binary, simpler renderer, better typography, faster everything.

**Target user:** people who own e-readers, care about their books, and have outgrown Calibre's UI but still need its functionality.

**Non-goals:** news/RSS-to-epub conversion, a book editor, DRM removal, cloud sync as a service, social features, a store, native PDF reading as a primary experience.

## 2. The EPUB-first principle

EPUB is the canonical format in Atlas. Every book in the library has an EPUB. Other formats are either:

1. **Imports** — converted to EPUB on the way in (PDF, mobi, azw3, docx, html). The original may be kept as a sidecar but is not the read-from artifact.
2. **Exports** — converted from EPUB on the way out (kepub for Kobo, azw3 for Kindle, PDF for printing, markdown/docx for editing).

**What this buys:** one reader done well; smaller binary; coherent library; honest about PDF.

**What this costs:** PDF→EPUB conversion is imperfect; some users will want to keep PDFs as PDFs (allowed via sidecar + "Open Original" in OS viewer, but not rendered in-app).

## 3. Technical foundation

- **Shell:** Tauri 2
- **Frontend:** React + TypeScript + Vite
- **Backend:** Rust
- **Storage:** SQLite (metadata) + Tantivy (full-text search)
- **Reader:** foliate-js, embedded in webview
- **Conversion binaries:** `kepubify` bundled (~3MB). `pandoc` **detected, not bundled** — Atlas runs without it; conversion features prompt for one-click install (brew/winget/apt).

**Size budget (ship config):**

| Component | Size |
|---|---|
| Tauri shell + React bundle | ~8MB |
| Rust binary | ~4MB |
| kepubify | ~3MB |
| Bundled fonts (Literata, Inter) | ~2MB |
| **Total** | **~17MB** |

Comfortably under the 30MB target.

**Platforms:** macOS, Windows, Linux (deb, rpm, AppImage).

## 4. PDF handling

On import:

1. Detect text-based vs scanned (try text extraction; <100 chars/page avg → scanned).
2. **Text-based:** convert to EPUB using `pdf-extract` + HTML generation (Rust-native), or pandoc if available for higher quality. Original kept as `<book>.original.pdf` sidecar.
3. **Scanned:** refuse politely. Suggest `ocrmypdf` or similar, re-import.

Send-to-device: PDF-preferring devices (reMarkable) get the original PDF sidecar; everything else gets the EPUB or its conversion.

**No in-app PDF rendering.** The "Open Original" action launches the OS default viewer.

## 5. Data architecture

Books are content; files are instances. Every book has exactly one canonical EPUB.

```sql
books(id, title, title_sort, series_id, series_index, isbn,
      pub_date, language, description, cover_path, added_at,
      modified_at, content_hash)

files(id, book_id, path, role, format, size, hash, last_seen)
-- role: 'canonical' (always epub) | 'original' | 'export'
-- exactly one canonical per book

authors(id, name, sort)
book_authors(book_id, author_id, position)

series(id, name, sort)

tags(id, name)
book_tags(book_id, tag_id)

collections(id, name, kind, query)
collection_books(collection_id, book_id)

reading_progress(book_id, cfi, percent, updated_at)

annotations(id, book_id, cfi_start, cfi_end, text, note, color, created_at)
```

**Folder layout:**

```
LibraryRoot/
  Author Name/
    Series Name/
      Book Title (2023).epub            # canonical
      Book Title (2023).original.pdf    # sidecar, optional
      Book Title (2023).kepub.epub      # export, optional
    Standalone Title (2021).epub
```

## 6. v1 feature scope

1. **Library:** drag-drop import, watch folder (index-in-place / copy / copy-and-organize), hash dedup, cover extraction, bulk ops.
2. **Import pipeline:** EPUB native; PDF→EPUB (text only); mobi/azw3/docx/html/md via pandoc-if-available.
3. **Metadata:** Open Library (primary) + Google Books (fallback), cached. Manual editing. "Identify" action. Series detection (OPF → ISBN → filename).
4. **Reading:** foliate-js. Paginated + scrolling. Font/size/line-height/margins/theme. Theme overrides publisher color CSS, preserves structure. Keyboard nav; vim keys optional.
5. **Annotations:** CFI-addressed highlights + notes, 5 colors, cross-library search, export to Markdown (Readwise format) or JSON.
6. **Smart collections:** JSON AST → SQL, filter-chip UI.
7. **Export & send-to-device:** kepub (Kobo), azw3 (Kindle, via pandoc), PDF/md/docx (via pandoc). Auto-detect Kindle/Kobo via USB mass storage. Per-device profile. MTP and email-to-Kindle deferred.
8. **OPDS server:** Axum, OPDS 1.2, off by default, optional HTTP Basic auth.
9. **CLI:** `atlas import|list|show|convert|send|enrich|serve|search`.
10. **Search:** Tantivy over EPUB text + metadata. Snippets in results.
11. **Calibre import:** read `metadata.db` + folder; EPUBs become canonical; other formats sidecar or convert.

## 7. UX principles

Three views: **Library** (grid + list), **Reader** (full-screen), **Settings**. Density matters — 50+ covers on a 27" monitor. Keyboard-first; Cmd+K palette. Panels over modals. Native per-platform. Dark mode default; sepia + light available. Literata for reading, Inter for UI, both bundled.

Visual reference points: Linear, Things, iA Writer.

## 8. Build order

1. **Foundation** — Rust core, SQLite, Tauri shell, library grid. *Goal: 1,000 EPUBs imported and browsable.*
2. **Reading** — foliate-js, themes, progress.
3. **Import pipeline** — PDF→EPUB, pandoc detection.
4. **Enrichment** — ISBN lookup, editing, series detection, cover refresh.
5. **Annotations + smart collections** — shared query layer.
6. **CLI.**
7. **Export + send-to-device.**
8. **OPDS server.**
9. **Calibre import.**

## 9. Success criteria

- Installed size **<30MB** (target ~17MB).
- Cold start to library view: **<500ms** at 10,000 books.
- Idle memory: **<150MB**.
- Import 1,000 EPUBs: **<60s**.
- FTS across 10,000 books: **<100ms**.
- Calibre migrant productive in **10 minutes**.

## 10. Deferred / never

**Later:** MTP, email-to-Kindle, statistics, multi-library, plugin API, mobile OPDS client, audiobook, scanned-PDF OCR.

**Never:** RSS-to-epub, book editor, DRM removal, in-app store, cloud account, social features, native PDF reading.

## 11. Open decisions

- Default library location: `~/Books` vs `~/Documents/Atlas` vs user-picked on first run.
- License: MIT vs AGPL.
- Distribution: Homebrew + winget + Flathub — pick ≥2 for v1.
- Pricing: free/OSS by default.

**Resolved:** pandoc is **detect-and-prompt**, not bundled.
