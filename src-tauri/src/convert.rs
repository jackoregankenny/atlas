//! EPUB → text / markdown / html exporters.
//!
//! Pure Rust, no external binaries. Each exporter walks the EPUB
//! spine via `epub::read_spine_xhtml` and folds the per-document
//! output into one string.
//!
//! Output quality is "good enough for read-elsewhere" — block
//! structure preserved, inline emphasis preserved for markdown, image
//! references dropped (the exports live next to the canonical EPUB,
//! so any reader who wants the originals can crack the EPUB open).

use crate::epub;
use crate::error::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::path::Path;

/// Concatenate all spine documents as plain text. Block-level tags
/// emit a blank line, inline tags don't. Whitespace collapsed.
pub fn epub_to_text(path: &Path) -> Result<String> {
    let docs = epub::read_spine_xhtml(path)?;
    let mut out = String::new();
    for xhtml in &docs {
        let t = xhtml_to_text(xhtml);
        if !t.is_empty() {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            out.push_str(&t);
        }
    }
    Ok(out)
}

/// Concatenate all spine documents as markdown. Headings, paragraphs,
/// emphasis, lists, blockquotes, and code are preserved.
pub fn epub_to_markdown(path: &Path) -> Result<String> {
    let docs = epub::read_spine_xhtml(path)?;
    let mut out = String::new();
    for xhtml in &docs {
        let md = xhtml_to_markdown(xhtml);
        if !md.is_empty() {
            if !out.is_empty() {
                out.push_str("\n\n---\n\n");
            }
            out.push_str(&md);
        }
    }
    Ok(out)
}

/// Concatenate all spine documents as one HTML file. Body fragments
/// are wrapped in a minimal <html><body> shell so the result opens
/// in any browser.
pub fn epub_to_html(path: &Path) -> Result<String> {
    let docs = epub::read_spine_xhtml(path)?;
    let mut out = String::from(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"></head><body>\n",
    );
    for (i, xhtml) in docs.iter().enumerate() {
        if i > 0 {
            out.push_str("\n<hr>\n");
        }
        out.push_str(&extract_body(xhtml));
        out.push('\n');
    }
    out.push_str("</body></html>\n");
    Ok(out)
}

// ─── XHTML → text ───────────────────────────────────────────────────

const BLOCK_TAGS: &[&[u8]] = &[
    b"p", b"div", b"section", b"article", b"header", b"footer", b"li",
    b"h1", b"h2", b"h3", b"h4", b"h5", b"h6", b"blockquote", b"pre",
    b"hr", b"br", b"tr",
];

fn is_block(name: &[u8]) -> bool {
    BLOCK_TAGS.iter().any(|t| eq_ignore_ascii_case(name, t))
}

fn eq_ignore_ascii_case(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| x.eq_ignore_ascii_case(y))
}

