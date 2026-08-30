use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        RwLock, RwLockReadGuard, RwLockWriteGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    crypto::VaultKey,
    error::{AppError, AppResult},
    models::{
        FileEncoding, FileLineEnding, FileNode, MarkdownViewMode, NoteListItem, NoteStats,
        TabSessionState, TagColor, TrashItem,
    },
};

pub const HISTORY_LIMIT: i64 = 10;

#[derive(Debug, Clone, Copy)]
pub struct EntryPlacement {
    pub position: i64,
    pub pinned: bool,
}

pub struct KnownVaultRecord {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub last_opened_at: String,
    pub default: bool,
}

pub struct AppState {
    pub db_path: PathBuf,
    active_vault: RwLock<Option<PathBuf>>,
    vault_key: RwLock<Option<VaultKey>>,
    vault_access: RwLock<()>,
    allow_exit: AtomicBool,
}

impl AppState {
    pub fn new(db_path: PathBuf, active_vault: Option<PathBuf>) -> Self {
        Self {
            db_path,
            active_vault: RwLock::new(active_vault),
            vault_key: RwLock::new(None),
            vault_access: RwLock::new(()),
            allow_exit: AtomicBool::new(false),
        }
    }

    pub fn active_vault(&self) -> AppResult<PathBuf> {
        self.active_vault_optional()?
            .ok_or_else(|| crate::error::AppError::State("No vault is open".to_string()))
    }

    pub fn active_vault_optional(&self) -> AppResult<Option<PathBuf>> {
        Ok(self
            .active_vault
            .read()
            .map_err(|_| crate::error::AppError::State("Vault lock is poisoned".to_string()))?
            .clone())
    }

    pub fn set_active_vault(&self, path: PathBuf) -> AppResult<()> {
        self.clear_vault_key()?;
        *self
            .active_vault
            .write()
            .map_err(|_| crate::error::AppError::State("Vault lock is poisoned".to_string()))? =
            Some(path);
        Ok(())
    }

    pub fn set_vault_key(&self, key: VaultKey) -> AppResult<()> {
        *self.vault_key.write().map_err(|_| {
            crate::error::AppError::State("Vault key lock is poisoned".to_string())
        })? = Some(key);
        Ok(())
    }

    pub fn clear_vault_key(&self) -> AppResult<()> {
        self.vault_key
            .write()
            .map_err(|_| crate::error::AppError::State("Vault key lock is poisoned".to_string()))?
            .take();
        Ok(())
    }

    pub fn vault_key(&self) -> AppResult<Zeroizing<[u8; 32]>> {
        self.vault_key
            .read()
            .map_err(|_| crate::error::AppError::State("Vault key lock is poisoned".to_string()))?
            .as_ref()
            .map(VaultKey::copy_bytes)
            .ok_or(crate::error::AppError::Locked)
    }

    pub fn vault_is_unlocked(&self) -> AppResult<bool> {
        Ok(self
            .vault_key
            .read()
            .map_err(|_| crate::error::AppError::State("Vault key lock is poisoned".to_string()))?
            .is_some())
    }

    pub fn read_vault_access(&self) -> AppResult<RwLockReadGuard<'_, ()>> {
        self.vault_access
            .read()
            .map_err(|_| crate::error::AppError::State("Vault access lock is poisoned".to_string()))
    }

    pub fn write_vault_access(&self) -> AppResult<RwLockWriteGuard<'_, ()>> {
        self.vault_access
            .write()
            .map_err(|_| crate::error::AppError::State("Vault access lock is poisoned".to_string()))
    }

    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::SeqCst);
    }

    pub fn exit_is_allowed(&self) -> bool {
        self.allow_exit.load(Ordering::SeqCst)
    }
}

