use std::{
    fs,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tauri::{
    Manager,
    ipc::{CallbackFn, InvokeBody, InvokeResponse},
    test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets},
    webview::InvokeRequest,
};
use tempfile::tempdir;

use crate::db::{self, AppState};

#[tauri::command]
async fn benchmark_ready() {}

fn request(command: &str, body: Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.to_string(),
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
        invoke_key: INVOKE_KEY.to_string(),
    }
}

#[test]
fn editor_file_ipc_dispatch_stays_responsive_while_vault_io_waits() {
    let directory = tempdir().unwrap();
    let root = directory.path().join("synthetic-vault");
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    fs::write(
        root.join("typing.md"),
        "# Synthetic note\n\nOriginal text.\n",
    )
    .unwrap();
    fs::write(root.join("page.pdf"), b"%PDF-1.7\nsynthetic fixture").unwrap();
    fs::write(
        root.join("image.svg"),
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>"#,
    )
    .unwrap();
    let database = directory.path().join("synthetic.sqlite");
    db::initialize(&database).unwrap();
    crate::vault::open_vault(&database, root.to_str().unwrap()).unwrap();
    let app = mock_builder()
        .manage(AppState::new(database, Some(root.clone())))
        .invoke_handler(tauri::generate_handler![
            benchmark_ready,
            super::get_last_vault,
            super::read_note,
            super::read_pdf,
            super::save_note,
            super::record_edit,
            super::read_image_data_url,
            super::refresh_vault,
            super::list_search_documents,
            super::list_editable_documents,
            super::list_link_rewrite_documents,
            super::list_known_vault_files,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    get_ipc_response(&window, request("benchmark_ready", json!({}))).unwrap();
    let cases = [
        ("read_note", json!({ "path": "typing.md" })),
        ("read_pdf", json!({ "path": "page.pdf" })),
        (
            "save_note",
            json!({
                "path": "typing.md",
                "content": "# Synthetic note\n\nUpdated text.\n",
                "encoding": "utf8",
                "lineEnding": "lf",
                "reason": "manual",
            }),
        ),
        ("record_edit", json!({ "path": "typing.md" })),
        (
            "read_image_data_url",
            json!({ "notePath": "typing.md", "imageSource": "image.svg" }),
        ),
        ("refresh_vault", json!({})),
        ("get_last_vault", json!({})),
        ("list_search_documents", json!({ "paths": ["typing.md"] })),
        ("list_editable_documents", json!({})),
        ("list_link_rewrite_documents", json!({})),
        ("list_known_vault_files", json!({})),
    ];
    let mut slow = Vec::new();
    for (command, body) in cases {
        let handle = app.handle().clone();
        let (locked, lock_ready) = mpsc::sync_channel(1);
        let (release, released) = mpsc::sync_channel(1);
        let contention = thread::spawn(move || {
            let state = handle.state::<AppState>();
            let _guard = state.write_vault_access().unwrap();
            locked.send(()).unwrap();
            // A fixed synthetic stall distinguishes dispatch from completion.
            let _ = released.recv_timeout(Duration::from_millis(500));
        });
        lock_ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let (response, received) = mpsc::sync_channel(1);
        let started = Instant::now();
        let webview: &tauri::Webview<MockRuntime> = window.as_ref();
        webview.clone().on_message(
            request(command, body),
            Box::new(move |_, _, result, _, _| response.send(result).unwrap()),
        );
        let elapsed = started.elapsed();
        let _ = release.send(());
        contention.join().unwrap();
        let result = received.recv_timeout(Duration::from_secs(5)).unwrap();
        match result {
            InvokeResponse::Ok(body) => {
                let value = body.deserialize::<Value>().unwrap();
                if command == "read_note" {
                    assert_eq!(value["content"], "# Synthetic note\n\nOriginal text.\n");
                }
                if command == "read_pdf" {
                    assert!(value["dataBase64"].as_str().unwrap().starts_with("JVBER"));
                }
                if command == "save_note" {
                    assert_eq!(value["changed"], true);
                    assert_eq!(value["path"], "typing.md");
                }
                if command == "record_edit" {
                    assert_eq!(value["editCount"], 1);
                }
                if command == "read_image_data_url" {
                    assert!(
                        value
                            .as_str()
                            .unwrap()
                            .starts_with("data:image/svg+xml;base64,")
                    );
                }
                if command == "refresh_vault" || command == "get_last_vault" {
                    assert_eq!(value["vaultPath"], root.to_str().unwrap());
                    assert_eq!(value["tree"].as_array().unwrap().len(), 3);
                }
                if command == "list_known_vault_files" {
                    assert!(!value["files"].as_array().unwrap().is_empty());
                } else if command.starts_with("list_") {
                    assert!(!value["documents"].as_array().unwrap().is_empty());
                }
            }
            InvokeResponse::Err(error) => panic!("{command} failed: {error:?}"),
        }
        eprintln!("Editor IPC dispatch benchmark: {command} {elapsed:?}");
        if elapsed >= Duration::from_millis(100) {
            slow.push((command, elapsed));
        }
    }
    assert_eq!(
        fs::read_to_string(root.join("typing.md")).unwrap(),
        "# Synthetic note\n\nUpdated text.\n"
    );
    assert!(
        slow.is_empty(),
        "File I/O blocked the IPC/UI dispatcher instead of a background worker: {slow:?}"
    );
}
