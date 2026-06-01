# Atlas — v1 progress vs. brief

Mapped against [BRIEF.md](BRIEF.md) §6 (v1 feature scope) and §3 (technical foundation).

Legend: ✅ done · 🟡 partial · ⬜ not started · ❌ deferred / out-of-scope for v1

---

## §3 Technical foundation

| | Status | Notes |
|---|---|---|
| Tauri 2 shell | ✅ | macOS dev verified |
| React + TS + Vite | ✅ | |
| Rust core | ✅ | r2d2 pool, async commands |
| SQLite metadata | ✅ | WAL, schema + migration runner |
| Tantivy FTS | ⬜ | client-side substring filter only so far |
| foliate-js reader | 🟡 | **epubjs in use** — same component contract, swap planned |
| pandoc detect-and-prompt | ⬜ | not wired yet |
| kepubify bundled | ⬜ | not wired yet |

---

## §6.1 Library management

| | Status | Notes |
|---|---|---|
| Drag-and-drop import | ✅ | full-window overlay |
| File picker import | ✅ | Files / Folder via popover |
| Watch folder | ⬜ | three modes (index-in-place / copy / copy-and-organize) — not built |
| Hash-based dedup | ✅ | SHA-256 of file bytes, `content_hash` UNIQUE |
| Cover extraction from EPUB OPF | ✅ | namespaced + non-self-closing tags + heuristic fallback |
| Bulk operations | 🟡 | "Enrich missing" batch only |

---

## §6.2 Import pipeline

| | Status | Notes |
|---|---|---|
| EPUB native | ✅ | |
| PDF → EPUB (text) | ⬜ | |
| PDF → EPUB (scanned, refuse) | ⬜ | |
| mobi / azw3 → EPUB via pandoc | ⬜ | |
| docx / html / md → EPUB via pandoc | ⬜ | |
| Original kept as sidecar | ⬜ | schema supports `role='original'`; no producer yet |

---

## §6.3 Metadata enrichment

| | Status | Notes |
|---|---|---|
| Open Library by ISBN | ✅ | primary |
| Open Library search fallback | ✅ | title + first author |
| Google Books fallback | ⬜ | |
| Cached responses | ✅ | `enrichment_cache` table, 30-day TTL |
| Manual editing | ✅ | full edit-metadata modal + `manual_fields` JSON guards enrich |
| Custom cover replacement | ✅ | CoverPicker with file / URL / Open Library candidates |
| "Identify" disambiguation panel | ⬜ | |
| Series detection (OPF → ISBN → filename) | 🟡 | OPF only |
| Cover refresh | ✅ | local re-extract + Open Library cover URL |

---

## §6.4 Reading

| | Status | Notes |
|---|---|---|
| Renderer | ✅ | epubjs (foliate-js swap planned) |
| Paginated mode | ✅ | |
| Scrolling mode | ✅ | per-book flow toggle |
| Font + size + line height + margins | 🟡 | font size + flow only |
| Theme: light / sepia / dark | ✅ | |
| Theme overrides publisher CSS | 🟡 | colors yes, full structural pass not audited |
| Keyboard navigation | ✅ | arrows, j/k, space, PageUp/Dn, Esc |
| Vim keys optional | ❌ | always on for now |
| Progress saving (CFI) | ✅ | per-relocate; "Continue · NN%" on detail |
| Per-book rating (1–5) | ✅ | sortable, settable from detail panel |

---

## §6.5 Annotations

| | Status | Notes |
|---|---|---|
| CFI-addressed highlights | ✅ | epub.js range CFIs, vault-portable UUIDs |
| Notes per highlight | ✅ | |
| Five colors | ✅ | floating toolbar in reader |
| Cross-library search | ⬜ | per-book panel only; no global view yet |
| Export as Markdown (Readwise format) | ⬜ | |
| Export as JSON | ⬜ | partially via vault manifest |

---

## §6.6 Smart collections

| | Status | Notes |
|---|---|---|
| JSON AST → SQL | ⬜ | |
| Filter-chip UI | ⬜ | |
| Manual collections | ✅ | folders sidebar, add/remove, rename/delete |

---

## §6.7 Export & send-to-device

