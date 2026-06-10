use crate::devices::{self, Device};
use crate::enrich::{self, CoverCandidate, EnrichOutcome};
use crate::library::{
    self, BookRow, Collection, FileRow, Highlight, ImportReport, MetadataPatch, MigrationReport,
    TagRow,
};
use crate::manifest::{self, DirtyKind};
use crate::state::AppState;

/// Tell the manifest writer something changed. Each mutation command
/// calls this so the portable manifest stays in step with SQLite,
/// debounced by kind (see manifest::DirtyKind).
fn touch(state: &State<'_, AppState>, kind: DirtyKind) {
    state.touch_manifest(kind);
}
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn list_books(state: State<'_, AppState>) -> Result<Vec<BookRow>, String> {
    library::list_books(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_book(state: State<'_, AppState>, id: i64) -> Result<Option<BookRow>, String> {
    library::get_book(&state.db, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_progress(
    state: State<'_, AppState>,
    id: i64,
    cfi: String,
    percent: f64,
) -> Result<(), String> {
    library::update_progress(&state.db, id, &cfi, percent).map_err(|e| e.to_string())?;
    // Long debounce — reader fires this on every page turn.
    touch(&state, DirtyKind::Progress);
    Ok(())
}

#[tauri::command]
pub fn book_count(state: State<'_, AppState>) -> Result<i64, String> {
    library::book_count(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_paths(
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
) -> Result<ImportReport, String> {
    let report = library::import_paths(
        &state.db,
        &state.covers_dir,
        &state.library_root(),
        &paths,
    );
    if report.imported > 0 {
        touch(&state, DirtyKind::Normal);
    }
    Ok(report)
}

#[tauri::command]
pub fn update_book_metadata(
    state: State<'_, AppState>,
    id: i64,
    patch: MetadataPatch,
) -> Result<(), String> {
    library::update_book_metadata(&state.db, id, patch).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn clear_manual_field(
    state: State<'_, AppState>,
    id: i64,
    field: String,
) -> Result<(), String> {
    library::clear_manual_field(&state.db, id, &field).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn list_book_files(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<FileRow>, String> {
    library::list_book_files(&state.db, id).map_err(|e| e.to_string())
}

/// Open a book's file (canonical, sidecar original, or export) in the
/// OS default app. We re-check the path is actually attached to the
/// book so the frontend can't be tricked into opening arbitrary paths.
#[tauri::command]
pub fn open_book_file(
    state: State<'_, AppState>,
    id: i64,
    file_id: i64,
) -> Result<(), String> {
    let files = library::list_book_files(&state.db, id).map_err(|e| e.to_string())?;
    let f = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| "file not attached to book".to_string())?;
    if !std::path::Path::new(&f.path).exists() {
        return Err(format!("file not found: {}", f.path));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&f.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &f.path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&f.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_rating(
    state: State<'_, AppState>,
    id: i64,
    rating: Option<i64>,
) -> Result<(), String> {
    library::set_rating(&state.db, id, rating).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn delete_book(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    library::delete_book(&state.db, id).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn app_paths(state: State<'_, AppState>) -> AppPaths {
    AppPaths {
        data_dir: state.data_dir.to_string_lossy().to_string(),
        covers_dir: state.covers_dir.to_string_lossy().to_string(),
        db_path: state.db_path.to_string_lossy().to_string(),
        library_root: state.library_root().to_string_lossy().to_string(),
        first_run: state.first_run,
    }
}

#[tauri::command]
pub fn migrate_orphan_files(state: State<'_, AppState>) -> Result<MigrationReport, String> {
    library::migrate_orphan_files(&state.db, &state.library_root()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_devices() -> Vec<Device> {
    devices::detect_devices()
}

/// Write a UTF-8 string to a user-chosen path. The path comes from
/// the OS save dialog (frontend), so we don't enforce a scope here —
/// the user has already explicitly picked the destination.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_annotations_markdown(
    state: State<'_, AppState>,
    book_id: Option<i64>,
) -> Result<String, String> {
    library::export_annotations_markdown(&state.db, book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn convert_book(
    state: State<'_, AppState>,
    id: i64,
    format: String,
) -> Result<String, String> {
    let out = library::convert_book(&state.db, id, &format).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(out)
}

/// Force-write the vault manifest from the current SQLite state. Useful
/// for manual testing and as the "Save manifest now" debug action — the
/// scheduled writeback in phase 2 will make this rarely necessary.
// ─── highlights ──────────────────────────────────────────────────────

#[tauri::command]
pub fn list_highlights(state: State<'_, AppState>, book_id: i64) -> Result<Vec<Highlight>, String> {
    library::list_highlights(&state.db, book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_highlight(
    state: State<'_, AppState>,
    book_id: i64,
    cfi_range: String,
    text: String,
    color: Option<String>,
    note: Option<String>,
) -> Result<Highlight, String> {
    let h = library::add_highlight(
        &state.db,
        book_id,
        &cfi_range,
        &text,
        color.as_deref(),
        note.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(h)
}

#[tauri::command]
pub fn update_highlight(
    state: State<'_, AppState>,
    uuid: String,
    note: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    library::update_highlight(&state.db, &uuid, note.as_deref(), color.as_deref())
        .map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn delete_highlight(state: State<'_, AppState>, uuid: String) -> Result<(), String> {
    library::delete_highlight(&state.db, &uuid).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn write_vault_manifest(state: State<'_, AppState>) -> Result<String, String> {
    manifest::write_snapshot(&state.db, &state.library_root())
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct SendResult {
    pub dest: String,
    /// "azw3" / "kepub" when the book was converted on the way out.
    pub converted_to: Option<String>,
}

#[tauri::command]
pub fn send_to_device(
    state: State<'_, AppState>,
    id: i64,
    device_id: String,
) -> Result<SendResult, String> {
    let book = library::get_book(&state.db, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "book not found".to_string())?;
    let file_path = book
        .file_path
        .ok_or_else(|| "book has no canonical file".to_string())?;
    let path = std::path::PathBuf::from(file_path);
    let outcome = devices::send_to_device(&device_id, &path).map_err(|e| e.to_string())?;
    Ok(SendResult {
        dest: outcome.dest.to_string_lossy().to_string(),
        converted_to: outcome.converted_to,
    })
}

#[tauri::command]
pub fn reveal_in_finder(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let book = library::get_book(&state.db, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "book not found".to_string())?;
    let file_path = book
        .file_path
        .ok_or_else(|| "book has no canonical file".to_string())?;
    let p = std::path::Path::new(&file_path);
    if !p.exists() {
        return Err(format!("file not found: {}", file_path));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &file_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &file_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_finished(
    state: State<'_, AppState>,
    id: i64,
    finished: bool,
) -> Result<(), String> {
    library::set_finished(&state.db, id, finished).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<TagRow>, String> {
    library::list_tags(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    library::add_tag(&state.db, id, &name).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn remove_tag(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    library::remove_tag(&state.db, id, &name).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    library::list_collections(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    let id = library::create_collection(&state.db, &name).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(id)
}

#[tauri::command]
pub fn rename_collection(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    library::rename_collection(&state.db, id, &name).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    library::delete_collection(&state.db, id).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn add_to_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    book_id: i64,
) -> Result<(), String> {
    library::add_to_collection(&state.db, collection_id, book_id).map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub fn remove_from_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    book_id: i64,
) -> Result<(), String> {
    library::remove_from_collection(&state.db, collection_id, book_id)
        .map_err(|e| e.to_string())?;
    touch(&state, DirtyKind::Normal);
    Ok(())
}

#[tauri::command]
pub async fn enrich_book(
    state: State<'_, AppState>,
    id: i64,
) -> Result<EnrichOutcome, String> {
    let pool = state.db.clone();
    let covers_dir = state.covers_dir.clone();
    enrich::enrich_book(pool, covers_dir, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cover_candidates(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<CoverCandidate>, String> {
    let pool = state.db.clone();
    enrich::cover_candidates(pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_book_cover(
    state: State<'_, AppState>,
    id: i64,
    url: String,
) -> Result<String, String> {
    let pool = state.db.clone();
    let covers_dir = state.covers_dir.clone();
    enrich::set_cover_from_url(pool, covers_dir, id, url)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct AppPaths {
    pub data_dir: String,
    pub covers_dir: String,
    pub db_path: String,
    pub library_root: String,
    /// Set true when there was no vaults.json on launch. Frontend
    /// uses it to show the welcome picker on first run.
    pub first_run: bool,
}

// ─── vault registry ─────────────────────────────────────────────────

#[tauri::command]
pub fn list_vaults(state: State<'_, AppState>) -> Result<crate::vaults::VaultRegistry, String> {
    crate::vaults::load(&state.data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cloud_drive_suggestions() -> Vec<crate::vaults::CloudSuggestion> {
    crate::vaults::cloud_drive_suggestions()
}

/// Validate a folder candidate the user picked in the welcome modal.
/// We don't open it as a vault here — that happens on the next launch
/// after `set_current_vault` writes the registry. Just sanity checks
/// so the UI can warn before committing.
#[tauri::command]
pub fn validate_vault_path(path: String) -> Result<VaultValidation, String> {
    let p = std::path::Path::new(&path);
    if path.trim().is_empty() {
        return Err("empty path".to_string());
    }
    // We're happy to *create* a vault folder, but the parent must
    // already exist so we don't accidentally make a tree somewhere
    // unexpected (think typo'd icloud paths).
    let parent_ok = match p.parent() {
        Some(parent) => parent.as_os_str().is_empty() || parent.exists(),
        None => false,
    };
    if !parent_ok {
        return Err(format!(
            "parent folder doesn't exist: {}",
            p.parent().map(|x| x.display().to_string()).unwrap_or_default()
        ));
    }
    let exists = p.exists();
    let has_manifest = p.join(".atlas").join("library.json").exists();
    Ok(VaultValidation {
        exists,
        has_manifest,
        is_dir: !exists || p.is_dir(),
    })
}

#[derive(serde::Serialize)]
pub struct VaultValidation {
    pub exists: bool,
    pub has_manifest: bool,
    pub is_dir: bool,
}

/// Set the current vault and persist to vaults.json. **Requires
/// app restart** to actually swap the open library — swapping the
/// SQLite pool + manifest writer mid-flight is fiddly and would
/// only run once per session anyway. Frontend prompts.
#[tauri::command]
pub fn set_current_vault(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<crate::vaults::VaultRegistry, String> {
    let p = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let registry =
        crate::vaults::touch_vault(&state.data_dir, &p).map_err(|e| e.to_string())?;
    // Take effect immediately: swap the root in place (flushing the old
    // vault's pending manifest writes) and run the same bootstrap the app
    // does at startup, so an existing vault's manifest reconciles in and
    // `library-updated` refreshes the UI. No process restart — that would
    // orphan the dev server under `tauri dev` and is needless in prod.
    state.set_library_root(p.clone());
    manifest::bootstrap_in_background(state.db.clone(), p, app);
    Ok(registry)
}

#[tauri::command]
pub fn forget_vault(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::vaults::VaultRegistry, String> {
    let p = std::path::PathBuf::from(&path);
    crate::vaults::forget_vault(&state.data_dir, &p).map_err(|e| e.to_string())
}

/// Trigger an app restart so AppState picks up the new vault path
/// chosen via `set_current_vault`. We flush the manifest first so
/// the user's pending edits get out the door.
#[tauri::command]
pub fn relaunch_app(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    if let Err(e) = crate::manifest::flush(&state.db, &state.library_root()) {
        tracing::warn!("pre-restart flush failed: {e}");
    }
    app.restart();
}

/// Mirror long-running work onto the OS surface — macOS dock icon,
/// Windows taskbar, Linux (Unity-protocol) launcher. `indeterminate`
/// for work with no known total (import), percent for batch jobs,
/// neither to clear.
#[tauri::command]
pub fn set_taskbar_progress(
    window: tauri::Window,
    percent: Option<u64>,
    indeterminate: Option<bool>,
) -> Result<(), String> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    let state = if indeterminate.unwrap_or(false) {
        ProgressBarState {
            status: Some(ProgressBarStatus::Indeterminate),
            progress: None,
        }
    } else if let Some(p) = percent {
        ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some(p.min(100)),
        }
    } else {
        ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        }
    };
    window.set_progress_bar(state).map_err(|e| e.to_string())
}
