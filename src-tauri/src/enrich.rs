use crate::db::DbPool;
use crate::epub;
use crate::error::{AtlasError, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

const UA: &str = concat!(
    "Atlas/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/jackoregankenny/artemis)"
);
const CACHE_TTL_DAYS: i64 = 30;
const MAX_AUTO_TAGS: usize = 6;
const TAG_MAX_LEN: usize = 28;

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AtlasError::Msg(format!("http client: {}", e)))
}

#[derive(Debug, Clone, Default)]
struct Candidate {
    isbn: Option<String>,
    description: Option<String>,
    pub_date: Option<String>,
    language: Option<String>,
    cover_url: Option<String>,
    work_key: Option<String>,
    subjects: Vec<String>,
}

fn merge(into: &mut Candidate, other: Candidate) {
    if into.isbn.is_none() { into.isbn = other.isbn; }
    if into.description.is_none() { into.description = other.description; }
    if into.pub_date.is_none() { into.pub_date = other.pub_date; }
    if into.language.is_none() { into.language = other.language; }
    if into.cover_url.is_none() { into.cover_url = other.cover_url; }
    if into.work_key.is_none() { into.work_key = other.work_key; }
    for s in other.subjects {
        if !into.subjects.contains(&s) { into.subjects.push(s); }
    }
}

#[derive(serde::Serialize, Debug)]
pub struct EnrichOutcome {
    pub matched: bool,
    pub fields_updated: u32,
    pub cover_fetched: bool,
    pub tags_added: u32,
}

