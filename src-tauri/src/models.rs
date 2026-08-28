use serde::{Deserialize, Serialize};

use crate::crypto::EncryptionPhase;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Folder,
    Markdown,
    Text,
    Image,
    File,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileEncoding {
    Utf8,
    Base64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileLineEnding {
    Lf,
    Crlf,
    Cr,
}

impl FileLineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
            Self::Cr => "cr",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "crlf" => Self::Crlf,
            "cr" => Self::Cr,
            _ => Self::Lf,
        }
    }
}

impl FileEncoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Utf8 => "utf8",
            Self::Base64 => "base64",
        }
    }

    pub fn from_str(value: &str) -> Self {
        if value == "base64" {
            Self::Base64
        } else {
            Self::Utf8
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MarkdownViewMode {
    RichText,
    Source,
}

impl MarkdownViewMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RichText => "rich-text",
            Self::Source => "source",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "rich-text" => Some(Self::RichText),
            "source" => Some(Self::Source),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub children: Vec<FileNode>,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub bookmarked: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteStats {
    pub open_count: i64,
    pub edit_count: i64,
    pub save_count: i64,
    pub last_opened_at: Option<String>,
    pub last_edited_at: Option<String>,
    pub last_saved_at: Option<String>,
    pub bookmarked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub path: String,
    pub content: String,
    pub content_hash: String,
    pub encoding: FileEncoding,
    pub line_ending: FileLineEnding,
    pub view_mode: Option<MarkdownViewMode>,
    pub stats: NoteStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub path: String,
    pub title: String,
    pub last_opened_at: Option<String>,
    pub bookmarked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownVault {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub last_opened_at: String,
    pub available: bool,
    pub current: bool,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownVaultFile {
    pub vault_id: i64,
    pub vault_name: String,
    pub path: String,
    pub file_name: String,
    pub current: bool,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownVaultFileBatch {
    pub files: Vec<KnownVaultFile>,
    pub skipped_vault_count: usize,
    pub skipped_entry_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagColor {
    pub tag: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: i64,
    pub original_path: String,
    pub deleted_at: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub vault_path: String,
    pub vault_name: String,
    pub default: bool,
    pub tree: Vec<FileNode>,
    pub bookmarks: Vec<NoteListItem>,
    pub recent: Vec<NoteListItem>,
    pub trash: Vec<TrashItem>,
    pub tag_colors: Vec<TagColor>,
    pub encryption: EncryptionStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    pub enabled: bool,
    pub unlocked: bool,
    pub phase: Option<EncryptionPhase>,
    pub remaining_recovery_codes: usize,
}

impl Default for EncryptionStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            unlocked: true,
            phase: None,
            remaining_recovery_codes: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionSetupResult {
    pub snapshot: WorkspaceSnapshot,
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodesResult {
    pub remaining_recovery_codes: usize,
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub path: String,
    pub changed: bool,
    pub saved_at: String,
    pub content_hash: String,
    pub history_count: i64,
    pub stats: NoteStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRevision {
    pub id: i64,
    pub created_at: String,
    pub reason: String,
    pub preview: String,
    pub byte_count: usize,
    pub encoding: FileEncoding,
    pub line_ending: FileLineEnding,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocument {
    pub path: String,
    pub title: String,
    pub content: String,
    pub content_hash: String,
    pub encoding: FileEncoding,
    pub line_ending: FileLineEnding,
    pub tags: Vec<String>,
    pub kind: FileKind,
    pub bookmarked: bool,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBatch {
    pub documents: Vec<SearchDocument>,
    pub skipped_count: usize,
    pub truncated: bool,
}
