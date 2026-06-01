use crate::db::{self, DbPool};
use crate::error::Result;
use crate::manifest::ManifestWriter;
use crate::vaults;
use std::path::PathBuf;

pub struct AppState {
    pub db: DbPool,
    pub data_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub db_path: PathBuf,
    pub library_root: PathBuf,
    /// True iff there was no `vaults.json` when this AppState booted —
    /// frontend uses it to decide whether to show the welcome modal.
    pub first_run: bool,
    /// Background task that debounces and writes the vault manifest
    /// after mutations. Cheap to clone; commands hold the AppState as
    /// shared state and just call `.touch()` after each write.
    pub manifest_writer: ManifestWriter,
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
            library_root,
            first_run,
            manifest_writer,
        })
    }
}
