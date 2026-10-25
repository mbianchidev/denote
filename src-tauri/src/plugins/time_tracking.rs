use std::{
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{PluginManager, commands::run_blocking};
use crate::{
    db::AppState,
    dialogs,
    error::{AppError, AppResult},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTrackingClock {
    boot_id: String,
    wall_time_ms: u64,
    monotonic_ms: u64,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeTrackingExportFormat {
    Csv,
    Json,
}

#[tauri::command]
pub fn plugin_time_tracking_clock(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<TimeTrackingClock> {
    state.enabled_permission(&plugin_id, "time-tracking")?;
    read_clock(&plugin_id)
}

fn read_clock(plugin_id: &str) -> AppResult<TimeTrackingClock> {
    let (boot_id, monotonic_ms) = continuous_clock()?;
    let wall_time_ms = u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| AppError::State(format!("The system clock precedes 1970: {error}")))?
            .as_millis(),
    )
    .map_err(|_| AppError::State("The system clock exceeds the timer range".into()))?;
    if monotonic_ms > 9_007_199_254_740_991 || wall_time_ms > 253_402_300_799_999 {
        return Err(AppError::State(
            "The native clock exceeds the supported timer range".into(),
        ));
    }
    let mut hash = Sha256::new();
    hash.update(plugin_id.as_bytes());
    hash.update([0]);
    hash.update(boot_id);
    Ok(TimeTrackingClock {
        boot_id: hex::encode(hash.finalize()),
        wall_time_ms,
        monotonic_ms,
    })
}

#[cfg(target_os = "macos")]
fn continuous_clock() -> AppResult<(Vec<u8>, u64)> {
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }
    let mut boot = [0_u8; 128];
    let mut length = boot.len();
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            boot.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if length == 0 || length > boot.len() || boot[0] == 0 {
        return Err(AppError::State(
            "The native boot identity is unavailable".into(),
        ));
    }
    let mut timebase = Timebase { numer: 0, denom: 0 };
    if unsafe { mach_timebase_info(&mut timebase) } != 0
        || timebase.numer == 0
        || timebase.denom == 0
    {
        return Err(AppError::State(
            "The continuous clock timebase is unavailable".into(),
        ));
    }
    // Unlike mach_absolute_time and JavaScript timers, this clock includes sleep.
    let milliseconds = u128::from(unsafe { mach_continuous_time() }) * u128::from(timebase.numer)
        / u128::from(timebase.denom)
        / 1_000_000;
    let milliseconds = u64::try_from(milliseconds)
        .map_err(|_| AppError::State("The continuous clock exceeds its range".into()))?;
    Ok((boot[..length].to_vec(), milliseconds))
}

#[cfg(target_os = "linux")]
fn continuous_clock() -> AppResult<(Vec<u8>, u64)> {
    let boot = fs::read("/proc/sys/kernel/random/boot_id")?;
    if boot.is_empty() || boot.len() > 128 {
        return Err(AppError::State(
            "The native boot identity is unavailable".into(),
        ));
    }
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut time) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let seconds = u64::try_from(time.tv_sec)
        .map_err(|_| AppError::State("The continuous clock is negative".into()))?;
    let nanoseconds = u64::try_from(time.tv_nsec)
        .map_err(|_| AppError::State("The continuous clock is negative".into()))?;
    let milliseconds = seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(nanoseconds / 1_000_000))
        .ok_or_else(|| AppError::State("The continuous clock exceeds its range".into()))?;
    Ok((boot, milliseconds))
}

#[cfg(target_os = "windows")]
fn continuous_clock() -> AppResult<(Vec<u8>, u64)> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetTickCount64() -> u64;
    }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQuerySystemInformation(
            information_class: u32,
            information: *mut std::ffi::c_void,
            information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }
    // SYSTEM_BOOT_ENVIRONMENT_INFORMATION starts with the boot's 16-byte GUID.
    let mut information = [0_u64; 4];
    let mut length = 0_u32;
    let status = unsafe {
        NtQuerySystemInformation(
            90,
            information.as_mut_ptr().cast(),
            std::mem::size_of_val(&information) as u32,
            &mut length,
        )
    };
    if status < 0 || length < 16 || information[..2] == [0, 0] {
        return Err(AppError::State(format!(
            "The native boot identity is unavailable (NTSTATUS {status:#x})"
        )));
    }
    let boot = information[..2]
        .iter()
        .flat_map(|value| value.to_ne_bytes())
        .collect();
    Ok((boot, unsafe { GetTickCount64() }))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn continuous_clock() -> AppResult<(Vec<u8>, u64)> {
    Err(AppError::State(
        "Time tracking requires a supported desktop continuous clock".into(),
    ))
}

