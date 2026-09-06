use std::{
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use reqwest::{Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, ipc::Channel, utils::platform::bundle_type};
use tauri_plugin_updater::{Update, UpdaterExt};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};

const CONFIG_SOURCE: &str = include_str!("../updater.json");
const RELEASE_ASSET_SOURCE: &str = include_str!("../../release-assets.json");
const MAX_UPDATE_BYTES: usize = 512 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const OFFICIAL_REPOSITORY: &str = "mbianchidev/denote";
const DEVELOPMENT_IDENTIFIER: &str = "dev.mbianchi.denote.development";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterConfiguration {
    schema_version: u32,
    enabled: bool,
    channel: String,
    endpoint: String,
    public_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetContract {
    schema_version: u32,
    repository: String,
    updater_targets: Vec<UpdaterTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterTarget {
    target: String,
    release_file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub operating_system: String,
    pub architecture: String,
    pub bundle_type: String,
    pub update_channel: String,
    pub updater_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum UpdateProgress {
    Started { content_length: Option<u64> },
    Progress { downloaded: u64 },
    Finished,
}

struct PreparedUpdate {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct UpdateManager {
    prepared: Mutex<Option<PreparedUpdate>>,
}

#[tauri::command]
pub fn get_runtime_info<R: Runtime>(app: AppHandle<R>) -> AppResult<RuntimeInfo> {
    let config = configuration()?;
    Ok(RuntimeInfo {
        operating_system: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        bundle_type: current_bundle_type(),
        update_channel: if app.config().identifier == DEVELOPMENT_IDENTIFIER {
            "development".to_string()
        } else {
            config.channel.clone()
        },
        updater_configured: app.config().identifier != DEVELOPMENT_IDENTIFIER
            && configuration_is_enabled(&config),
    })
}

#[tauri::command]
pub async fn check_for_update<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<AvailableUpdate>> {
    let update = checked_update(&app).await?;
    Ok(update.map(|update| AvailableUpdate {
        version: update.version,
        notes: update.body,
    }))
}

#[tauri::command]
pub async fn download_update<R: Runtime>(
    app: AppHandle<R>,
    manager: tauri::State<'_, UpdateManager>,
    expected_version: String,
    progress: Channel<UpdateProgress>,
) -> AppResult<AvailableUpdate> {
    discard_prepared(&manager)?;
    let update = checked_update(&app)
        .await?
        .ok_or_else(|| AppError::Update("No newer Denote release is available".to_string()))?;
    if update.version != expected_version {
        return Err(AppError::Update(format!(
            "The available update changed from {expected_version} to {}. Check again before downloading.",
            update.version
        )));
    }
    let available = AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    let mut downloaded = 0_u64;
    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = progress.send(UpdateProgress::Started { content_length });
                }
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let _ = progress.send(UpdateProgress::Progress { downloaded });
            },
            || {
                let _ = progress.send(UpdateProgress::Finished);
            },
        )
        .await
        .map_err(update_error)?;
    if bytes.len() > MAX_UPDATE_BYTES {
        return Err(AppError::Update(format!(
            "The verified update exceeds the {} MiB safety limit",
            MAX_UPDATE_BYTES / 1024 / 1024
        )));
    }
    let mut prepared = manager
        .prepared
        .lock()
        .map_err(|_| AppError::Update("The prepared update lock is poisoned".to_string()))?;
    *prepared = Some(PreparedUpdate { update, bytes });
    Ok(available)
}

#[tauri::command]
pub fn discard_prepared_update(manager: tauri::State<'_, UpdateManager>) -> AppResult<()> {
    discard_prepared(&manager)
}

#[tauri::command]
pub fn install_prepared_update<R: Runtime>(
    app: AppHandle<R>,
    manager: tauri::State<'_, UpdateManager>,
    expected_version: String,
) -> AppResult<()> {
    let prepared = {
        let mut slot = manager
            .prepared
            .lock()
            .map_err(|_| AppError::Update("The prepared update lock is poisoned".to_string()))?;
        slot.take().ok_or_else(|| {
            AppError::Update("Download the update before installing it".to_string())
        })?
    };
    if prepared.update.version != expected_version {
        return Err(AppError::Update(
            "The prepared update no longer matches the reviewed version".to_string(),
        ));
    }
    if let Err(error) = prepared.update.install(&prepared.bytes) {
        restore_prepared(&manager, prepared)?;
        return Err(update_error(error));
    }

    #[cfg(target_os = "macos")]
    remove_installed_app_quarantine(&app)?;

    app.restart();
}

async fn checked_update<R: Runtime>(app: &AppHandle<R>) -> AppResult<Option<Update>> {
    let config = configuration()?;
    if app.config().identifier == DEVELOPMENT_IDENTIFIER {
        return Err(AppError::Update(
            "Updates are unavailable in Denote Development".to_string(),
        ));
    }
    if !configuration_is_enabled(&config) {
        return Err(AppError::Update(
            "The stable update channel is not configured with a trusted public key".to_string(),
        ));
    }
    let public_key = config
        .public_key
        .as_deref()
        .expect("enabled updater configuration has a public key");
    let endpoint = Url::parse(&config.endpoint)
        .map_err(|error| AppError::Update(format!("Invalid update endpoint: {error}")))?;
    validate_endpoint(&endpoint)?;
    let updater = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(update_error)?
        .timeout(Duration::from_secs(30))
        .configure_client(|builder| builder.redirect(github_redirect_policy()))
        .build()
        .map_err(update_error)?;
    let update = updater.check().await.map_err(update_error)?;
    if let Some(update) = &update {
        validate_update_download(update)?;
    }
    Ok(update)
}

fn configuration() -> AppResult<UpdaterConfiguration> {
    let config: UpdaterConfiguration = serde_json::from_str(CONFIG_SOURCE)
        .map_err(|error| AppError::Update(format!("Invalid updater configuration: {error}")))?;
    if config.schema_version != 1 || config.channel != "stable" {
        return Err(AppError::Update(
            "Unsupported updater configuration".to_string(),
        ));
    }
    validate_endpoint(
        &Url::parse(&config.endpoint)
            .map_err(|error| AppError::Update(format!("Invalid update endpoint: {error}")))?,
    )?;
    Ok(config)
}

fn configuration_is_enabled(config: &UpdaterConfiguration) -> bool {
    config.enabled
        && config
            .public_key
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn release_contract() -> AppResult<ReleaseAssetContract> {
    let contract: ReleaseAssetContract = serde_json::from_str(RELEASE_ASSET_SOURCE)
        .map_err(|error| AppError::Update(format!("Invalid release asset contract: {error}")))?;
    if contract.schema_version != 1 || contract.repository != OFFICIAL_REPOSITORY {
        return Err(AppError::Update(
            "Unsupported release asset contract".to_string(),
        ));
    }
    Ok(contract)
}

fn validate_endpoint(url: &Url) -> AppResult<()> {
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.path() != format!("/{OFFICIAL_REPOSITORY}/releases/latest/download/latest.json")
    {
        return Err(AppError::Update(
            "The update endpoint must be the official Denote GitHub Release endpoint".to_string(),
        ));
    }
    Ok(())
}

fn validate_update_download(update: &Update) -> AppResult<()> {
    let contract = release_contract()?;
    let target = current_updater_target().ok_or_else(|| {
        AppError::Update("This Denote package type does not support in-app updates".to_string())
    })?;
    let expected = contract
        .updater_targets
        .iter()
        .find(|entry| entry.target == target)
        .ok_or_else(|| {
            AppError::Update(format!(
                "No signed updater artifact is defined for {target}"
            ))
        })?;
    let expected_name = render_release_name(&expected.release_file_name, &update.version)?;
    let expected_path = format!(
        "/{OFFICIAL_REPOSITORY}/releases/download/v{}/{expected_name}",
        update.version
    );
    if update.download_url.scheme() != "https"
        || update.download_url.host_str() != Some("github.com")
        || update.download_url.path() != expected_path
        || update.download_url.query().is_some()
        || update.download_url.fragment().is_some()
    {
        return Err(AppError::Update(
            "The update metadata selected an unofficial or unexpected artifact".to_string(),
        ));
    }
    Ok(())
}

fn current_updater_target() -> Option<String> {
    let target = tauri_plugin_updater::target()?;
    Some(format!("{target}-{}", current_bundle_type()))
}

fn current_bundle_type() -> String {
    bundle_type()
        .map(|bundle| format!("{bundle:?}").to_ascii_lowercase())
        .unwrap_or_else(|| "unknown".to_string())
}

fn render_release_name(template: &str, version: &str) -> AppResult<String> {
    if !template.contains("{version}")
        || template.contains('/')
        || template.contains('\\')
        || !version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-+".contains(character))
    {
        return Err(AppError::Update(
            "Invalid updater artifact filename".to_string(),
        ));
    }
    Ok(template.replace("{version}", version))
}

fn github_redirect_policy() -> Policy {
    Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many GitHub release redirects");
        }
        match attempt.url().host_str() {
            Some(
                "github.com"
                | "objects.githubusercontent.com"
                | "release-assets.githubusercontent.com"
                | "github-releases.githubusercontent.com",
            ) if attempt.url().scheme() == "https" => attempt.follow(),
            _ => attempt.error("update redirect left the GitHub release host allowlist"),
        }
    })
}

