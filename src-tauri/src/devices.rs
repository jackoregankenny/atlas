use crate::error::{AtlasError, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub root: PathBuf,
    pub books_dir: PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Kindle,
    Kobo,
    PocketBook,
    Boox,
    Remarkable,
    Generic,
}

/// Scan the OS for connected USB e-readers.
///
/// Detection is best-effort: a removable volume mounted somewhere with the
/// characteristic file layout for a known device. Polling is on-demand; the
/// frontend calls `list_devices` when it cares.
pub fn detect_devices() -> Vec<Device> {
    let mut out = Vec::new();
    for root in candidate_roots() {
        if let Some(d) = identify(&root) {
            out.push(d);
        }
    }
    out
}

fn candidate_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        scan_dir("/Volumes")
    }
    #[cfg(target_os = "windows")]
    {
        // Letters A-Z; the OS skips ones that aren't mounted very quickly.
        let mut out = Vec::new();
        for c in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\", c as char));
            if p.exists() {
                out.push(p);
            }
        }
        out
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut out = Vec::new();
        for base in ["/media", "/run/media", "/mnt"] {
            out.extend(scan_dir(base));
            // /run/media/<user>/<volume>
            for first in scan_dir(base) {
                out.extend(scan_dir(&first));
            }
        }
        out
    }
}

#[allow(dead_code)]
fn scan_dir<P: AsRef<Path>>(p: P) -> Vec<PathBuf> {
    fs::read_dir(p.as_ref())
        .into_iter()
        .flatten()
        .filter_map(|r| r.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

fn identify(root: &Path) -> Option<Device> {
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());

    // ── Kindle ───────────────────────────────────────────────────────────
    // Kindles expose `documents/` and `system/`. Recent firmware also has
    // `.kindle/` or `system/.assets/`.
    if root.join("documents").is_dir() && root.join("system").is_dir() {
        let books_dir = root.join("documents");
        return Some(Device {
            id: format!("kindle:{}", root.to_string_lossy()),
            name: "Kindle".into(),
            kind: DeviceKind::Kindle,
            root: root.to_path_buf(),
            books_dir,
        });
    }

    // ── Kobo ─────────────────────────────────────────────────────────────
    // Distinctive marker: `.kobo/` directory at root.
    if root.join(".kobo").is_dir() {
        // Kobo accepts books anywhere on the volume; the convention is the
        // volume root itself. We'll put them in /Books/ for hygiene.
        let books_dir = root.join("Books");
        return Some(Device {
            id: format!("kobo:{}", root.to_string_lossy()),
            name: "Kobo".into(),
            kind: DeviceKind::Kobo,
            root: root.to_path_buf(),
            books_dir,
        });
    }

    // ── PocketBook ───────────────────────────────────────────────────────
    if root.join("system").is_dir() && root.join("config").is_dir() && name.to_lowercase().contains("pocket") {
        let books_dir = root.join("Books");
        return Some(Device {
            id: format!("pocketbook:{}", root.to_string_lossy()),
            name: "PocketBook".into(),
            kind: DeviceKind::PocketBook,
            root: root.to_path_buf(),
            books_dir,
        });
    }

    // ── Boox ─────────────────────────────────────────────────────────────
    if root.join("Books").is_dir() && name.to_lowercase().contains("boox") {
        let books_dir = root.join("Books");
        return Some(Device {
            id: format!("boox:{}", root.to_string_lossy()),
            name: "Boox".into(),
            kind: DeviceKind::Boox,
            root: root.to_path_buf(),
            books_dir,
        });
    }

    // ── reMarkable ───────────────────────────────────────────────────────
    // reMarkable normally syncs over WiFi/USB-IP, not mass storage.
    // No filesystem heuristic here; users can add it manually later.

    // Name-based fallback for known volume labels.
    let lower = name.to_lowercase();
    if lower.contains("kindle") {
        let books_dir = root.join("documents");
        return Some(Device {
            id: format!("kindle:{}", root.to_string_lossy()),
            name: "Kindle".into(),
            kind: DeviceKind::Kindle,
            root: root.to_path_buf(),
            books_dir,
        });
    }
    if lower.contains("kobo") {
        let books_dir = root.join("Books");
        return Some(Device {
            id: format!("kobo:{}", root.to_string_lossy()),
            name: "Kobo".into(),
            kind: DeviceKind::Kobo,
            root: root.to_path_buf(),
            books_dir,
        });
    }

    None
}

/// What actually landed on the device. `converted_to` is Some("azw3") /
/// Some("kepub") when the payload was transcoded on the way out.
#[derive(Debug, Serialize)]
pub struct SendOutcome {
    pub dest: PathBuf,
    pub converted_to: Option<String>,
}

pub fn send_to_device(device_id: &str, book_file: &Path) -> Result<SendOutcome> {
    let devices = detect_devices();
    let device = devices
        .iter()
        .find(|d| d.id == device_id)
        .ok_or_else(|| AtlasError::Msg("device not connected".into()))?;

    // Pick the payload the device can actually read. Modern Kindle firmware
    // does not open sideloaded EPUB, so a Kindle send without a converter is
    // an error with instructions — not a silent copy of a file the device
    // will reject.
    let (payload, converted_to) = match device.kind {
        DeviceKind::Kindle => {
            let tool = find_tool(EBOOK_CONVERT_CANDIDATES).ok_or_else(|| {
                AtlasError::Msg(
                    "Kindles don't read sideloaded EPUB, so Atlas converts to AZW3 \
                     first — but no converter was found. Install Calibre (its \
                     ebook-convert tool is used automatically), or send this book \
                     with Amazon's Send to Kindle instead."
                        .into(),
                )
            })?;
            (convert_with_ebook_convert(&tool, book_file, "azw3")?, Some("azw3".to_string()))
        }
        DeviceKind::Kobo => {
            // kepub is an enhancement (better typography/footnotes on Kobo),
            // not a requirement — fall back to plain EPUB silently.
            match find_tool(KEPUBIFY_CANDIDATES) {
                Some(tool) => (convert_with_kepubify(&tool, book_file)?, Some("kepub".to_string())),
                None => (book_file.to_path_buf(), None),
            }
        }
        _ => (book_file.to_path_buf(), None),
    };

    fs::create_dir_all(&device.books_dir)
        .map_err(|e| AtlasError::Msg(format!("create books dir: {}", e)))?;

    let size = fs::metadata(&payload)
        .map_err(|e| AtlasError::Msg(format!("read payload: {}", e)))?
        .len();
    if let Ok(free) = fs2::available_space(&device.books_dir) {
        // 10% headroom so we never fill the device to the byte.
        if free < size + size / 10 {
            return Err(AtlasError::Msg(format!(
                "Not enough space on {} ({} MB needed, {} MB free)",
                device.name,
                size / 1_048_576 + 1,
                free / 1_048_576
            )));
        }
    }

    let file_name = payload
        .file_name()
        .ok_or_else(|| AtlasError::Msg("invalid source path".into()))?;
    let mut dest = device.books_dir.join(file_name);
    if dest.exists() {
        let same_size = fs::metadata(&dest).map(|m| m.len() == size).unwrap_or(false);
        if same_size {
            // Identical name and size — treat as already on the device.
            return Ok(SendOutcome { dest, converted_to });
        }
        // Same name, different content: don't clobber someone else's book.
        dest = unique_dest(&dest);
    }

    // Copy via a temp name then rename, so a yanked cable mid-copy leaves an
    // obviously-partial file instead of a truncated one with the real name.
    let tmp = dest.with_extension("atlas-partial");
    if let Err(e) = fs::copy(&payload, &tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(AtlasError::Msg(format!("copy to device: {}", e)));
    }
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_file(&tmp);
        return Err(AtlasError::Msg(format!("finalize on device: {}", e)));
    }

    Ok(SendOutcome { dest, converted_to })
}

