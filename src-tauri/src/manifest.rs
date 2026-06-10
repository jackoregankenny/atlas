// Vault manifest — the portable, file-over-app source of truth.
//
// See docs/VAULTS.md for the design. This module owns:
//   * the on-disk JSON schema (serde types below)
//   * snapshotting from SQLite into the manifest
//   * atomic writes that are safe to drop into cloud-synced folders
//
// Read-back / merge happens in phase 2 (see roadmap). For phase 1 the
// manifest is write-only — we produce it so users can see the file and
// validate the schema before anything depends on parsing it.

use crate::db::DbPool;
use crate::error::{AtlasError, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Current manifest schema version. Bump deliberately, with a written
/// migration in docs/VAULTS.md. Reading newer-than-known versions is
/// allowed (forward-compat); unknown fields are preserved via
/// `#[serde(flatten)] extra`.
pub const MANIFEST_VERSION: u32 = 1;

/// `.atlas/library.json` inside the vault.
pub fn manifest_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".atlas").join("library.json")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub vault_id: String,
    /// Keyed by content_hash. BTreeMap so output is deterministic — diff-
    /// friendly for users keeping their vault in git.
    pub books: BTreeMap<String, BookEntry>,
    #[serde(default)]
    pub collections: Vec<CollectionEntry>,
    /// Anything from a future schema we don't recognise. Round-trips on
    /// write so newer Atlases don't silently drop data when an older
    /// build saves the manifest.
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BookEntry {
    /// Path of the canonical file, relative to the vault root, forward
    /// slashes always. Survives macOS↔Windows moves.
    pub file: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title_sort: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_index: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pub_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Cover path, relative to vault root if we managed to place it
    /// there; absent otherwise (covers are re-derivable from the epub).
    /// Phase 5 will migrate all covers into `.atlas/covers/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    pub added_at: String,
    /// Drives last-write-wins per-record merge during conflict resolution.
    pub updated_at: String,
    /// "unread" | "reading" | "finished" — denormalised mirror of the
    /// progress/finished_at signals so the file reads naturally.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_cfi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Collection names this book belongs to. Names not ids — ids are
    /// local rowids and meaningless across devices.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<String>,
    /// Reader highlights for this book. Sorted by created_at for
    /// stable diffs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub highlights: Vec<HighlightEntry>,
    /// Tombstones for highlights deleted on some device. The reconcile
    /// path replays these so deletes propagate across the vault.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_highlights: Vec<HighlightTombstone>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HighlightEntry {
    pub uuid: String,
    pub cfi_range: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub color: String,
    pub created_at: String,
    /// Per-record clock for last-write-wins merge.
    pub updated_at: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HighlightTombstone {
    pub uuid: String,
    pub deleted_at: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

// ─── snapshot from SQLite ────────────────────────────────────────────

pub fn snapshot_from_db(pool: &DbPool, vault_root: &Path) -> Result<Manifest> {
    let conn = pool.get()?;

    let vault_id = ensure_vault_id(&conn)?;

    // Collections first — we'll need a id→name map when serialising books.
    let mut collections: Vec<CollectionEntry> = Vec::new();
    let mut collection_name_by_id: BTreeMap<i64, String> = BTreeMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, name FROM collections ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, name) = row?;
            collection_name_by_id.insert(id, name.clone());
            collections.push(CollectionEntry {
                name,
                created_at: None,
                extra: BTreeMap::new(),
            });
        }
    }

    // Prefetch all highlights once, grouped by book_id. Avoids N+1
    // when serialising large libraries.
    let mut highlights_by_book: BTreeMap<i64, Vec<HighlightEntry>> = BTreeMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT book_id, uuid, cfi_range, text, note, color, created_at, updated_at
               FROM highlights
              ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                HighlightEntry {
                    uuid: r.get(1)?,
                    cfi_range: r.get(2)?,
                    text: r.get(3)?,
                    note: r.get(4)?,
                    color: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    extra: BTreeMap::new(),
                },
            ))
        })?;
        for row in rows {
            let (bid, h) = row?;
            highlights_by_book.entry(bid).or_default().push(h);
        }
    }

    // Tombstones are addressed by book_hash rather than book_id — the
    // book row might not exist anymore. Grouped by hash for direct
    // lookup when we know the book's content_hash below.
    let mut tombstones_by_hash: BTreeMap<String, Vec<HighlightTombstone>> = BTreeMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT book_hash, uuid, deleted_at FROM highlight_tombstones ORDER BY deleted_at",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                HighlightTombstone {
                    uuid: r.get(1)?,
                    deleted_at: r.get(2)?,
                    extra: BTreeMap::new(),
                },
            ))
        })?;
        for row in rows {
            let (hash, t) = row?;
            if hash.is_empty() {
                continue;
            }
            tombstones_by_hash.entry(hash).or_default().push(t);
        }
    }

    let mut books: BTreeMap<String, BookEntry> = BTreeMap::new();

    let sql = "
        SELECT b.id, b.title, b.title_sort, b.content_hash,
               b.series_index, b.cover_path, b.language, b.pub_date,
               b.added_at, b.modified_at, b.isbn, b.description,
               b.finished_at, b.rating,
               s.name AS series_name,
               (SELECT path FROM files WHERE book_id = b.id AND role = 'canonical' LIMIT 1) AS file_path,
               rp.percent, rp.cfi, rp.updated_at AS progress_updated_at,
               COALESCE((SELECT GROUP_CONCAT(a.name, '||')
                         FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                         WHERE ba.book_id = b.id ORDER BY ba.position), '') AS authors,
               COALESCE((SELECT GROUP_CONCAT(t.name, '||')
                         FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
                         WHERE bt.book_id = b.id ORDER BY t.name), '') AS tags,
               COALESCE((SELECT GROUP_CONCAT(cb.collection_id, '||')
                         FROM collection_books cb WHERE cb.book_id = b.id), '') AS collection_ids
        FROM books b
        LEFT JOIN series s ON s.id = b.series_id
        LEFT JOIN reading_progress rp ON rp.book_id = b.id
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        let id: i64 = r.get("id")?;
        let content_hash: Option<String> = r.get("content_hash")?;
        let title: String = r.get("title")?;
        let title_sort: String = r.get("title_sort")?;
        let series_index: Option<f64> = r.get("series_index")?;
        let cover_path: Option<String> = r.get("cover_path")?;
        let language: Option<String> = r.get("language")?;
        let pub_date: Option<String> = r.get("pub_date")?;
        let added_at: String = r.get("added_at")?;
        let modified_at: String = r.get("modified_at")?;
        let isbn: Option<String> = r.get("isbn")?;
        let description: Option<String> = r.get("description")?;
        let finished_at: Option<String> = r.get("finished_at")?;
        let rating: Option<i64> = r.get("rating")?;
        let series: Option<String> = r.get("series_name")?;
        let file_path: Option<String> = r.get("file_path")?;
        let progress_percent: Option<f64> = r.get("percent")?;
        let progress_cfi: Option<String> = r.get("cfi")?;
        let progress_updated: Option<String> = r.get("progress_updated_at")?;
        let authors_s: String = r.get("authors")?;
        let tags_s: String = r.get("tags")?;
        let coll_ids_s: String = r.get("collection_ids")?;
        Ok(BookSnapshotRow {
            id,
            content_hash,
            title,
            title_sort,
            series_index,
            cover_path,
            language,
            pub_date,
            added_at,
            modified_at,
            isbn,
            description,
            finished_at,
            rating,
            series,
            file_path,
            progress_percent,
            progress_cfi,
            progress_updated,
            authors_s,
            tags_s,
            coll_ids_s,
        })
    })?;

    for row in rows {
        let row = row?;
        let Some(hash) = row.content_hash else { continue };

        let authors = split_pipe(&row.authors_s);
        let tags = split_pipe(&row.tags_s);
        let collections = split_pipe(&row.coll_ids_s)
            .into_iter()
            .filter_map(|s| s.parse::<i64>().ok())
            .filter_map(|id| collection_name_by_id.get(&id).cloned())
            .collect();

        let file = match row.file_path.as_deref() {
            Some(p) => relativise(vault_root, Path::new(p)),
            None => String::new(),
        };
        let cover = row
            .cover_path
            .as_deref()
            .and_then(|p| Path::new(p).strip_prefix(vault_root).ok())
            .map(|p| posix(p));

        // updated_at: the most recent of book.modified_at and progress.updated_at.
        // This is what conflict resolution uses to pick a winner per record.
        let updated_at = max_ts(&row.modified_at, row.progress_updated.as_deref())
            .unwrap_or(row.modified_at.clone());

        let status = if row.finished_at.is_some() {
            "finished"
        } else if row.progress_percent.unwrap_or(0.0) > 0.5 {
            "reading"
        } else {
            "unread"
        }
        .to_string();

        let highlights = highlights_by_book.remove(&row.id).unwrap_or_default();
        let deleted_highlights = tombstones_by_hash.remove(&hash).unwrap_or_default();

        books.insert(
            hash,
            BookEntry {
                file,
                title: row.title,
                title_sort: row.title_sort,
                authors,
                series: row.series,
                series_index: row.series_index,
                isbn: row.isbn,
                pub_date: row.pub_date,
                language: row.language,
                description: row.description,
                cover,
                added_at: row.added_at,
                updated_at,
                status,
                progress_cfi: row.progress_cfi,
                progress_percent: row.progress_percent,
                finished_at: row.finished_at,
                rating: row.rating,
                tags,
                collections,
                highlights,
                deleted_highlights,
                extra: BTreeMap::new(),
            },
        );
    }

    Ok(Manifest {
        version: MANIFEST_VERSION,
        vault_id,
        books,
        collections,
        extra: BTreeMap::new(),
    })
}