fn discard_prepared(manager: &UpdateManager) -> AppResult<()> {
    let mut prepared = manager
        .prepared
        .lock()
        .map_err(|_| AppError::Update("The prepared update lock is poisoned".to_string()))?;
    prepared.take();
    Ok(())
}

fn restore_prepared(manager: &UpdateManager, prepared: PreparedUpdate) -> AppResult<()> {
    let mut slot = manager
        .prepared
        .lock()
        .map_err(|_| AppError::Update("The prepared update lock is poisoned".to_string()))?;
    *slot = Some(prepared);
    Ok(())
}

fn update_error(error: impl std::fmt::Display) -> AppError {
    AppError::Update(error.to_string())
}

#[cfg(target_os = "macos")]
fn remove_installed_app_quarantine<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let executable = std::env::current_exe()
        .map_err(|error| AppError::Update(format!("Unable to locate Denote: {error}")))?;
    let bundle = app_bundle_from_executable(&executable, &app.package_info().name)?;
    for entry in WalkDir::new(&bundle).follow_links(false) {
        let entry = entry.map_err(|error| {
            AppError::Update(format!("Unable to inspect updated Denote: {error}"))
        })?;
        if entry.file_type().is_symlink() {
            continue;
        }
        if xattr::get(entry.path(), "com.apple.quarantine")
            .map_err(|error| {
                AppError::Update(format!(
                    "Unable to inspect Denote quarantine metadata: {error}"
                ))
            })?
            .is_some()
        {
            xattr::remove(entry.path(), "com.apple.quarantine").map_err(|error| {
                AppError::Update(format!(
                    "Unable to remove quarantine from the verified Denote update: {error}"
                ))
            })?;
        }
    }
    Ok(())
}

