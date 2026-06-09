# Atlas

A local-first ebook library manager and reader. EPUB-native. Under 30MB. The anti-Calibre.

Atlas treats EPUB as the canonical format for digital books. Other formats are inputs to be
converted, not first-class citizens — which keeps the binary small, the reader simple, and the
typography good. It's built for people who own e-readers, care about their books, and have
outgrown Calibre's UI but still need its functionality.

> Status: **early, but real.** The library, reader, enrichment, annotations, and send-to-device
> paths work today. See [STATUS.md](STATUS.md) for a feature-by-feature breakdown against the
> [brief](BRIEF.md), and [FEATURES.md](FEATURES.md) for design sketches of what's next.

## What works today

- **Library** — drag-and-drop / file-picker import, SHA-256 dedup, cover extraction, grid / compact / list views, sort & filter, tags, collections, read-status tracking, ratings.
- **Reader** — paginated + scrolling modes, light / sepia / dark themes, keyboard navigation, per-book CFI progress (`epub.js` today, `foliate-js` planned).
- **Metadata enrichment** — Open Library by ISBN with search fallback, cached responses, full manual editing, custom cover replacement.
- **Annotations** — CFI-addressed highlights with notes and five colors.
- **Send to device** — auto-detects Kindle / Kobo over USB and copies the canonical EPUB across.
- **Portable vaults** — `.atlas/library.json` manifest lets a library round-trip across devices without a server.

## Tech stack

- **Shell:** Tauri 2
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (SQLite via `rusqlite` + `r2d2` pool, WAL, migration runner)
- **Reader:** `epub.js` in the webview (`foliate-js` swap planned)

## Development

Prerequisites: [Rust](https://rustup.rs/), [Node](https://nodejs.org/) + [pnpm](https://pnpm.io/),
and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
pnpm install        # install frontend deps
pnpm tauri dev      # run the app in development
pnpm tauri build    # produce a release bundle
```

## Roadmap

The big near-term items, roughly in priority order (full detail in [STATUS.md](STATUS.md)):

1. Pandoc detect-and-prompt → non-EPUB import + AZW3/PDF/MD export
2. Calibre library import (`metadata.db` + folder walk)
3. Kepubify export wired through for Kobo
4. OPDS 1.2 server (Axum, off by default)
5. Tantivy full-text search across EPUB text + metadata
6. `atlas` CLI (`import | list | show | convert | send | enrich | serve | search`)

## License

[AGPL-3.0-or-later](LICENSE).
