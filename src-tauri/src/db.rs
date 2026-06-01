use crate::error::Result;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

pub type DbPool = Pool<SqliteConnectionManager>;

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    title_sort      TEXT NOT NULL,
    series_id       INTEGER REFERENCES series(id) ON DELETE SET NULL,
    series_index    REAL,
    isbn            TEXT,
    pub_date        TEXT,
    language        TEXT,
    description     TEXT,
    cover_path      TEXT,
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at     TEXT NOT NULL DEFAULT (datetime('now')),
    content_hash    TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    path        TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL CHECK(role IN ('canonical','original','export')),
    format      TEXT NOT NULL,
    size        INTEGER NOT NULL,
    hash        TEXT,
    last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_book ON files(book_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_canonical
    ON files(book_id) WHERE role = 'canonical';

CREATE TABLE IF NOT EXISTS authors (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    sort    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_authors (
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, author_id)
);

CREATE TABLE IF NOT EXISTS series (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    sort  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS book_tags (
    book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    kind   TEXT NOT NULL CHECK(kind IN ('manual','smart')),
    query  TEXT
);

CREATE TABLE IF NOT EXISTS collection_books (
    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    book_id        INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, book_id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
    book_id    INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    cfi        TEXT,
    percent    REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Legacy table from an unreleased iteration. Empty in the wild; kept
-- around so a future migration can drop it cleanly. The active table
-- is `highlights` below.
CREATE TABLE IF NOT EXISTS annotations (
    id          INTEGER PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cfi_start   TEXT NOT NULL,
    cfi_end     TEXT NOT NULL,
    text        TEXT,
    note        TEXT,
    color       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);

-- Reader highlights. `uuid` is the portable identity that survives
-- across devices via the vault manifest (see docs/VAULTS.md); the
-- integer `id` is purely a local rowid for cheap joins. `cfi_range`
-- is an epub.js range CFI like `epubcfi(/6/4!/4/2,/1:0,/1:10)`.
CREATE TABLE IF NOT EXISTS highlights (
    id          INTEGER PRIMARY KEY,
    uuid        TEXT NOT NULL UNIQUE,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cfi_range   TEXT NOT NULL,
    text        TEXT NOT NULL,
    note        TEXT,
    color       TEXT NOT NULL DEFAULT 'yellow',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_updated ON highlights(updated_at);

-- Highlight delete tombstones. Without them, deleting a highlight on
-- device A wouldn't propagate to device B — B would see the absence
-- and assume the highlight is "local-only" (which is the same shape as
-- "you created it after the last sync from A"). The tombstone makes
-- "deleted" representable. book_hash is denormalised in so we can
-- write tombstones back into the manifest even when the underlying
-- book has since been removed locally. GC'd after 90 days on startup.
CREATE TABLE IF NOT EXISTS highlight_tombstones (
    uuid        TEXT PRIMARY KEY,
    book_hash   TEXT NOT NULL,
    deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_highlight_tombstones_book
    ON highlight_tombstones(book_hash);

-- Simple key/value scratch space for things like the last manifest mtime.
-- Keeps us from needing one ALTER per new piece of bookkeeping.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrichment_cache (
    key         TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    payload     TEXT NOT NULL,
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

pub fn open(path: &Path) -> Result<DbPool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(path);
    let pool = Pool::builder().max_size(8).build(manager)?;
    let conn = pool.get()?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    Ok(pool)
}

fn migrate(conn: &rusqlite::Connection) -> Result<()> {
    if !column_exists(conn, "books", "finished_at")? {
        conn.execute("ALTER TABLE books ADD COLUMN finished_at TEXT", [])?;
    }
    if !column_exists(conn, "books", "rating")? {
        conn.execute("ALTER TABLE books ADD COLUMN rating INTEGER", [])?;
    }
    // JSON object of fields the user has manually edited. Enrich uses
    // this to avoid overwriting human input.
    //   {"title": true, "description": true, ...}
    if !column_exists(conn, "books", "manual_fields")? {
        conn.execute("ALTER TABLE books ADD COLUMN manual_fields TEXT", [])?;
    }
    Ok(())
}

fn column_exists(conn: &rusqlite::Connection, table: &str, col: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, col],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}
