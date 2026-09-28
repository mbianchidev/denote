use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use crate::error::{AppError, AppResult};

#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SelectionKind {
    File,
    Folder,
}

pub(crate) struct SelectionOptions {
    title: &'static str,
    directory: Option<PathBuf>,
    filter: Option<(&'static str, &'static [&'static str])>,
}

impl SelectionOptions {
    pub(crate) fn new(title: &'static str) -> Self {
        Self {
            title,
            directory: None,
            filter: None,
        }
    }

    pub(crate) fn with_directory(mut self, path: &Path) -> Self {
        self.directory = Some(path.to_path_buf());
        self
    }

    #[cfg(debug_assertions)]
    pub(crate) fn with_filter(
        mut self,
        name: &'static str,
        extensions: &'static [&'static str],
    ) -> Self {
        self.filter = Some((name, extensions));
        self
    }
}

type Completion = Box<dyn FnOnce(AppResult<Option<PathBuf>>) + Send>;

struct PickerLease<'a>(&'a AtomicBool);

impl<'a> PickerLease<'a> {
    fn acquire(active: &'a AtomicBool) -> AppResult<Self> {
        active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                AppError::State(
                    "Another file picker is already open. Complete or cancel it first.".to_string(),
                )
            })?;
        Ok(Self(active))
    }
}

impl Drop for PickerLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub(crate) fn prewarm() {
    #[cfg(target_os = "macos")]
    {
        static PREPARE: std::sync::Once = std::sync::Once::new();
        PREPARE.call_once(|| {
            dispatch2::DispatchQueue::main().exec_async(macos::prewarm);
        });
    }
}

pub(crate) async fn select(
    app: &tauri::AppHandle,
    kind: SelectionKind,
    options: SelectionOptions,
) -> AppResult<Option<PathBuf>> {
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    let lease = PickerLease::acquire(&ACTIVE)?;
    let app = app.clone();
    select_with_callback(move |complete| {
        open(
            app,
            kind,
            options,
            Box::new(move |result| {
                drop(lease);
                complete(result);
            }),
        );
    })
    .await
}

async fn select_with_callback(open: impl FnOnce(Completion)) -> AppResult<Option<PathBuf>> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    open(Box::new(move |selected| {
        if sender.try_send(selected).is_err() {
            eprintln!("The file picker closed after its request ended.");
        }
    }));
    receiver.recv().await.ok_or_else(|| {
        AppError::State("The file picker closed without a result. Try again.".to_string())
    })?
}

#[cfg(target_os = "macos")]
fn open(
    _app: tauri::AppHandle,
    kind: SelectionKind,
    options: SelectionOptions,
    complete: Completion,
) {
    // AppKit panel work must not nest inside tao's run-loop observer.
    dispatch2::DispatchQueue::main().exec_async(move || macos::open(kind, options, complete));
}

#[cfg(not(target_os = "macos"))]
fn open(
    app: tauri::AppHandle,
    kind: SelectionKind,
    options: SelectionOptions,
    complete: Completion,
) {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let mut dialog = app.dialog().file().set_title(options.title);
    if let Some(directory) = options.directory {
        dialog = dialog.set_directory(directory);
    }
    if let Some((name, extensions)) = options.filter {
        dialog = dialog.add_filter(name, extensions);
    }
    let complete = move |selected: Option<FilePath>| {
        complete(
            selected
                .map(|path| {
                    path.into_path()
                        .map_err(|error| AppError::InvalidPath(error.to_string()))
                })
                .transpose(),
        );
    };
    match kind {
        SelectionKind::File => dialog.pick_file(complete),
        SelectionKind::Folder => dialog.pick_folder(complete),
    }
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
        complete(Ok(Some(PathBuf::from("synthetic.tgz"))));
        assert_eq!(
            tauri::async_runtime::block_on(selection).expect("selected file"),
            Some(PathBuf::from("synthetic.tgz")),
        );
    }

    #[test]
    fn file_selection_distinguishes_cancellation_from_a_missing_callback() {
        assert_eq!(
            tauri::async_runtime::block_on(select_with_callback(|complete| complete(Ok(None))))
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
            tauri::async_runtime::block_on(select_with_callback(|complete| complete(Ok(None))))
                .expect("picker remains responsive"),
            None,
        );
        release.send(()).expect("release");
        tauri::async_runtime::block_on(work).expect("worker finished");
    }

    #[test]
    fn file_selection_reports_native_presentation_errors() {
        let error = tauri::async_runtime::block_on(select_with_callback(|complete| {
            complete(Err(AppError::State("Synthetic native failure".to_string())));
        }))
        .expect_err("native error");
        assert!(error.to_string().contains("Synthetic native failure"));
    }

    #[test]
    fn a_picker_lease_prevents_reconfiguration_until_the_native_callback_is_released() {
        let active = AtomicBool::new(false);
        let lease = PickerLease::acquire(&active).expect("first picker");
        assert!(PickerLease::acquire(&active).is_err());
        drop(lease);
        let next = PickerLease::acquire(&active).expect("next picker");
        assert!(active.load(Ordering::Acquire));
        drop(next);
        assert!(!active.load(Ordering::Acquire));
    }
}
