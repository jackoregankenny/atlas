use crate::error::{AtlasError, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Default, Clone)]
pub struct EpubMeta {
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub pub_date: Option<String>,
    pub description: Option<String>,
    pub isbn: Option<String>,
    pub cover_bytes: Option<Vec<u8>>,
    pub cover_ext: Option<String>,
}

pub fn read_meta(path: &Path) -> Result<EpubMeta> {
    let file = File::open(path)?;
    let mut zip = zip::ZipArchive::new(file)?;

    let opf_path = find_opf_path(&mut zip)?;
    let opf_xml = read_zip_entry_to_string(&mut zip, &opf_path)?;
    let parsed = parse_opf(&opf_xml)?;
    let mut meta = parsed.meta;

    let base = std::path::Path::new(&opf_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let join_base = |rel: &str| {
        if base.is_empty() {
            rel.to_string()
        } else {
            format!("{}/{}", base, rel)
        }
    };

    // Try in order: properties=cover-image, meta name=cover → manifest id,
    // then heuristic: any image in manifest whose href contains "cover".
    let mut candidates: Vec<String> = Vec::new();
    if let Some(rel) = &parsed.cover_href {
        candidates.push(join_base(rel));
    }
    if let Some(id) = &parsed.cover_id {
        if let Some(rel) = parsed.manifest.get(id) {
            candidates.push(join_base(rel));
        }
    }
    for (_, href) in parsed.manifest.iter() {
        let lower = href.to_lowercase();
        if lower.contains("cover") && is_image_ext(&lower) {
            candidates.push(join_base(href));
        }
    }
    // Last resort: any image inside the zip with "cover" in the name.
    if candidates.is_empty() {
        for i in 0..zip.len() {
            if let Ok(entry) = zip.by_index(i) {
                let name = entry.name().to_string();
                let lower = name.to_lowercase();
                if lower.contains("cover") && is_image_ext(&lower) {
                    candidates.push(name);
                }
            }
        }
    }

    for c in candidates {
        if let Ok(bytes) = read_zip_entry_to_bytes(&mut zip, &c) {
            if bytes.len() > 256 {
                let ext = std::path::Path::new(&c)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("jpg")
                    .to_lowercase();
                meta.cover_bytes = Some(bytes);
                meta.cover_ext = Some(ext);
                break;
            }
        }
    }

    Ok(meta)
}

fn is_image_ext(s: &str) -> bool {
    [".jpg", ".jpeg", ".png", ".webp", ".gif"]
        .iter()
        .any(|e| s.ends_with(e))
}

fn find_opf_path<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>) -> Result<String> {
    let container = read_zip_entry_to_string(zip, "META-INF/container.xml")?;
    let mut reader = Reader::from_str(&container);
    reader.trim_text(true);
    let mut buf = Vec::new();
    loop {
        let evt = reader.read_event_into(&mut buf)?;
        match evt {
            Event::Empty(e) | Event::Start(e) => {
                if local_name(&e) == b"rootfile" {
                    for attr in e.attributes() {
                        let attr = attr?;
                        if attr.key.as_ref() == b"full-path" {
                            return Ok(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Err(AtlasError::Msg("opf rootfile not found".into()))
}

fn read_zip_entry_to_string<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|_| AtlasError::Msg(format!("epub entry missing: {}", name)))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)?;
    Ok(s)
}

fn read_zip_entry_to_bytes<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>> {
    let mut entry = zip
        .by_name(name)
        .map_err(|_| AtlasError::Msg(format!("epub entry missing: {}", name)))?;
    let mut b = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut b)?;
    Ok(b)
}

fn local_name<'a>(e: &'a BytesStart<'a>) -> &'a [u8] {
    let bytes: &'a [u8] = e.name().into_inner();
    match bytes.iter().rposition(|&b| b == b':') {
        Some(idx) => &bytes[idx + 1..],
        None => bytes,
    }
}

struct OpfParsed {
    meta: EpubMeta,
    manifest: std::collections::HashMap<String, String>,
    cover_id: Option<String>,
    cover_href: Option<String>,
}

fn parse_opf(xml: &str) -> Result<OpfParsed> {
    use std::collections::HashMap;
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut meta = EpubMeta::default();
    let mut manifest: HashMap<String, String> = HashMap::new();
    let mut cover_id: Option<String> = None;
    let mut cover_href: Option<String> = None;

    enum Cur {
        None,
        Title,
        Creator,
        Lang,
        Date,
        Description,
        Identifier { is_isbn: bool },
    }
    let mut cur = Cur::None;
    let mut text_acc = String::new();

    // Handles both <item ... /> and <item ...>...</item>, similarly for <meta>.
    let handle_void_element = |e: &BytesStart,
                               manifest: &mut HashMap<String, String>,
                               cover_id: &mut Option<String>,
                               cover_href: &mut Option<String>|
     -> Result<()> {
        match local_name(e) {
            b"item" => {
                let mut id = None;
                let mut href = None;
                let mut properties: Option<String> = None;
                for attr in e.attributes() {
                    let attr = attr?;
                    match attr.key.as_ref() {
                        b"id" => id = Some(String::from_utf8_lossy(&attr.value).to_string()),
                        b"href" => href = Some(String::from_utf8_lossy(&attr.value).to_string()),
                        b"properties" => {
                            properties = Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                        _ => {}
                    }
                }
                if let (Some(i), Some(h)) = (id, href) {
                    if let Some(p) = &properties {
                        if p.split_whitespace().any(|t| t == "cover-image") {
                            *cover_href = Some(h.clone());
                        }
                    }
                    manifest.insert(i, h);
                }
            }
            b"meta" => {
                let mut name_attr = None;
                let mut content_attr = None;
                for attr in e.attributes() {
                    let attr = attr?;
                    match attr.key.as_ref() {
                        b"name" => {
                            name_attr = Some(String::from_utf8_lossy(&attr.value).to_string())
                        }
                        b"content" => {
                            content_attr =
                                Some(String::from_utf8_lossy(&attr.value).to_string())
                        }
                        _ => {}
                    }
                }
                if let (Some(n), Some(c)) = (name_attr, content_attr) {
                    if n.eq_ignore_ascii_case("cover") {
                        *cover_id = Some(c);
                    }
                }
            }
            _ => {}
        }
        Ok(())
    };

    loop {
        let event = reader.read_event_into(&mut buf)?;
        match event {
            Event::Start(e) => {
                let local = local_name(&e);
                // void-element-like elements may appear with explicit </item>
                handle_void_element(&e, &mut manifest, &mut cover_id, &mut cover_href)?;
                match local {
                    b"title" => {
                        cur = Cur::Title;
                        text_acc.clear();
                    }
                    b"creator" => {
                        cur = Cur::Creator;
                        text_acc.clear();
                    }
                    b"language" => {
                        cur = Cur::Lang;
                        text_acc.clear();
                    }
                    b"date" => {
                        cur = Cur::Date;
                        text_acc.clear();
                    }
                    b"description" => {
                        cur = Cur::Description;
                        text_acc.clear();
                    }
                    b"identifier" => {
                        let mut is_isbn = false;
                        for attr in e.attributes() {
                            let attr = attr?;
                            let k = attr.key.as_ref();
                            let v = String::from_utf8_lossy(&attr.value).to_lowercase();
                            if (k.ends_with(b"scheme") || k == b"scheme") && v.contains("isbn") {
                                is_isbn = true;
                            }
                        }
                        cur = Cur::Identifier { is_isbn };
                        text_acc.clear();
                    }
                    _ => {}
                }
            }
            Event::Empty(e) => {
                handle_void_element(&e, &mut manifest, &mut cover_id, &mut cover_href)?;
            }
            Event::Text(t) => {
                text_acc.push_str(&t.unescape().unwrap_or_default());
            }
            Event::End(_) => {
                let val = text_acc.trim().to_string();
                match std::mem::replace(&mut cur, Cur::None) {
                    Cur::Title if meta.title.is_empty() && !val.is_empty() => meta.title = val,
                    Cur::Creator if !val.is_empty() => meta.authors.push(val),
                    Cur::Lang if meta.language.is_none() && !val.is_empty() => {
                        meta.language = Some(val)
                    }
                    Cur::Date if meta.pub_date.is_none() && !val.is_empty() => {
                        meta.pub_date = Some(val)
                    }
                    Cur::Description if meta.description.is_none() && !val.is_empty() => {
                        meta.description = Some(val)
                    }
                    Cur::Identifier { is_isbn } if is_isbn && meta.isbn.is_none() => {
                        let digits: String =
                            val.chars().filter(|c| c.is_ascii_digit() || *c == 'X').collect();
                        if !digits.is_empty() {
                            meta.isbn = Some(digits);
                        }
                    }
                    _ => {}
                }
                text_acc.clear();
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    if meta.title.is_empty() {
        meta.title = "Untitled".into();
    }
    Ok(OpfParsed {
        meta,
        manifest,
        cover_id,
        cover_href,
    })
}

/// Read the EPUB's reading-order content: returns the raw XHTML of
/// each spine document in order. Used by the export pipeline
/// (`convert::epub_to_*`) to produce text / markdown / html outputs.
///
/// We re-parse the OPF rather than threading spine through `parse_opf`
/// because spine isn't useful for the import-time metadata path and
/// keeping the two passes separate is simpler than weaving a second
/// concern through the existing parser.
pub fn read_spine_xhtml(path: &Path) -> Result<Vec<String>> {
    let file = File::open(path)?;
    let mut zip = zip::ZipArchive::new(file)?;

    let opf_path = find_opf_path(&mut zip)?;
    let opf_xml = read_zip_entry_to_string(&mut zip, &opf_path)?;
    let base = std::path::Path::new(&opf_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let join_base = |rel: &str| {
        if base.is_empty() {
            rel.to_string()
        } else {
            format!("{}/{}", base, rel)
        }
    };

    // Single pass: collect manifest (id → href) and spine (ordered idrefs).
    let mut reader = Reader::from_str(&opf_xml);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut manifest: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut spine: Vec<String> = Vec::new();
    let collect = |e: &BytesStart,
                   manifest: &mut std::collections::HashMap<String, String>,
                   spine: &mut Vec<String>|
     -> Result<()> {
        match local_name(e) {
            b"item" => {
                let mut id = None;
                let mut href = None;
                for attr in e.attributes() {
                    let attr = attr?;
                    match attr.key.as_ref() {
                        b"id" => id = Some(String::from_utf8_lossy(&attr.value).to_string()),
                        b"href" => href = Some(String::from_utf8_lossy(&attr.value).to_string()),
                        _ => {}
                    }
                }
                if let (Some(i), Some(h)) = (id, href) {
                    manifest.insert(i, h);
                }
            }
            b"itemref" => {
                for attr in e.attributes() {
                    let attr = attr?;
                    if attr.key.as_ref() == b"idref" {
                        spine.push(String::from_utf8_lossy(&attr.value).to_string());
                    }
                }
            }
            _ => {}
        }
        Ok(())
    };
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) | Event::Empty(e) => collect(&e, &mut manifest, &mut spine)?,
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    let mut out = Vec::with_capacity(spine.len());
    for idref in &spine {
        let Some(href) = manifest.get(idref) else {
            continue;
        };
        // EPUBs sometimes URL-encode hrefs (e.g. "ch%201.xhtml"). The
        // zip library expects the decoded path.
        let decoded = percent_decode(href);
        let path_in_zip = join_base(&decoded);
        if let Ok(s) = read_zip_entry_to_string(&mut zip, &path_in_zip) {
            out.push(s);
        }
    }
    Ok(out)
}

/// Minimal RFC 3986 percent-decoder. We avoid pulling in a URL crate
/// for a one-liner need: EPUB hrefs are simple enough that this
/// covers the realistic cases.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
