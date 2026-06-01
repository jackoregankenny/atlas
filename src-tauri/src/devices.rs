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

pub fn send_to_device(device_id: &str, book_file: &Path) -> Result<PathBuf> {
    let devices = detect_devices();
    let device = devices
        .iter()
        .find(|d| d.id == device_id)
        .ok_or_else(|| AtlasError::Msg("device not connected".into()))?;

    fs::create_dir_all(&device.books_dir)
        .map_err(|e| AtlasError::Msg(format!("create books dir: {}", e)))?;

    let file_name = book_file
        .file_name()
        .ok_or_else(|| AtlasError::Msg("invalid source path".into()))?;
    let dest = device.books_dir.join(file_name);

    // Use a copy so the user keeps the canonical library copy.
    fs::copy(book_file, &dest)
        .map_err(|e| AtlasError::Msg(format!("copy to device: {}", e)))?;

    Ok(dest)
}
