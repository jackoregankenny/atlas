use crate::db::{self, DbPool};
use crate::error::Result;
use crate::manifest::ManifestWriter;
use crate::vaults;
use std::path::PathBuf;
use std::sync::RwLock;

pub struct AppState {
    pub db: DbPool,
    pub data_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub db_path: PathBuf,
    /// Behind a lock so picking a vault (welcome modal / Settings →
    /// Switch) takes effect immediately, without restarting the process —
    /// a restart would orphan the dev server in `tauri dev` and is
    /// needless friction in production. Read via `library_root()`.
    library_root: RwLock<PathBuf>,
    /// True iff there was no `vaults.json` when this AppState booted —
    /// frontend uses it to decide whether to show the welcome modal.
    pub first_run: bool,
    /// Background task that debounces and writes the vault manifest
    /// after mutations. Swapped together with library_root; dropping
    /// the old writer closes its channel and ends its task.
    manifest_writer: RwLock<ManifestWriter>,
}

impl AppState {
    pub fn library_root(&self) -> PathBuf {
        self.library_root.read().unwrap().clone()
    }

    pub fn touch_manifest(&self, kind: crate::manifest::DirtyKind) {
        self.manifest_writer.read().unwrap().touch(kind);
    }

    /// Point the app at a different vault: swap the root and respawn the
    /// manifest writer against it. Pending writes for the old vault are
    /// flushed first so nothing is lost.
    pub fn set_library_root(&self, new_root: PathBuf) {
        let old_root = self.library_root();
        if old_root == new_root {
            return;
        }
        if let Err(e) = crate::manifest::flush(&self.db, &old_root) {
            tracing::warn!("flush before vault switch failed: {e}");
        }
        let writer = ManifestWriter::spawn(self.db.clone(), new_root.clone());
        *self.manifest_writer.write().unwrap() = writer;
        *self.library_root.write().unwrap() = new_root;
    }
}

impl AppState {
    pub fn init(data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let covers_dir = data_dir.join("covers");
        std::fs::create_dir_all(&covers_dir)?;
        let db_path = data_dir.join("atlas.db");
        let db = db::open(&db_path)?;

        // Phase 3: consult the vault registry. If a previous run set a
        // current vault we use it; otherwise we silently default and
        // flag first_run so the UI can ask the user where they'd
        // actually like their library to live.
        let registry = vaults::load(&data_dir)?;
        let first_run = registry.current.is_none();
        let library_root = registry
            .current
            .clone()
            .unwrap_or_else(vaults::default_path);
        std::fs::create_dir_all(&library_root)?;

        // Touch (or create) the registry entry so the picker can show
        // this folder in the list immediately, without waiting for the
        // user to confirm via the welcome modal.
        let _ = vaults::touch_vault(&data_dir, &library_root);

        let manifest_writer = ManifestWriter::spawn(db.clone(), library_root.clone());
        Ok(Self {
            db,
            data_dir,
            covers_dir,
            db_path,
            library_root: RwLock::new(library_root),
            first_run,
            manifest_writer: RwLock::new(manifest_writer),
        })
    }
}
