mod commands;
mod crypto;
mod db;
mod default_vault;
mod error;
mod models;
mod vault;

use db::AppState;
use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let app_cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            if let Err(error) = vault::prune_stale_clipboard_files(&app_cache_dir) {
                eprintln!("Unable to prune stale clipboard attachment files: {error}");
            }
            app.manage(commands::FileClipboard::new());
            app.manage(commands::LinkRewriteLeases::new());
            let default_vault_path = default_vault::ensure(&app_data_dir)?;
            let db_path = app_data_dir.join("denote.sqlite3");
            db::initialize(&db_path)?;
            let mut connection = db::open(&db_path)?;
            db::register_default_vault(
                &mut connection,
                &default_vault_path.to_string_lossy(),
                default_vault::name(),
            )?;
            let active_vault = db::get_last_vault(&connection)?
                .and_then(|path| std::fs::canonicalize(path).ok())
                .filter(|path| path.is_dir())
                .unwrap_or_else(|| default_vault_path.clone());
            db::set_last_vault(&connection, &active_vault.to_string_lossy())?;
            let state = AppState::new(db_path, Some(active_vault));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_last_vault,
            commands::list_known_vaults,
            commands::list_known_vault_files,
            commands::open_known_vault,
            commands::delete_known_vault,
            commands::choose_vault,
            commands::refresh_vault,
            commands::enable_vault_encryption,
            commands::unlock_vault_with_password,
            commands::unlock_vault_with_recovery_code,
            commands::lock_vault,
            commands::change_vault_password,
            commands::regenerate_vault_recovery_codes,
            commands::disable_vault_encryption,
            commands::copy_file_path,
            commands::copy_file_content,
            commands::copy_file_for_attachment,
            commands::open_external_uri,
            commands::read_note,
            commands::save_note,
            commands::create_entry,
            commands::rename_entry,
            commands::move_entry,
            commands::finish_link_rewrite,
            commands::trash_entry,
            commands::restore_trash_item,
            commands::empty_trash,
            commands::complete_exit,
            commands::set_bookmark,
            commands::record_edit,
            commands::set_entry_order,
            commands::set_entry_pinned,
            commands::set_tag_color,
            commands::set_vault_markdown_view_mode,
            commands::set_restore_tabs,
            commands::save_tab_session,
            commands::list_history,
            commands::restore_revision,
            commands::list_search_documents,
            commands::list_editable_documents,
            commands::list_link_rewrite_documents,
            commands::read_image_data_url,
            commands::save_attachment,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Denote")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if !state.exit_is_allowed() {
                    api.prevent_exit();
                    if let Err(error) = app.emit("denote://exit-requested", ()) {
                        eprintln!("Unable to request Denote exit flush: {error}");
                    }
                }
            }
        });
}
