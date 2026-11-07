use super::DeviceAuthenticationStatus;
use crate::error::{AppError, AppResult};

#[derive(Clone, Copy)]
pub(super) enum Purpose {
    Unlock,
    Configure,
}

impl Purpose {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn reason(self) -> &'static str {
        match self {
            Self::Unlock => "unlock Denote",
            Self::Configure => "change Denote app lock settings",
        }
    }
}

pub(super) fn verify<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    purpose: Purpose,
) -> AppResult<()> {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Authentication("The main Denote window is unavailable.".into()))?;
    if !window
        .is_focused()
        .map_err(|error| AppError::Authentication(error.to_string()))?
    {
        return Err(AppError::Authentication(
            "Focus Denote before authenticating.".into(),
        ));
    }
    platform::verify(app, purpose)
}

pub(super) fn availability() -> DeviceAuthenticationStatus {
    platform::availability()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::RcBlock;
    use objc2::{rc::autoreleasepool, runtime::Bool};
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAError, LAPolicy};
    use std::{sync::mpsc, time::Duration};

    pub(super) fn availability() -> DeviceAuthenticationStatus {
        autoreleasepool(|_| unsafe {
            let context = LAContext::new();
            let result =
                context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics);
            let reason = result.err().map(|error| message(error.code()));
            context.invalidate();
            DeviceAuthenticationStatus {
                available: reason.is_none(),
                name: "Touch ID".into(),
                unavailable_reason: reason,
            }
        })
    }

    pub(super) fn verify<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
        purpose: Purpose,
    ) -> AppResult<()> {
        autoreleasepool(|_| unsafe {
            let context = LAContext::new();
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .map_err(|error| AppError::Authentication(message(error.code())))?;
            context.setLocalizedFallbackTitle(Some(&NSString::from_str("")));
            context.setTouchIDAuthenticationAllowableReuseDuration(0.0);
            let (sender, receiver) = mpsc::sync_channel(1);
            let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
                let result = if success.as_bool() {
                    Ok(())
                } else {
                    let reason = error
                        .as_ref()
                        .map(|error| message(error.code()))
                        .unwrap_or_else(|| "Touch ID did not authenticate.".into());
                    Err(AppError::Authentication(reason))
                };
                if sender.try_send(result).is_err() {
                    eprintln!("Touch ID completed after its app authentication request ended.");
                }
            });
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &NSString::from_str(purpose.reason()),
                &reply,
            );
            let result = receiver
                .recv_timeout(Duration::from_secs(90))
                .map_err(|_| AppError::Authentication("Touch ID timed out. Try again.".into()));
            context.invalidate();
            result?
        })
    }

    fn message(code: isize) -> String {
        match LAError(code) {
            LAError::UserCancel
            | LAError::UserFallback
            | LAError::SystemCancel
            | LAError::AppCancel => "Touch ID authentication was cancelled.".into(),
            LAError::BiometryNotEnrolled => {
                "Set up Touch ID in macOS System Settings, or use an app password.".into()
            }
            LAError::BiometryLockout => {
                "Touch ID is locked out. Unlock it in macOS, or use an app password.".into()
            }
            LAError::BiometryNotAvailable
            | LAError::BiometryNotPaired
            | LAError::BiometryDisconnected => {
                "Touch ID is unavailable. Connect a supported device, or use an app password."
                    .into()
            }
            _ => format!("Touch ID authentication failed (code {code})."),
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    use windows::{
        Security::Credentials::UI::{
            UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
        },
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                IUserConsentVerifierInterop, RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize,
            },
        },
        core::{HSTRING, Interface, RuntimeType, factory},
    };
    use windows_future::{IAsyncInfo, IAsyncOperation};

    pub(super) fn availability() -> DeviceAuthenticationStatus {
        let result = (|| {
            let _apartment = Apartment::initialize()?;
            factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(native_error)?;
            let operation = UserConsentVerifier::CheckAvailabilityAsync().map_err(native_error)?;
            let result = wait(&operation, Duration::from_secs(10))?;
            if result != UserConsentVerifierAvailability::Available {
                return Err(AppError::Authentication(match result {
                    UserConsentVerifierAvailability::NotConfiguredForUser => {
                        "Set up Windows Hello in Windows Settings.".into()
                    }
                    UserConsentVerifierAvailability::DisabledByPolicy => {
                        "Windows Hello is disabled by device policy.".into()
                    }
                    UserConsentVerifierAvailability::DeviceBusy => {
                        "Windows Hello is busy. Try again.".into()
                    }
                    _ => "Windows Hello is unavailable on this device.".into(),
                }));
            }
            Ok(())
        })();
        DeviceAuthenticationStatus {
            available: result.is_ok(),
            name: "Windows Hello".into(),
            unavailable_reason: result.err().map(|error| error.to_string()),
        }
    }

    pub(super) fn verify<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        purpose: Purpose,
    ) -> AppResult<()> {
        use tauri::Manager;
        let (sender, receiver) = mpsc::sync_channel(1);
        let handle = app.clone();
        let expires = Instant::now() + Duration::from_secs(10);
        app.run_on_main_thread(move || {
            if Instant::now() >= expires {
                let _ = sender.send(Err(AppError::Authentication(
                    "Windows Hello could not open in time.".into(),
                )));
                return;
            }
            let operation = (|| {
                let window = handle.get_webview_window("main").ok_or_else(|| {
                    AppError::Authentication("The main Denote window is unavailable.".into())
                })?;
                if !window
                    .is_focused()
                    .map_err(|error| AppError::Authentication(error.to_string()))?
                {
                    return Err(AppError::Authentication(
                        "Focus Denote before authenticating.".into(),
                    ));
                }
                let hwnd = window
                    .hwnd()
                    .map_err(|error| AppError::Authentication(error.to_string()))?;
                let verifier = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                    .map_err(native_error)?;
                let operation: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                    verifier.RequestVerificationForWindowAsync(
                        HWND(hwnd.0),
                        &HSTRING::from(purpose.reason()),
                    )
                }
                .map_err(native_error)?;
                Ok(operation)
            })();
            if let Err(error) = sender.send(operation) {
                if let Ok(operation) = error.0 {
                    cancel(&operation);
                }
                eprintln!("Windows Hello request ended before its prompt could open.");
            }
        })
        .map_err(|error| {
            AppError::Authentication(format!("Unable to open Windows Hello: {error}"))
        })?;
        let operation = receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| {
                AppError::Authentication("Windows Hello could not open. Try again.".into())
            })??;
        let result = wait(&operation, Duration::from_secs(90))?;
        match result {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::Canceled => Err(AppError::Authentication("Windows Hello authentication was cancelled.".into())),
            UserConsentVerificationResult::RetriesExhausted => Err(AppError::Authentication("Windows Hello is locked out. Use an app password or unlock Windows Hello in Windows.".into())),
            _ => Err(AppError::Authentication(format!("Windows Hello did not authenticate (code {}).", result.0))),
        }
    }

    fn wait<T: RuntimeType + Send + 'static>(
        operation: &IAsyncOperation<T>,
        timeout: Duration,
    ) -> AppResult<T> {
        let (sender, receiver) = mpsc::sync_channel(1);
        if let Err(error) = operation.when(move |result| {
            if sender.try_send(result).is_err() {
                eprintln!("Windows Hello completed after its app authentication request ended.");
            }
        }) {
            cancel(operation);
            return Err(native_error(error));
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result.map_err(native_error),
            Err(_) => {
                cancel(operation);
                Err(AppError::Authentication(
                    "Windows Hello timed out. Try again.".into(),
                ))
            }
        }
    }

    fn native_error(error: windows::core::Error) -> AppError {
        AppError::Authentication(format!("Windows Hello is unavailable: {error}"))
    }

    fn cancel<T: RuntimeType>(operation: &IAsyncOperation<T>) {
        if let Err(error) = operation
            .cast::<IAsyncInfo>()
            .and_then(|info| info.Cancel())
        {
            eprintln!("Unable to cancel expired Windows Hello authentication: {error}");
        }
    }

    struct Apartment;
    impl Apartment {
        fn initialize() -> AppResult<Self> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(native_error)?;
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;
    pub(super) fn availability() -> DeviceAuthenticationStatus {
        DeviceAuthenticationStatus::unsupported()
    }
    pub(super) fn verify<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
        _purpose: Purpose,
    ) -> AppResult<()> {
        Err(AppError::Authentication(
            "Native device unlock is unavailable on this platform. Use an app password.".into(),
        ))
    }
}