struct BookSnapshotRow {
    id: i64,
    content_hash: Option<String>,
    title: String,
    title_sort: String,
    series_index: Option<f64>,
    cover_path: Option<String>,
    language: Option<String>,
    pub_date: Option<String>,
    added_at: String,
    modified_at: String,
    isbn: Option<String>,
    description: Option<String>,
    finished_at: Option<String>,
    rating: Option<i64>,
    series: Option<String>,
    file_path: Option<String>,
    progress_percent: Option<f64>,
    progress_cfi: Option<String>,
    progress_updated: Option<String>,
    authors_s: String,
    tags_s: String,
    coll_ids_s: String,
}

fn split_pipe(s: &str) -> Vec<String> {
    if s.is_empty() {
        Vec::new()
    } else {
        s.split("||").map(|x| x.to_string()).collect()
    }
}

fn posix(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn relativise(vault_root: &Path, p: &Path) -> String {
    p.strip_prefix(vault_root)
        .map(posix)
        .unwrap_or_else(|_| p.to_string_lossy().into_owned())
}

fn max_ts(a: &str, b: Option<&str>) -> Option<String> {
    match b {
        Some(b) if b > a => Some(b.to_string()),
        _ => Some(a.to_string()),
    }
}

fn ensure_vault_id(conn: &rusqlite::Connection) -> Result<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'vault_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    // Tiny generator — 16 hex chars of randomness is plenty for a per-vault
    // id, and dodging the `uuid` crate keeps the dep footprint flat.
    let id = random_hex(16);
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('vault_id', ?1)",
        [&id],
    )?;
    Ok(id)
}

