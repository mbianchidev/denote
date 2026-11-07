use tauri::{
    AppHandle, Manager, RunEvent, Runtime, Webview, Window, ipc::Invoke, plugin::Plugin,
    webview::PageLoadPayload,
};
use tauri_runtime::webview::InitializationScript;

use crate::{
    db::AppState,
    error::{AppError, AppResult},
};

fn check<R: Runtime>(invoke: &Invoke<R>, authentication_command: bool) -> AppResult<()> {
    if invoke.message.webview().label() != "main" {
        return Err(AppError::Authentication(
            "App commands require the main Denote window.".into(),
        ));
    }
    let app = invoke.message.webview().app_handle().clone();
    let state = app.try_state::<AppState>().ok_or(AppError::AppLocked)?;
    if authentication_command {
        Ok(())
    } else {
        state.app_lock.ensure_unlocked()
    }
}

pub(crate) fn guard<R: Runtime>(
    handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let allowed = matches!(
            invoke.message.command(),
            "get_app_lock_status"
                | "unlock_app_with_password"
                | "unlock_app_with_device"
                | "stop_sensitive_tools"
                | "stop_code_sessions"
                | "stop_tool_session"
                | "stop_tool_sessions"
                | "recover_plugin_transactions"
                | "complete_exit"
        );
        if let Err(error) = check(&invoke, allowed) {
            invoke.resolver.reject(error);
            return true;
        }
        handler(invoke)
    }
}

// Tauri routes plugin IPC separately from the application's invoke handler.
pub(crate) struct GuardedPlugin<P>(pub P);

