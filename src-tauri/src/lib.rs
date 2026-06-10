mod commands;
mod convert;
mod db;
mod devices;
mod enrich;
mod epub;
mod error;
mod library;
mod manifest;
mod state;
mod vaults;

use state::AppState;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .try_init();

    let result = tauri::Builder::default()
        // single-instance MUST be first so that on a second launch the
        // already-running instance is the one that receives the deep
        // link. The closure focuses the existing window and forwards
        // the URL(s) the second instance was asked to open.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            // argv[0] is the binary path; everything after is potential
            // deep-link URLs handed to us by the OS.
            for arg in argv.iter().skip(1) {
                if arg.starts_with("atlas://") {
                    let _ = app.emit("deep-link", arg);
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Forward atlas:// URLs from the OS to the webview as a
            // "deep-link" event. Frontend listens and routes to a book
            // detail panel / reader. Pre-launch URLs (cold start via
            // an atlas:// click) arrive via single_instance's argv on
            // a follow-up launch and via .get_current() on first.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = handle.emit("deep-link", url.as_str());
                    }
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let handle = app.handle().clone();
                    // Defer so the webview is mounted before we fire.
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(400));
                        for url in urls {
                            let _ = handle.emit("deep-link", url.as_str());
                        }
                    });
                }
            }

            let data_dir = app.path().app_data_dir()?;
            let state = AppState::init(data_dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            // Vault manifest bootstrap — shared with live vault switches
            // (commands::set_current_vault). See manifest::bootstrap_in_background.
            manifest::bootstrap_in_background(
                state.db.clone(),
                state.library_root(),
                app.handle().clone(),
            );

            app.manage(state);

            // Native menubar. macOS gets the system menu bar; Windows/Linux
            // get a window menu. Every keyboard shortcut the frontend
            // handles is exposed here too so it shows up in
            // Help → Search (macOS) and Alt-key navigation (Win/Linux).
            let handle = app.handle();

            // ── File ──
            let import_item = MenuItemBuilder::with_id("menu:import", "Import EPUBs…")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let import_folder_item =
                MenuItemBuilder::with_id("menu:import-folder", "Import Folder…")
                    .accelerator("CmdOrCtrl+Shift+O")
                    .build(handle)?;
            let export_highlights_item =
                MenuItemBuilder::with_id("menu:export-highlights", "Export Highlights…")
                    .accelerator("CmdOrCtrl+Shift+E")
                    .build(handle)?;
            let reveal_vault_item =
                MenuItemBuilder::with_id("menu:reveal-vault", "Reveal Vault Folder")
                    .build(handle)?;

            // ── Edit ──
            let find_item = MenuItemBuilder::with_id("menu:find", "Find…")
                .accelerator("CmdOrCtrl+F")
                .build(handle)?;

            // ── View ──
            let view_grid_item = MenuItemBuilder::with_id("menu:view-grid", "as Grid")
                .accelerator("CmdOrCtrl+1")
                .build(handle)?;
            let view_compact_item =
                MenuItemBuilder::with_id("menu:view-compact", "as Compact")
                    .accelerator("CmdOrCtrl+2")
                    .build(handle)?;
            let view_list_item = MenuItemBuilder::with_id("menu:view-list", "as List")
                .accelerator("CmdOrCtrl+3")
                .build(handle)?;
            let theme_dark_item = MenuItemBuilder::with_id("menu:theme-dark", "Dark")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(handle)?;
            let theme_light_item = MenuItemBuilder::with_id("menu:theme-light", "Light")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(handle)?;
            let theme_system_item = MenuItemBuilder::with_id("menu:theme-system", "System")
                .build(handle)?;
            let toggle_highlights_item =
                MenuItemBuilder::with_id("menu:toggle-highlights", "Show Highlights")
                    .accelerator("CmdOrCtrl+Shift+H")
                    .build(handle)?;

            // ── Go ──
            let library_item = MenuItemBuilder::with_id("menu:library", "All Books")
                .accelerator("CmdOrCtrl+0")
                .build(handle)?;
            let filter_reading_item =
                MenuItemBuilder::with_id("menu:filter-reading", "Currently Reading")
                    .build(handle)?;
            let filter_unread_item =
                MenuItemBuilder::with_id("menu:filter-unread", "Unread")
                    .build(handle)?;
            let filter_finished_item =
                MenuItemBuilder::with_id("menu:filter-finished", "Finished")
                    .build(handle)?;
            let search_item = MenuItemBuilder::with_id("menu:search", "Search Library…")
                .accelerator("CmdOrCtrl+K")
                .build(handle)?;

            // ── Atlas / Window ──
            let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let shortcuts_item = MenuItemBuilder::with_id("menu:shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+/")
                .build(handle)?;

            let theme_menu = SubmenuBuilder::new(handle, "Theme")
                .item(&theme_dark_item)
                .item(&theme_light_item)
                .item(&theme_system_item)
                .build()?;

            let app_menu = SubmenuBuilder::new(handle, "Atlas")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&import_item)
                .item(&import_folder_item)
                .separator()
                .item(&export_highlights_item)
                .separator()
                .item(&reveal_vault_item)
                .separator()
                .close_window()
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&find_item)
                .build()?;
            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&view_grid_item)
                .item(&view_compact_item)
                .item(&view_list_item)
                .separator()
                .item(&theme_menu)
                .separator()
                .item(&toggle_highlights_item)
                .separator()
                .fullscreen()
                .build()?;
            let go_menu = SubmenuBuilder::new(handle, "Go")
                .item(&library_item)
                .item(&filter_reading_item)
                .item(&filter_unread_item)
                .item(&filter_finished_item)
                .separator()
                .item(&search_item)
                .build()?;
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .maximize()
                .separator()
                .item(&shortcuts_item)
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(handle)
                .items(&[
                    &app_menu, &file_menu, &edit_menu, &view_menu, &go_menu, &window_menu,
                ])
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                // The frontend listens for "menu" events and dispatches
                // off the payload id (`menu:view-grid`, etc).
                let _ = app.emit("menu", event.id().0.clone());
            });

            // Custom overlay titlebar via tauri-plugin-decorum. Works around
            // Tauri issue #9503 (drag broken with titleBarStyle: Overlay on
            // macOS) by installing a proper draggable overlay titlebar. Also
            // gives us pixel-perfect control over traffic-light position.
            if let Some(main_window) = app.get_webview_window("main") {
                use tauri_plugin_decorum::WebviewWindowExt;
                let _ = main_window.create_overlay_titlebar();
                #[cfg(target_os = "macos")]
                {
                    // Nudge traffic lights to align with our sidebar content.
                    let _ = main_window.set_traffic_lights_inset(14.0, 16.0);
                }
            }

            // Native window vibrancy/acrylic. Falls back silently on
            // unsupported OS versions.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::HudWindow,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::apply_mica;
                    let _ = apply_mica(&window, Some(true));
                }
                let _ = window;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::get_book,
            commands::book_count,
            commands::import_paths,
            commands::delete_book,
            commands::app_paths,
            commands::enrich_book,
            commands::cover_candidates,
            commands::set_book_cover,
            commands::update_progress,
            commands::set_finished,
            commands::list_tags,
            commands::add_tag,
            commands::remove_tag,
            commands::reveal_in_finder,
            commands::set_rating,
            commands::list_devices,
            commands::send_to_device,
            commands::migrate_orphan_files,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::write_vault_manifest,
            commands::list_highlights,
            commands::add_highlight,
            commands::update_highlight,
            commands::delete_highlight,
            commands::update_book_metadata,
            commands::clear_manual_field,
            commands::list_book_files,
            commands::open_book_file,
            commands::convert_book,
            commands::export_annotations_markdown,
            commands::write_text_file,
            commands::list_vaults,
            commands::cloud_drive_suggestions,
            commands::validate_vault_path,
            commands::set_current_vault,
            commands::forget_vault,
            commands::relaunch_app,
        ])
        .build(tauri::generate_context!());

    let app = match result {
        Ok(app) => app,
        Err(e) => {
            tracing::error!("tauri build failed: {e}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        // On final shutdown, flush any pending manifest writes
        // synchronously so the user's last edits before quitting
        // make it into the portable file. The debounced writer
        // would otherwise drop them when its runtime tears down.
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Err(e) = manifest::flush(&state.db, &state.library_root()) {
                    tracing::warn!("final manifest flush failed: {e}");
                } else {
                    tracing::info!("flushed manifest on exit");
                }
            }
        }
    });
}
