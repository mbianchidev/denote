mod commands;
mod db;
mod error;
mod models;
mod vault;

use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("denote.sqlite3");
            db::initialize(&db_path)?;
            let connection = db::open(&db_path)?;
            let active_vault = db::get_last_vault(&connection)?
                .and_then(|path| std::fs::canonicalize(path).ok())
                .filter(|path| path.is_dir());
            let state = AppState::new(db_path, active_vault);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_last_vault,
            commands::choose_vault,
            commands::refresh_vault,
            commands::read_note,
            commands::save_note,
            commands::create_entry,
            commands::rename_entry,
            commands::trash_entry,
            commands::restore_trash_item,
            commands::empty_trash,
            commands::set_bookmark,
            commands::record_edit,
            commands::set_entry_order,
            commands::list_history,
            commands::restore_revision,
            commands::list_search_documents,
            commands::read_image_data_url,
            commands::save_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Denote");
}