fn random_hex(len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Two sources of entropy mixed cheaply: clock + a hash of process state.
    let pid = std::process::id() as u128;
    let mix = now
        .wrapping_mul(0x9E3779B97F4A7C15)
        .wrapping_add(pid.wrapping_mul(0xBF58476D1CE4E5B9));
    let bytes = mix.to_le_bytes();
    let s = hex::encode(bytes);
    s[..len.min(s.len())].to_string()
}

// ─── atomic write ────────────────────────────────────────────────────

/// Write the manifest atomically. Strategy: serialise to `<path>.tmp`,
/// fsync it, then rename into place. Cloud-sync clients (iCloud,
/// Dropbox) only ever see the final file, never a half-written one.
pub fn save_atomic(manifest: &Manifest, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = match path.extension() {
        Some(ext) => path.with_extension(format!("{}.tmp", ext.to_string_lossy())),
        None => path.with_extension("tmp"),
    };
    {
        let mut f = std::fs::File::create(&tmp)?;
        let json = serde_json::to_vec_pretty(manifest)?;
        f.write_all(&json)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Convenience: snapshot the current DB state and write the manifest if
/// none exists. Pre-existing manifests are left alone — phase 2 will own
/// the merge story. Returns true if we wrote a fresh manifest.
pub fn ensure_manifest_exists(pool: &DbPool, vault_root: &Path) -> Result<bool> {
    let path = manifest_path(vault_root);
    if path.exists() {
        return Ok(false);
    }
    let manifest = snapshot_from_db(pool, vault_root)?;
    save_atomic(&manifest, &path)?;
    Ok(true)
}

/// Force a snapshot regardless of whether the manifest exists. Used by
/// the manual export command for testing the round-trip.
pub fn write_snapshot(pool: &DbPool, vault_root: &Path) -> Result<PathBuf> {
    let manifest = snapshot_from_db(pool, vault_root)?;
    let path = manifest_path(vault_root);
    save_atomic(&manifest, &path)?;
    Ok(path)
}

// ─── read & reconcile (manifest → SQLite overlay) ────────────────────

#[derive(Debug, Default, serde::Serialize)]
pub struct ReconcileReport {
    /// Books whose mutable state was overwritten by manifest entries
    /// (because the manifest's updated_at was newer).
    pub updated: u32,
    /// Manifest entries whose content_hash isn't in the local library.
    /// Usually means the user hasn't imported the file on this device yet.
    pub unknown: u32,
    /// Local books with no matching manifest entry. Will get written into
    /// the manifest by the next flush.
    pub local_only: u32,
    /// Collections created from the manifest that didn't exist locally.
    pub collections_created: u32,
    /// Highlights inserted, updated, or deleted (via tombstone) by this
    /// reconcile pass.
    pub highlights_changed: u32,
}

pub fn load(path: &Path) -> Result<Option<Manifest>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)?;
    let m: Manifest = serde_json::from_slice(&bytes)?;
    Ok(Some(m))
}

