# Atlas Vaults

> File over app. Your library is a folder. Atlas is just a window onto it.

## Why

Reading apps lock you in. Your progress, ratings, tags, and collections live
in some app-private database that travels nowhere. Lose the app, lose the
metadata. Open the library on a second machine, start over.

Obsidian solved this for notes by making the **vault** — a plain folder — the
unit of truth, and pushing sync onto whatever the user already uses (iCloud,
Dropbox, Syncthing). Atlas does the same for books.

## The contract

Everything Atlas knows that isn't a book file is either (a) **portable** —
inside the vault, synced — or (b) **device-local** — derived cache that can
be deleted at any time.

```
<vault>/                          ← user picks this; defaults to ~/Documents/Atlas
├── Books/
│   ├── <Author> - <Title>.epub   ← canonical files Atlas imports into the vault
│   └── …
└── .atlas/
    ├── library.json              ← THE source of truth (synced)
    ├── settings.json             ← per-vault prefs (synced)
    ├── covers/                   ← extracted cover images (synced — cheap, deterministic)
    └── conflicts/                ← quarantined conflict copies, for recovery

~/Library/Application Support/Atlas/   (device-local, never synced)
├── vaults.json                   ← known vault paths, last-opened first
├── cache.db                      ← SQLite, derived from library.json
└── prefs.json                    ← device-only (window size, dev flags)
```

**Rule of thumb**: if a thing exists in the vault, treat the file as truth.
If a thing exists only in the cache, it can be rebuilt for free.

## Identity

A book's identity is the **SHA-256 of its file content**, not its on-disk path
or a database row id. Renaming a file, moving it between folders inside the
vault, or importing the same epub on two devices independently all converge
to the same record.

The cache.db keeps integer rowids for join performance, but those are local
and meaningless across devices.

## Manifest schema (`library.json`)

Versioned. Forward-compatible — unknown fields are preserved verbatim on
write-back so a future Atlas reading an older manifest never silently drops
data.

```jsonc
{
  "version": 1,
  "vault_id": "8b3f…",            // generated once on vault creation
  "books": {
    "<sha256>": {
      "file": "Books/Le Guin - The Dispossessed.epub",
      "title": "The Dispossessed",
      "title_sort": "Dispossessed, The",
      "authors": ["Ursula K. Le Guin"],
      "series": "Hainish Cycle",
      "series_index": 5,
      "isbn": "9780061054884",
      "pub_date": "1974",
      "language": "en",
      "description": "…",
      "cover": ".atlas/covers/<sha256>.jpg",
      "added_at": "2026-01-12T14:03:22Z",
      "updated_at": "2026-05-25T09:18:44Z",
      "status": "reading",
      "progress_cfi": "epubcfi(/6/14[chap03]!/4/2/1:0)",
      "progress_percent": 42,
      "finished_at": null,
      "rating": 4,
      "tags": ["sci-fi", "favorites"],
      "collections": ["Re-read pile"]
    }
  },
  "collections": [
    { "name": "Re-read pile", "created_at": "2026-02-01T…" }
  ]
}
```

Notes:
- `file` is **relative to the vault root**, always forward-slash, so it
  survives the move from macOS to Windows.
- `updated_at` is per-record and drives conflict merging.
- Collections live as their own list; per-book membership is a denormalised
  mirror so the file is human-readable in isolation.

## Performance model

The manifest is **only touched at three moments**:

1. **Launch (cold)**: one `fs::read` + `serde_json::from_slice`. For 10k books
   the file is ~5–10 MB; <50ms on SSD. Parsed once into cache.db.
2. **Launch (warm)**: if manifest mtime ≤ `cache.db`'s last-known-manifest-mtime,
   skip the parse entirely. Warm starts are identical to today.
3. **Write**: every mutation hits cache.db immediately (UI stays instant) and
   marks a dirty flag. A debounced background task flushes the manifest
   ~500ms after the last edit via `tmp + fsync + rename` — never partial,
   safe on cloud drives.

For high-frequency mutations (progress updates while reading) the cache.db
gets every tick; the manifest flushes on reader close or 5s idle, whichever
comes first.

