use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Folder,
    Markdown,
    Text,
    Image,
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
    pub tree: Vec<FileNode>,
    pub bookmarks: Vec<NoteListItem>,
    pub recent: Vec<NoteListItem>,
    pub trash: Vec<TrashItem>,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocument {
    pub path: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub kind: FileKind,
    pub bookmarked: bool,
    pub last_opened_at: Option<String>,
}