/// Read the vault manifest and fold any newer-than-local changes into
/// SQLite. Mtime-gated: skips entirely if the file hasn't changed since
/// the last successful reconcile.
///
/// Phase 2 scope: overlays *mutable* state only (progress, rating, tags,
/// finished_at, collection membership). Inserting brand-new books from
/// the manifest is phase 2b — it needs the actual epub file on disk to
/// verify the content_hash, and that story belongs with the vault-picker
/// flow in phase 3.
pub fn reconcile_on_startup(pool: &DbPool, vault_root: &Path) -> Result<Option<ReconcileReport>> {
    let path = manifest_path(vault_root);
    let Some(file_mtime) = file_mtime_secs(&path) else {
        return Ok(None);
    };

    let conn = pool.get()?;
    let last_seen: Option<i64> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'last_manifest_mtime'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .and_then(|s| s.parse().ok());

    if let Some(last) = last_seen {
        if file_mtime <= last {
            tracing::debug!("manifest unchanged since last reconcile, skipping");
            return Ok(None);
        }
    }

    let Some(manifest) = load(&path)? else {
        return Ok(None);
    };

    let report = apply_manifest(&conn, &manifest)?;
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('last_manifest_mtime', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&file_mtime.to_string()],
    )?;
    Ok(Some(report))
}