### Render-from-cache-while-parsing

Cold start renders the library **immediately** from cache.db; the manifest
parse happens on a background thread, and only deltas re-render via a
`library-updated` event. Skeleton shimmer is reserved for the truly first
launch (no cache yet).

## Sync & conflicts

Atlas does not sync anything itself. Users point their vault at iCloud,
Dropbox, Syncthing, a Git remote, or whatever. The contract:

- **Atomic writes** mean cloud drives never see a half-file. No torn JSON,
  ever.
- **No SQLite in the vault**. SQLite's WAL/SHM files corrupt under cloud
  sync; we keep them out of harm's way in app-data.

When two devices edit offline, the cloud drive produces a sibling like
`library (jack's Mac).json`. On launch Atlas:

1. Detects the sibling next to `library.json`.
2. Parses both, performs a **per-record last-write-wins merge** keyed by
   content_hash, using `updated_at`. Tags/collections union, then de-dup.
3. Moves the conflict copy into `.atlas/conflicts/<timestamp>.json` so the
   user can recover anything we got wrong.
4. Writes the merged manifest, surfaces a non-blocking toast:
   *"Merged 3 changes from jack's Mac."*

The conflict directory is bounded — old conflicts (>30 days) get pruned.

## First-run UX

Modelled on Obsidian's vault dialog:

```
┌─ Welcome to Atlas ─────────────────────────────┐
│  Where should Atlas keep your books?            │
│                                                 │
│  ○ Use ~/Documents/Atlas              (default) │
│  ○ Pick a folder…                               │
│  ○ Open existing vault…                         │
│                                                 │
│  ─ Found existing vaults: ──────────────────    │
│    ▸ ~/iCloud Drive/Atlas      (2 days ago)     │
│    ▸ ~/Dropbox/Atlas           (yesterday)      │
└─────────────────────────────────────────────────┘
```

Atlas scans common cloud-drive roots (iCloud Drive, Dropbox, OneDrive,
Google Drive) for any folder containing `.atlas/library.json` and offers
them as one-click options. On second device, "Open existing vault…"
points at the synced folder, the manifest loads, library appears instantly.

Command palette adds:
- **Switch vault…** — change without restart, like Obsidian.
- **Open vault in Finder** — reveal the synced folder.
- **Show conflict copies** — opens `.atlas/conflicts/`.

## Migration from pre-vault Atlas

Single-shot on upgrade:

1. Current `library_root` (e.g. `~/Documents/Atlas`) is promoted to a vault.
2. Existing SQLite is serialised into `<vault>/.atlas/library.json`.
3. cache.db is rebuilt from the manifest (proves the round-trip works).
4. Old `atlas.db` in app-data is kept for one release as `atlas.db.legacy`
   so we can roll back.

Reversible. No data loss possible.

## What this unlocks

- **Versioning**: `library.json` is diff-friendly. Put your vault in git and
  reading history becomes a free side effect.
- **Scripting**: power users can grep, batch-edit, or write external tools
  against a stable, documented schema.
- **Trust**: nothing about your library is held hostage by Atlas being
  installed, working, or even existing.
- **Multi-device**: same library on laptop, desktop, eventually tablet —
  whatever the user already pays a cloud-drive provider for.

## Roadmap

| Phase | What | Status |
|---|---|---|
| 1 | Manifest types + atomic snapshot writer wired to startup/mutations. No UI change. | in progress |
| 2 | Manifest → SQLite import on launch, mtime-skip optimisation, render-from-cache while parsing. | next |
| 3 | First-run vault picker, `vaults.json`, switch-vault command. | |
| 4 | Conflict-copy detection + per-record merge, `.atlas/conflicts/` quarantine. | |
| 5 | Auto-detection of cloud-drive vaults on first run. | |

## Non-goals

- Atlas does not implement sync. iCloud / Dropbox / Syncthing / git do that.
- The manifest is not a database. It's a portable snapshot. Queries always
  go through SQLite.
- Schemas don't drift silently. Bumping `version` is a deliberate act with
  a written migration.
