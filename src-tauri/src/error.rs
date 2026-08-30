use serde::ser::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Metadata operation failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Unsupported file: {0}")]
    UnsupportedFile(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid data: {0}")]
    InvalidData(String),
    #[error("Application state error: {0}")]
    State(String),
    #[error("Save conflict: {0}")]
    Conflict(String),
    #[error("Vault is locked")]
    Locked,
    #[error("Encryption error: {0}")]
    Crypto(String),
    #[error("Clipboard operation failed: {0}")]
    Clipboard(String),
    #[error("Unable to move vault to system Trash: {0}")]
    Trash(String),
    #[error("Plugin operation failed: {0}")]
    Plugin(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
