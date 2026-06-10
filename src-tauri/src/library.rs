use crate::convert;
use crate::db::DbPool;
use std::ffi::OsStr;
use crate::epub;
use crate::error::{AtlasError, Result};
use rusqlite::OptionalExtension;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct BookRow {
    pub id: i64,
    pub title: String,
    pub authors: Vec<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub cover_path: Option<String>,
    pub language: Option<String>,
    pub pub_date: Option<String>,
    pub added_at: String,
    pub file_path: Option<String>,
    pub isbn: Option<String>,
    pub description: Option<String>,
    pub progress_percent: Option<f64>,
    pub progress_cfi: Option<String>,
    pub finished_at: Option<String>,
    pub status: String,
    pub tags: Vec<String>,
    pub rating: Option<i64>,
    pub folder_ids: Vec<i64>,
    /// JSON object marking which fields the user has manually edited,
    /// e.g. `{"title": true, "description": true}`. Drives the "auto"
    /// revert pill in the edit-metadata modal and the enrich guard.
    pub manual_fields: Option<String>,
    /// True iff the book has at least one `role='original'` sidecar
    /// file. Lets the right-click menu show "Open original" as enabled
    /// only when there's actually something to open.
    pub has_original: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct ImportReport {
    pub imported: u32,
    pub skipped: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

/// `description` is the one per-book blob that can run to kilobytes. The
/// library list never renders it (the detail panel refetches via
/// `get_book`), so `list_books` selects NULL in its place to keep the
/// startup IPC payload small at large library sizes.
fn book_select(with_description: bool) -> String {
    let desc = if with_description {
        "b.description"
    } else {
        "NULL"
    };
    format!(
        "
    SELECT b.id, b.title, b.series_index, b.cover_path, b.language, b.pub_date, b.added_at,
           s.name AS series_name,
           COALESCE((SELECT GROUP_CONCAT(a.name, '||')
                     FROM book_authors ba
                     JOIN authors a ON a.id = ba.author_id
                     WHERE ba.book_id = b.id
                     ORDER BY ba.position), '') AS authors,
           (SELECT path FROM files WHERE book_id = b.id AND role = 'canonical' LIMIT 1) AS file_path,
           b.isbn, {desc} AS description,
           rp.percent, rp.cfi,
           b.finished_at,
           COALESCE((SELECT GROUP_CONCAT(t.name, '||')
                     FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
                     WHERE bt.book_id = b.id ORDER BY t.name), '') AS tags,
           b.rating,
           COALESCE((SELECT GROUP_CONCAT(cb.collection_id, '||')
                     FROM collection_books cb
                     WHERE cb.book_id = b.id), '') AS folder_ids,
           b.manual_fields,
           EXISTS(SELECT 1 FROM files WHERE book_id = b.id AND role = 'original') AS has_original
    FROM books b
    LEFT JOIN series s ON s.id = b.series_id
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
"
    )
}

fn map_book(row: &rusqlite::Row) -> rusqlite::Result<BookRow> {
    let authors_str: String = row.get(8)?;
    let authors = if authors_str.is_empty() {
        vec![]
    } else {
        authors_str.split("||").map(|s| s.to_string()).collect()
    };
    let tags_str: String = row.get(15)?;
    let tags = if tags_str.is_empty() {
        vec![]
    } else {
        tags_str.split("||").map(|s| s.to_string()).collect()
    };
    let rating: Option<i64> = row.get(16)?;
    let folder_ids_str: String = row.get(17)?;
    let folder_ids = if folder_ids_str.is_empty() {
        vec![]
    } else {
        folder_ids_str
            .split("||")
            .filter_map(|s| s.parse::<i64>().ok())
            .collect()
    };
    let progress: Option<f64> = row.get(12)?;
    let finished_at: Option<String> = row.get(14)?;
    let status = if finished_at.is_some() {
        "finished"
    } else if progress.unwrap_or(0.0) > 0.5 {
        "reading"
    } else {
        "unread"
    };
    Ok(BookRow {
        id: row.get(0)?,
        title: row.get(1)?,
        series_index: row.get(2)?,
        cover_path: row.get(3)?,
        language: row.get(4)?,
        pub_date: row.get(5)?,
        added_at: row.get(6)?,
        series: row.get(7)?,
        authors,
        file_path: row.get(9)?,
        isbn: row.get(10)?,
        description: row.get(11)?,
        progress_percent: progress,
        progress_cfi: row.get(13)?,
        finished_at,
        status: status.to_string(),
        tags,
        rating,
        folder_ids,
        manual_fields: row.get(18)?,
        has_original: row.get::<_, i64>(19)? != 0,
    })
}

pub fn list_books(pool: &DbPool) -> Result<Vec<BookRow>> {
    let conn = pool.get()?;
    let sql = format!(
        "{} ORDER BY b.title_sort COLLATE NOCASE",
        book_select(false)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_book)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_book(pool: &DbPool, book_id: i64) -> Result<Option<BookRow>> {
    let conn = pool.get()?;
    let sql = format!("{} WHERE b.id = ?1", book_select(true));
    let row = conn
        .query_row(&sql, [book_id], map_book)
        .map(Some)
        .or_else(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                Ok(None)
            } else {
                Err(e)
            }
        })?;
    Ok(row)
}

pub fn update_progress(pool: &DbPool, book_id: i64, cfi: &str, percent: f64) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO reading_progress (book_id, cfi, percent, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET cfi = ?2, percent = ?3, updated_at = datetime('now')",
        rusqlite::params![book_id, cfi, percent],
    )?;
    Ok(())
}