| | Status | Notes |
|---|---|---|
| Export to kepub | ⬜ | needs kepubify binary wired (placeholder in menu) |
| Export to azw3 | ⬜ | needs pandoc |
| Export to PDF / md / docx | ⬜ | needs pandoc |
| Auto-detect Kindle via USB | ✅ | mass-storage volume probing |
| Auto-detect Kobo via USB | ✅ | |
| Send EPUB to device | ✅ | copies canonical file to device's Documents/Books dir |
| Send with auto-conversion | ⬜ | depends on conversion pipeline |
| Per-device profile | ⬜ | |
| MTP | ❌ | brief defers |
| Email-to-Kindle | ❌ | brief defers |

---

## §6.8 OPDS server

| | Status | Notes |
|---|---|---|
| Axum server | ⬜ | |
| OPDS 1.2 navigation feed | ⬜ | |
| OPDS 1.2 acquisition feed | ⬜ | |
| Optional HTTP Basic auth | ⬜ | |
| Off by default | n/a | |

---

## §6.9 CLI

`atlas import | list | show | convert | send | enrich | serve | search` — **not started**. Will live as a separate `atlas-cli` binary in `src-tauri/` workspace once `atlas-core` is extracted.

---

## §6.10 Search

| | Status | Notes |
|---|---|---|
| Tantivy over EPUB text | ⬜ | |
| Tantivy over metadata | ⬜ | |
| Snippets in results | ⬜ | |
| Client-side substring filter | ✅ | covers title / authors / series — fine until library grows |
| Cmd+K palette | ✅ | scoped fuzzy across metadata |

---

## §6.11 Calibre import

| | Status | Notes |
|---|---|---|
| Read `metadata.db` | ⬜ | |
| Walk library folder | ⬜ | |
| Map tags / series / authors | ⬜ | |
| EPUBs → canonical, others → sidecar/convert | ⬜ | |

---

## Beyond the brief — shipped polish

These weren't in §6 but landed during build-out:

- Read status tracking (Unread / Reading / Finished) with cover badge, sidebar filter, Mark-as-read toggle.
- Tags UI (chips on detail, sidebar list with counts, click-to-filter).
- Author and series click-through filters; clickable in cards and detail panel.
- View modes: Grid, Compact, List with persisted preference.
- Sort menu: Title / Author / Recently added / Year / Reading progress / Rating, asc/desc.
- Light theme + system-follow option, persisted.
- Keyboard shortcuts: `?`, `⌘K`, `/`, `g l`, `g s`, `v`, `t`, `⌘I`, `⌘⇧I`, etc. + overlay.
- Code-split reader (epubjs lazy-loaded — main bundle 248KB gzip 78KB).
- View Transitions API for grid↔list crossfade.
- Generic Popover (portaled) + Menu primitives.
- Toast stack with success/error/info variants.
- Cover image fade-in + shimmer skeleton.
- Command palette with fuzzy scoring + keyboard nav + cover thumbnails.
- Vault manifest (.atlas/library.json) with debounced writeback + startup reconcile — lets a single library round-trip across devices without a server.
- Highlight tombstones with 90-day GC for cross-device delete propagation.

---

## Still missing (the actual punch list)

Grouped roughly by effort. See [FEATURES.md](FEATURES.md) for full design sketches.

**Small**
- `atlas://` URL scheme + Copy book link (§12)
- Open original sidecar action (§11) — needs sidecar producer first
- Kepubify export wired through (§4)
- OPDS server (§6)

**Medium**
- Pandoc detect-and-prompt + non-EPUB import (§3)
- Calibre library import (§7)
- Reading sessions / stats (§15)
- Global annotations view + Markdown export (§2 stretch)

**Large**
- Tantivy full-text search (§1)
- CLI binary (§8) — gated on atlas-core workspace split

---

## Recommended next-up order

1. **Edit metadata + Open original + Copy book link** — small UI surface, unblocks the disabled context-menu items.
2. **Kepubify export** — small binary sidecar, lights up the first row of "Convert to".
3. **Pandoc integration** — unblocks non-EPUB imports and AZW3/PDF/MD exports.
4. **Calibre import** — biggest single migration trigger for the target audience.
5. **OPDS server** — small, isolated, demoable.
6. **`atlas://` URL scheme** — small, but needs deep-link + single-instance plugins.
7. **Reading sessions / stats** — distinguishing feature.
8. **Tantivy FTS** — once libraries grow past a few hundred books.
9. **atlas-core workspace split + CLI** — last because it benefits from a settled core API.

Deferred per brief §10 (later/never) unchanged.
