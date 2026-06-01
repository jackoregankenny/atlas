//! Vault registry — the small index that lives in app-data (NOT in
//! the synced vault folder) and remembers which library folders this
//! installation knows about and which one to open by default. Modelled
//! on Obsidian's vault list: an app-level concept, distinct from the
//! per-vault `library.json` that travels with the books.
//!
//! See docs/VAULTS.md for the bigger picture.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    /// Canonical absolute path. Stored with native separators; the
    /// frontend never needs to parse them.
    pub path: PathBuf,
    /// Display name shown in the picker. Defaults to the leaf folder.
    #[serde(default)]
    pub name: String,
    /// ISO-8601 timestamp of the last successful open, used to sort
    /// the picker most-recent-first.
    #[serde(default)]
    pub last_opened: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct VaultRegistry {
    /// Absolute path of the vault Atlas should open on launch. None
    /// means "first run" — UI should show the welcome picker.
    #[serde(default)]
    pub current: Option<PathBuf>,
    /// Every vault Atlas has ever opened on this install. The current
    /// one is in here too. Sorted on save by last_opened desc.
    #[serde(default)]
    pub vaults: Vec<VaultEntry>,
    /// Future-proofing for schema-additive changes.
    #[serde(flatten, default)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

const FILE_NAME: &str = "vaults.json";

pub fn registry_path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

pub fn load(data_dir: &Path) -> Result<VaultRegistry> {
    let path = registry_path(data_dir);
    if !path.exists() {
        return Ok(VaultRegistry::default());
    }
    let bytes = std::fs::read(&path)?;
    // Tolerate empty or corrupt file rather than refusing to launch —
    // the welcome flow will recover gracefully.
    Ok(serde_json::from_slice(&bytes).unwrap_or_default())
}

/// Atomic write: tmp + rename. Same pattern as manifest::save_atomic,
/// for the same reason — cloud-drive clients don't see partial files.
pub fn save(data_dir: &Path, reg: &VaultRegistry) -> Result<()> {
    let path = registry_path(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(reg)?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all().ok();
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Add (or refresh) a vault entry and mark it current. Idempotent —
/// re-opening an existing vault just bumps its `last_opened`.
pub fn touch_vault(data_dir: &Path, vault_path: &Path) -> Result<VaultRegistry> {
    let mut reg = load(data_dir)?;
    let canon = canonicalise(vault_path);
    let name = canon
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Atlas".to_string());
    let now = chrono::Utc::now().to_rfc3339();
    let mut found = false;
    for v in reg.vaults.iter_mut() {
        if same_path(&v.path, &canon) {
            v.last_opened = now.clone();
            if v.name.is_empty() {
                v.name = name.clone();
            }
            found = true;
            break;
        }
    }
    if !found {
        reg.vaults.push(VaultEntry {
            path: canon.clone(),
            name,
            last_opened: now,
        });
    }
    reg.current = Some(canon);
    // Most-recent-first for picker order.
    reg.vaults
        .sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    save(data_dir, &reg)?;
    Ok(reg)
}

/// Forget a vault from the registry. Does NOT touch the vault folder
/// itself — the user's books and manifest stay put. If the removed
/// vault was current, `current` becomes None and the next launch
/// shows the welcome picker.
pub fn forget_vault(data_dir: &Path, vault_path: &Path) -> Result<VaultRegistry> {
    let mut reg = load(data_dir)?;
    let canon = canonicalise(vault_path);
    reg.vaults.retain(|v| !same_path(&v.path, &canon));
    if reg.current.as_ref().map(|p| same_path(p, &canon)).unwrap_or(false) {
        reg.current = None;
    }
    save(data_dir, &reg)?;
    Ok(reg)
}

/// Best-effort canonicalisation. Falls back to the input path when
/// the folder doesn't exist yet (we create it on first open) — we
/// still want a normalised slash style on Windows.
fn canonicalise(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn same_path(a: &Path, b: &Path) -> bool {
    canonicalise(a) == canonicalise(b)
}

/// Common cloud-drive locations to suggest in the welcome picker.
/// Only includes folders that actually exist on this machine, so we
/// never propose Dropbox to a user who's never installed it. The
/// caller appends ".../Atlas" when presenting suggestions.
pub fn cloud_drive_suggestions() -> Vec<CloudSuggestion> {
    let mut out = Vec::new();
    let Some(home) = dirs::home_dir() else { return out };

    let candidates: &[(&str, PathBuf)] = &[
        // macOS — iCloud Drive
        ("iCloud Drive", home.join("Library/Mobile Documents/com~apple~CloudDocs")),
        // macOS / Linux / Windows — Dropbox default
        ("Dropbox", home.join("Dropbox")),
        // Google Drive (macOS desktop client)
        ("Google Drive", home.join("Library/CloudStorage/GoogleDrive-personal/My Drive")),
        // OneDrive (Windows + macOS Mac App)
        ("OneDrive", home.join("OneDrive")),
        // Documents folder always exists, useful default.
    ];

    for (label, root) in candidates {
        if root.exists() {
            out.push(CloudSuggestion {
                label: label.to_string(),
                base: root.clone(),
                suggested: root.join("Atlas"),
            });
        }
    }

    if let Some(docs) = dirs::document_dir() {
        out.push(CloudSuggestion {
            label: "Documents".to_string(),
            base: docs.clone(),
            suggested: docs.join("Atlas"),
        });
    }
    out
}

#[derive(Debug, Serialize)]
pub struct CloudSuggestion {
    pub label: String,
    pub base: PathBuf,
    pub suggested: PathBuf,
}

/// Default fallback when no vault has ever been chosen — equivalent
/// to what `state::default_library_root` used to do. Centralised here
/// so the welcome picker and the headless fallback agree.
pub fn default_path() -> PathBuf {
    if let Some(docs) = dirs::document_dir() {
        return docs.join("Atlas");
    }
    if let Some(home) = dirs::home_dir() {
        return home.join("Atlas");
    }
    PathBuf::from("./Atlas")
}