pub fn initialize(db_path: &Path) -> AppResult<()> {
    let mut connection = open(db_path)?;
    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vaults (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL,
          markdown_view_mode TEXT CHECK (markdown_view_mode IN ('rich-text', 'source')),
          restore_tabs INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS note_stats (
          vault_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          open_count INTEGER NOT NULL DEFAULT 0,
          edit_count INTEGER NOT NULL DEFAULT 0,
          save_count INTEGER NOT NULL DEFAULT 0,
          last_opened_at TEXT,
          last_edited_at TEXT,
          last_saved_at TEXT,
          is_bookmarked INTEGER NOT NULL DEFAULT 0,
          view_mode TEXT CHECK (view_mode IN ('rich-text', 'source')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (vault_id, path),
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY,
          vault_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          content TEXT NOT NULL,
          encoding TEXT NOT NULL DEFAULT 'utf8',
          line_ending TEXT NOT NULL DEFAULT 'lf',
          is_encrypted INTEGER NOT NULL DEFAULT 0,
          content_hash TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS entry_order (
          vault_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          position INTEGER NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (vault_id, path),
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tag_colors (
          vault_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          color TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (vault_id, tag),
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trash_items (
          id INTEGER PRIMARY KEY,
          vault_id INTEGER NOT NULL,
          original_path TEXT NOT NULL,
          trash_path TEXT NOT NULL UNIQUE,
          is_directory INTEGER NOT NULL,
          deleted_at TEXT NOT NULL,
          restored_at TEXT,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pending_file_operations (
          id TEXT PRIMARY KEY,
          vault_id INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('rename', 'trash', 'restore')),
          source_path TEXT NOT NULL,
          destination_path TEXT NOT NULL,
          item_id INTEGER,
          is_directory INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_cache (
          vault_id INTEGER PRIMARY KEY,
          tree_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workspace_cache_refresh (
          vault_id INTEGER PRIMARY KEY,
          generation INTEGER NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tab_sessions (
          vault_id INTEGER PRIMARY KEY,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_note_stats_recent
          ON note_stats(vault_id, last_opened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_note_stats_bookmarks
          ON note_stats(vault_id, is_bookmarked, path);
        CREATE INDEX IF NOT EXISTS idx_history_note
          ON history(vault_id, path, id DESC);
        CREATE INDEX IF NOT EXISTS idx_trash_active
          ON trash_items(vault_id, restored_at, deleted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pending_file_operations
          ON pending_file_operations(vault_id, created_at);

        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, CURRENT_TIMESTAMP);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (2, CURRENT_TIMESTAMP);
        "#,
    )?;
    let migration = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let added_encoding = !column_exists(&migration, "history", "encoding")?;
    if added_encoding {
        migration.execute(
            "ALTER TABLE history ADD COLUMN encoding TEXT NOT NULL DEFAULT 'utf8'",
            [],
        )?;
    }
    let added_line_ending = !column_exists(&migration, "history", "line_ending")?;
    if added_line_ending {
        migration.execute(
            "ALTER TABLE history ADD COLUMN line_ending TEXT NOT NULL DEFAULT 'lf'",
            [],
        )?;
    }
    let added_history_encryption = !column_exists(&migration, "history", "is_encrypted")?;
    if added_history_encryption {
        migration.execute(
            "ALTER TABLE history ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    let added_entry_pinning = !column_exists(&migration, "entry_order", "is_pinned")?;
    if added_entry_pinning {
        migration.execute(
            "ALTER TABLE entry_order ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    let added_note_view_mode = !column_exists(&migration, "note_stats", "view_mode")?;
    if added_note_view_mode {
        migration.execute(
            "ALTER TABLE note_stats ADD COLUMN view_mode TEXT CHECK (view_mode IN ('rich-text', 'source'))",
            [],
        )?;
    }
    let added_vault_view_mode = !column_exists(&migration, "vaults", "markdown_view_mode")?;
    if added_vault_view_mode {
        migration.execute(
            "ALTER TABLE vaults ADD COLUMN markdown_view_mode TEXT CHECK (markdown_view_mode IN ('rich-text', 'source'))",
            [],
        )?;
    }
    let added_restore_tabs = !column_exists(&migration, "vaults", "restore_tabs")?;
    if added_restore_tabs {
        migration.execute(
            "ALTER TABLE vaults ADD COLUMN restore_tabs INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (10, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (11, CURRENT_TIMESTAMP)",
        [],
    )?;
    migration.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (12, CURRENT_TIMESTAMP)",
        [],
    )?;
    if added_encoding || added_line_ending {
        backfill_history_format(&migration)?;
    }
    migration.commit()?;
    Ok(())
}

fn backfill_history_format(transaction: &Transaction<'_>) -> AppResult<()> {
    let mut last_id = 0;
    loop {
        let rows = {
            let mut statement = transaction.prepare(
                "SELECT id, content, encoding FROM history WHERE id > ?1 ORDER BY id LIMIT 100",
            )?;
            let mapped = statement.query_map(params![last_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            mapped.collect::<Result<Vec<_>, _>>()?
        };
        if rows.is_empty() {
            break;
        }
        for (id, content, encoding) in rows {
            last_id = id;
            let (content, encoding, line_ending) = if encoding == "base64" {
                (content, "base64", "lf")
            } else {
                match detect_line_ending(&content) {
                    Some(line_ending) => (content, "utf8", line_ending),
                    None => (STANDARD.encode(content.as_bytes()), "base64", "lf"),
                }
            };
            transaction.execute(
                "UPDATE history SET content = ?1, encoding = ?2, line_ending = ?3 WHERE id = ?4",
                params![content, encoding, line_ending, id],
            )?;
        }
        if last_id == 0 {
            break;
        }
    }
    Ok(())
}

fn detect_line_ending(content: &str) -> Option<&'static str> {
    let without_crlf = content.replace("\r\n", "");
    let has_crlf = content.contains("\r\n");
    let has_cr = without_crlf.contains('\r');
    let has_lf = without_crlf.contains('\n');
    if [has_crlf, has_cr, has_lf]
        .into_iter()
        .filter(|value| *value)
        .count()
        > 1
    {
        return None;
    }
    Some(if has_crlf {
        "crlf"
    } else if has_cr {
        "cr"
    } else {
        "lf"
    })
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn open(db_path: &Path) -> AppResult<Connection> {
    let connection = Connection::open(db_path)?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA secure_delete = ON;",
    )?;
    Ok(connection)
}

pub fn scrub_deleted_content(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(
        "PRAGMA wal_checkpoint(TRUNCATE);
         VACUUM;
         PRAGMA wal_checkpoint(TRUNCATE);",
    )?;
    Ok(())
}

pub fn now() -> String {
    Utc::now().to_rfc3339()
}

pub fn ensure_vault(connection: &Connection, path: &str, name: &str) -> AppResult<i64> {
    let timestamp = now();
    connection.execute(
        r#"
        INSERT INTO vaults(path, name, created_at, updated_at, last_opened_at)
        VALUES (?1, ?2, ?3, ?3, ?3)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at,
          last_opened_at = excluded.last_opened_at
        "#,
        params![path, name, timestamp],
    )?;
    let id = connection.query_row(
        "SELECT id FROM vaults WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn register_default_vault(
    connection: &mut Connection,
    path: &str,
    name: &str,
) -> AppResult<i64> {
    let transaction = connection.transaction()?;
    let timestamp = now();
    transaction.execute(
        r#"
        INSERT INTO vaults(path, name, created_at, updated_at, last_opened_at)
        VALUES (?1, ?2, ?3, ?3, ?3)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
        "#,
        params![path, name, timestamp],
    )?;
    transaction.execute(
        r#"
        INSERT INTO settings(key, value, updated_at)
        VALUES ('default_vault', ?1, ?2)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        "#,
        params![path, timestamp],
    )?;
    let id = transaction.query_row(
        "SELECT id FROM vaults WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    transaction.commit()?;
    Ok(id)
}

pub fn set_last_vault(connection: &Connection, path: &str) -> AppResult<()> {
    connection.execute(
        r#"
        INSERT INTO settings(key, value, updated_at)
        VALUES ('last_vault', ?1, ?2)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        "#,
        params![path, now()],
    )?;
    Ok(())
}

pub fn get_last_vault(connection: &Connection) -> AppResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'last_vault'",
            [],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn list_known_vaults(connection: &Connection) -> AppResult<Vec<KnownVaultRecord>> {
    list_known_vaults_with_limit(connection, 50)
}

pub fn list_all_known_vaults(connection: &Connection) -> AppResult<Vec<KnownVaultRecord>> {
    list_known_vaults_with_limit(connection, -1)
}

fn list_known_vaults_with_limit(
    connection: &Connection,
    limit: i64,
) -> AppResult<Vec<KnownVaultRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, name, path, last_opened_at,
                CASE WHEN path = (
                  SELECT value FROM settings WHERE key = 'default_vault'
                ) THEN 1 ELSE 0 END AS is_default
         FROM vaults
         ORDER BY is_default DESC, last_opened_at DESC, name COLLATE NOCASE
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok(KnownVaultRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            last_opened_at: row.get(3)?,
            default: row.get::<_, i64>(4)? != 0,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn known_vault_path(connection: &Connection, vault_id: i64) -> AppResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT path FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn known_vault(connection: &Connection, vault_id: i64) -> AppResult<Option<KnownVaultRecord>> {
    Ok(connection
        .query_row(
            "SELECT id, name, path, last_opened_at,
                    CASE WHEN path = (
                      SELECT value FROM settings WHERE key = 'default_vault'
                    ) THEN 1 ELSE 0 END
             FROM vaults
             WHERE id = ?1",
            params![vault_id],
            |row| {
                Ok(KnownVaultRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    last_opened_at: row.get(3)?,
                    default: row.get::<_, i64>(4)? != 0,
                })
            },
        )
        .optional()?)
}

pub fn delete_known_vault(connection: &mut Connection, vault_id: i64, path: &str) -> AppResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM vaults WHERE id = ?1", params![vault_id])?;
    transaction.execute(
        "DELETE FROM settings WHERE key = 'last_vault' AND value = ?1",
        params![path],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn is_default_vault(connection: &Connection, path: &str) -> AppResult<bool> {
    Ok(connection
        .query_row(
            "SELECT value = ?1 FROM settings WHERE key = 'default_vault'",
            params![path],
            |row| row.get::<_, bool>(0),
        )
        .optional()?
        .unwrap_or(false))
}

pub fn list_tag_colors(connection: &Connection, vault_id: i64) -> AppResult<Vec<TagColor>> {
    let mut statement =
        connection.prepare("SELECT tag, color FROM tag_colors WHERE vault_id = ?1 ORDER BY tag")?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok(TagColor {
            tag: row.get(0)?,
            color: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn workspace_tree_cache(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<Option<Vec<FileNode>>> {
    let serialized = connection
        .query_row(
            "SELECT tree_json FROM workspace_cache WHERE vault_id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    serialized
        .map(|serialized| {
            serde_json::from_str(&serialized).map_err(|error| {
                AppError::InvalidData(format!("Cached vault tree is invalid: {error}"))
            })
        })
        .transpose()
}

pub fn begin_workspace_tree_refresh(connection: &mut Connection, vault_id: i64) -> AppResult<i64> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let generation = transaction.query_row(
        r#"
        INSERT INTO workspace_cache_refresh(vault_id, generation)
        VALUES (?1, 1)
        ON CONFLICT(vault_id) DO UPDATE SET
          generation = workspace_cache_refresh.generation + 1
        RETURNING generation
        "#,
        params![vault_id],
        |row| row.get(0),
    )?;
    transaction.commit()?;
    Ok(generation)
}

pub fn set_workspace_tree_cache_if_current(
    connection: &mut Connection,
    vault_id: i64,
    generation: i64,
    tree: &[FileNode],
) -> AppResult<bool> {
    let serialized = serde_json::to_string(tree).map_err(|error| {
        AppError::State(format!("Unable to serialize the vault tree cache: {error}"))
    })?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = transaction.query_row(
        "SELECT generation FROM workspace_cache_refresh WHERE vault_id = ?1",
        params![vault_id],
        |row| row.get::<_, i64>(0),
    )?;
    if current != generation {
        transaction.commit()?;
        return Ok(false);
    }
    transaction.execute(
        r#"
        INSERT INTO workspace_cache(vault_id, tree_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(vault_id) DO UPDATE SET
          tree_json = excluded.tree_json,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, serialized, now()],
    )?;
    transaction.commit()?;
    Ok(true)
}

pub fn set_workspace_tree_cache(
    connection: &mut Connection,
    vault_id: i64,
    tree: &[FileNode],
) -> AppResult<()> {
    let serialized = serde_json::to_string(tree).map_err(|error| {
        AppError::State(format!("Unable to serialize the vault tree cache: {error}"))
    })?;
    connection.execute(
        r#"
        INSERT INTO workspace_cache(vault_id, tree_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(vault_id) DO UPDATE SET
          tree_json = excluded.tree_json,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, serialized, now()],
    )?;
    Ok(())
}

pub fn clear_workspace_tree_cache(connection: &Connection, vault_id: i64) -> AppResult<()> {
    connection.execute(
        "DELETE FROM workspace_cache WHERE vault_id = ?1",
        params![vault_id],
    )?;
    Ok(())
}

pub fn set_tag_color(
    connection: &Connection,
    vault_id: i64,
    tag: &str,
    color: &str,
) -> AppResult<()> {
    connection.execute(
        r#"
        INSERT INTO tag_colors(vault_id, tag, color, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(vault_id, tag) DO UPDATE SET
          color = excluded.color,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, tag, color, now()],
    )?;
    Ok(())
}

pub fn stats_map(connection: &Connection, vault_id: i64) -> AppResult<HashMap<String, NoteStats>> {
    let mut statement = connection.prepare(
        r#"
        SELECT path, open_count, edit_count, save_count, last_opened_at,
               last_edited_at, last_saved_at, is_bookmarked
        FROM note_stats
        WHERE vault_id = ?1
        "#,
    )?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            NoteStats {
                open_count: row.get(1)?,
                edit_count: row.get(2)?,
                save_count: row.get(3)?,
                last_opened_at: row.get(4)?,
                last_edited_at: row.get(5)?,
                last_saved_at: row.get(6)?,
                bookmarked: row.get::<_, i64>(7)? != 0,
            },
        ))
    })?;

    let mut result = HashMap::new();
    for row in rows {
        let (path, stats) = row?;
        result.insert(path, stats);
    }
    Ok(result)
}

pub fn get_stats(connection: &Connection, vault_id: i64, path: &str) -> AppResult<NoteStats> {
    Ok(connection
        .query_row(
            r#"
            SELECT open_count, edit_count, save_count, last_opened_at,
                   last_edited_at, last_saved_at, is_bookmarked
            FROM note_stats
            WHERE vault_id = ?1 AND path = ?2
            "#,
            params![vault_id, path],
            |row| {
                Ok(NoteStats {
                    open_count: row.get(0)?,
                    edit_count: row.get(1)?,
                    save_count: row.get(2)?,
                    last_opened_at: row.get(3)?,
                    last_edited_at: row.get(4)?,
                    last_saved_at: row.get(5)?,
                    bookmarked: row.get::<_, i64>(6)? != 0,
                })
            },
        )
        .optional()?
        .unwrap_or_default())
}

pub fn record_open(connection: &Connection, vault_id: i64, path: &str) -> AppResult<()> {
    let timestamp = now();
    connection.execute(
        r#"
        INSERT INTO note_stats(
          vault_id, path, open_count, last_opened_at, created_at, updated_at
        )
        VALUES (?1, ?2, 1, ?3, ?3, ?3)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          open_count = open_count + 1,
          last_opened_at = excluded.last_opened_at,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, path, timestamp],
    )?;
    Ok(())
}

pub fn record_save(transaction: &Transaction<'_>, vault_id: i64, path: &str) -> AppResult<()> {
    let timestamp = now();
    transaction.execute(
        r#"
        INSERT INTO note_stats(
          vault_id, path, save_count, last_saved_at, created_at, updated_at
        )
        VALUES (?1, ?2, 1, ?3, ?3, ?3)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          save_count = save_count + 1,
          last_saved_at = excluded.last_saved_at,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, path, timestamp],
    )?;
    Ok(())
}

pub fn record_edit(connection: &Connection, vault_id: i64, path: &str) -> AppResult<()> {
    let timestamp = now();
    connection.execute(
        r#"
        INSERT INTO note_stats(
          vault_id, path, edit_count, last_edited_at, created_at, updated_at
        )
        VALUES (?1, ?2, 1, ?3, ?3, ?3)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          edit_count = edit_count + 1,
          last_edited_at = excluded.last_edited_at,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, path, timestamp],
    )?;
    Ok(())
}

pub fn set_bookmark(
    connection: &Connection,
    vault_id: i64,
    path: &str,
    bookmarked: bool,
) -> AppResult<()> {
    let timestamp = now();
    connection.execute(
        r#"
        INSERT INTO note_stats(
          vault_id, path, is_bookmarked, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?4)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          is_bookmarked = excluded.is_bookmarked,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, path, i64::from(bookmarked), timestamp],
    )?;
    Ok(())
}

pub fn get_vault_markdown_view_mode(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<Option<MarkdownViewMode>> {
    let value = connection
        .query_row(
            "SELECT markdown_view_mode FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    value
        .map(|value| {
            MarkdownViewMode::from_str(&value).ok_or_else(|| {
                AppError::InvalidData(format!("Invalid saved Markdown view mode: {value}"))
            })
        })
        .transpose()
}

pub fn set_vault_markdown_view_mode(
    connection: &mut Connection,
    vault_id: i64,
    mode: MarkdownViewMode,
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE vaults SET markdown_view_mode = ?1, updated_at = ?2 WHERE id = ?3",
        params![mode.as_str(), now(), vault_id],
    )?;
    transaction.execute(
        "UPDATE note_stats SET view_mode = NULL WHERE vault_id = ?1",
        params![vault_id],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn get_restore_tabs(connection: &Connection, vault_id: i64) -> AppResult<bool> {
    Ok(connection.query_row(
        "SELECT restore_tabs FROM vaults WHERE id = ?1",
        params![vault_id],
        |row| row.get::<_, i64>(0).map(|value| value != 0),
    )?)
}

pub fn set_restore_tabs(connection: &Connection, vault_id: i64, enabled: bool) -> AppResult<()> {
    connection.execute(
        "UPDATE vaults SET restore_tabs = ?1, updated_at = ?2 WHERE id = ?3",
        params![i64::from(enabled), now(), vault_id],
    )?;
    Ok(())
}

pub fn get_tab_session(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<Option<TabSessionState>> {
    let serialized = connection
        .query_row(
            "SELECT state_json FROM tab_sessions WHERE vault_id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    serialized
        .map(|serialized| {
            serde_json::from_str(&serialized).map_err(|error| {
                AppError::InvalidData(format!("Saved tab session is invalid: {error}"))
            })
        })
        .transpose()
}

pub fn save_tab_session(
    connection: &mut Connection,
    vault_id: i64,
    session: &TabSessionState,
) -> AppResult<()> {
    let serialized = serde_json::to_string(session).map_err(|error| {
        AppError::State(format!("Unable to serialize the tab session: {error}"))
    })?;
    connection.execute(
        r#"
        INSERT INTO tab_sessions(vault_id, state_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(vault_id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, serialized, now()],
    )?;
    Ok(())
}

pub fn clear_tab_session(connection: &Connection, vault_id: i64) -> AppResult<()> {
    connection.execute(
        "DELETE FROM tab_sessions WHERE vault_id = ?1",
        params![vault_id],
    )?;
    Ok(())
}

pub fn note_lists(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<(Vec<NoteListItem>, Vec<NoteListItem>)> {
    let read_items = |where_clause: &str, limit: Option<i64>| -> AppResult<Vec<NoteListItem>> {
        let query = format!(
            r#"
            SELECT path, last_opened_at, is_bookmarked
            FROM note_stats
            WHERE vault_id = ?1 AND {where_clause}
            ORDER BY last_opened_at DESC, path COLLATE NOCASE
            {}
            "#,
            limit
                .map(|value| format!("LIMIT {value}"))
                .unwrap_or_default()
        );
        let mut statement = connection.prepare(&query)?;
        let rows = statement.query_map(params![vault_id], |row| {
            let path: String = row.get(0)?;
            Ok(NoteListItem {
                title: title_from_path(&path),
                path,
                last_opened_at: row.get(1)?,
                bookmarked: row.get::<_, i64>(2)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    };

    let bookmarks = read_items("is_bookmarked = 1", None)?;
    let recent = read_items("last_opened_at IS NOT NULL", Some(30))?;
    Ok((bookmarks, recent))
}

pub fn entry_placement_map(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<HashMap<String, EntryPlacement>> {
    let mut statement = connection
        .prepare("SELECT path, position, is_pinned FROM entry_order WHERE vault_id = ?1")?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            EntryPlacement {
                position: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
            },
        ))
    })?;
    let mut result = HashMap::new();
    for row in rows {
        let (path, placement) = row?;
        result.insert(path, placement);
    }
    Ok(result)
}

pub fn set_entry_order(
    connection: &mut Connection,
    vault_id: i64,
    paths: &[String],
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let timestamp = now();
    for (position, path) in paths.iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO entry_order(vault_id, path, position, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(vault_id, path) DO UPDATE SET
              position = excluded.position,
              updated_at = excluded.updated_at
            "#,
            params![vault_id, path, position as i64, timestamp],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn set_entry_pinned(
    connection: &Connection,
    vault_id: i64,
    path: &str,
    pinned: bool,
) -> AppResult<()> {
    connection.execute(
        r#"
        INSERT INTO entry_order(vault_id, path, position, is_pinned, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          is_pinned = excluded.is_pinned,
          updated_at = excluded.updated_at
        "#,
        params![vault_id, path, i64::MAX, i64::from(pinned), now()],
    )?;
    Ok(())
}

pub fn push_history(
    transaction: &Transaction<'_>,
    vault_id: i64,
    path: &str,
    content: &str,
    content_hash: &str,
    encoding: FileEncoding,
    line_ending: FileLineEnding,
    is_encrypted: bool,
    reason: &str,
) -> AppResult<()> {
    let latest_hash: Option<String> = transaction
        .query_row(
            r#"
            SELECT content_hash
            FROM history
            WHERE vault_id = ?1 AND path = ?2
            ORDER BY id DESC
            LIMIT 1
            "#,
            params![vault_id, path],
            |row| row.get(0),
        )
        .optional()?;
    if latest_hash.as_deref() == Some(content_hash) {
        return Ok(());
    }

    transaction.execute(
        r#"
        INSERT INTO history(
          vault_id, path, content, encoding, line_ending, is_encrypted,
          content_hash, reason, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            vault_id,
            path,
            content,
            encoding.as_str(),
            line_ending.as_str(),
            i64::from(is_encrypted),
            content_hash,
            reason,
            now()
        ],
    )?;
    transaction.execute(
        r#"
        DELETE FROM history
        WHERE vault_id = ?1
          AND path = ?2
          AND id NOT IN (
            SELECT id
            FROM history
            WHERE vault_id = ?1 AND path = ?2
            ORDER BY id DESC
            LIMIT ?3
          )
        "#,
        params![vault_id, path, HISTORY_LIMIT],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct StoredHistoryRevision {
    pub id: i64,
    pub created_at: String,
    pub reason: String,
    pub content: String,
    pub encoding: FileEncoding,
    pub line_ending: FileLineEnding,
    pub is_encrypted: bool,
}

pub fn list_history(
    connection: &Connection,
    vault_id: i64,
    path: &str,
) -> AppResult<Vec<StoredHistoryRevision>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, created_at, reason, content, encoding, line_ending, is_encrypted
        FROM history
        WHERE vault_id = ?1 AND path = ?2
        ORDER BY id DESC
        "#,
    )?;
    let rows = statement.query_map(params![vault_id, path], |row| {
        Ok(StoredHistoryRevision {
            id: row.get(0)?,
            created_at: row.get(1)?,
            reason: row.get(2)?,
            content: row.get(3)?,
            encoding: FileEncoding::from_str(&row.get::<_, String>(4)?),
            line_ending: FileLineEnding::from_str(&row.get::<_, String>(5)?),
            is_encrypted: row.get::<_, i64>(6)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn history_content(
    connection: &Connection,
    vault_id: i64,
    path: &str,
    revision_id: i64,
) -> AppResult<Option<StoredHistoryRevision>> {
    Ok(connection
        .query_row(
            r#"
            SELECT id, created_at, reason, content, encoding, line_ending, is_encrypted
            FROM history
            WHERE id = ?1 AND vault_id = ?2 AND path = ?3
            "#,
            params![revision_id, vault_id, path],
            |row| {
                Ok(StoredHistoryRevision {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    reason: row.get(2)?,
                    content: row.get(3)?,
                    encoding: FileEncoding::from_str(&row.get::<_, String>(4)?),
                    line_ending: FileLineEnding::from_str(&row.get::<_, String>(5)?),
                    is_encrypted: row.get::<_, i64>(6)? != 0,
                })
            },
        )
        .optional()?)
}

pub fn history_rows_after(
    connection: &Connection,
    vault_id: i64,
    last_id: i64,
    limit: i64,
) -> AppResult<Vec<StoredHistoryRevision>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, created_at, reason, content, encoding, line_ending, is_encrypted
        FROM history
        WHERE vault_id = ?1 AND id > ?2
        ORDER BY id
        LIMIT ?3
        "#,
    )?;
    let rows = statement.query_map(params![vault_id, last_id, limit], |row| {
        Ok(StoredHistoryRevision {
            id: row.get(0)?,
            created_at: row.get(1)?,
            reason: row.get(2)?,
            content: row.get(3)?,
            encoding: FileEncoding::from_str(&row.get::<_, String>(4)?),
            line_ending: FileLineEnding::from_str(&row.get::<_, String>(5)?),
            is_encrypted: row.get::<_, i64>(6)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn update_history_storage(
    connection: &Connection,
    id: i64,
    content: &str,
    is_encrypted: bool,
) -> AppResult<()> {
    connection.execute(
        "UPDATE history SET content = ?1, is_encrypted = ?2 WHERE id = ?3",
        params![content, i64::from(is_encrypted), id],
    )?;
    Ok(())
}

pub fn history_count(connection: &Connection, vault_id: i64, path: &str) -> AppResult<i64> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM history WHERE vault_id = ?1 AND path = ?2",
        params![vault_id, path],
        |row| row.get(0),
    )?)
}

pub fn trash_metadata(
    connection: &mut Connection,
    vault_id: i64,
    original_path: &str,
    trash_path: &str,
    is_directory: bool,
    operation_id: Option<&str>,
) -> AppResult<i64> {
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        INSERT INTO trash_items(
          vault_id, original_path, trash_path, is_directory, deleted_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            vault_id,
            original_path,
            trash_path,
            i64::from(is_directory),
            now()
        ],
    )?;
    rekey_content_metadata_tx(&transaction, vault_id, original_path, trash_path)?;
    finish_file_operation_tx(&transaction, operation_id)?;
    let item_id = transaction.last_insert_rowid();
    transaction.commit()?;
    Ok(item_id)
}

pub fn list_trash(connection: &Connection, vault_id: i64) -> AppResult<Vec<TrashItem>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, original_path, deleted_at, is_directory
        FROM trash_items
        WHERE vault_id = ?1 AND restored_at IS NULL
        ORDER BY deleted_at DESC
        "#,
    )?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok(TrashItem {
            id: row.get(0)?,
            original_path: row.get(1)?,
            deleted_at: row.get(2)?,
            is_directory: row.get::<_, i64>(3)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn trash_item(
    connection: &Connection,
    vault_id: i64,
    item_id: i64,
) -> AppResult<Option<TrashItem>> {
    Ok(connection
        .query_row(
            r#"
            SELECT id, original_path, deleted_at, is_directory
            FROM trash_items
            WHERE id = ?1 AND vault_id = ?2 AND restored_at IS NULL
            "#,
            params![item_id, vault_id],
            |row| {
                Ok(TrashItem {
                    id: row.get(0)?,
                    original_path: row.get(1)?,
                    deleted_at: row.get(2)?,
                    is_directory: row.get::<_, i64>(3)? != 0,
                })
            },
        )
        .optional()?)
}

pub fn trash_path(
    connection: &Connection,
    vault_id: i64,
    item_id: i64,
) -> AppResult<Option<(String, String, bool)>> {
    Ok(connection
        .query_row(
            r#"
            SELECT original_path, trash_path, is_directory
            FROM trash_items
            WHERE id = ?1 AND vault_id = ?2 AND restored_at IS NULL
            "#,
            params![item_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0)),
        )
        .optional()?)
}

pub fn restore_metadata(
    connection: &mut Connection,
    vault_id: i64,
    item_id: i64,
    trash_path: &str,
    restored_path: &str,
    operation_id: Option<&str>,
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    delete_content_metadata_tx(&transaction, vault_id, restored_path)?;
    rekey_content_metadata_tx(&transaction, vault_id, trash_path, restored_path)?;
    transaction.execute(
        r#"
        UPDATE trash_items
        SET restored_at = ?1
        WHERE id = ?2 AND vault_id = ?3
        "#,
        params![now(), item_id, vault_id],
    )?;
    finish_file_operation_tx(&transaction, operation_id)?;
    transaction.commit()?;
    Ok(())
}

pub fn purge_trash_metadata(
    connection: &mut Connection,
    vault_id: i64,
    item_id: i64,
    trash_path: &str,
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    delete_content_metadata_tx(&transaction, vault_id, trash_path)?;
    transaction.execute(
        "DELETE FROM trash_items WHERE id = ?1 AND vault_id = ?2",
        params![item_id, vault_id],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn rename_metadata(
    connection: &mut Connection,
    vault_id: i64,
    old_path: &str,
    new_path: &str,
    operation_id: Option<&str>,
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    rename_metadata_tx(&transaction, vault_id, old_path, new_path)?;
    finish_file_operation_tx(&transaction, operation_id)?;
    transaction.commit()?;
    Ok(())
}

fn rename_metadata_tx(
    transaction: &Transaction<'_>,
    vault_id: i64,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    delete_content_metadata_tx(transaction, vault_id, new_path)?;
    rekey_content_metadata_tx(transaction, vault_id, old_path, new_path)?;
    Ok(())
}

fn finish_file_operation_tx(
    transaction: &Transaction<'_>,
    operation_id: Option<&str>,
) -> AppResult<()> {
    if let Some(operation_id) = operation_id {
        transaction.execute(
            "DELETE FROM pending_file_operations WHERE id = ?1",
            params![operation_id],
        )?;
    }
    Ok(())
}

#[derive(Debug)]
pub struct PendingFileOperation {
    pub id: String,
    pub kind: String,
    pub source_path: String,
    pub destination_path: String,
    pub item_id: Option<i64>,
    pub is_directory: bool,
}

pub fn begin_file_operation(
    connection: &Connection,
    vault_id: i64,
    kind: &str,
    source_path: &str,
    destination_path: &str,
    item_id: Option<i64>,
    is_directory: bool,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    connection.execute(
        r#"
        INSERT INTO pending_file_operations(
          id, vault_id, kind, source_path, destination_path, item_id,
          is_directory, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            id,
            vault_id,
            kind,
            source_path,
            destination_path,
            item_id,
            i64::from(is_directory),
            now()
        ],
    )?;
    Ok(id)
}

pub fn cancel_file_operation(connection: &Connection, operation_id: &str) -> AppResult<()> {
    connection.execute(
        "DELETE FROM pending_file_operations WHERE id = ?1",
        params![operation_id],
    )?;
    Ok(())
}

pub fn pending_file_operations(
    connection: &Connection,
    vault_id: i64,
) -> AppResult<Vec<PendingFileOperation>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, kind, source_path, destination_path, item_id, is_directory
        FROM pending_file_operations
        WHERE vault_id = ?1
        ORDER BY created_at, id
        "#,
    )?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok(PendingFileOperation {
            id: row.get(0)?,
            kind: row.get(1)?,
            source_path: row.get(2)?,
            destination_path: row.get(3)?,
            item_id: row.get(4)?,
            is_directory: row.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn rekey_content_metadata_tx(
    transaction: &Transaction<'_>,
    vault_id: i64,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    for table in ["note_stats", "history", "entry_order"] {
        let query = format!(
            r#"
            UPDATE {table}
            SET path = ?1 || substr(path, length(?2) + 1)
            WHERE vault_id = ?3
              AND (
                path = ?2
                OR substr(path, 1, length(?2) + 1) = ?2 || '/'
              )
            "#
        );
        transaction.execute(&query, params![new_path, old_path, vault_id])?;
    }
    Ok(())
}

fn delete_content_metadata_tx(
    transaction: &Transaction<'_>,
    vault_id: i64,
    path: &str,
) -> AppResult<()> {
    for table in ["note_stats", "history", "entry_order"] {
        let query = format!(
            r#"
            DELETE FROM {table}
            WHERE vault_id = ?1
              AND (
                path = ?2
                OR substr(path, 1, length(?2) + 1) = ?2 || '/'
              )
            "#
        );
        transaction.execute(&query, params![vault_id, path])?;
    }
    Ok(())
}

fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn history_keeps_only_ten_distinct_revisions() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("test.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let vault_id = ensure_vault(&connection, "/tmp/vault", "vault").expect("vault");

        for revision in 0..12 {
            let content = format!("revision {revision}");
            let hash = hex::encode(Sha256::digest(content.as_bytes()));
            let transaction = connection.transaction().expect("transaction");
            push_history(
                &transaction,
                vault_id,
                "note.md",
                &content,
                &hash,
                FileEncoding::Utf8,
                FileLineEnding::Lf,
                false,
                "autosave",
            )
            .expect("history");
            transaction.commit().expect("commit");
        }

        assert_eq!(
            history_count(&connection, vault_id, "note.md").expect("count"),
            HISTORY_LIMIT
        );
    }

    #[test]
    fn duplicate_history_content_is_not_added_twice() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("test.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let vault_id = ensure_vault(&connection, "/tmp/vault", "vault").expect("vault");

        for _ in 0..2 {
            let hash = hex::encode(Sha256::digest(b"same"));
            let transaction = connection.transaction().expect("transaction");
            push_history(
                &transaction,
                vault_id,
                "note.md",
                "same",
                &hash,
                FileEncoding::Utf8,
                FileLineEnding::Lf,
                false,
                "autosave",
            )
            .expect("history");
            transaction.commit().expect("commit");
        }

        assert_eq!(
            history_count(&connection, vault_id, "note.md").expect("count"),
            1
        );
    }

    #[test]
    fn lists_known_vaults_by_recent_use_and_resolves_ids() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("vaults.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let work_id = ensure_vault(&connection, "/vaults/work", "work").expect("work vault");
        let music_id = ensure_vault(&connection, "/vaults/music", "music").expect("music vault");
        connection
            .execute(
                "UPDATE vaults SET last_opened_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
                params![work_id],
            )
            .expect("work timestamp");
        connection
            .execute(
                "UPDATE vaults SET last_opened_at = '2026-01-02T00:00:00Z' WHERE id = ?1",
                params![music_id],
            )
            .expect("music timestamp");

        let vaults = list_known_vaults(&connection).expect("known vaults");

        assert_eq!(vaults[0].id, music_id);
        assert_eq!(vaults[1].id, work_id);
        assert_eq!(
            known_vault_path(&connection, work_id).expect("known path"),
            Some("/vaults/work".to_string())
        );
        assert_eq!(
            known_vault_path(&connection, i64::MAX).expect("missing path"),
            None
        );
        set_last_vault(&connection, "/vaults/work").expect("last vault");
        delete_known_vault(&mut connection, work_id, "/vaults/work").expect("delete known vault");
        assert_eq!(
            known_vault_path(&connection, work_id).expect("deleted path"),
            None
        );
        assert_eq!(
            get_last_vault(&connection).expect("last vault removed"),
            None
        );
    }

    #[test]
    fn global_search_can_read_all_known_vault_rows() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("all-vaults.sqlite3");
        initialize(&db_path).expect("database initialized");
        let connection = open(&db_path).expect("database opened");
        for index in 0..51 {
            ensure_vault(
                &connection,
                &format!("/vaults/{index}"),
                &format!("vault-{index}"),
            )
            .expect("known vault");
        }

        assert_eq!(
            list_known_vaults(&connection).expect("recent vaults").len(),
            50
        );
        assert_eq!(
            list_all_known_vaults(&connection)
                .expect("all known vaults")
                .len(),
            51
        );
    }

    #[test]
    fn stale_workspace_scans_cannot_replace_a_newer_cache() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("cache-generation.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let vault_id = ensure_vault(&connection, "/vaults/work", "work").expect("vault");
        let older = begin_workspace_tree_refresh(&mut connection, vault_id).expect("older scan");
        let newer = begin_workspace_tree_refresh(&mut connection, vault_id).expect("newer scan");
        let older_tree = vec![FileNode {
            path: "old.md".to_string(),
            name: "old.md".to_string(),
            kind: crate::models::FileKind::Markdown,
            children: Vec::new(),
            size: 0,
            modified_at: None,
            bookmarked: false,
            pinned: false,
            position: None,
        }];
        let newer_tree = vec![FileNode {
            path: "new.md".to_string(),
            name: "new.md".to_string(),
            kind: crate::models::FileKind::Markdown,
            children: Vec::new(),
            size: 0,
            modified_at: None,
            bookmarked: false,
            pinned: false,
            position: None,
        }];

        assert!(
            !set_workspace_tree_cache_if_current(&mut connection, vault_id, older, &older_tree,)
                .expect("stale cache write")
        );
        assert!(
            set_workspace_tree_cache_if_current(&mut connection, vault_id, newer, &newer_tree,)
                .expect("current cache write")
        );
        assert_eq!(
            workspace_tree_cache(&connection, vault_id)
                .expect("cached tree")
                .expect("cache exists")[0]
                .name,
            "new.md"
        );
    }

    #[test]
    fn stores_tab_restore_preferences_and_grouped_sessions_per_vault() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("tab-session.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let vault_id = ensure_vault(&connection, "/vaults/work", "work").expect("vault");
        let session = crate::models::TabSessionState {
            tabs: vec![
                crate::models::TabSessionTab {
                    path: "one.md".to_string(),
                    group_id: Some("work".to_string()),
                },
                crate::models::TabSessionTab {
                    path: "two.md".to_string(),
                    group_id: Some("work".to_string()),
                },
            ],
            groups: vec![crate::models::TabGroup {
                id: "work".to_string(),
                name: "Work".to_string(),
                collapsed: true,
            }],
            active_path: Some("two.md".to_string()),
        };

        save_tab_session(&mut connection, vault_id, &session).expect("save tab session");
        set_restore_tabs(&connection, vault_id, false).expect("disable restore");

        assert!(!get_restore_tabs(&connection, vault_id).expect("restore preference"));
        assert_eq!(
            get_tab_session(&connection, vault_id).expect("tab session"),
            Some(session)
        );
    }

    #[test]
    fn stores_tag_colors_per_vault() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("tag-colors.sqlite3");
        initialize(&db_path).expect("database initialized");
        let connection = open(&db_path).expect("database opened");
        let work_id = ensure_vault(&connection, "/vaults/work", "work").expect("work vault");
        let music_id = ensure_vault(&connection, "/vaults/music", "music").expect("music vault");

        set_tag_color(&connection, work_id, "guide", "#7aa66a").expect("work tag color");
        set_tag_color(&connection, music_id, "guide", "#336699").expect("music tag color");
        set_tag_color(&connection, work_id, "guide", "#8bb77a").expect("updated work color");

        assert_eq!(
            list_tag_colors(&connection, work_id).expect("work tag colors"),
            vec![crate::models::TagColor {
                tag: "guide".to_string(),
                color: "#8bb77a".to_string(),
            }]
        );
        assert_eq!(
            list_tag_colors(&connection, music_id).expect("music tag colors"),
            vec![crate::models::TagColor {
                tag: "guide".to_string(),
                color: "#336699".to_string(),
            }]
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("tag color migration"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 8",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("note view mode migration"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 9",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("workspace cache migration"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 10",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("workspace refresh generation migration"),
            1
        );
    }

    #[test]
    fn registers_the_default_vault_without_refreshing_its_recent_timestamp() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("default-vault.sqlite3");
        initialize(&db_path).expect("database initialized");
        let mut connection = open(&db_path).expect("database opened");
        let vault_id =
            register_default_vault(&mut connection, "/vaults/denote-welcome", "Denote Welcome")
                .expect("register default vault");
        connection
            .execute(
                "UPDATE vaults SET last_opened_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
                params![vault_id],
            )
            .expect("set timestamp");

        register_default_vault(&mut connection, "/vaults/denote-welcome", "Denote Welcome")
            .expect("register existing default vault");
        let vaults = list_known_vaults(&connection).expect("known vaults");

        assert_eq!(vaults[0].id, vault_id);
        assert!(vaults[0].default);
        assert_eq!(vaults[0].last_opened_at, "2026-01-01T00:00:00Z");
        assert!(
            is_default_vault(&connection, "/vaults/denote-welcome").expect("default vault status")
        );
    }

    #[test]
    fn migrates_existing_entry_order_rows_with_pinning_disabled() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("legacy-order.sqlite3");
        let connection = Connection::open(&db_path).expect("legacy database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE entry_order (
                  vault_id INTEGER NOT NULL,
                  path TEXT NOT NULL,
                  position INTEGER NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (vault_id, path)
                );
                INSERT INTO entry_order(vault_id, path, position, updated_at)
                VALUES (1, 'folder/note.md', 3, 'now');
                "#,
            )
            .expect("legacy entry order");
        drop(connection);

        initialize(&db_path).expect("database migrated");
        let connection = open(&db_path).expect("database opened");
        let placements = entry_placement_map(&connection, 1).expect("entry placements");
        let placement = placements.get("folder/note.md").expect("legacy placement");
        assert_eq!(placement.position, 3);
        assert!(!placement.pinned);

        set_entry_pinned(&connection, 1, "folder/note.md", true).expect("pin entry");
        assert!(
            entry_placement_map(&connection, 1).expect("pinned placements")["folder/note.md"]
                .pinned
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("migration version"),
            1
        );
    }

    #[test]
    fn adds_vault_view_mode_without_guessing_from_note_activity() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("legacy-view-mode.sqlite3");
        let connection = Connection::open(&db_path).expect("legacy database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE vaults (
                  id INTEGER PRIMARY KEY,
                  path TEXT NOT NULL UNIQUE,
                  name TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_opened_at TEXT NOT NULL
                );
                CREATE TABLE note_stats (
                  vault_id INTEGER NOT NULL,
                  path TEXT NOT NULL,
                  open_count INTEGER NOT NULL DEFAULT 0,
                  edit_count INTEGER NOT NULL DEFAULT 0,
                  save_count INTEGER NOT NULL DEFAULT 0,
                  last_opened_at TEXT,
                  last_edited_at TEXT,
                  last_saved_at TEXT,
                  is_bookmarked INTEGER NOT NULL DEFAULT 0,
                  view_mode TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (vault_id, path)
                );
                INSERT INTO vaults(
                  id, path, name, created_at, updated_at, last_opened_at
                ) VALUES (1, '/vaults/work', 'work', 'now', 'now', 'now');
                INSERT INTO note_stats(
                  vault_id, path, view_mode, created_at, updated_at
                ) VALUES
                  (1, 'first.md', 'rich-text', 'now', '2026-01-01T00:00:00Z'),
                  (1, 'second.md', 'source', 'now', '2026-01-02T00:00:00Z');
                "#,
            )
            .expect("legacy view modes");
        drop(connection);

        initialize(&db_path).expect("database migrated");
        let mut connection = open(&db_path).expect("database opened");

        assert_eq!(
            get_vault_markdown_view_mode(&connection, 1).expect("vault view mode"),
            None
        );
        set_vault_markdown_view_mode(&mut connection, 1, MarkdownViewMode::Source)
            .expect("initialize vault view mode");
        assert_eq!(
            get_vault_markdown_view_mode(&connection, 1).expect("saved vault view mode"),
            Some(MarkdownViewMode::Source)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM note_stats WHERE view_mode IS NOT NULL",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("legacy view modes cleared after initialization"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 11",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("vault view mode migration"),
            1
        );
    }

    #[test]
    fn migrates_existing_history_rows_to_utf8_encoding() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("legacy.sqlite3");
        let connection = Connection::open(&db_path).expect("legacy database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE history (
                  id INTEGER PRIMARY KEY,
                  vault_id INTEGER NOT NULL,
                  path TEXT NOT NULL,
                  content TEXT NOT NULL,
                  content_hash TEXT NOT NULL,
                  reason TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                INSERT INTO history(
                  vault_id, path, content, content_hash, reason, created_at
                ) VALUES (1, 'note.md', 'legacy', 'hash', 'autosave', 'now');
                INSERT INTO history(
                  vault_id, path, content, content_hash, reason, created_at
                ) VALUES (1, 'crlf.txt', 'placeholder', 'crlf-hash', 'autosave', 'now');
                INSERT INTO history(
                  vault_id, path, content, content_hash, reason, created_at
                ) VALUES (1, 'mixed.txt', 'placeholder', 'mixed-hash', 'autosave', 'now');
                "#,
            )
            .expect("legacy schema");
        connection
            .execute(
                "UPDATE history SET content = ?1 WHERE path = 'crlf.txt'",
                params!["one\r\ntwo\r\n"],
            )
            .expect("set CRLF fixture");
        connection
            .execute(
                "UPDATE history SET content = ?1 WHERE path = 'mixed.txt'",
                params!["one\r\ntwo\nthree\r"],
            )
            .expect("set mixed fixture");
        drop(connection);

        initialize(&db_path).expect("migrate database");
        let connection = open(&db_path).expect("open migrated database");
        let encoding: String = connection
            .query_row("SELECT encoding FROM history WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("encoding");
        assert_eq!(encoding, "utf8");
        let line_ending: String = connection
            .query_row("SELECT line_ending FROM history WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("line ending");
        assert_eq!(line_ending, "lf");
        let crlf: (String, String) = connection
            .query_row(
                "SELECT encoding, line_ending FROM history WHERE path = 'crlf.txt'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("CRLF metadata");
        assert_eq!(crlf, ("utf8".to_string(), "crlf".to_string()));
        let mixed: (String, String, String) = connection
            .query_row(
                "SELECT content, encoding, line_ending FROM history WHERE path = 'mixed.txt'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("mixed metadata");
        assert_eq!(mixed.1, "base64");
        assert_eq!(mixed.2, "lf");
        assert_eq!(
            STANDARD.decode(mixed.0).expect("decode mixed history"),
            b"one\r\ntwo\nthree\r"
        );
    }
}