fn unique_dest(p: &Path) -> PathBuf {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("book");
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

// ── conversion tools ─────────────────────────────────────────────────────
//
// Detect-and-use, never bundled (brief §3). Checked on PATH first, then in
// the usual install locations — a Tauri app launched from Finder/Dock gets
// a minimal PATH that misses Homebrew and /usr/local.

const EBOOK_CONVERT_CANDIDATES: &[&str] = &[
    "ebook-convert",
    "/opt/homebrew/bin/ebook-convert",
    "/usr/local/bin/ebook-convert",
    "/Applications/calibre.app/Contents/MacOS/ebook-convert",
    "C:\\Program Files\\Calibre2\\ebook-convert.exe",
];

const KEPUBIFY_CANDIDATES: &[&str] = &[
    "kepubify",
    "/opt/homebrew/bin/kepubify",
    "/usr/local/bin/kepubify",
];

fn find_tool(candidates: &[&str]) -> Option<PathBuf> {
    for c in candidates {
        let p = Path::new(c);
        if p.is_absolute() {
            if p.exists() {
                return Some(p.to_path_buf());
            }
        } else if let Ok(out) = std::process::Command::new(c).arg("--version").output() {
            if out.status.success() {
                return Some(PathBuf::from(c));
            }
        }
    }
    None
}

fn convert_with_ebook_convert(tool: &Path, epub: &Path, fmt: &str) -> Result<PathBuf> {
    let stem = epub.file_stem().and_then(|s| s.to_str()).unwrap_or("book");
    let out = std::env::temp_dir().join(format!("atlas-send-{}.{}", stem, fmt));
    let status = std::process::Command::new(tool)
        .arg(epub)
        .arg(&out)
        .output()
        .map_err(|e| AtlasError::Msg(format!("run ebook-convert: {}", e)))?;
    if !status.status.success() || !out.exists() {
        return Err(AtlasError::Msg(format!(
            "ebook-convert failed: {}",
            String::from_utf8_lossy(&status.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
        )));
    }
    Ok(out)
}

fn convert_with_kepubify(tool: &Path, epub: &Path) -> Result<PathBuf> {
    let out_dir = std::env::temp_dir().join("atlas-kepub");
    fs::create_dir_all(&out_dir)
        .map_err(|e| AtlasError::Msg(format!("create temp dir: {}", e)))?;
    let status = std::process::Command::new(tool)
        .arg("-o")
        .arg(&out_dir)
        .arg(epub)
        .output()
        .map_err(|e| AtlasError::Msg(format!("run kepubify: {}", e)))?;
    if !status.status.success() {
        return Err(AtlasError::Msg(format!(
            "kepubify failed: {}",
            String::from_utf8_lossy(&status.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
        )));
    }
    let stem = epub.file_stem().and_then(|s| s.to_str()).unwrap_or("book");
    let produced = out_dir.join(format!("{}.kepub.epub", stem));
    if produced.exists() {
        Ok(produced)
    } else {
        Err(AtlasError::Msg("kepubify produced no output".into()))
    }
}