pub async fn enrich_book(
    pool: DbPool,
    covers_dir: PathBuf,
    book_id: i64,
) -> Result<EnrichOutcome> {
    let (title, isbn, mut cover_path, first_author, file_path, existing_tags) = {
        let conn = pool.get()?;
        let row = conn.query_row(
            "SELECT title, isbn, cover_path,
                    COALESCE((SELECT a.name FROM book_authors ba
                              JOIN authors a ON a.id = ba.author_id
                              WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1), ''),
                    (SELECT path FROM files WHERE book_id = b.id AND role = 'canonical' LIMIT 1),
                    COALESCE((SELECT GROUP_CONCAT(t.name, '||')
                              FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
                              WHERE bt.book_id = b.id), '')
             FROM books b WHERE id = ?1",
            [book_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                ))
            },
        )?;
        row
    };
    let existing_tags: Vec<String> = if existing_tags.is_empty() {
        vec![]
    } else {
        existing_tags.split("||").map(|s| s.to_string()).collect()
    };

    // Re-extract cover from the local EPUB if we don't have one yet.
    let mut local_cover_fetched = false;
    if cover_path.is_none() {
        if let Some(fp) = file_path.as_deref() {
            let path = Path::new(fp);
            if path.exists() {
                if let Ok(local_meta) = epub::read_meta(path) {
                    if let (Some(bytes), Some(ext)) = (local_meta.cover_bytes, local_meta.cover_ext) {
                        std::fs::create_dir_all(&covers_dir)?;
                        let p = covers_dir.join(format!("local-{}.{}", book_id, ext));
                        if std::fs::write(&p, &bytes).is_ok() {
                            let conn = pool.get()?;
                            conn.execute(
                                "UPDATE books SET cover_path = ?1, modified_at = datetime('now') WHERE id = ?2",
                                rusqlite::params![p.to_string_lossy(), book_id],
                            )?;
                            cover_path = Some(p.to_string_lossy().to_string());
                            local_cover_fetched = true;
                        }
                    }
                }
            }
        }
    }

    let http = client()?;

    // Gather a candidate from the best sources we have.
    let mut candidate = Candidate::default();
    let mut matched_remote = false;

    if let Some(isbn) = isbn.as_deref().filter(|s| !s.is_empty()) {
        if let Some(ol) = openlibrary_by_isbn(&http, &pool, isbn).await? {
            merge(&mut candidate, ol);
            matched_remote = true;
        }
    } else if let Some(ol) = openlibrary_search(&http, &pool, &title, &first_author).await? {
        merge(&mut candidate, ol);
        matched_remote = true;
    }

    // Follow the work key for the full description / more subjects.
    if let Some(work_key) = candidate.work_key.clone() {
        if let Some(work) = openlibrary_work(&http, &pool, &work_key).await? {
            merge(&mut candidate, work);
        }
    }

    // Google Books fallback — pulls description and additional fields for
    // books that Open Library doesn't have a rich record for.
    if candidate.description.is_none() || candidate.cover_url.is_none() {
        if let Some(gb) = google_books(&http, &pool, candidate.isbn.as_deref().or(isbn.as_deref()), &title, &first_author).await? {
            merge(&mut candidate, gb);
            matched_remote = true;
        }
    }

    if !matched_remote {
        return Ok(EnrichOutcome {
            matched: local_cover_fetched,
            fields_updated: 0,
            cover_fetched: local_cover_fetched,
            tags_added: 0,
        });
    }

    // Apply field changes (only fill empties).
    let mut fields = 0u32;
    {
        let conn = pool.get()?;
        if let Some(v) = &candidate.isbn {
            fields += conn.execute(
                "UPDATE books SET isbn = ?1, modified_at = datetime('now') WHERE id = ?2 AND (isbn IS NULL OR isbn = '') AND COALESCE(json_extract(manual_fields, '$.isbn'), 0) = 0",
                rusqlite::params![v, book_id],
            )? as u32;
        }
        if let Some(v) = &candidate.description {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                fields += conn.execute(
                    "UPDATE books SET description = ?1, modified_at = datetime('now') WHERE id = ?2 AND (description IS NULL OR description = '') AND COALESCE(json_extract(manual_fields, '$.description'), 0) = 0",
                    rusqlite::params![trimmed, book_id],
                )? as u32;
            }
        }
        if let Some(v) = &candidate.pub_date {
            fields += conn.execute(
                "UPDATE books SET pub_date = ?1, modified_at = datetime('now') WHERE id = ?2 AND (pub_date IS NULL OR pub_date = '') AND COALESCE(json_extract(manual_fields, '$.pub_date'), 0) = 0",
                rusqlite::params![v, book_id],
            )? as u32;
        }
        if let Some(v) = &candidate.language {
            fields += conn.execute(
                "UPDATE books SET language = ?1, modified_at = datetime('now') WHERE id = ?2 AND (language IS NULL OR language = '') AND COALESCE(json_extract(manual_fields, '$.language'), 0) = 0",
                rusqlite::params![v, book_id],
            )? as u32;
        }
    }

    // Auto-add cleaned subjects as tags (skip ones already on the book).
    let mut tags_added = 0u32;
    let suggested_tags = clean_subjects_to_tags(&candidate.subjects, &existing_tags);
    if !suggested_tags.is_empty() {
        let conn = pool.get()?;
        for name in &suggested_tags {
            conn.execute(
                "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
                rusqlite::params![name],
            )?;
            let tag_id: i64 = conn.query_row(
                "SELECT id FROM tags WHERE name = ?1",
                rusqlite::params![name],
                |r| r.get(0),
            )?;
            let n = conn.execute(
                "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![book_id, tag_id],
            )?;
            tags_added += n as u32;
        }
    }

    let mut cover_fetched = local_cover_fetched;
    if cover_path.is_none() {
        if let Some(url) = &candidate.cover_url {
            if let Ok(path) = fetch_cover(&http, &covers_dir, book_id, url).await {
                let conn = pool.get()?;
                conn.execute(
                    "UPDATE books SET cover_path = ?1, modified_at = datetime('now') WHERE id = ?2",
                    rusqlite::params![path.to_string_lossy(), book_id],
                )?;
                cover_fetched = true;
            }
        }
    }

    Ok(EnrichOutcome {
        matched: true,
        fields_updated: fields,
        cover_fetched,
        tags_added,
    })
}

fn clean_subjects_to_tags(subjects: &[String], existing: &[String]) -> Vec<String> {
    let existing_lc: Vec<String> = existing.iter().map(|s| s.to_lowercase()).collect();
    let mut out = Vec::new();
    for raw in subjects {
        if out.len() >= MAX_AUTO_TAGS {
            break;
        }
        let s = raw.trim();
        if s.is_empty() || s.len() > TAG_MAX_LEN {
            continue;
        }
        // Skip qualified or noisy subjects — keep simple human ones.
        let lower = s.to_lowercase();
        if lower.contains("--")
            || lower.contains("history of")
            || lower.contains("nyt:")
            || lower.contains("genre/form")
            || lower.contains("internet archive wishlist")
            || lower.starts_with("accessible book")
            || lower.starts_with("large type books")
            || lower.starts_with("readable book")
            || lower.starts_with("translations into")
            || lower.contains(", fictitious")
            || lower.contains("juvenile fiction")
                && !lower.contains("juvenile fiction.")
        {
            continue;
        }
        // Reject ALL-CAPS noise and things that look like cataloging codes.
        if s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            continue;
        }
        let normalized = title_case(s);
        if existing_lc.contains(&normalized.to_lowercase()) {
            continue;
        }
        if out.iter().any(|t: &String| t.eq_ignore_ascii_case(&normalized)) {
            continue;
        }
        out.push(normalized);
    }
    out
}