pub fn import_paths(
    pool: &DbPool,
    covers_dir: &Path,
    library_root: &Path,
    paths: &[PathBuf],
) -> ImportReport {
    // Expand directories up front so the parallel stage sees a flat file list.
    let mut files: Vec<PathBuf> = Vec::new();
    for p in paths {
        if p.is_dir() {
            for entry in walkdir::WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    files.push(entry.path().to_path_buf());
                }
            }
        } else if p.is_file() {
            files.push(p.clone());
        }
    }

    // Hashing and EPUB parsing dominate import time, so files run in
    // parallel. SQLite writes serialize on the WAL writer (busy_timeout in
    // db::open), and the copy_lock keeps unique_path() allocation atomic so
    // two same-titled books can't race to the same destination file.
    let copy_lock = std::sync::Mutex::new(());
    let results: Vec<Result<ImportOutcome>> = {
        use rayon::prelude::*;
        files
            .par_iter()
            .filter_map(|path| import_one(pool, covers_dir, library_root, &copy_lock, path))
            .collect()
    };

    let mut report = ImportReport::default();
    for res in results {
        match res {
            Ok(ImportOutcome::Imported) => report.imported += 1,
            Ok(ImportOutcome::Duplicate) => report.skipped += 1,
            Err(e) => {
                report.failed += 1;
                report.errors.push(e.to_string());
            }
        }
    }
    report
}

/// EPUB-only import. Other extensions get a clear unsupported error;
/// no extension at all (folder artifacts) is silently skipped (None).
fn import_one(
    pool: &DbPool,
    covers_dir: &Path,
    library_root: &Path,
    copy_lock: &std::sync::Mutex<()>,
    path: &Path,
) -> Option<Result<ImportOutcome>> {
    if is_epub(path) {
        return Some(import_single(pool, covers_dir, library_root, copy_lock, path));
    }
    let ext = path.extension().and_then(OsStr::to_str).unwrap_or("");
    if ext.is_empty() {
        None
    } else {
        Some(Err(AtlasError::Msg(format!(
            "{}: only .epub is supported for import",
            path.display()
        ))))
    }
}

enum ImportOutcome {
    Imported,
    Duplicate,
}

fn is_epub(p: &Path) -> bool {
    p.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("epub"))
        .unwrap_or(false)
}