impl<R: Runtime, P: Plugin<R>> Plugin<R> for GuardedPlugin<P> {
    fn name(&self) -> &'static str {
        self.0.name()
    }
    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        configuration: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, configuration)
    }
    fn initialization_script(&self) -> Option<String> {
        self.0.initialization_script()
    }
    fn initialization_script_2(&self) -> Option<InitializationScript> {
        self.0.initialization_script_2()
    }
    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window);
    }
    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview);
    }
    fn on_navigation(&mut self, webview: &Webview<R>, url: &tauri::Url) -> bool {
        self.0.on_navigation(webview, url)
    }
    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }
    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }
    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        if let Err(error) = check(&invoke, false) {
            invoke.resolver.reject(error);
            return true;
        }
        self.0.extend_api(invoke)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tauri::{
        Manager,
        ipc::{CallbackFn, InvokeBody},
        test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets},
        webview::InvokeRequest,
    };
    use tempfile::tempdir;

    use crate::{
        app_lock::{AppLockConfigurationRequest, AppLockManager, PasswordUpdate},
        commands,
        db::{self, AppState},
    };

    fn request(command: &str, body: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        }
    }

    #[test]
    fn locked_app_rejects_every_workspace_command_before_dispatch() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("synthetic-vault");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("private.md"), "Synthetic private text").unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        crate::vault::open_vault(&database, root.to_str().unwrap()).unwrap();
        let manager = AppLockManager::load(database.clone()).unwrap();
        manager
            .configure(
                AppLockConfigurationRequest {
                    password: PasswordUpdate::Set {
                        value: "synthetic app password".into(),
                    },
                    current_password: None,
                    device_authentication_enabled: false,
                    inactivity_minutes: None,
                },
                || panic!("Unexpected device prompt"),
            )
            .unwrap();
        manager.mark_locked().unwrap();
        let app = mock_builder()
            .manage(AppState::with_app_lock(database, Some(root), manager))
            .invoke_handler(super::guard(tauri::generate_handler![
                crate::app_lock::get_app_lock_status,
                crate::app_lock::unlock_app_with_password,
                commands::read_note,
                commands::get_last_vault,
                commands::list_known_vaults,
            ]))
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        for command in [
            "read_note",
            "get_last_vault",
            "list_known_vaults",
            "plugin_secret_get",
            "copy_file_content",
            "configure_app_lock",
        ] {
            let error =
                get_ipc_response(&window, request(command, json!({ "path": "private.md" })))
                    .unwrap_err();
            assert!(
                error.as_str().unwrap().contains("Denote is locked"),
                "{command}: {error}"
            );
        }
        assert!(app.state::<AppState>().read_vault_access().is_err());
        let handle = app.handle().clone();
        let (ready, received) = std::sync::mpsc::sync_channel(1);
        let contention = std::thread::spawn(move || {
            let state = handle.state::<AppState>();
            let _configuration = state.app_lock.state.lock().unwrap();
            ready.send(()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(300));
        });
        received
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let started = std::time::Instant::now();
        let error = get_ipc_response(
            &window,
            request("read_note", json!({ "path": "private.md" })),
        )
        .unwrap_err();
        let dispatch_elapsed = started.elapsed();
        contention.join().unwrap();
        assert!(error.as_str().unwrap().contains("Denote is locked"));
        assert!(
            dispatch_elapsed < std::time::Duration::from_millis(100),
            "Locked dispatch waited {dispatch_elapsed:?} for authentication state."
        );
        let status = get_ipc_response(&window, request("get_app_lock_status", json!({}))).unwrap();
        assert!(
            status.deserialize::<serde_json::Value>().unwrap()["locked"]
                .as_bool()
                .unwrap()
        );
        get_ipc_response(
            &window,
            request(
                "unlock_app_with_password",
                json!({ "password": "synthetic app password" }),
            ),
        )
        .unwrap();
        let note = get_ipc_response(
            &window,
            request("read_note", json!({ "path": "private.md" })),
        )
        .unwrap();
        assert_eq!(
            note.deserialize::<serde_json::Value>().unwrap()["content"],
            "Synthetic private text"
        );
    }

    #[test]
    fn locked_app_guards_native_plugin_ipc_even_when_tauri_permissions_allow_it() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        use tauri::{Runtime, ipc::Invoke, plugin::Plugin};

        struct SyntheticOpener(Arc<AtomicUsize>);
        impl<R: Runtime> Plugin<R> for SyntheticOpener {
            fn name(&self) -> &'static str {
                "opener"
            }
            fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
                self.0.fetch_add(1, Ordering::SeqCst);
                invoke.resolver.resolve("synthetic native result");
                true
            }
        }
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        let manager = AppLockManager::load(database.clone()).unwrap();
        manager
            .configure(
                AppLockConfigurationRequest {
                    password: PasswordUpdate::Set {
                        value: "synthetic app password".into(),
                    },
                    current_password: None,
                    device_authentication_enabled: false,
                    inactivity_minutes: None,
                },
                || panic!("Unexpected device prompt"),
            )
            .unwrap();
        manager.mark_locked().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let app = mock_builder()
            .manage(AppState::with_app_lock(database, None, manager))
            .plugin(super::GuardedPlugin(SyntheticOpener(calls.clone())))
            .invoke_handler(super::guard(tauri::generate_handler![
                crate::app_lock::unlock_app_with_password
            ]))
            .build(crate::application_context())
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let error = get_ipc_response(
            &window,
            request(
                "plugin:opener|open_url",
                json!({ "url": "https://example.invalid" }),
            ),
        )
        .unwrap_err();
        assert!(
            error.as_str().unwrap().contains("Denote is locked"),
            "{error}"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        get_ipc_response(
            &window,
            request(
                "unlock_app_with_password",
                json!({ "password": "synthetic app password" }),
            ),
        )
        .unwrap();
        let result = get_ipc_response(
            &window,
            request(
                "plugin:opener|open_url",
                json!({ "url": "https://example.invalid" }),
            ),
        )
        .unwrap();
        assert_eq!(
            result.deserialize::<String>().unwrap(),
            "synthetic native result"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn app_lock_seals_the_vault_clears_keys_and_removes_only_owned_clipboard_files() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("synthetic-vault");
        let cache = directory.path().join("synthetic-cache");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("private.md"), "Synthetic private text").unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        crate::vault::open_vault(&database, root.to_str().unwrap()).unwrap();
        let (mut manifest, key, _) =
            crate::crypto::create_manifest("synthetic vault password").unwrap();
        manifest.phase = crate::crypto::EncryptionPhase::Encrypted;
        crate::crypto::save_manifest(&root, &manifest).unwrap();
        let staged = crate::vault::stage_clipboard_file(
            root.to_str().unwrap(),
            "private.md",
            "Synthetic clipboard text",
            crate::models::FileEncoding::Utf8,
            crate::models::FileLineEnding::Lf,
            &cache,
        )
        .unwrap();
        let sentinel = cache.join("keep.txt");
        std::fs::write(&sentinel, "Synthetic unrelated cache").unwrap();
        let manager = AppLockManager::load(database.clone()).unwrap();
        manager
            .configure(
                AppLockConfigurationRequest {
                    password: PasswordUpdate::Set {
                        value: "synthetic app password".into(),
                    },
                    current_password: None,
                    device_authentication_enabled: false,
                    inactivity_minutes: None,
                },
                || panic!("Unexpected device prompt"),
            )
            .unwrap();
        let app = mock_builder()
            .manage(AppState::with_app_lock(
                database,
                Some(root.clone()),
                manager,
            ))
            .manage(crate::plugins::PluginManager::new(
                directory.path().join("synthetic-app-data"),
                cache,
            ))
            .invoke_handler(super::guard(tauri::generate_handler![
                crate::app_lock::lock_app,
                crate::app_lock::unlock_app_with_password,
            ]))
            .build(mock_context(noop_assets()))
            .unwrap();
        app.state::<AppState>().set_vault_key(key).unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let status = get_ipc_response(&window, request("lock_app", json!({}))).unwrap();
        assert_eq!(
            status.deserialize::<serde_json::Value>().unwrap()["locked"],
            true
        );
        assert!(!app.state::<AppState>().vault_is_unlocked().unwrap());
        assert!(!staged.exists());
        assert_eq!(
            std::fs::read_to_string(sentinel).unwrap(),
            "Synthetic unrelated cache"
        );
        assert!(crate::crypto::is_encrypted_file(
            &std::fs::read(root.join("private.md")).unwrap()
        ));
        get_ipc_response(
            &window,
            request(
                "unlock_app_with_password",
                json!({ "password": "synthetic app password" }),
            ),
        )
        .unwrap();
        assert!(
            !app.state::<AppState>().vault_is_unlocked().unwrap(),
            "App unlock must not unlock encrypted vaults."
        );
    }
}