fn title_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut next_upper = true;
    for c in s.chars() {
        if c.is_whitespace() {
            out.push(c);
            next_upper = true;
        } else if next_upper {
            for u in c.to_uppercase() {
                out.push(u);
            }
            next_upper = false;
        } else {
            for u in c.to_lowercase() {
                out.push(u);
            }
        }
    }
    out
}

// ───────── Open Library ─────────

async fn openlibrary_by_isbn(
    http: &reqwest::Client,
    pool: &DbPool,
    isbn: &str,
) -> Result<Option<Candidate>> {
    let clean: String = isbn.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if clean.is_empty() {
        return Ok(None);
    }
    // /isbn/X.json gives a clean edition record with works[] array.
    let key = format!("openlibrary:edition:{}", clean);
    let body = match cache_get(pool, &key)? {
        Some(s) => s,
        None => {
            let url = format!("https://openlibrary.org/isbn/{}.json", urlencoding::encode(&clean));
            let resp = http.get(&url).send().await.map_err(http_err)?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body = resp.text().await.map_err(http_err)?;
            cache_put(pool, &key, "openlibrary-edition", &body)?;
            body
        }
    };
    Ok(Some(parse_ol_edition(&body, &clean)))
}

/// Pure parse of an Open Library edition record (`/isbn/X.json`). Always
/// returns a Candidate carrying at least the ISBN (and a synthesized cover
/// URL); the network/IO lives in the caller so this stays unit-testable
/// against captured fixtures.
fn parse_ol_edition(body: &str, clean_isbn: &str) -> Candidate {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);

    let mut c = Candidate {
        isbn: Some(clean_isbn.to_string()),
        ..Default::default()
    };

    if let Some(d) = v.get("publish_date").and_then(|x| x.as_str()) {
        c.pub_date = Some(d.to_string());
    }
    if let Some(langs) = v.get("languages").and_then(|x| x.as_array()) {
        if let Some(first) = langs.first() {
            if let Some(k) = first.get("key").and_then(|x| x.as_str()) {
                // "/languages/eng" → "eng"
                if let Some(short) = k.rsplit('/').next() {
                    c.language = Some(short.to_string());
                }
            }
        }
    }
    if let Some(covers) = v.get("covers").and_then(|x| x.as_array()) {
        if let Some(id) = covers.iter().find_map(|x| x.as_i64()).filter(|&n| n > 0) {
            c.cover_url = Some(format!("https://covers.openlibrary.org/b/id/{}-L.jpg", id));
        }
    }
    if c.cover_url.is_none() {
        c.cover_url = Some(format!("https://covers.openlibrary.org/b/isbn/{}-L.jpg", clean_isbn));
    }
    if let Some(works) = v.get("works").and_then(|x| x.as_array()) {
        if let Some(first) = works.first() {
            if let Some(k) = first.get("key").and_then(|x| x.as_str()) {
                c.work_key = Some(k.to_string());
            }
        }
    }
    c
}

#[derive(Debug, Deserialize)]
struct OlSearch {
    docs: Vec<OlSearchDoc>,
}
#[derive(Debug, Deserialize)]
struct OlSearchDoc {
    key: Option<String>,
    first_publish_year: Option<i32>,
    language: Option<Vec<String>>,
    isbn: Option<Vec<String>>,
    cover_i: Option<i64>,
    subject: Option<Vec<String>>,
    first_sentence: Option<Vec<String>>,
}

async fn openlibrary_search(
    http: &reqwest::Client,
    pool: &DbPool,
    title: &str,
    author: &str,
) -> Result<Option<Candidate>> {
    if title.trim().is_empty() {
        return Ok(None);
    }
    let key = format!(
        "openlibrary:search:{}|{}",
        title.to_lowercase(),
        author.to_lowercase()
    );
    let body = match cache_get(pool, &key)? {
        Some(s) => s,
        None => {
            let mut url = format!(
                "https://openlibrary.org/search.json?title={}&limit=5&fields=key,first_publish_year,language,isbn,cover_i,subject,first_sentence",
                urlencoding::encode(title)
            );
            if !author.trim().is_empty() {
                url.push_str(&format!("&author={}", urlencoding::encode(author)));
            }
            let resp = http.get(&url).send().await.map_err(http_err)?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body = resp.text().await.map_err(http_err)?;
            cache_put(pool, &key, "openlibrary-search", &body)?;
            body
        }
    };
    Ok(parse_ol_search(&body))
}