fn apply_manifest(
    conn: &rusqlite::Connection,
    manifest: &Manifest,
) -> Result<ReconcileReport> {
    let mut report = ReconcileReport::default();

    // Ensure all manifest collections exist locally. Names are the
    // portable identity — local rowids are opaque per device.
    let mut collection_id_by_name: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, name FROM collections")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, name) = row?;
            collection_id_by_name.insert(name, id);
        }
    }
    for c in &manifest.collections {
        if !collection_id_by_name.contains_key(&c.name) {
            conn.execute(
                "INSERT INTO collections (name, kind) VALUES (?1, 'manual')",
                [&c.name],
            )?;
            collection_id_by_name.insert(c.name.clone(), conn.last_insert_rowid());
            report.collections_created += 1;
        }
    }

    // Build the local book lookup once: hash → (id, modified_at, progress_updated).
    let mut local_books: BTreeMap<String, LocalBookState> = BTreeMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT b.content_hash, b.id, b.modified_at, rp.updated_at
             FROM books b
             LEFT JOIN reading_progress rp ON rp.book_id = b.id
             WHERE b.content_hash IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                LocalBookState {
                    id: r.get(1)?,
                    modified_at: r.get(2)?,
                    progress_updated_at: r.get(3)?,
                },
            ))
        })?;
        for row in rows {
            let (hash, st) = row?;
            local_books.insert(hash, st);
        }
    }

    for (hash, entry) in &manifest.books {
        let Some(local) = local_books.get(hash) else {
            report.unknown += 1;
            continue;
        };

        // Only overwrite if the manifest record is newer than the local one.
        // Per-record updated_at is what makes the merge story conflict-safe.
        let manifest_newer = entry.updated_at > local.modified_at;
        let manifest_progress_newer = match local.progress_updated_at.as_deref() {
            Some(local_pu) => entry.updated_at > local_pu.to_string(),
            None => entry.progress_cfi.is_some() || entry.progress_percent.is_some(),
        };

        if manifest_newer {
            apply_mutable_fields(conn, local.id, hash, entry, &collection_id_by_name)?;
            report.updated += 1;
        }

        if manifest_progress_newer
            && (entry.progress_cfi.is_some() || entry.progress_percent.is_some())
        {
            conn.execute(
                "INSERT INTO reading_progress (book_id, cfi, percent, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(book_id) DO UPDATE SET
                    cfi = excluded.cfi,
                    percent = excluded.percent,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    local.id,
                    entry.progress_cfi.clone().unwrap_or_default(),
                    entry.progress_percent.unwrap_or(0.0),
                    entry.updated_at,
                ],
            )?;
        }

        // Highlights & tombstones: each carries its own updated_at, so
        // run them independently of the parent book's clock. Worst case
        // the per-uuid query says "local is newer, skip" — cheap.
        for h in &entry.highlights {
            if reconcile_highlight(conn, local.id, h)? {
                report.highlights_changed += 1;
            }
        }
        for t in &entry.deleted_highlights {
            if reconcile_tombstone(conn, hash, t)? {
                report.highlights_changed += 1;
            }
        }
    }

    // Count books we have locally but the manifest doesn't mention. They
    // become "local_only" — perfectly fine, the next flush will pick them
    // up. Useful for the toast: "12 new books on this device → manifest".
    for hash in local_books.keys() {
        if !manifest.books.contains_key(hash) {
            report.local_only += 1;
        }
    }

    Ok(report)
}

struct LocalBookState {
    id: i64,
    modified_at: String,
    progress_updated_at: Option<String>,
}

fn apply_mutable_fields(
    conn: &rusqlite::Connection,
    book_id: i64,
    _content_hash: &str,
    entry: &BookEntry,
    collection_id_by_name: &BTreeMap<String, i64>,
) -> Result<()> {
    // rating + finished_at + modified_at
    conn.execute(
        "UPDATE books
            SET rating = ?1,
                finished_at = ?2,
                modified_at = ?3
          WHERE id = ?4",
        rusqlite::params![entry.rating, entry.finished_at, entry.updated_at, book_id],
    )?;

    // Tags: replace the set. Manifest is the truth.
    conn.execute("DELETE FROM book_tags WHERE book_id = ?1", [book_id])?;
    for tag in &entry.tags {
        let t = tag.trim();
        if t.is_empty() {
            continue;
        }
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&t])?;
        let tid: i64 = conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            [&t],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![book_id, tid],
        )?;
    }

    // Collection memberships: also replace.
    conn.execute(
        "DELETE FROM collection_books WHERE book_id = ?1",
        [book_id],
    )?;
    for name in &entry.collections {
        if let Some(cid) = collection_id_by_name.get(name) {
            conn.execute(
                "INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?1, ?2)",
                rusqlite::params![cid, book_id],
            )?;
        }
    }

    Ok(())
}