fn import_single(
    pool: &DbPool,
    covers_dir: &Path,
    library_root: &Path,
    copy_lock: &std::sync::Mutex<()>,
    path: &Path,
) -> Result<ImportOutcome> {
    let source = fs::canonicalize(path)?;
    let hash = hash_file(&source)?;

    let conn = pool.get()?;
    if conn
        .query_row(
            "SELECT 1 FROM books WHERE content_hash = ?1",
            [&hash],
            |_| Ok(()),
        )
        .is_ok()
    {
        return Ok(ImportOutcome::Duplicate);
    }

    let meta = epub::read_meta(&source)?;
    let title_sort = sort_key(&meta.title);

    // Compute the organized destination path and copy unless the file is
    // already inside the library root (avoids double-imports of own files).
    let canonical = if source.starts_with(library_root) {
        source.clone()
    } else {
        // unique_path() probes the filesystem, so allocation+copy must be
        // atomic across parallel importers of same-titled books.
        let _guard = copy_lock.lock().unwrap();
        let dest = organized_path(library_root, &meta);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let final_dest = unique_path(&dest);
        fs::copy(&source, &final_dest)?;
        final_dest
    };
    let size = fs::metadata(&canonical)?.len() as i64;

    let cover_path = if let (Some(bytes), Some(ext)) = (&meta.cover_bytes, &meta.cover_ext) {
        fs::create_dir_all(covers_dir)?;
        let p = covers_dir.join(format!("{}.{}", &hash[..16], ext));
        fs::write(&p, bytes)?;
        Some(p.to_string_lossy().to_string())
    } else {
        None
    };

    let tx = conn.unchecked_transaction()?;

    // Two parallel importers can both pass the dedup probe above before
    // either commits; the UNIQUE(content_hash) constraint is the arbiter.
    let insert = tx.execute(
        "INSERT INTO books (title, title_sort, isbn, pub_date, language, description, cover_path, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            meta.title,
            title_sort,
            meta.isbn,
            meta.pub_date,
            meta.language,
            meta.description,
            cover_path,
            hash,
        ],
    );
    match insert {
        Err(rusqlite::Error::SqliteFailure(f, ref msg))
            if f.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.as_deref().is_some_and(|m| m.contains("content_hash")) =>
        {
            return Ok(ImportOutcome::Duplicate);
        }
        other => {
            other?;
        }
    }
    let book_id = tx.last_insert_rowid();

    for (pos, author) in meta.authors.iter().enumerate() {
        let sort = sort_key(author);
        tx.execute(
            "INSERT OR IGNORE INTO authors (name, sort) VALUES (?1, ?2)",
            rusqlite::params![author, sort],
        )?;
        let aid: i64 = tx.query_row(
            "SELECT id FROM authors WHERE name = ?1",
            rusqlite::params![author],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO book_authors (book_id, author_id, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![book_id, aid, pos as i64],
        )?;
    }

    tx.execute(
        "INSERT INTO files (book_id, path, role, format, size, hash)
         VALUES (?1, ?2, 'canonical', 'epub', ?3, ?4)",
        rusqlite::params![book_id, canonical.to_string_lossy(), size, hash],
    )?;

    tx.commit()?;
    let _ = book_id;
    Ok(ImportOutcome::Imported)
}

fn hash_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn organized_path(root: &Path, meta: &epub::EpubMeta) -> PathBuf {
    let author = meta
        .authors
        .first()
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Unknown Author");
    let mut path = root.join(safe_segment(author));
    // Year suffix if we can parse one out of pub_date.
    let year = meta
        .pub_date
        .as_deref()
        .and_then(|d| d.split(|c: char| !c.is_ascii_digit()).next())
        .filter(|s| s.len() == 4);
    let name = match year {
        Some(y) => format!("{} ({}).epub", safe_segment(&meta.title), y),
        None => format!("{}.epub", safe_segment(&meta.title)),
    };
    path.push(name);
    path
}

fn safe_segment(s: &str) -> String {
    // Strip characters that are illegal or troublesome on common filesystems.
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => {
                out.push('-');
            }
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let trimmed = out.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "Untitled".into()
    } else if trimmed.len() > 180 {
        trimmed.chars().take(180).collect()
    } else {
        trimmed
    }
}

fn unique_path(p: &Path) -> PathBuf {
    if !p.exists() {
        return p.to_path_buf();
    }
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("epub");
    let parent = p.parent().unwrap_or_else(|| Path::new("."));
    for i in 2..1000 {
        let candidate = parent.join(format!("{} ({}).{}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    p.to_path_buf()
}

#[derive(Debug, Serialize, Default)]
pub struct MigrationReport {
    pub moved: u32,
    pub missing: u32,
    pub errors: Vec<String>,
}

/// Move any book whose canonical file lives outside the library root into the
/// organised library structure. Idempotent — books already inside the root are
/// left alone.
pub fn migrate_orphan_files(
    pool: &DbPool,
    library_root: &Path,
) -> Result<MigrationReport> {
    let conn = pool.get()?;
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT b.id, b.title, b.pub_date,
                    COALESCE((SELECT a.name FROM book_authors ba
                              JOIN authors a ON a.id = ba.author_id
                              WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1), ''),
                    f.id, f.path
             FROM books b
             JOIN files f ON f.book_id = b.id AND f.role = 'canonical'",
        )?;
        let r = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        r
    };

    let mut report = MigrationReport::default();
    for (book_id, title, pub_date, first_author, file_id, current_path) in rows {
        let path = PathBuf::from(&current_path);
        // Already inside the library — skip.
        if path.starts_with(library_root) {
            continue;
        }
        if !path.exists() {
            report.missing += 1;
            continue;
        }
        // Build a synthetic EpubMeta just for the path-derivation helper.
        let meta = epub::EpubMeta {
            title: title.clone(),
            authors: if first_author.is_empty() {
                vec![]
            } else {
                vec![first_author]
            },
            pub_date,
            ..Default::default()
        };
        let dest = organized_path(library_root, &meta);
        if let Some(parent) = dest.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                report.errors.push(format!("{}: {}", title, e));
                continue;
            }
        }
        let final_dest = unique_path(&dest);
        if let Err(e) = fs::copy(&path, &final_dest) {
            report.errors.push(format!("{}: {}", title, e));
            continue;
        }
        if let Err(e) = conn.execute(
            "UPDATE files SET path = ?1, last_seen = datetime('now') WHERE id = ?2",
            rusqlite::params![final_dest.to_string_lossy(), file_id],
        ) {
            // Roll back the copy if the DB update failed.
            let _ = fs::remove_file(&final_dest);
            report.errors.push(format!("{}: db {}", title, e));
            continue;
        }
        let _ = conn.execute(
            "UPDATE books SET modified_at = datetime('now') WHERE id = ?1",
            [book_id],
        );
        report.moved += 1;
    }
    Ok(report)
}