fn xhtml_to_text(xhtml: &str) -> String {
    let mut reader = Reader::from_str(xhtml);
    reader.trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut skip_depth: u32 = 0;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().into_inner().to_vec();
                if eq_ignore_ascii_case(&name, b"script") || eq_ignore_ascii_case(&name, b"style") {
                    skip_depth += 1;
                } else if is_block(&name) && !out.ends_with("\n\n") {
                    if !out.is_empty() && !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push('\n');
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().into_inner().to_vec();
                if eq_ignore_ascii_case(&name, b"script") || eq_ignore_ascii_case(&name, b"style") {
                    if skip_depth > 0 {
                        skip_depth -= 1;
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name = e.name().into_inner();
                if is_block(name) && !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            Ok(Event::Text(t)) if skip_depth == 0 => {
                let s = t.unescape().unwrap_or_default();
                // Collapse runs of whitespace inside a text node.
                let mut prev_space = out.ends_with(|c: char| c.is_whitespace()) || out.is_empty();
                for c in s.chars() {
                    if c.is_whitespace() {
                        if !prev_space {
                            out.push(' ');
                            prev_space = true;
                        }
                    } else {
                        out.push(c);
                        prev_space = false;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    // Collapse 3+ newlines down to 2 (paragraph break).
    let mut cleaned = String::with_capacity(out.len());
    let mut nl_run = 0;
    for c in out.chars() {
        if c == '\n' {
            nl_run += 1;
            if nl_run <= 2 {
                cleaned.push(c);
            }
        } else {
            nl_run = 0;
            cleaned.push(c);
        }
    }
    cleaned.trim().to_string()
}

// ─── XHTML → markdown ───────────────────────────────────────────────
//
// Inline emphasis, headings, lists, blockquote, code, links. Images
// dropped (alt text preserved as plain text). Not a complete CommonMark
// pipeline — a good-enough renderer for "read this book in obsidian".

fn xhtml_to_markdown(xhtml: &str) -> String {
    let mut reader = Reader::from_str(xhtml);
    reader.trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut list_stack: Vec<ListKind> = Vec::new();
    let mut list_counter: Vec<u32> = Vec::new();
    let mut skip_depth: u32 = 0;
    let mut in_pre = false;
    let mut href_stack: Vec<String> = Vec::new();

    let push_block = |out: &mut String| {
        while out.ends_with(' ') {
            out.pop();
        }
        if !out.is_empty() && !out.ends_with("\n\n") {
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
        }
    };

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().into_inner().to_vec();
                let lname = name.to_ascii_lowercase();
                match lname.as_slice() {
                    b"script" | b"style" => skip_depth += 1,
                    b"h1" => { push_block(&mut out); out.push_str("# "); }
                    b"h2" => { push_block(&mut out); out.push_str("## "); }
                    b"h3" => { push_block(&mut out); out.push_str("### "); }
                    b"h4" => { push_block(&mut out); out.push_str("#### "); }
                    b"h5" => { push_block(&mut out); out.push_str("##### "); }
                    b"h6" => { push_block(&mut out); out.push_str("###### "); }
                    b"p" | b"div" | b"section" | b"article" => push_block(&mut out),
                    b"blockquote" => { push_block(&mut out); out.push_str("> "); }
                    b"pre" => { push_block(&mut out); out.push_str("```\n"); in_pre = true; }
                    b"code" if !in_pre => out.push('`'),
                    b"em" | b"i" => out.push('*'),
                    b"strong" | b"b" => out.push_str("**"),
                    b"ul" => { push_block(&mut out); list_stack.push(ListKind::Bullet); list_counter.push(0); }
                    b"ol" => { push_block(&mut out); list_stack.push(ListKind::Ordered); list_counter.push(0); }
                    b"li" => {
                        if !out.is_empty() && !out.ends_with('\n') {
                            out.push('\n');
                        }
                        let depth = list_stack.len().saturating_sub(1);
                        for _ in 0..depth {
                            out.push_str("  ");
                        }
                        match list_stack.last() {
                            Some(ListKind::Bullet) => out.push_str("- "),
                            Some(ListKind::Ordered) => {
                                if let Some(n) = list_counter.last_mut() {
                                    *n += 1;
                                    out.push_str(&format!("{}. ", n));
                                }
                            }
                            None => {}
                        }
                    }
                    b"a" => {
                        let mut href = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"href" {
                                href = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        out.push('[');
                        href_stack.push(href);
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().into_inner().to_ascii_lowercase();
                match name.as_slice() {
                    b"script" | b"style" => { if skip_depth > 0 { skip_depth -= 1; } }
                    b"h1" | b"h2" | b"h3" | b"h4" | b"h5" | b"h6"
                    | b"p" | b"div" | b"section" | b"article" | b"li" => push_block(&mut out),
                    b"blockquote" => push_block(&mut out),
                    b"pre" => { if !out.ends_with('\n') { out.push('\n'); } out.push_str("```"); push_block(&mut out); in_pre = false; }
                    b"code" if !in_pre => out.push('`'),
                    b"em" | b"i" => out.push('*'),
                    b"strong" | b"b" => out.push_str("**"),
                    b"ul" | b"ol" => { list_stack.pop(); list_counter.pop(); push_block(&mut out); }
                    b"a" => {
                        let href = href_stack.pop().unwrap_or_default();
                        if href.is_empty() {
                            out.push(']');
                        } else {
                            out.push_str(&format!("]({})", href));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let name = e.name().into_inner().to_ascii_lowercase();
                match name.as_slice() {
                    b"br" => out.push_str("  \n"),
                    b"hr" => { push_block(&mut out); out.push_str("---"); push_block(&mut out); }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) if skip_depth == 0 => {
                let s = t.unescape().unwrap_or_default();
                if in_pre {
                    out.push_str(&s);
                } else {
                    let mut prev_space = out.ends_with(|c: char| c.is_whitespace()) || out.is_empty();
                    for c in s.chars() {
                        if c.is_whitespace() {
                            if !prev_space {
                                out.push(' ');
                                prev_space = true;
                            }
                        } else {
                            out.push(c);
                            prev_space = false;
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out.trim().to_string()
}

#[derive(Copy, Clone)]
enum ListKind {
    Bullet,
    Ordered,
}

// ─── XHTML → html (body extract) ────────────────────────────────────

/// Pull the `<body>...</body>` inner content if present; otherwise
/// return the input unchanged. Used by `epub_to_html` to compose one
/// HTML doc out of many spine chapters.
fn extract_body(xhtml: &str) -> String {
    let lower = xhtml.to_ascii_lowercase();
    if let Some(start) = lower.find("<body") {
        if let Some(start_close) = lower[start..].find('>') {
            let body_open_end = start + start_close + 1;
            if let Some(end) = lower[body_open_end..].find("</body>") {
                return xhtml[body_open_end..body_open_end + end].to_string();
            }
        }
    }
    xhtml.to_string()
}
