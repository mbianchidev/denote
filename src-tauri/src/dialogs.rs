use std::path::PathBuf;

use tauri_plugin_dialog::{FileDialogBuilder, FilePath};

use crate::error::{AppError, AppResult};

pub(crate) enum SelectionKind {
    File,
    Folder,
}

pub(crate) fn prewarm() {
    #[cfg(target_os = "macos")]
    {
        static PREPARE: std::sync::Once = std::sync::Once::new();
        PREPARE.call_once(|| {
            dispatch2::DispatchQueue::main().exec_async(|| {
                let main_thread = objc2::MainThreadMarker::new()
                    .expect("File picker preparation runs on the main queue");
                #[cfg(debug_assertions)]
                let started = std::time::Instant::now();
                // Construct only: never present a panel or request a selection.
                let _panel = objc2_app_kit::NSOpenPanel::openPanel(main_thread);
                #[cfg(debug_assertions)]
                eprintln!(
                    "Native file picker prepared in {} ms.",
                    started.elapsed().as_millis()
                );
            });
        });
    }
}

pub(crate) async fn select(
    dialog: FileDialogBuilder<tauri::Wry>,
    kind: SelectionKind,
) -> AppResult<Option<PathBuf>> {
    select_with_callback(move |complete| open(dialog, kind, complete)).await
}

async fn select_with_callback(
    open: impl FnOnce(Box<dyn FnOnce(Option<FilePath>) + Send>),
) -> AppResult<Option<PathBuf>> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    open(Box::new(move |selected| {
        if sender.try_send(selected).is_err() {
            eprintln!("The file picker closed after its request ended.");
        }
    }));
    receiver
        .recv()
        .await
        .ok_or_else(|| {
            AppError::State("The file picker closed without a result. Try again.".to_string())
        })?
        .map(|selected| {
            selected
                .into_path()
                .map_err(|error| AppError::InvalidPath(error.to_string()))
        })
        .transpose()
}

fn open(
    dialog: FileDialogBuilder<tauri::Wry>,
    kind: SelectionKind,
    complete: Box<dyn FnOnce(Option<FilePath>) + Send>,
) {
    #[cfg(target_os = "macos")]
    {
        #[cfg(debug_assertions)]
        let queued = std::time::Instant::now();
        // AppKit panel construction must not nest inside tao's run-loop observer.
        dispatch2::DispatchQueue::main().exec_async(move || {
            #[cfg(debug_assertions)]
            let started = std::time::Instant::now();
            let dialog = rfd::AsyncFileDialog::from(dialog);
            match kind {
                SelectionKind::File => complete_selection(dialog.pick_file(), complete),
                SelectionKind::Folder => complete_selection(dialog.pick_folder(), complete),
            }
            #[cfg(debug_assertions)]
            eprintln!(
                "Native file picker initialized in {} ms (queued {} ms).",
                started.elapsed().as_millis(),
                started.duration_since(queued).as_millis()
            );
        });
    }

    #[cfg(not(target_os = "macos"))]
    match kind {
        SelectionKind::File => dialog.pick_file(complete),
        SelectionKind::Folder => dialog.pick_folder(complete),
    }
}

#[cfg(target_os = "macos")]
fn complete_selection(
    selection: impl std::future::Future<Output = Option<rfd::FileHandle>> + Send + 'static,
    complete: Box<dyn FnOnce(Option<FilePath>) + Send>,
) {
    tauri::async_runtime::spawn(async move {
        complete(selection.await.map(|file| file.path().to_path_buf().into()));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        sync::mpsc,
        task::{Context, Poll, Waker},
        thread,
        time::Duration,
    };

    #[test]
    fn file_selection_yields_until_the_native_callback_answers() {
        let (sender, receiver) = mpsc::channel();
        let mut selection = Box::pin(select_with_callback(move |complete| {
            sender.send(complete).expect("picker opened");
        }));
        let mut context = Context::from_waker(Waker::noop());
        assert!(matches!(
            selection.as_mut().poll(&mut context),
            Poll::Pending
        ));
        let complete = receiver.try_recv().expect("picker callback");
        complete(Some(FilePath::Path(PathBuf::from("synthetic.tgz"))));
        assert_eq!(
            tauri::async_runtime::block_on(selection).expect("selected file"),
            Some(PathBuf::from("synthetic.tgz")),
        );
    }

    #[test]
    fn file_selection_distinguishes_cancellation_from_a_missing_callback() {
        assert_eq!(
            tauri::async_runtime::block_on(select_with_callback(|complete| complete(None)))
                .expect("cancelled"),
            None,
        );
        let error = tauri::async_runtime::block_on(select_with_callback(|_| {}))
            .expect_err("picker dispatch failed");
        assert!(error.to_string().contains("without a result"));
    }

    #[test]
    fn slow_background_work_does_not_block_file_selection() {
        let caller = thread::current().id();
        let (started, started_receiver) = mpsc::channel();
        let (release, release_receiver) = mpsc::channel();
        let work = tauri::async_runtime::spawn_blocking(move || {
            started
                .send(thread::current().id())
                .expect("background worker");
            release_receiver.recv().expect("release worker");
        });
        let worker = started_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("started");
        assert_ne!(caller, worker);
        assert_eq!(
            tauri::async_runtime::block_on(select_with_callback(|complete| complete(None)))
                .expect("picker remains responsive"),
            None,
        );
        release.send(()).expect("release");
        tauri::async_runtime::block_on(work).expect("worker finished");
    }
}