/// Apply one incoming highlight against local state.
/// Returns true if we wrote something.
///   * Local tombstone for this uuid → no-op (already deleted here).
///   * No local row → insert.
///   * Local row newer or equal → no-op.
///   * Local row older → update.
fn reconcile_highlight(
    conn: &rusqlite::Connection,
    book_id: i64,
    h: &HighlightEntry,
) -> Result<bool> {
    let tombstoned: bool = conn
        .query_row(
            "SELECT 1 FROM highlight_tombstones WHERE uuid = ?1",
            [&h.uuid],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if tombstoned {
        return Ok(false);
    }

    let local_updated: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM highlights WHERE uuid = ?1",
            [&h.uuid],
            |r| r.get(0),
        )
        .optional()?;
    match local_updated.as_deref() {
        Some(local) if h.updated_at.as_str() <= local => Ok(false),
        Some(_) => {
            conn.execute(
                "UPDATE highlights
                    SET cfi_range = ?1, text = ?2, note = ?3,
                        color = ?4, updated_at = ?5
                  WHERE uuid = ?6",
                rusqlite::params![
                    h.cfi_range, h.text, h.note, h.color, h.updated_at, h.uuid
                ],
            )?;
            Ok(true)
        }
        None => {
            conn.execute(
                "INSERT INTO highlights
                    (uuid, book_id, cfi_range, text, note, color, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    h.uuid, book_id, h.cfi_range, h.text, h.note, h.color,
                    h.created_at, h.updated_at
                ],
            )?;
            Ok(true)
        }
    }
}

/// Replay an incoming tombstone: record it locally (idempotent) and
/// delete the live row if one still exists. Returns true on first
/// application, false on a duplicate replay.
fn reconcile_tombstone(
    conn: &rusqlite::Connection,
    book_hash: &str,
    t: &HighlightTombstone,
) -> Result<bool> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM highlight_tombstones WHERE uuid = ?1",
            [&t.uuid],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if exists {
        // The live row might still exist if a previous reconcile crashed
        // between the tombstone insert and the delete. Defend against it.
        conn.execute("DELETE FROM highlights WHERE uuid = ?1", [&t.uuid])?;
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO highlight_tombstones (uuid, book_hash, deleted_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![t.uuid, book_hash, t.deleted_at],
    )?;
    conn.execute("DELETE FROM highlights WHERE uuid = ?1", [&t.uuid])?;
    Ok(true)
}

fn file_mtime_secs(path: &Path) -> Option<i64> {
    let md = std::fs::metadata(path).ok()?;
    let mtime = md.modified().ok()?;
    let dur = mtime.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_secs() as i64)
}

// ─── flush & writer task ─────────────────────────────────────────────

/// Synchronous flush: snapshot from DB and atomically write the manifest,
/// then record the new mtime in `meta` so the next startup's reconcile
/// can skip the parse. Safe to call from anywhere, including shutdown.
pub fn flush(pool: &DbPool, vault_root: &Path) -> Result<()> {
    let manifest = snapshot_from_db(pool, vault_root)?;
    let path = manifest_path(vault_root);
    save_atomic(&manifest, &path)?;
    if let Some(mtime) = file_mtime_secs(&path) {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('last_manifest_mtime', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&mtime.to_string()],
        )?;
    }
    Ok(())
}

/// Why a flush was requested. The kind only changes the debounce window;
/// once the timer fires, every dirty bit gets flushed together.
#[derive(Debug, Clone, Copy)]
pub enum DirtyKind {
    /// Default. Tags, rating, finished, collections, imports. 500ms.
    Normal,
    /// Reading progress. Can fire on every page turn — wait longer so
    /// we don't repeatedly rewrite a 10 MB JSON during a long reading
    /// session. Flushes on reader close anyway.
    Progress,
}