/// Field-level patch coming from the Edit Metadata modal. Every field
/// is `Option<Option<T>>`-flavoured via a wrapper enum: `None` means
/// "leave alone", `Some(value)` means "set to value (possibly clearing)".
/// We use serde's default-when-missing semantics with `#[serde(default)]`
/// and `skip_serializing_if` so the frontend only sends what changed.
#[derive(Debug, Default, serde::Deserialize)]
pub struct MetadataPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub authors: Option<Vec<String>>,
    #[serde(default)]
    pub series: Option<Option<String>>,
    #[serde(default)]
    pub series_index: Option<Option<f64>>,
    #[serde(default)]
    pub language: Option<Option<String>>,
    #[serde(default)]
    pub isbn: Option<Option<String>>,
    #[serde(default)]
    pub pub_date: Option<Option<String>>,
    #[serde(default)]
    pub description: Option<Option<String>>,
}

/// Apply a user-authored metadata patch. Each touched field is marked
/// in `books.manual_fields` so the enrich pipeline won't clobber it
/// later.
pub fn update_book_metadata(pool: &DbPool, book_id: i64, patch: MetadataPatch) -> Result<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    // Read current manual_fields JSON; default to empty object.
    let mut manual: serde_json::Value = {
        let cur: Option<String> = tx
            .query_row(
                "SELECT manual_fields FROM books WHERE id = ?1",
                [book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        match cur {
            Some(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({})),
            None => serde_json::json!({}),
        }
    };
    let mark = |m: &mut serde_json::Value, key: &str| {
        if let Some(obj) = m.as_object_mut() {
            obj.insert(key.into(), serde_json::Value::Bool(true));
        }
    };

    if let Some(title) = patch.title.as_ref() {
        let title = title.trim();
        if !title.is_empty() {
            tx.execute(
                "UPDATE books SET title = ?1, title_sort = ?2, modified_at = datetime('now') WHERE id = ?3",
                rusqlite::params![title, sort_key(title), book_id],
            )?;
            mark(&mut manual, "title");
        }
    }
    if let Some(lang) = patch.language.as_ref() {
        tx.execute(
            "UPDATE books SET language = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![lang, book_id],
        )?;
        mark(&mut manual, "language");
    }
    if let Some(isbn) = patch.isbn.as_ref() {
        tx.execute(
            "UPDATE books SET isbn = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![isbn, book_id],
        )?;
        mark(&mut manual, "isbn");
    }
    if let Some(pd) = patch.pub_date.as_ref() {
        tx.execute(
            "UPDATE books SET pub_date = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![pd, book_id],
        )?;
        mark(&mut manual, "pub_date");
    }
    if let Some(desc) = patch.description.as_ref() {
        tx.execute(
            "UPDATE books SET description = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![desc, book_id],
        )?;
        mark(&mut manual, "description");
    }

    // Series: None|Some -> Some sets/clears, None leaves alone.
    if let Some(series_opt) = patch.series.as_ref() {
        match series_opt {
            None => {
                tx.execute(
                    "UPDATE books SET series_id = NULL, modified_at = datetime('now') WHERE id = ?1",
                    [book_id],
                )?;
            }
            Some(name) => {
                let name = name.trim();
                if name.is_empty() {
                    tx.execute(
                        "UPDATE books SET series_id = NULL WHERE id = ?1",
                        [book_id],
                    )?;
                } else {
                    let sort = sort_key(name);
                    tx.execute(
                        "INSERT OR IGNORE INTO series (name, sort) VALUES (?1, ?2)",
                        rusqlite::params![name, sort],
                    )?;
                    let sid: i64 = tx.query_row(
                        "SELECT id FROM series WHERE name = ?1",
                        rusqlite::params![name],
                        |r| r.get(0),
                    )?;
                    tx.execute(
                        "UPDATE books SET series_id = ?1, modified_at = datetime('now') WHERE id = ?2",
                        rusqlite::params![sid, book_id],
                    )?;
                }
            }
        }
        mark(&mut manual, "series");
    }
    if let Some(si_opt) = patch.series_index.as_ref() {
        tx.execute(
            "UPDATE books SET series_index = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![si_opt, book_id],
        )?;
        mark(&mut manual, "series_index");
    }

    // Authors: full replace. Easier to reason about than diffing.
    if let Some(authors) = patch.authors.as_ref() {
        tx.execute("DELETE FROM book_authors WHERE book_id = ?1", [book_id])?;
        for (pos, name) in authors.iter().enumerate() {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let sort = sort_key(name);
            tx.execute(
                "INSERT OR IGNORE INTO authors (name, sort) VALUES (?1, ?2)",
                rusqlite::params![name, sort],
            )?;
            let aid: i64 = tx.query_row(
                "SELECT id FROM authors WHERE name = ?1",
                rusqlite::params![name],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO book_authors (book_id, author_id, position) VALUES (?1, ?2, ?3)",
                rusqlite::params![book_id, aid, pos as i64],
            )?;
        }
        // Clean up orphaned authors so the by-author list stays tidy.
        tx.execute(
            "DELETE FROM authors WHERE id NOT IN (SELECT DISTINCT author_id FROM book_authors)",
            [],
        )?;
        mark(&mut manual, "authors");
    }

    tx.execute(
        "UPDATE books SET manual_fields = ?1 WHERE id = ?2",
        rusqlite::params![manual.to_string(), book_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Mark a single field as no longer manually overridden so the next
/// enrich pass can fill it in again.
pub fn clear_manual_field(pool: &DbPool, book_id: i64, field: &str) -> Result<()> {
    let conn = pool.get()?;
    let cur: Option<String> = conn
        .query_row(
            "SELECT manual_fields FROM books WHERE id = ?1",
            [book_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let mut v: serde_json::Value = cur
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(o) = v.as_object_mut() {
        o.remove(field);
    }
    conn.execute(
        "UPDATE books SET manual_fields = ?1 WHERE id = ?2",
        rusqlite::params![v.to_string(), book_id],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FileRow {
    pub id: i64,
    pub path: String,
    pub role: String,
    pub format: String,
    pub size: i64,
}

/// Export a book to another format using the Rust-native converters
/// in `convert`. Writes the result next to the canonical EPUB,
/// registers it as `role='export'`, and returns the output path.
/// Re-exporting overwrites the previous export for that format.
pub fn convert_book(pool: &DbPool, book_id: i64, format: &str) -> Result<String> {
    let conn = pool.get()?;
    let canonical: String = conn
        .query_row(
            "SELECT path FROM files WHERE book_id = ?1 AND role = 'canonical'",
            [book_id],
            |r| r.get(0),
        )
        .map_err(|_| AtlasError::Msg("no canonical file".into()))?;
    let src = Path::new(&canonical);
    let stem = src.file_stem().and_then(OsStr::to_str).unwrap_or("book");

    let (ext, content) = match format {
        "markdown" => ("md", convert::epub_to_markdown(src)?),
        "html" => ("html", convert::epub_to_html(src)?),
        "text" => ("txt", convert::epub_to_text(src)?),
        other => return Err(AtlasError::Msg(format!("unsupported export format: {other}"))),
    };

    let dst = src
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("{stem}.{ext}"));
    std::fs::write(&dst, content.as_bytes())?;

    let size = std::fs::metadata(&dst).map(|m| m.len() as i64).unwrap_or(0);
    // Idempotent re-export: drop any prior row for the same format.
    conn.execute(
        "DELETE FROM files WHERE book_id = ?1 AND role = 'export' AND format = ?2",
        rusqlite::params![book_id, ext],
    )?;
    conn.execute(
        "INSERT INTO files (book_id, path, role, format, size)
         VALUES (?1, ?2, 'export', ?3, ?4)",
        rusqlite::params![book_id, dst.to_string_lossy(), ext, size],
    )?;
    Ok(dst.to_string_lossy().to_string())
}

pub fn list_book_files(pool: &DbPool, book_id: i64) -> Result<Vec<FileRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, path, role, format, size
           FROM files WHERE book_id = ?1
           ORDER BY CASE role WHEN 'canonical' THEN 0 WHEN 'original' THEN 1 ELSE 2 END",
    )?;
    let rows = stmt
        .query_map([book_id], |r| {
            Ok(FileRow {
                id: r.get(0)?,
                path: r.get(1)?,
                role: r.get(2)?,
                format: r.get(3)?,
                size: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_rating(pool: &DbPool, book_id: i64, rating: Option<i64>) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE books SET rating = ?1, modified_at = datetime('now') WHERE id = ?2",
        rusqlite::params![rating, book_id],
    )?;
    Ok(())
}

fn sort_key(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    for prefix in ["the ", "a ", "an "] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            return rest.to_string();
        }
    }
    lower
}

pub fn set_finished(pool: &DbPool, book_id: i64, finished: bool) -> Result<()> {
    let conn = pool.get()?;
    if finished {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE books SET finished_at = datetime('now'), modified_at = datetime('now') WHERE id = ?1",
            [book_id],
        )?;
        tx.execute(
            "INSERT INTO reading_progress (book_id, cfi, percent, updated_at)
             VALUES (?1, COALESCE((SELECT cfi FROM reading_progress WHERE book_id = ?1), ''), 100, datetime('now'))
             ON CONFLICT(book_id) DO UPDATE SET percent = 100, updated_at = datetime('now')",
            [book_id],
        )?;
        tx.commit()?;
    } else {
        conn.execute(
            "UPDATE books SET finished_at = NULL, modified_at = datetime('now') WHERE id = ?1",
            [book_id],
        )?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct TagRow {
    pub name: String,
    pub count: i64,
}

pub fn list_tags(pool: &DbPool) -> Result<Vec<TagRow>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT t.name, COUNT(bt.book_id) AS n
         FROM tags t
         LEFT JOIN book_tags bt ON bt.tag_id = t.id
         GROUP BY t.id
         ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TagRow {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn add_tag(pool: &DbPool, book_id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
        rusqlite::params![name],
    )?;
    let tag_id: i64 = conn.query_row(
        "SELECT id FROM tags WHERE name = ?1",
        rusqlite::params![name],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
        rusqlite::params![book_id, tag_id],
    )?;
    Ok(())
}

pub fn remove_tag(pool: &DbPool, book_id: i64, name: &str) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM book_tags
         WHERE book_id = ?1 AND tag_id IN (SELECT id FROM tags WHERE name = ?2)",
        rusqlite::params![book_id, name],
    )?;
    // also clean up orphan tags
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)",
        [],
    )?;
    Ok(())
}

// ===== Collections (folders) =====

#[derive(Debug, Serialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub count: i64,
}

pub fn list_collections(pool: &DbPool) -> Result<Vec<Collection>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.kind, COUNT(cb.book_id) AS n
         FROM collections c
         LEFT JOIN collection_books cb ON cb.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                count: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_collection(pool: &DbPool, name: &str) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AtlasError::Msg("empty collection name".into()));
    }
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO collections (name, kind) VALUES (?1, 'manual')",
        rusqlite::params![name],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_collection(pool: &DbPool, id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AtlasError::Msg("empty collection name".into()));
    }
    let conn = pool.get()?;
    conn.execute(
        "UPDATE collections SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )?;
    Ok(())
}

