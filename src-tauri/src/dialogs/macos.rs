use std::{cell::RefCell, path::PathBuf};

use block2::RcBlock;
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{
    NSApplication, NSModalResponse, NSModalResponseCancel, NSModalResponseOK, NSOpenPanel,
};
use objc2_foundation::{NSArray, NSString, NSURL};

use super::{Completion, SelectionKind, SelectionOptions};
use crate::error::{AppError, AppResult};

thread_local! {
    static PANEL: RefCell<Option<Retained<NSOpenPanel>>> = const { RefCell::new(None) };
}

fn prepared_panel(main_thread: MainThreadMarker) -> Retained<NSOpenPanel> {
    if let Some(panel) = PANEL.with(|cached| cached.borrow().clone()) {
        return panel;
    }
    let panel = NSOpenPanel::openPanel(main_thread);
    PANEL.with(|cached| *cached.borrow_mut() = Some(panel.clone()));
    panel
}

pub(super) fn prewarm() {
    let main_thread =
        MainThreadMarker::new().expect("File picker preparation runs on the main queue");
    #[cfg(debug_assertions)]
    let started = std::time::Instant::now();
    // Retain the actual panel: constructing a fresh one repeats AppKit's handshake.
    let _panel = prepared_panel(main_thread);
    #[cfg(debug_assertions)]
    eprintln!(
        "Native file picker prepared and retained in {} ms.",
        started.elapsed().as_millis()
    );
}

fn configure_panel(
    panel: &NSOpenPanel,
    kind: SelectionKind,
    options: &SelectionOptions,
) -> AppResult<()> {
    let directory = options
        .directory
        .as_ref()
        .map(|path| {
            NSURL::from_directory_path(path).ok_or_else(|| {
                AppError::InvalidPath("The file picker's starting folder is invalid.".to_string())
            })
        })
        .transpose()?;
    let extensions = options.filter.map(|(_, extensions)| {
        NSArray::from_retained_slice(
            &extensions
                .iter()
                .map(|extension| NSString::from_str(extension))
                .collect::<Vec<_>>(),
        )
    });

    panel.setCanChooseFiles(kind == SelectionKind::File);
    panel.setCanChooseDirectories(kind == SelectionKind::Folder);
    panel.setAllowsMultipleSelection(false);
    panel.setCanCreateDirectories(true);
    panel.setMessage(Some(&NSString::from_str(options.title)));
    panel.setNameFieldStringValue(&NSString::from_str(""));
    panel.setDirectoryURL(directory.as_deref());
    #[allow(deprecated)]
    panel.setAllowedFileTypes(extensions.as_deref());
    Ok(())
}

fn selected_path(response: NSModalResponse, url: Option<&NSURL>) -> AppResult<Option<PathBuf>> {
    match response {
        response if response == NSModalResponseCancel => Ok(None),
        response if response == NSModalResponseOK => {
            let url = url.ok_or_else(|| {
                AppError::State("The file picker returned no selection. Try again.".to_string())
            })?;
            if !url.isFileURL() {
                return Err(AppError::InvalidPath(
                    "The file picker did not return a local filesystem path.".to_string(),
                ));
            }
            url.to_file_path().map(Some).ok_or_else(|| {
                AppError::InvalidPath("The selected filesystem path is invalid.".to_string())
            })
        }
        _ => Err(AppError::State(
            "macOS could not present the file picker. Try again.".to_string(),
        )),
    }
}

pub(super) fn open(kind: SelectionKind, options: SelectionOptions, complete: Completion) {
    let main_thread = MainThreadMarker::new().expect("File pickers run on the main queue");
    #[cfg(debug_assertions)]
    let started = std::time::Instant::now();
    let app = NSApplication::sharedApplication(main_thread);
    let Some(window) = app.mainWindow() else {
        complete(Err(AppError::State(
            "The main window is not ready for a file picker. Try again.".to_string(),
        )));
        return;
    };
    let panel = prepared_panel(main_thread);
    if let Err(error) = configure_panel(&panel, kind, &options) {
        complete(Err(error));
        return;
    }
    let complete = RefCell::new(Some(complete));
    let handler = RcBlock::new(move |response: NSModalResponse| {
        let Some(complete) = complete.borrow_mut().take() else {
            eprintln!("The native file picker delivered more than one completion.");
            return;
        };
        let panel = PANEL.with(|cached| cached.borrow().clone());
        let result = match panel {
            Some(panel) => {
                let url = if response == NSModalResponseOK {
                    panel.URL()
                } else {
                    None
                };
                let result = selected_path(response, url.as_deref());
                panel.orderOut(None);
                result
            }
            None => Err(AppError::State(
                "The native file picker was released before it completed.".to_string(),
            )),
        };
        complete(result);
    });
    panel.beginSheetModalForWindow_completionHandler(&window, &handler);
    #[cfg(debug_assertions)]
    eprintln!(
        "Retained native file picker presented in {} ms.",
        started.elapsed().as_millis()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_app_kit::NSModalResponseAbort;

    #[test]
    fn native_results_distinguish_cancellation_missing_selection_and_presentation_failure() {
        assert!(
            selected_path(NSModalResponseCancel, None)
                .expect("cancelled")
                .is_none()
        );
        assert!(
            selected_path(NSModalResponseOK, None)
                .expect_err("missing selection")
                .to_string()
                .contains("no selection")
        );
        assert!(
            selected_path(NSModalResponseAbort, None)
                .expect_err("presentation failure")
                .to_string()
                .contains("could not present")
        );
    }

    #[test]
    fn native_selection_preserves_local_paths_and_rejects_remote_urls() {
        let path = PathBuf::from("/synthetic/vault/example note.tgz");
        let local = NSURL::from_file_path(&path).expect("local URL");
        assert_eq!(
            selected_path(NSModalResponseOK, Some(&local)).expect("selected path"),
            Some(path)
        );
        let remote = NSURL::URLWithString(&NSString::from_str("https://example.invalid/file.tgz"))
            .expect("remote URL");
        assert!(
            selected_path(NSModalResponseOK, Some(&remote))
                .expect_err("remote path")
                .to_string()
                .contains("local filesystem path")
        );
    }
}