impl DirtyKind {
    fn debounce(self) -> std::time::Duration {
        match self {
            DirtyKind::Normal => std::time::Duration::from_millis(500),
            DirtyKind::Progress => std::time::Duration::from_secs(5),
        }
    }
}

/// Cheap clonable handle. Each mutation command calls `.touch(...)`;
/// the spawned task coalesces bursts and writes one manifest per quiet
/// window.
#[derive(Clone)]
pub struct ManifestWriter {
    tx: tokio::sync::mpsc::UnboundedSender<DirtyKind>,
}

impl ManifestWriter {
    pub fn spawn(pool: DbPool, vault_root: PathBuf) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<DirtyKind>();

        tauri::async_runtime::spawn(async move {
            // The earliest moment at which we should flush. `None` = idle.
            // Shorter debounces win — a Progress ping does not push a
            // pending Normal flush further out.
            let mut deadline: Option<tokio::time::Instant> = None;

            loop {
                let sleep_dur = deadline
                    .map(|d| d.saturating_duration_since(tokio::time::Instant::now()))
                    .unwrap_or_else(|| std::time::Duration::from_secs(60 * 60));

                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            None => break, // channel closed → app exiting
                            Some(kind) => {
                                let new = tokio::time::Instant::now() + kind.debounce();
                                deadline = Some(match deadline {
                                    Some(existing) => existing.min(new),
                                    None => new,
                                });
                            }
                        }
                    }
                    _ = tokio::time::sleep(sleep_dur), if deadline.is_some() => {
                        deadline = None;
                        let pool = pool.clone();
                        let root = vault_root.clone();
                        // Move the actual file write off the async runtime —
                        // sqlite + fs are blocking, and we don't want to
                        // wedge other Tauri tasks during the flush.
                        tauri::async_runtime::spawn_blocking(move || {
                            if let Err(e) = flush(&pool, &root) {
                                tracing::warn!("manifest flush failed: {e}");
                            } else {
                                tracing::debug!("manifest flushed");
                            }
                        });
                    }
                }
            }
        });

        ManifestWriter { tx }
    }

    pub fn touch(&self, kind: DirtyKind) {
        // Send failures only happen after shutdown — the channel is
        // unbounded, so backpressure isn't a concern.
        let _ = self.tx.send(kind);
    }
}

// AtlasError is referenced via `?` in this module; the explicit import
// silences the "unused" complaint.
#[allow(dead_code)]
fn _unused(_e: AtlasError) {}

/// Vault bootstrap, shared by app startup and live vault switches (see
/// docs/VAULTS.md):
///   1. GC highlight delete tombstones older than 90 days.
///   2. If no manifest exists in `root`, snapshot the current DB into one.
///   3. Otherwise, reconcile newer-than-local entries into SQLite and emit
///      `library-updated` so the UI refreshes any deltas.
/// All off the main thread so a slow disk never blocks the caller.
pub fn bootstrap_in_background(
    pool: DbPool,
    root: std::path::PathBuf,
    app_handle: tauri::AppHandle,
) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        if let Err(e) = crate::library::gc_highlight_tombstones(&pool, 90) {
            tracing::debug!("tombstone gc failed: {e}");
        }
        match ensure_manifest_exists(&pool, &root) {
            Ok(true) => tracing::info!(
                "wrote initial vault manifest at {}",
                manifest_path(&root).display()
            ),
            Ok(false) => match reconcile_on_startup(&pool, &root) {
                Ok(Some(report)) => {
                    tracing::info!(
                        "vault reconcile: {} updated, {} unknown, {} local-only, {} collections",
                        report.updated,
                        report.unknown,
                        report.local_only,
                        report.collections_created,
                    );
                    if report.updated > 0 || report.collections_created > 0 {
                        let _ = app_handle.emit("library-updated", &report);
                    }
                }
                Ok(None) => tracing::debug!("vault manifest unchanged"),
                Err(e) => tracing::warn!("vault reconcile failed: {e}"),
            },
            Err(e) => tracing::warn!("manifest snapshot failed: {e}"),
        }
    });
}