pub fn delete_collection(pool: &DbPool, id: i64) -> Result<()> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

pub fn add_to_collection(pool: &DbPool, collection_id: i64, book_id: i64) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?1, ?2)",
        rusqlite::params![collection_id, book_id],
    )?;
    Ok(())
}

pub fn remove_from_collection(pool: &DbPool, collection_id: i64, book_id: i64) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM collection_books WHERE collection_id = ?1 AND book_id = ?2",
        rusqlite::params![collection_id, book_id],
    )?;
    Ok(())
}

pub fn delete_book(pool: &DbPool, book_id: i64) -> Result<()> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM books WHERE id = ?1", [book_id])?;
    Ok(())
}

// ─── highlights ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct Highlight {
    /// Portable identity. Stays the same across devices and across
    /// re-imports of the same book; what the manifest keys on.
    pub uuid: String,
    pub book_id: i64,
    pub cfi_range: String,
    pub text: String,
    pub note: Option<String>,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_highlights(pool: &DbPool, book_id: i64) -> Result<Vec<Highlight>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT uuid, book_id, cfi_range, text, note, color, created_at, updated_at
           FROM highlights
          WHERE book_id = ?1
          ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([book_id], |r| {
        Ok(Highlight {
            uuid: r.get(0)?,
            book_id: r.get(1)?,
            cfi_range: r.get(2)?,
            text: r.get(3)?,
            note: r.get(4)?,
            color: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn add_highlight(
    pool: &DbPool,
    book_id: i64,
    cfi_range: &str,
    text: &str,
    color: Option<&str>,
    note: Option<&str>,
) -> Result<Highlight> {
    let conn = pool.get()?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let color = color.unwrap_or("yellow");
    conn.execute(
        "INSERT INTO highlights (uuid, book_id, cfi_range, text, color, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![&uuid, book_id, cfi_range, text, color, note],
    )?;
    get_highlight(pool, &uuid)?
        .ok_or_else(|| AtlasError::Msg("highlight insert disappeared".into()))
}

pub fn get_highlight(pool: &DbPool, uuid: &str) -> Result<Option<Highlight>> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT uuid, book_id, cfi_range, text, note, color, created_at, updated_at
           FROM highlights WHERE uuid = ?1",
        [uuid],
        |r| {
            Ok(Highlight {
                uuid: r.get(0)?,
                book_id: r.get(1)?,
                cfi_range: r.get(2)?,
                text: r.get(3)?,
                note: r.get(4)?,
                color: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.into())
}

pub fn update_highlight(
    pool: &DbPool,
    uuid: &str,
    note: Option<&str>,
    color: Option<&str>,
) -> Result<()> {
    let conn = pool.get()?;
    // Use COALESCE so callers can update one field at a time without
    // having to fetch the other first.
    conn.execute(
        "UPDATE highlights
            SET note  = COALESCE(?1, note),
                color = COALESCE(?2, color),
                updated_at = datetime('now')
          WHERE uuid = ?3",
        rusqlite::params![note, color, uuid],
    )?;
    Ok(())
}

pub fn delete_highlight(pool: &DbPool, uuid: &str) -> Result<()> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    // Record a tombstone keyed on the book's content_hash so the
    // delete propagates through the manifest even after the book row
    // is gone. Falls back to an empty hash when somehow detached — the
    // reconcile side tolerates that.
    let book_hash: Option<String> = tx
        .query_row(
            "SELECT b.content_hash
               FROM highlights h
               JOIN books b ON b.id = h.book_id
              WHERE h.uuid = ?1",
            [uuid],
            |r| r.get(0),
        )
        .optional()?;
    tx.execute(
        "INSERT OR REPLACE INTO highlight_tombstones (uuid, book_hash) VALUES (?1, ?2)",
        rusqlite::params![uuid, book_hash.unwrap_or_default()],
    )?;
    tx.execute("DELETE FROM highlights WHERE uuid = ?1", [uuid])?;
    tx.commit()?;
    Ok(())
}

/// Render highlights as Markdown in the Readwise format. If `book_id`
/// is `Some`, only that book; otherwise all books with highlights.
/// Empty string when there are no highlights to export — caller can
/// decide whether to surface that.
///
/// Format (one heading per book, one block per highlight):
///   # Title — Author
///
///   > quote
///
///   note  (omitted when empty)
///
///   ---
pub fn export_annotations_markdown(pool: &DbPool, book_id: Option<i64>) -> Result<String> {
    let conn = pool.get()?;
    // Pull (book_id, title, authors_joined) for books we'll include.
    // GROUP_CONCAT in author position order matches map_book's logic.
    let mut where_clause = String::new();
    if book_id.is_some() {
        where_clause = " WHERE b.id = ?1".into();
    }
    let book_sql = format!(
        "SELECT b.id, b.title,
                COALESCE((SELECT GROUP_CONCAT(a.name, ', ')
                          FROM book_authors ba
                          JOIN authors a ON a.id = ba.author_id
                          WHERE ba.book_id = b.id
                          ORDER BY ba.position), '') AS authors
           FROM books b
          WHERE EXISTS(SELECT 1 FROM highlights h WHERE h.book_id = b.id){extra}
          ORDER BY b.title_sort COLLATE NOCASE",
        extra = if book_id.is_some() { " AND b.id = ?1" } else { "" },
    );
    let _ = where_clause; // kept for future filter expansion
    let mut stmt = conn.prepare(&book_sql)?;
    let books: Vec<(i64, String, String)> = match book_id {
        Some(id) => stmt
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?,
        None => stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?,
    };

    let mut out = String::new();
    for (bid, title, authors) in books {
        let header = if authors.is_empty() {
            format!("# {}\n\n", title)
        } else {
            format!("# {} — {}\n\n", title, authors)
        };
        out.push_str(&header);

        let mut hstmt = conn.prepare(
            "SELECT text, note FROM highlights
              WHERE book_id = ?1 ORDER BY created_at ASC",
        )?;
        let highlights = hstmt
            .query_map([bid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (text, note) in highlights {
            // Prefix each line of the quote with "> " so multi-line
            // selections render as one continuous blockquote.
            for line in text.lines() {
                out.push_str("> ");
                out.push_str(line);
                out.push('\n');
            }
            out.push('\n');
            if let Some(n) = note.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                out.push_str(n);
                out.push_str("\n\n");
            }
            out.push_str("---\n\n");
        }
    }
    Ok(out.trim_end().to_string())
}

/// Drop tombstones older than `keep_days`. Called on startup so the
/// table doesn't grow unbounded. 90 days is comfortably longer than
/// any reasonable offline period — once every device has reconciled
/// past a tombstone, it's safe to forget.
pub fn gc_highlight_tombstones(pool: &DbPool, keep_days: i64) -> Result<usize> {
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM highlight_tombstones
          WHERE deleted_at < datetime('now', ?1)",
        [format!("-{} days", keep_days)],
    )?;
    Ok(n)
}

// Note: manifest reconciliation reads from `highlights` /
// `highlight_tombstones` directly via its own connection-borrowing
// helpers (see manifest::reconcile_highlight / reconcile_tombstone).
// Keeping the reconcile logic on the manifest side lets it batch the
// inserts/deletes inside one transaction next to the rest of the
// vault overlay; bouncing each row through this module would just add
// a pool checkout per highlight for no payoff.

pub fn book_count(pool: &DbPool) -> Result<i64> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))?;
    Ok(n)
}

#[allow(dead_code)]
pub fn ensure_library_root() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AtlasError::Msg("no home dir".into()))?;
    let root = home.join("Books").join("Atlas");
    fs::create_dir_all(&root)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sort_key_strips_leading_articles() {
        assert_eq!(sort_key("The Name of the Wind"), "name of the wind");
        assert_eq!(sort_key("A Memory Called Empire"), "memory called empire");
        assert_eq!(sort_key("An Instance of the Fingerpost"), "instance of the fingerpost");
        // Only whole-word articles, not prefixes of real words.
        assert_eq!(sort_key("Theory of Everything"), "theory of everything");
        assert_eq!(sort_key("  Dune  "), "dune");
    }

    #[test]
    fn safe_segment_strips_illegal_filename_chars() {
        assert_eq!(safe_segment("Foo/Bar: Baz?"), "Foo-Bar- Baz-");
        assert_eq!(safe_segment("  .hidden.  "), "hidden");
        assert_eq!(safe_segment(""), "Untitled");
        assert_eq!(safe_segment("///"), "---");
    }

    #[test]
    fn safe_segment_caps_length() {
        let long = "x".repeat(500);
        assert_eq!(safe_segment(&long).chars().count(), 180);
    }

    #[test]
    fn unique_path_suffixes_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Book.epub");
        assert_eq!(unique_path(&p), p);
        std::fs::write(&p, b"x").unwrap();
        assert_eq!(unique_path(&p), dir.path().join("Book (2).epub"));
        std::fs::write(dir.path().join("Book (2).epub"), b"x").unwrap();
        assert_eq!(unique_path(&p), dir.path().join("Book (3).epub"));
    }

    #[test]
    fn import_rejects_non_epub_and_skips_extensionless() {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("atlas.db")).unwrap();
        let pdf = dir.path().join("paper.pdf");
        std::fs::write(&pdf, b"%PDF-").unwrap();
        let bare = dir.path().join("LICENSE");
        std::fs::write(&bare, b"text").unwrap();

        let report = import_paths(
            &db,
            &dir.path().join("covers"),
            dir.path(),
            &[pdf, bare],
        );
        assert_eq!(report.imported, 0);
        assert_eq!(report.failed, 1, "only the .pdf should report an error");
        assert!(report.errors[0].contains("only .epub"));
    }

    #[test]
    fn db_open_is_idempotent_and_migrated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("atlas.db");
        {
            let pool = crate::db::open(&path).unwrap();
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO books (title, title_sort, content_hash) VALUES ('T', 't', 'h1')",
                [],
            )
            .unwrap();
        }
        // Re-open over the existing file: schema + migrations must not error
        // and data must survive.
        let pool = crate::db::open(&path).unwrap();
        let books = list_books(&pool).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "T");
        // list_books omits the description payload by design.
        assert_eq!(books[0].description, None);
    }

    #[test]
    fn duplicate_content_hash_is_rejected_by_schema() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(&dir.path().join("atlas.db")).unwrap();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO books (title, title_sort, content_hash) VALUES ('A', 'a', 'same')",
            [],
        )
        .unwrap();
        let dup = conn.execute(
            "INSERT INTO books (title, title_sort, content_hash) VALUES ('B', 'b', 'same')",
            [],
        );
        assert!(dup.is_err(), "UNIQUE(content_hash) must hold");
    }
}