/// Pure parse of an Open Library search response. Maps the first doc to a
/// Candidate, or None if the body is unparseable or has no docs.
fn parse_ol_search(body: &str) -> Option<Candidate> {
    let parsed: OlSearch = serde_json::from_str(body).ok()?;
    let doc = parsed.docs.into_iter().next()?;
    let isbn = doc
        .isbn
        .as_ref()
        .and_then(|xs| xs.iter().find(|s| s.len() == 13 || s.len() == 10).cloned());
    let cover_url = doc
        .cover_i
        .map(|id| format!("https://covers.openlibrary.org/b/id/{}-L.jpg", id))
        .or_else(|| isbn.as_ref().map(|i| format!("https://covers.openlibrary.org/b/isbn/{}-L.jpg", i)));

    Some(Candidate {
        isbn,
        pub_date: doc.first_publish_year.map(|y| y.to_string()),
        language: doc.language.and_then(|xs| xs.into_iter().next()),
        cover_url,
        work_key: doc.key,
        description: doc.first_sentence.and_then(|xs| xs.into_iter().next()),
        subjects: doc.subject.unwrap_or_default(),
    })
}

async fn openlibrary_work(
    http: &reqwest::Client,
    pool: &DbPool,
    work_key: &str,
) -> Result<Option<Candidate>> {
    let key_slug = work_key.trim_start_matches('/');
    let cache_key = format!("openlibrary:work:{}", work_key);
    let body = match cache_get(pool, &cache_key)? {
        Some(s) => s,
        None => {
            let url = format!("https://openlibrary.org/{}.json", key_slug);
            let resp = http.get(&url).send().await.map_err(http_err)?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body = resp.text().await.map_err(http_err)?;
            cache_put(pool, &cache_key, "openlibrary-work", &body)?;
            body
        }
    };
    Ok(Some(parse_ol_work(&body)))
}

/// Pure parse of an Open Library work record. `description` arrives either as
/// a plain string or as a `{ value, type }` object — both forms are handled.
fn parse_ol_work(body: &str) -> Candidate {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);

    let description = match v.get("description") {
        // Plain string
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        // { value: "...", type: "/type/text" }
        Some(serde_json::Value::Object(o)) => {
            o.get("value").and_then(|x| x.as_str()).map(|s| s.to_string())
        }
        _ => None,
    };
    let subjects = v
        .get("subjects")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Candidate {
        description,
        subjects,
        ..Default::default()
    }
}

// ───────── Google Books fallback ─────────

#[derive(Debug, Deserialize)]
struct GbResp {
    items: Option<Vec<GbItem>>,
}
#[derive(Debug, Deserialize)]
struct GbItem {
    #[serde(rename = "volumeInfo")]
    volume_info: Option<GbVolumeInfo>,
}
#[derive(Debug, Deserialize)]
struct GbVolumeInfo {
    description: Option<String>,
    #[serde(rename = "publishedDate")]
    published_date: Option<String>,
    language: Option<String>,
    categories: Option<Vec<String>>,
    #[serde(rename = "imageLinks")]
    image_links: Option<GbImages>,
    #[serde(rename = "industryIdentifiers")]
    industry_identifiers: Option<Vec<GbIdent>>,
}
#[derive(Debug, Deserialize)]
struct GbImages {
    thumbnail: Option<String>,
    #[serde(rename = "smallThumbnail")]
    small_thumbnail: Option<String>,
}
#[derive(Debug, Deserialize)]
struct GbIdent {
    #[serde(rename = "type")]
    kind: String,
    identifier: String,
}

async fn google_books(
    http: &reqwest::Client,
    pool: &DbPool,
    isbn: Option<&str>,
    title: &str,
    author: &str,
) -> Result<Option<Candidate>> {
    let query = match isbn {
        Some(i) if !i.is_empty() => format!("isbn:{}", i),
        _ => {
            if title.trim().is_empty() {
                return Ok(None);
            }
            let mut q = format!("intitle:{}", title);
            if !author.trim().is_empty() {
                q.push_str(&format!("+inauthor:{}", author));
            }
            q
        }
    };
    let cache_key = format!("googlebooks:{}", query.to_lowercase());
    let body = match cache_get(pool, &cache_key)? {
        Some(s) => s,
        None => {
            let url = format!(
                "https://www.googleapis.com/books/v1/volumes?q={}&maxResults=3",
                urlencoding::encode(&query)
            );
            let resp = http.get(&url).send().await.map_err(http_err)?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body = resp.text().await.map_err(http_err)?;
            cache_put(pool, &cache_key, "googlebooks", &body)?;
            body
        }
    };
    Ok(parse_google_books(&body))
}