#[tauri::command]
pub async fn export_time_tracking(
    app: AppHandle,
    state: State<'_, PluginManager>,
    app_state: State<'_, AppState>,
    plugin_id: String,
    workspace_scope: String,
    format: TimeTrackingExportFormat,
    content: String,
) -> AppResult<bool> {
    validate_export(format, &content)?;
    authorize_export(&state, &app_state, &plugin_id, &workspace_scope)?;
    let (name, extension) = match format {
        TimeTrackingExportFormat::Csv => ("time-tracking.csv", "csv"),
        TimeTrackingExportFormat::Json => ("time-tracking.json", "json"),
    };
    let Some(mut path) =
        dialogs::save(&app, "Export time-tracking sessions", name, extension).await?
    else {
        return Ok(false);
    };
    path.set_extension(extension);
    let manager = state.inner().clone();
    run_blocking(move || {
        let app_state = app.state::<AppState>();
        let _access = app_state.read_vault_access()?;
        authorize_export(&manager, &app_state, &plugin_id, &workspace_scope)?;
        let mut file = AtomicWriteFile::open(path)?;
        file.write_all(content.as_bytes())?;
        file.commit()?;
        Ok(true)
    })
    .await
}

fn authorize_export(
    manager: &PluginManager,
    app_state: &AppState,
    plugin_id: &str,
    scope: &str,
) -> AppResult<()> {
    manager.enabled_permission(plugin_id, "time-tracking")?;
    let root = app_state.active_vault()?;
    if fs::canonicalize(scope)? != root {
        return Err(AppError::Plugin(
            "Time-tracking export expired after a vault switch".into(),
        ));
    }
    crate::commands::active_key(app_state, &root)?;
    Ok(())
}

fn validate_export(format: TimeTrackingExportFormat, content: &str) -> AppResult<()> {
    if content.is_empty() || content.len() > 2 * 1024 * 1024 {
        return Err(AppError::Plugin(
            "Time-tracking export must contain at most 2 MiB".into(),
        ));
    }
    if matches!(format, TimeTrackingExportFormat::Json) {
        let value: serde_json::Value = serde_json::from_str(content).map_err(|error| {
            AppError::Plugin(format!("Invalid time-tracking JSON export: {error}"))
        })?;
        if value.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1)
            || !value
                .get("sessions")
                .and_then(|value| value.as_array())
                .is_some_and(|sessions| sessions.len() <= 500)
        {
            return Err(AppError::Plugin("Invalid time-tracking JSON export".into()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_time_tracking_clock_is_continuous_and_boot_scoped() {
        let first = read_clock("denote.synthetic").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let next = read_clock("denote.synthetic").unwrap();
        assert_eq!(first.boot_id, next.boot_id);
        assert_eq!(first.boot_id.len(), 64);
        assert!(next.monotonic_ms >= first.monotonic_ms);
        assert_ne!(first.boot_id, read_clock("denote.other").unwrap().boot_id);
    }

    #[test]
    fn time_tracking_exports_are_bounded_and_versioned() {
        assert!(
            validate_export(
                TimeTrackingExportFormat::Json,
                r#"{"schemaVersion":1,"sessions":[]}"#
            )
            .is_ok()
        );
        for invalid in [
            "",
            "[]",
            r#"{"schemaVersion":2,"sessions":[]}"#,
            r#"{"schemaVersion":1,"sessions":{}}"#,
        ] {
            assert!(validate_export(TimeTrackingExportFormat::Json, invalid).is_err());
        }
        assert!(
            validate_export(
                TimeTrackingExportFormat::Csv,
                &"x".repeat(2 * 1024 * 1024 + 1)
            )
            .is_err()
        );
    }
}
