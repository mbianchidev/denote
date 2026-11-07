use std::{
    path::PathBuf,
    sync::{
        Mutex, MutexGuard, TryLockError,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    crypto::{self, KdfConfig},
    db,
    error::{AppError, AppResult},
};

mod device;
pub(crate) mod ipc;

const CONFIGURATION_VERSION: u32 = 1;
const MAX_CONFIGURATION_BYTES: i64 = 8192;
const MAX_PASSWORD_BYTES: usize = 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceAuthenticationStatus {
    pub available: bool,
    pub name: String,
    pub unavailable_reason: Option<String>,
}

impl DeviceAuthenticationStatus {
    #[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
    pub(crate) fn unsupported() -> Self {
        Self {
            available: false,
            name: "Device authentication".into(),
            unavailable_reason: Some(
                "Native device unlock is unavailable on this platform. Use an app password.".into(),
            ),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppLockStatus {
    pub enabled: bool,
    pub locked: bool,
    pub password_enabled: bool,
    pub device_authentication_enabled: bool,
    pub inactivity_minutes: Option<u32>,
    pub device_authentication: DeviceAuthenticationStatus,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum PasswordUpdate {
    Keep,
    Set { value: String },
    Remove,
}

impl Drop for PasswordUpdate {
    fn drop(&mut self) {
        if let Self::Set { value } = self {
            value.zeroize();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppLockConfigurationRequest {
    pub password: PasswordUpdate,
    pub current_password: Option<String>,
    pub device_authentication_enabled: bool,
    pub inactivity_minutes: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordVerifier {
    salt: [u8; 16],
    hash: [u8; 32],
}

impl PasswordVerifier {
    fn create(password: &str) -> AppResult<Self> {
        validate_password_size(password)?;
        crypto::validate_password(password).map_err(|error| match error {
            AppError::Crypto(message) => AppError::Authentication(message),
            error => error,
        })?;
        let mut salt = [0; 16];
        getrandom::fill(&mut salt).map_err(|error| {
            AppError::Authentication(format!("Secure password salt generation failed: {error}"))
        })?;
        let hash = crypto::derive_password_key(password.as_bytes(), &salt, &KdfConfig::default())?;
        Ok(Self { salt, hash: *hash })
    }

    fn verify(&self, password: &str) -> AppResult<()> {
        validate_password_size(password)?;
        let hash =
            crypto::derive_password_key(password.as_bytes(), &self.salt, &KdfConfig::default())?;
        if !bool::from(hash.ct_eq(&self.hash)) {
            return Err(AppError::Authentication("Incorrect app password.".into()));
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    version: u32,
    password: Option<PasswordVerifier>,
    device_authentication_enabled: bool,
    inactivity_minutes: Option<u32>,
}

impl Default for Configuration {
    fn default() -> Self {
        Self {
            version: CONFIGURATION_VERSION,
            password: None,
            device_authentication_enabled: false,
            inactivity_minutes: None,
        }
    }
}

impl Configuration {
    fn enabled(&self) -> bool {
        self.password.is_some() || self.device_authentication_enabled
    }

    fn validate(&self) -> AppResult<()> {
        if self.version != CONFIGURATION_VERSION {
            return Err(AppError::Authentication(
                "This app-lock settings version is unsupported.".into(),
            ));
        }
        if self
            .inactivity_minutes
            .is_some_and(|minutes| !(1..=240).contains(&minutes))
        {
            return Err(AppError::Authentication(
                "Choose an inactivity timeout from 1 to 240 minutes.".into(),
            ));
        }
        if !self.enabled() && self.inactivity_minutes.is_some() {
            return Err(AppError::Authentication(
                "Enable an unlock method before setting an inactivity timeout.".into(),
            ));
        }
        Ok(())
    }
}

pub(crate) struct AppLockManager {
    database: PathBuf,
    state: Mutex<ConfigurationState>,
    authentication: Mutex<()>,
    locked: AtomicBool,
}

struct ConfigurationState {
    configuration: Configuration,
    generation: u64,
    failed_attempts: u32,
    retry_after: Option<Instant>,
}

impl AppLockManager {
    pub(crate) fn load(database: PathBuf) -> AppResult<Self> {
        let connection = db::open(&database)?;
        let record: Option<(i64, Option<String>)> = connection.query_row(
            "SELECT length(CAST(value AS BLOB)), CASE WHEN length(CAST(value AS BLOB)) <= ?1 THEN value END
             FROM settings WHERE key = 'app_lock'",
            [MAX_CONFIGURATION_BYTES],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let configuration = match record {
            None => Configuration::default(),
            Some((_, Some(source))) => {
                serde_json::from_str::<Configuration>(&source).map_err(|error| {
                    AppError::Authentication(format!(
                        "App-lock settings are invalid (line {}, column {}).",
                        error.line(),
                        error.column(),
                    ))
                })?
            }
            Some(_) => {
                return Err(AppError::Authentication(
                    "App-lock settings exceed the supported size.".into(),
                ));
            }
        };
        configuration.validate()?;
        Ok(Self::new(database, configuration))
    }

    fn new(database: PathBuf, configuration: Configuration) -> Self {
        Self {
            locked: AtomicBool::new(configuration.enabled()),
            state: Mutex::new(ConfigurationState {
                configuration,
                generation: 0,
                failed_attempts: 0,
                retry_after: None,
            }),
            authentication: Mutex::new(()),
            database,
        }
    }

    #[cfg(test)]
    pub(crate) fn disabled(database: PathBuf) -> Self {
        Self::new(database, Configuration::default())
    }

    pub(crate) fn is_locked(&self) -> bool {
        self.locked.load(Ordering::Acquire)
    }

    pub(crate) fn status(
        &self,
        device_authentication: DeviceAuthenticationStatus,
    ) -> AppResult<AppLockStatus> {
        let state = self.state()?;
        let configuration = &state.configuration;
        Ok(AppLockStatus {
            enabled: configuration.enabled(),
            locked: self.is_locked(),
            password_enabled: configuration.password.is_some(),
            device_authentication_enabled: configuration.device_authentication_enabled,
            inactivity_minutes: configuration.inactivity_minutes,
            device_authentication,
        })
    }

    pub(crate) fn unlock_with_password(&self, password: String) -> AppResult<()> {
        let password = Zeroizing::new(password);
        let _authentication = self.acquire_authentication()?;
        let mut state = self.state()?;
        Self::verify_password(&mut state, &password)?;
        state.failed_attempts = 0;
        state.retry_after = None;
        self.locked.store(false, Ordering::Release);
        Ok(())
    }

    pub(crate) fn unlock_with_device(
        &self,
        verify_device: impl FnOnce() -> AppResult<()>,
    ) -> AppResult<()> {
        let _authentication = self.acquire_authentication()?;
        let generation = {
            let state = self.state()?;
            if !state.configuration.device_authentication_enabled {
                return Err(AppError::Authentication(
                    "Device unlock is not enabled.".into(),
                ));
            }
            state.generation
        };
        verify_device()?;
        let mut state = self.state()?;
        if state.generation != generation {
            return Err(AppError::Authentication(
                "App-lock state changed during authentication. Try again.".into(),
            ));
        }
        state.failed_attempts = 0;
        state.retry_after = None;
        self.locked.store(false, Ordering::Release);
        Ok(())
    }

    pub(crate) fn mark_locked(&self) -> AppResult<()> {
        let mut state = self.state()?;
        if !state.configuration.enabled() {
            return Err(AppError::Authentication(
                "Enable app lock in Settings before locking Denote.".into(),
            ));
        }
        self.locked.store(true, Ordering::Release);
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or_else(|| AppError::State("App-lock generation is exhausted.".into()))?;
        Ok(())
    }

    pub(crate) fn ensure_unlocked(&self) -> AppResult<()> {
        if self.state.is_poisoned() {
            self.locked.store(true, Ordering::Release);
            return Err(AppError::State(
                "App-lock settings lock is poisoned. Restart Denote.".into(),
            ));
        }
        if self.is_locked() {
            return Err(AppError::AppLocked);
        }
        Ok(())
    }

    pub(crate) fn configure(
        &self,
        request: AppLockConfigurationRequest,
        verify_device: impl FnOnce() -> AppResult<()>,
    ) -> AppResult<()> {
        let current_password = request.current_password.map(Zeroizing::new);
        let _authentication = self.acquire_authentication()?;
        let (previous, generation) = {
            let mut state = self.state()?;
            if self.is_locked() {
                return Err(AppError::AppLocked);
            }
            if state.configuration.password.is_some() {
                Self::verify_password(
                    &mut state,
                    current_password
                        .as_deref()
                        .map(String::as_str)
                        .ok_or_else(|| {
                            AppError::Authentication(
                                "Enter the current app password to change app lock.".into(),
                            )
                        })?,
                )?;
            }
            (state.configuration.clone(), state.generation)
        };
        if (request.device_authentication_enabled && !previous.device_authentication_enabled)
            || (previous.device_authentication_enabled && previous.password.is_none())
        {
            verify_device()?;
        }
        let password = match &request.password {
            PasswordUpdate::Keep => previous.password.clone(),
            PasswordUpdate::Set { value } => Some(PasswordVerifier::create(value)?),
            PasswordUpdate::Remove => None,
        };
        let next = Configuration {
            version: CONFIGURATION_VERSION,
            password,
            device_authentication_enabled: request.device_authentication_enabled,
            inactivity_minutes: request.inactivity_minutes,
        };
        next.validate()?;
        let mut state = self.state()?;
        if self.is_locked() || state.generation != generation {
            return Err(AppError::Authentication(
                "App-lock state changed before settings could be saved. Try again.".into(),
            ));
        }
        let connection = db::open(&self.database)?;
        if next.enabled() {
            let source = serde_json::to_string(&next).map_err(|error| {
                AppError::Authentication(format!("Unable to encode app-lock settings: {error}"))
            })?;
            connection.execute(
                "INSERT INTO settings(key, value, updated_at) VALUES ('app_lock', ?1, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![source],
            )?;
        } else {
            connection.execute("DELETE FROM settings WHERE key = 'app_lock'", [])?;
        }
        state.configuration = next;
        state.failed_attempts = 0;
        state.retry_after = None;
        Ok(())
    }

    fn state(&self) -> AppResult<MutexGuard<'_, ConfigurationState>> {
        self.state.lock().map_err(|_| {
            self.locked.store(true, Ordering::Release);
            AppError::State("App-lock settings lock is poisoned. Restart Denote.".into())
        })
    }

    fn acquire_authentication(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.authentication.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => {
                AppError::Authentication("Another app authentication is in progress.".into())
            }
            TryLockError::Poisoned(_) => {
                self.locked.store(true, Ordering::Release);
                AppError::State("App authentication state is poisoned. Restart Denote.".into())
            }
        })
    }

    fn verify_password(state: &mut ConfigurationState, password: &str) -> AppResult<()> {
        let now = Instant::now();
        if state.retry_after.is_some_and(|deadline| now < deadline) {
            return Err(AppError::Authentication(
                "Too many attempts. Wait before trying again.".into(),
            ));
        }
        let verifier = state.configuration.password.as_ref().ok_or_else(|| {
            AppError::Authentication("App password unlock is not enabled.".into())
        })?;
        if let Err(error) = verifier.verify(password) {
            state.failed_attempts = state.failed_attempts.saturating_add(1);
            if state.failed_attempts >= 5 {
                let seconds = 1u64 << (state.failed_attempts - 5).min(5);
                state.retry_after = Some(Instant::now() + Duration::from_secs(seconds));
            }
            return Err(error);
        }
        Ok(())
    }
}

fn validate_password_size(password: &str) -> AppResult<()> {
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(AppError::Authentication(
            "App passwords cannot exceed 1,024 bytes.".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_app_lock_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<AppLockStatus> {
    run_blocking(move || {
        use tauri::Manager;
        app.state::<db::AppState>()
            .app_lock
            .status(device::availability())
    })
    .await
}

#[tauri::command]
pub(crate) async fn unlock_app_with_password<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    password: String,
) -> AppResult<AppLockStatus> {
    let password = Zeroizing::new(password);
    run_blocking(move || {
        use tauri::Manager;
        let state = app.state::<db::AppState>();
        authentication_result(state.app_lock.unlock_with_password(password.to_string()))?;
        state.app_lock.status(device::availability())
    })
    .await
}

#[tauri::command]
pub(crate) async fn unlock_app_with_device<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<AppLockStatus> {
    run_blocking(move || {
        use tauri::Manager;
        let state = app.state::<db::AppState>();
        authentication_result(
            state
                .app_lock
                .unlock_with_device(|| device::verify(&app, device::Purpose::Unlock)),
        )?;
        state.app_lock.status(device::availability())
    })
    .await
}

#[tauri::command]
pub(crate) async fn configure_app_lock<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: AppLockConfigurationRequest,
) -> AppResult<AppLockStatus> {
    run_blocking(move || {
        use tauri::Manager;
        let state = app.state::<db::AppState>();
        authentication_result(
            state
                .app_lock
                .configure(request, || device::verify(&app, device::Purpose::Configure)),
        )?;
        state.app_lock.status(device::availability())
    })
    .await
}

#[tauri::command]
pub(crate) async fn lock_app<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<AppLockStatus> {
    run_blocking(move || {
        use tauri::Manager;
        let state = app.state::<db::AppState>();
        let plugins = app.state::<crate::plugins::PluginManager>();
        state.app_lock.ensure_unlocked()?;
        let device_status = device::availability();
        if !state.app_lock.status(device_status.clone())?.enabled {
            return Err(AppError::Authentication(
                "Enable app lock in Settings before locking Denote.".into(),
            ));
        }
        plugins.cancel_all_git_operations();
        let _tools = plugins.quiesce_native_tools()?;
        let _vault_access = state.write_vault_access()?;
        crate::commands::seal_active_vault_before_switch(&state)?;
        state.clear_vault_key()?;
        plugins.clear_clipboard_files()?;
        state.app_lock.mark_locked()?;
        state.app_lock.status(device_status)
    })
    .await
}

fn authentication_result(result: AppResult<()>) -> AppResult<()> {
    if let Err(error) = &result {
        eprintln!("Denote app authentication refused: {error}");
    }
    result
}

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::State(format!("App authentication worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn app_lock_is_disabled_by_default_and_persisted_password_starts_locked() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        crate::db::initialize(&database).unwrap();
        let manager = AppLockManager::load(database.clone()).unwrap();
        assert!(!manager.is_locked());
        assert!(
            !manager
                .status(DeviceAuthenticationStatus::unsupported())
                .unwrap()
                .enabled
        );

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
                || panic!("Password-only setup must not request device authentication"),
            )
            .unwrap();
        assert!(!manager.is_locked());

        let restarted = AppLockManager::load(database).unwrap();
        assert!(restarted.is_locked());
        assert!(
            restarted
                .unlock_with_password("synthetic wrong password".into())
                .is_err()
        );
        assert!(restarted.is_locked());
        restarted
            .unlock_with_password("synthetic app password".into())
            .unwrap();
        assert!(!restarted.is_locked());
    }

    #[test]
    fn device_unlock_requires_fresh_success_and_rejects_stale_authorization() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        crate::db::initialize(&database).unwrap();
        let manager = AppLockManager::load(database).unwrap();
        let request = || AppLockConfigurationRequest {
            password: PasswordUpdate::Remove,
            current_password: None,
            device_authentication_enabled: true,
            inactivity_minutes: None,
        };
        assert!(
            manager
                .configure(request(), || Err(AppError::Authentication(
                    "Cancelled".into()
                )))
                .is_err()
        );
        assert!(
            !manager
                .status(DeviceAuthenticationStatus::unsupported())
                .unwrap()
                .enabled
        );
        manager.configure(request(), || Ok(())).unwrap();
        manager.mark_locked().unwrap();

        assert!(
            manager
                .unlock_with_device(|| Err(AppError::Authentication("Cancelled".into())))
                .is_err()
        );
        assert!(manager.is_locked());
        assert!(
            manager
                .unlock_with_device(|| {
                    manager.mark_locked()?;
                    Ok(())
                })
                .is_err()
        );
        assert!(manager.is_locked());
        manager.unlock_with_device(|| Ok(())).unwrap();
        assert!(!manager.is_locked());
    }

    #[test]
    fn changing_or_disabling_a_password_requires_the_current_password() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        let manager = AppLockManager::load(database.clone()).unwrap();
        let request = |current: Option<&str>, password| AppLockConfigurationRequest {
            password,
            current_password: current.map(String::from),
            device_authentication_enabled: false,
            inactivity_minutes: None,
        };
        manager
            .configure(
                request(
                    None,
                    PasswordUpdate::Set {
                        value: "synthetic original password".into(),
                    },
                ),
                || Ok(()),
            )
            .unwrap();
        for current in [None, Some("synthetic wrong password")] {
            assert!(
                manager
                    .configure(request(current, PasswordUpdate::Remove), || Ok(()))
                    .is_err()
            );
        }
        manager
            .configure(
                request(
                    Some("synthetic original password"),
                    PasswordUpdate::Set {
                        value: "synthetic replacement password".into(),
                    },
                ),
                || Ok(()),
            )
            .unwrap();
        manager.mark_locked().unwrap();
        assert!(
            manager
                .unlock_with_password("synthetic original password".into())
                .is_err()
        );
        manager
            .unlock_with_password("synthetic replacement password".into())
            .unwrap();
        manager
            .configure(
                request(
                    Some("synthetic replacement password"),
                    PasswordUpdate::Remove,
                ),
                || Ok(()),
            )
            .unwrap();
        assert!(!AppLockManager::load(database).unwrap().is_locked());
    }

    #[test]
    fn invalid_configuration_never_becomes_a_disabled_lock() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        let connection = db::open(&database).unwrap();
        for source in [
            "{".to_string(),
            serde_json::json!({ "version": 999, "password": null, "device_authentication_enabled": true, "inactivity_minutes": null }).to_string(),
            serde_json::json!({ "version": 1, "password": null, "device_authentication_enabled": true, "inactivity_minutes": 0 }).to_string(),
            serde_json::json!({ "version": 1, "password": null, "device_authentication_enabled": true, "inactivity_minutes": 241 }).to_string(),
            "日".repeat(3000),
        ] {
            connection.execute(
                "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('app_lock',?1,CURRENT_TIMESTAMP)",
                params![source],
            ).unwrap();
            assert!(AppLockManager::load(database.clone()).is_err());
        }
    }

    #[test]
    fn password_verifiers_are_salted_bounded_and_never_store_the_password() {
        let first = PasswordVerifier::create("synthetic app password").unwrap();
        let second = PasswordVerifier::create("synthetic app password").unwrap();
        assert_ne!(first.salt, second.salt);
        assert_ne!(first.hash, second.hash);
        let source = serde_json::to_string(&first).unwrap();
        assert!(!source.contains("synthetic app password"));
        assert!(PasswordVerifier::create("short").is_err());
        assert!(PasswordVerifier::create("             ").is_err());
        assert!(PasswordVerifier::create(&"x".repeat(1025)).is_err());
    }

    #[test]
    fn authentication_is_single_flight_and_failed_passwords_are_rate_limited() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite");
        db::initialize(&database).unwrap();
        let manager = AppLockManager::load(database).unwrap();
        manager
            .configure(
                AppLockConfigurationRequest {
                    password: PasswordUpdate::Set {
                        value: "synthetic app password".into(),
                    },
                    current_password: None,
                    device_authentication_enabled: false,
                    inactivity_minutes: Some(1),
                },
                || Ok(()),
            )
            .unwrap();
        manager.mark_locked().unwrap();
        {
            let _in_flight = manager.authentication.lock().unwrap();
            assert!(
                manager
                    .unlock_with_password("synthetic app password".into())
                    .is_err()
            );
        }
        for _ in 0..5 {
            assert!(
                manager
                    .unlock_with_password("synthetic wrong password".into())
                    .is_err()
            );
        }
        assert!(
            manager
                .unlock_with_password("synthetic app password".into())
                .is_err()
        );
        manager.state.lock().unwrap().retry_after = Some(Instant::now() - Duration::from_secs(1));
        manager
            .unlock_with_password("synthetic app password".into())
            .unwrap();
        assert!(!manager.is_locked());
    }
}
