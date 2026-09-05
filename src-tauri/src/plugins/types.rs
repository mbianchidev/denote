use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const CATALOG_JSON: &str = include_str!("../../../plugins/catalog.json");
pub(crate) const BUNDLES_JSON: &str = include_str!("../../../plugins/bundles.json");
pub(crate) const MAX_PLUGIN_PACKAGE_BYTES: usize = 25 * 1024 * 1024;
pub(crate) const MAX_PLUGIN_ENTRYPOINT_BYTES: u64 = 5 * 1024 * 1024;
pub(crate) const MAX_PLUGIN_SETTINGS_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PLUGIN_STORAGE_VALUE_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PLUGIN_STORAGE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_PLUGIN_STORAGE_KEYS: usize = 256;
pub(crate) const PLUGIN_API_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPublisher {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermission {
    pub capability: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub executables: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCompatibility {
    pub api_version: u32,
    pub minimum_denote_version: String,
    pub maximum_denote_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub publisher: PluginPublisher,
    pub license: String,
    pub repository: String,
    pub homepage: Option<String>,
    pub icon: String,
    pub category: String,
    pub compatibility: PluginCompatibility,
    pub permissions: Vec<PluginPermission>,
    pub entrypoint: String,
    pub documentation: String,
    pub settings: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginArtifact {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProvenance {
    pub publisher_id: String,
    pub source_commit: String,
    pub trusted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRevocation {
    pub reason: String,
    pub revoked_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub manifest: PluginManifest,
    pub artifact: PluginArtifact,
    pub provenance: PluginProvenance,
    #[serde(default)]
    pub revoked: Option<PluginRevocation>,
    pub guide: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBundleRole {
    pub id: String,
    pub name: String,
    pub candidate_plugin_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBundle {
    pub id: String,
    pub name: String,
    pub categories: Vec<String>,
    pub roles: Vec<PluginBundleRole>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub catalog: PluginCatalogEntry,
    pub development: bool,
    pub runtime_manifest: Option<PluginManifest>,
    pub status: String,
    pub enabled: bool,
    pub error: Option<String>,
    pub approved_permissions: Vec<PluginPermission>,
    pub previously_approved: bool,
    pub settings: Value,
    pub has_credentials: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub version: String,
    pub entrypoint: String,
    pub transaction_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginNetworkRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNetworkResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginProcessRequest {
    pub executable: String,
    pub arguments: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProcessResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTextDocument {
    pub content: String,
    pub version: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct PersistentPluginState {
    pub(crate) enabled: BTreeSet<String>,
    pub(crate) development_plugin_ids: BTreeSet<String>,
    pub(crate) updates_available: BTreeSet<String>,
    pub(crate) approved_permissions: BTreeMap<String, BTreeSet<PluginPermission>>,
    pub(crate) artifact_hashes: BTreeMap<String, String>,
    pub(crate) catalog_fingerprints: BTreeMap<String, String>,
    pub(crate) entrypoint_hashes: BTreeMap<String, String>,
    pub(crate) installed_manifests: BTreeMap<String, PluginManifest>,
    pub(crate) settings: BTreeMap<String, Value>,
    pub(crate) settings_versions: BTreeMap<String, u32>,
    pub(crate) storage: BTreeMap<String, BTreeMap<String, Value>>,
    pub(crate) credential_keys: BTreeMap<String, BTreeSet<String>>,
    pub(crate) pending_credential_keys: BTreeMap<String, BTreeSet<String>>,
    pub(crate) errors: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CredentialLedger {
    pub(crate) credential_keys: BTreeMap<String, BTreeSet<String>>,
    pub(crate) pending_credential_keys: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Clone)]
pub(crate) struct PreparedPluginTransaction {
    pub(crate) plugin_id: String,
    pub(crate) permissions: BTreeSet<PluginPermission>,
    pub(crate) artifact_sha256: String,
    pub(crate) catalog_fingerprint: String,
    pub(crate) entrypoint_sha256: Option<String>,
    pub(crate) previously_enabled: bool,
}
