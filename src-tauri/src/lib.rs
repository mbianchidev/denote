mod commands;
mod crypto;
mod db;
mod default_vault;
mod error;
mod models;
mod plugins;
mod vault;

use db::AppState;
use tauri::{Emitter, Manager, RunEvent};

#[cfg(target_os = "macos")]
const NATIVE_MENU_COMMAND_EVENT: &str = "denote://menu-command";

#[cfg(target_os = "macos")]
fn configure_macos_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri::menu::{
        HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
    };

    let handle = app.handle();
    let package = app.package_info();
    let app_menu = Submenu::with_items(
        handle,
        package.name.clone(),
        true,
        &[
            &MenuItem::with_id(handle, "app.about", "About Denote", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "editor.settings",
                "Settings...",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(handle, "file.new", "New File", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(handle, "folder.new", "New Folder", true, None::<&str>)?,
            &MenuItem::with_id(handle, "tab.new", "New Tab", true, Some("CmdOrCtrl+T"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "vault.open",
                "Open Vault Folder...",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                handle,
                "vault.switch",
                "Switch Vault...",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &MenuItem::with_id(handle, "vault.refresh", "Refresh Vault", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "file.save", "Save", true, Some("CmdOrCtrl+S"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "tab.close", "Close Tab", true, Some("CmdOrCtrl+W"))?,
            &MenuItem::with_id(
                handle,
                "window.close",
                "Close Window",
                true,
                Some("CmdOrCtrl+Shift+W"),
            )?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "vault.search",
                "Search Current File",
                true,
                Some("CmdOrCtrl+F"),
            )?,
            &MenuItem::with_id(
                handle,
                "editor.replace",
                "Find and Replace...",
                true,
                Some("CmdOrCtrl+H"),
            )?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "view.files", "Show Files", true, None::<&str>)?,
            &MenuItem::with_id(handle, "view.search", "Show Search", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                "view.bookmarks",
                "Show Bookmarks",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                handle,
                "view.recent",
                "Show Recent Files",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(handle, "view.trash", "Show Trash", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "editor.outline",
                "Toggle Document Outline",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "pane.split", "Split Editor", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                "pane.close",
                "Close Focused Pane",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "editor.zoom-in",
                "Increase Editor Text Size",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                handle,
                "editor.zoom-out",
                "Decrease Editor Text Size",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                handle,
                "editor.zoom-reset",
                "Actual Editor Text Size",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;
    let window_menu = Submenu::with_id_and_items(
        handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::bring_all_to_front(handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(
        handle,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[&MenuItem::with_id(
            handle,
            "command-palette.open",
            "Show Command Palette...",
            true,
            Some("CmdOrCtrl+P"),
        )?],
    )?;
    let menu = Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.show() {
                    eprintln!("Unable to show existing Denote window: {error}");
                }
                if let Err(error) = window.set_focus() {
                    eprintln!("Unable to focus existing Denote window: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            configure_macos_menu(app)?;
            let app_data_dir = app.path().app_data_dir()?;
            let app_cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            if let Err(error) = vault::prune_stale_clipboard_files(&app_cache_dir) {
                eprintln!("Unable to prune stale clipboard attachment files: {error}");
            }
            app.manage(commands::FileClipboard::new());
            app.manage(commands::LinkRewriteLeases::new());
            app.manage(plugins::PluginManager::new(
                app_data_dir.clone(),
                app_cache_dir.clone(),
            ));
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
            commands::resolve_file_path,
            commands::copy_file_content,
            commands::copy_file_for_attachment,
            commands::open_external_uri,
            commands::read_note,
            commands::save_note,
            commands::create_entry,
            commands::duplicate_file,
            commands::rename_entry,
            commands::move_entry,
            commands::finish_link_rewrite,
            commands::trash_entry,
            commands::restore_trash_item,
            commands::empty_trash,
            commands::prepare_exit,
            commands::complete_exit,
            commands::set_bookmark,
            commands::record_edit,
            commands::set_entry_order,
            commands::set_entry_pinned,
            commands::set_tag_color,
            commands::set_vault_markdown_view_mode,
            commands::set_restore_tabs,
            commands::set_welcome_page_path,
            commands::mark_project_root,
            commands::unmark_project_root,
            commands::mark_project_workspace,
            commands::unmark_project_workspace,
            commands::dismiss_git_project_suggestion,
            commands::save_tab_session,
            commands::list_history,
            commands::restore_revision,
            commands::list_search_documents,
            commands::list_editable_documents,
            commands::list_link_rewrite_documents,
            commands::read_image_data_url,
            commands::save_attachment,
            plugins::list_plugins,
            plugins::list_plugin_bundles,
            plugins::prepare_plugin_enable,
            plugins::commit_plugin_enable,
            plugins::rollback_plugin_enable,
            plugins::recover_plugin_transactions,
            plugins::disable_plugin,
            plugins::read_plugin_entrypoint,
            plugins::get_plugin_settings,
            plugins::set_plugin_settings,
            plugins::import_plugin_settings,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugin_storage_delete,
            plugins::plugin_storage_clear,
            plugins::plugin_secret_get,
            plugins::plugin_secret_set,
            plugins::plugin_secret_delete,
            plugins::authorize_plugin_capability,
            plugins::plugin_workspace_read,
            plugins::plugin_workspace_write,
            plugins::plugin_network_request,
            plugins::plugin_clipboard_read,
            plugins::plugin_clipboard_write,
            plugins::plugin_show_notification,
            plugins::plugin_process_request,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Denote")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                let state = app.state::<AppState>();
                if !state.exit_is_allowed() {
                    api.prevent_exit();
                    if let Err(error) = app.emit("denote://exit-requested", ()) {
                        eprintln!("Unable to request Denote exit flush: {error}");
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::MenuEvent(event) => {
                if let Err(error) = app.emit(NATIVE_MENU_COMMAND_EVENT, event.id().as_ref()) {
                    eprintln!("Unable to dispatch Denote menu command: {error}");
                }
            }
            _ => {}
        });
}