#[cfg(any(test, target_os = "macos"))]
fn app_bundle_from_executable(executable: &Path, product_name: &str) -> AppResult<PathBuf> {
    if product_name != "Denote" {
        return Err(AppError::Update(
            "Only the production Denote app bundle can be finalized".to_string(),
        ));
    }
    let components = executable.components().collect::<Vec<_>>();
    let contents = components
        .windows(2)
        .position(|pair| {
            pair[0] == Component::Normal("Denote.app".as_ref())
                && pair[1] == Component::Normal("Contents".as_ref())
        })
        .ok_or_else(|| {
            AppError::Update("The running executable is not inside Denote.app".to_string())
        })?;
    let mut bundle = PathBuf::new();
    for component in components.into_iter().take(contents + 1) {
        bundle.push(component.as_os_str());
    }
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconfigured_updater_fails_closed() {
        let config = configuration().expect("configuration");
        assert!(!configuration_is_enabled(&config));
        assert!(config.public_key.is_none());
    }

    #[test]
    fn official_endpoint_is_exact() {
        validate_endpoint(
            &Url::parse(
                "https://github.com/mbianchidev/denote/releases/latest/download/latest.json",
            )
            .expect("url"),
        )
        .expect("official endpoint");
        assert!(
            validate_endpoint(&Url::parse("https://example.test/latest.json").expect("url"))
                .is_err()
        );
    }

    #[test]
    fn macos_bundle_path_is_derived_without_caller_input() {
        let path = app_bundle_from_executable(
            Path::new("/Applications/Denote.app/Contents/MacOS/denote"),
            "Denote",
        )
        .expect("bundle");
        assert_eq!(path, PathBuf::from("/Applications/Denote.app"));
        assert!(
            app_bundle_from_executable(
                Path::new("/Applications/Other.app/Contents/MacOS/denote"),
                "Denote",
            )
            .is_err()
        );
    }

    #[test]
    fn release_names_reject_paths() {
        assert_eq!(
            render_release_name("Denote_{version}_x64.dmg", "1.2.3").expect("name"),
            "Denote_1.2.3_x64.dmg"
        );
        assert!(render_release_name("../{version}", "1.2.3").is_err());
    }
}