/// Pure parse of a Google Books volumes response. Prefers an ISBN-13, falls
/// back to ISBN-10, and normalizes the thumbnail URL (http→https, drops the
/// `edge=curl` param that curls the cover art).
fn parse_google_books(body: &str) -> Option<Candidate> {
    let parsed: GbResp = serde_json::from_str(body).ok()?;
    let item = parsed.items?.into_iter().next()?;
    let info = item.volume_info?;

    let isbn_out = info
        .industry_identifiers
        .as_ref()
        .and_then(|xs| {
            xs.iter()
                .find(|x| x.kind == "ISBN_13")
                .or_else(|| xs.iter().find(|x| x.kind == "ISBN_10"))
                .map(|x| x.identifier.clone())
        });

    let cover_url = info.image_links.and_then(|i| i.thumbnail.or(i.small_thumbnail)).map(|u| {
        u.replace("http://", "https://")
            .replace("&edge=curl", "")
            .replace("edge=curl&", "")
            .replace("edge=curl", "")
    });

    Some(Candidate {
        isbn: isbn_out,
        description: info.description,
        pub_date: info.published_date,
        language: info.language,
        cover_url,
        subjects: info.categories.unwrap_or_default(),
        work_key: None,
    })
}

// ───────── covers & cache ─────────

async fn fetch_cover(
    http: &reqwest::Client,
    covers_dir: &Path,
    book_id: i64,
    url: &str,
) -> Result<PathBuf> {
    std::fs::create_dir_all(covers_dir)?;
    let resp = http.get(url).send().await.map_err(http_err)?;
    if !resp.status().is_success() {
        return Err(AtlasError::Msg(format!("cover http {}", resp.status())));
    }
    let bytes = resp.bytes().await.map_err(http_err)?;
    if bytes.len() < 1024 {
        return Err(AtlasError::Msg("cover unavailable".into()));
    }
    let ext = url
        .rsplit('?')
        .last()
        .unwrap_or(url)
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 4 && !e.contains('/'))
        .unwrap_or("jpg")
        .to_lowercase();
    let path = covers_dir.join(format!("ol-{}.{}", book_id, ext));
    std::fs::write(&path, &bytes)?;
    Ok(path)
}

fn http_err(e: reqwest::Error) -> AtlasError {
    AtlasError::Msg(format!("http: {}", e))
}

// ───────── cover candidates ─────────

#[derive(serde::Serialize, Debug, Clone)]
pub struct CoverCandidate {
    pub url: String,
    pub thumb_url: String,
    pub source: String,
}

/// Returns up to ~24 candidate cover URLs from the available sources.
/// Network calls reuse the same cached endpoints as enrichment, so calling
/// this on an already-enriched book is essentially free.
pub async fn cover_candidates(pool: DbPool, book_id: i64) -> Result<Vec<CoverCandidate>> {
    let (title, isbn, first_author) = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT title, isbn,
                    COALESCE((SELECT a.name FROM book_authors ba
                              JOIN authors a ON a.id = ba.author_id
                              WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1), '')
             FROM books b WHERE id = ?1",
            [book_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )?
    };

    let http = client()?;
    let mut out: Vec<CoverCandidate> = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    let push = |out: &mut Vec<CoverCandidate>, seen: &mut std::collections::HashSet<String>, url: String, thumb_url: String, source: &str| {
        if seen.insert(url.clone()) {
            out.push(CoverCandidate { url, thumb_url, source: source.to_string() });
        }
    };

    // 1. Open Library — edition by ISBN. Returns a covers[] array.
    if let Some(isbn) = isbn.as_deref().filter(|s| !s.is_empty()) {
        let clean: String = isbn.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if !clean.is_empty() {
            // Re-use the cached edition body fetched during enrichment.
            let _ = openlibrary_by_isbn(&http, &pool, &clean).await;
            if let Some(body) = cache_get(&pool, &format!("openlibrary:edition:{}", clean))? {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(covers) = v.get("covers").and_then(|x| x.as_array()) {
                        for c in covers.iter().filter_map(|x| x.as_i64()).filter(|&n| n > 0).take(8) {
                            push(
                                &mut out, &mut seen,
                                format!("https://covers.openlibrary.org/b/id/{}-L.jpg", c),
                                format!("https://covers.openlibrary.org/b/id/{}-M.jpg", c),
                                "openlibrary",
                            );
                        }
                    }
                }
            }
            // ISBN-direct fallback (always exists if OL has any record).
            push(
                &mut out, &mut seen,
                format!("https://covers.openlibrary.org/b/isbn/{}-L.jpg", clean),
                format!("https://covers.openlibrary.org/b/isbn/{}-M.jpg", clean),
                "openlibrary",
            );
        }
    }

    // 2. Open Library — search by title/author returns multiple editions, each
    //    with its own cover_i. Great source of alternate-edition art.
    if !title.trim().is_empty() {
        let _ = openlibrary_search(&http, &pool, &title, &first_author).await;
        let key = format!(
            "openlibrary:search:{}|{}",
            title.to_lowercase(),
            first_author.to_lowercase()
        );
        if let Some(body) = cache_get(&pool, &key)? {
            if let Ok(parsed) = serde_json::from_str::<OlSearch>(&body) {
                for doc in parsed.docs.into_iter().take(10) {
                    if let Some(id) = doc.cover_i {
                        push(
                            &mut out, &mut seen,
                            format!("https://covers.openlibrary.org/b/id/{}-L.jpg", id),
                            format!("https://covers.openlibrary.org/b/id/{}-M.jpg", id),
                            "openlibrary",
                        );
                    }
                }
            }
        }
    }

    // 3. Google Books — multiple items[] often correspond to multiple editions.
    {
        let _ = google_books(&http, &pool, isbn.as_deref(), &title, &first_author).await;
        let query = match isbn.as_deref() {
            Some(i) if !i.is_empty() => format!("isbn:{}", i),
            _ => {
                if title.trim().is_empty() {
                    String::new()
                } else {
                    let mut q = format!("intitle:{}", title);
                    if !first_author.trim().is_empty() {
                        q.push_str(&format!("+inauthor:{}", first_author));
                    }
                    q
                }
            }
        };
        if !query.is_empty() {
            let cache_key = format!("googlebooks:{}", query.to_lowercase());
            if let Some(body) = cache_get(&pool, &cache_key)? {
                if let Ok(parsed) = serde_json::from_str::<GbResp>(&body) {
                    for item in parsed.items.unwrap_or_default().into_iter().take(8) {
                        let Some(info) = item.volume_info else { continue; };
                        let Some(links) = info.image_links else { continue; };
                        let Some(raw) = links.thumbnail.or(links.small_thumbnail) else {
                            continue;
                        };
                        let base = raw
                            .replace("http://", "https://")
                            .replace("&edge=curl", "")
                            .replace("edge=curl&", "")
                            .replace("edge=curl", "");
                        // Strip existing zoom param if present and synthesize two sizes.
                        let stripped: String = base
                            .split('&')
                            .filter(|kv| !kv.starts_with("zoom="))
                            .collect::<Vec<_>>()
                            .join("&");
                        let full = if stripped.contains('?') {
                            format!("{}&zoom=3", stripped)
                        } else {
                            format!("{}?zoom=3", stripped)
                        };
                        let thumb = if stripped.contains('?') {
                            format!("{}&zoom=1", stripped)
                        } else {
                            format!("{}?zoom=1", stripped)
                        };
                        push(&mut out, &mut seen, full, thumb, "googlebooks");
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Downloads `url` and replaces this book's cover. New filename includes a
/// timestamp so the frontend (and the browser's `asset://` cache) sees a
/// distinct URL after the swap.
pub async fn set_cover_from_url(
    pool: DbPool,
    covers_dir: PathBuf,
    book_id: i64,
    url: String,
) -> Result<String> {
    let http = client()?;
    std::fs::create_dir_all(&covers_dir)?;
    let resp = http.get(&url).send().await.map_err(http_err)?;
    if !resp.status().is_success() {
        return Err(AtlasError::Msg(format!("cover http {}", resp.status())));
    }
    let bytes = resp.bytes().await.map_err(http_err)?;
    if bytes.len() < 1024 {
        return Err(AtlasError::Msg("cover unavailable".into()));
    }
    let ext = url
        .rsplit('?')
        .last()
        .unwrap_or(&url)
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 4 && !e.contains('/'))
        .unwrap_or("jpg")
        .to_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = covers_dir.join(format!("cover-{}-{}.{}", book_id, stamp, ext));
    std::fs::write(&path, &bytes)?;

    // Best-effort: remove the previously linked cover file so the covers
    // directory doesn't accumulate dead files. Only delete files inside the
    // covers dir (defense against an external path having slipped in).
    let prev: Option<String> = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT cover_path FROM books WHERE id = ?1",
            [book_id],
            |r| r.get::<_, Option<String>>(0),
        )?
    };
    if let Some(prev) = prev {
        let prev_path = std::path::PathBuf::from(&prev);
        if prev_path.starts_with(&covers_dir) && prev_path != path {
            let _ = std::fs::remove_file(&prev_path);
        }
    }

    {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE books SET cover_path = ?1, modified_at = datetime('now') WHERE id = ?2",
            rusqlite::params![path.to_string_lossy(), book_id],
        )?;
    }
    Ok(path.to_string_lossy().to_string())
}

fn cache_get(pool: &DbPool, key: &str) -> Result<Option<String>> {
    let conn = pool.get()?;
    let row = conn.query_row(
        "SELECT payload, fetched_at FROM enrichment_cache WHERE key = ?1",
        [key],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    );
    match row {
        Ok((payload, fetched_at)) => {
            if let Ok(when) = chrono::NaiveDateTime::parse_from_str(&fetched_at, "%Y-%m-%d %H:%M:%S")
            {
                let age = chrono::Utc::now().naive_utc() - when;
                if age.num_days() < CACHE_TTL_DAYS {
                    return Ok(Some(payload));
                }
            }
            Ok(None)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn cache_put(pool: &DbPool, key: &str, source: &str, payload: &str) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR REPLACE INTO enrichment_cache (key, source, payload, fetched_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        rusqlite::params![key, source, payload],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ───────── pure helpers ─────────

    #[test]
    fn title_case_capitalizes_each_word() {
        assert_eq!(title_case("science fiction"), "Science Fiction");
        assert_eq!(title_case("FANTASY"), "Fantasy");
        assert_eq!(title_case("war and peace"), "War And Peace");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn clean_subjects_filters_noise_and_caps_count() {
        let subjects = vec![
            "Fantasy".to_string(),
            "Fiction -- General".to_string(),        // qualified (--) → dropped
            "NYT:bestseller".to_string(),             // noisy prefix → dropped
            "PROTECTED DAISY".to_string(),            // all-caps noise → dropped
            "this-subject-is-far-too-long-to-be-a-tag".to_string(), // > TAG_MAX_LEN → dropped
            "Adventure".to_string(),
            "Dragons".to_string(),
            "Heroes".to_string(),
            "Magic".to_string(),
            "Quests".to_string(),
            "Middle Earth".to_string(),              // would exceed MAX_AUTO_TAGS
        ];
        let tags = clean_subjects_to_tags(&subjects, &[]);
        assert!(tags.contains(&"Fantasy".to_string()));
        assert!(tags.contains(&"Adventure".to_string()));
        assert!(!tags.iter().any(|t| t.contains("--")));
        assert!(!tags.iter().any(|t| t.to_lowercase().contains("nyt")));
        assert!(!tags.iter().any(|t| t.chars().all(|c| c.is_ascii_uppercase() || c == ' ')));
        assert!(tags.len() <= MAX_AUTO_TAGS, "got {} tags", tags.len());
    }

    #[test]
    fn clean_subjects_skips_existing_case_insensitively() {
        let subjects = vec!["Fantasy".to_string(), "Adventure".to_string()];
        let existing = vec!["fantasy".to_string()];
        let tags = clean_subjects_to_tags(&subjects, &existing);
        assert!(!tags.iter().any(|t| t.eq_ignore_ascii_case("fantasy")));
        assert!(tags.contains(&"Adventure".to_string()));
    }

    #[test]
    fn merge_only_fills_empty_fields() {
        let mut into = Candidate {
            isbn: Some("111".into()),
            description: Some("original".into()),
            ..Default::default()
        };
        let other = Candidate {
            isbn: Some("999".into()),
            description: None,
            pub_date: Some("2001".into()),
            subjects: vec!["A".into()],
            ..Default::default()
        };
        merge(&mut into, other);
        assert_eq!(into.isbn.as_deref(), Some("111")); // existing kept
        assert_eq!(into.description.as_deref(), Some("original")); // existing kept
        assert_eq!(into.pub_date.as_deref(), Some("2001")); // empty filled
        assert_eq!(into.subjects, vec!["A".to_string()]);
    }

    #[test]
    fn merge_dedupes_subjects() {
        let mut into = Candidate { subjects: vec!["A".into(), "B".into()], ..Default::default() };
        let other = Candidate { subjects: vec!["B".into(), "C".into()], ..Default::default() };
        merge(&mut into, other);
        assert_eq!(into.subjects, vec!["A".to_string(), "B".into(), "C".into()]);
    }

    // ───────── Open Library edition (/isbn/X.json) ─────────

    #[test]
    fn parse_ol_edition_extracts_all_fields() {
        let body = r#"{
            "publish_date": "1937",
            "languages": [{"key": "/languages/eng"}],
            "covers": [12003329, -1],
            "works": [{"key": "/works/OL27482W"}]
        }"#;
        let c = parse_ol_edition(body, "9780547928227");
        assert_eq!(c.isbn.as_deref(), Some("9780547928227"));
        assert_eq!(c.pub_date.as_deref(), Some("1937"));
        assert_eq!(c.language.as_deref(), Some("eng"));
        assert_eq!(
            c.cover_url.as_deref(),
            Some("https://covers.openlibrary.org/b/id/12003329-L.jpg")
        );
        assert_eq!(c.work_key.as_deref(), Some("/works/OL27482W"));
    }

    #[test]
    fn parse_ol_edition_falls_back_to_isbn_cover_when_no_cover_id() {
        let c = parse_ol_edition(r#"{"covers": []}"#, "123X");
        assert_eq!(
            c.cover_url.as_deref(),
            Some("https://covers.openlibrary.org/b/isbn/123X-L.jpg")
        );
    }

    #[test]
    fn parse_ol_edition_tolerates_garbage_body() {
        let c = parse_ol_edition("<<not json>>", "999");
        assert_eq!(c.isbn.as_deref(), Some("999"));
        assert!(c.cover_url.unwrap().contains("/isbn/999-")); // still synthesized
    }

    // ───────── Open Library search (/search.json) ─────────

    #[test]
    fn parse_ol_search_maps_first_doc() {
        let body = r#"{"docs":[
            {"key":"/works/OL27482W","first_publish_year":1937,"language":["eng"],
             "isbn":["x","9780547928227"],"cover_i":14627509,
             "subject":["Fantasy","Adventure"],"first_sentence":["In a hole in the ground."]}
        ]}"#;
        let c = parse_ol_search(body).expect("a candidate");
        assert_eq!(c.work_key.as_deref(), Some("/works/OL27482W"));
        assert_eq!(c.pub_date.as_deref(), Some("1937"));
        assert_eq!(c.language.as_deref(), Some("eng"));
        assert_eq!(c.isbn.as_deref(), Some("9780547928227")); // only 13/10-digit accepted
        assert_eq!(
            c.cover_url.as_deref(),
            Some("https://covers.openlibrary.org/b/id/14627509-L.jpg")
        );
        assert_eq!(c.description.as_deref(), Some("In a hole in the ground."));
        assert_eq!(c.subjects, vec!["Fantasy".to_string(), "Adventure".into()]);
    }

    #[test]
    fn parse_ol_search_none_on_empty_or_garbage() {
        assert!(parse_ol_search(r#"{"docs":[]}"#).is_none());
        assert!(parse_ol_search("not json").is_none());
    }

    // ───────── Open Library work — the drift-prone description branch ─────────

    #[test]
    fn parse_ol_work_handles_object_description() {
        let body = r#"{"description":{"value":"A tale of a hobbit.","type":"/type/text"},
                        "subjects":["Fantasy","Dragons"]}"#;
        let c = parse_ol_work(body);
        assert_eq!(c.description.as_deref(), Some("A tale of a hobbit."));
        assert_eq!(c.subjects.len(), 2);
    }

    #[test]
    fn parse_ol_work_handles_string_description() {
        let c = parse_ol_work(r#"{"description":"Plain string form.","subjects":[]}"#);
        assert_eq!(c.description.as_deref(), Some("Plain string form."));
        assert!(c.subjects.is_empty());
    }

    #[test]
    fn parse_ol_work_missing_description_is_none() {
        let c = parse_ol_work(r#"{"subjects":["X"]}"#);
        assert!(c.description.is_none());
        assert_eq!(c.subjects, vec!["X".to_string()]);
    }

    // ───────── Google Books (/volumes) ─────────

    #[test]
    fn parse_google_books_prefers_isbn13_and_cleans_cover_url() {
        let body = r#"{"items":[{"volumeInfo":{
            "description":"GB description.",
            "publishedDate":"1937-09-21",
            "language":"en",
            "categories":["Fiction"],
            "imageLinks":{"thumbnail":"http://books.google.com/books?id=abc&edge=curl"},
            "industryIdentifiers":[
                {"type":"ISBN_10","identifier":"0547928211"},
                {"type":"ISBN_13","identifier":"9780547928227"}
            ]
        }}]}"#;
        let c = parse_google_books(body).expect("a candidate");
        assert_eq!(c.description.as_deref(), Some("GB description."));
        assert_eq!(c.pub_date.as_deref(), Some("1937-09-21"));
        assert_eq!(c.language.as_deref(), Some("en"));
        assert_eq!(c.isbn.as_deref(), Some("9780547928227")); // ISBN_13 preferred over 10
        assert_eq!(
            c.cover_url.as_deref(),
            Some("https://books.google.com/books?id=abc") // https + edge=curl stripped
        );
        assert_eq!(c.subjects, vec!["Fiction".to_string()]);
    }

    #[test]
    fn parse_google_books_none_on_empty_items() {
        assert!(parse_google_books(r#"{"items":[]}"#).is_none());
        assert!(parse_google_books(r#"{}"#).is_none());
        assert!(parse_google_books("garbage").is_none());
    }
}
