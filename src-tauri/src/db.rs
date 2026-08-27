use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

use crate::{
    error::AppResult,
    models::{HistoryRevision, NoteListItem, NoteStats, TrashItem},
};

pub const HISTORY_LIMIT: i64 = 10;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }
}

pub fn initialize(db_path: &Path) -> AppResult<()> {
    let connection = open(db_path)?;
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
          last_opened_at TEXT NOT NULL
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
          content_hash TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS entry_order (
          vault_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          position INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (vault_id, path),
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

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_note_stats_recent
          ON note_stats(vault_id, last_opened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_note_stats_bookmarks
          ON note_stats(vault_id, is_bookmarked, path);
        CREATE INDEX IF NOT EXISTS idx_history_note
          ON history(vault_id, path, id DESC);
        CREATE INDEX IF NOT EXISTS idx_trash_active
          ON trash_items(vault_id, restored_at, deleted_at DESC);

        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, CURRENT_TIMESTAMP);
        "#,
    )?;
    Ok(())
}

pub fn open(db_path: &Path) -> AppResult<Connection> {
    let connection = Connection::open(db_path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    Ok(connection)
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
          vault_id, path, edit_count, save_count, last_edited_at, last_saved_at,
          created_at, updated_at
        )
        VALUES (?1, ?2, 1, 1, ?3, ?3, ?3, ?3)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          edit_count = edit_count + 1,
          save_count = save_count + 1,
          last_edited_at = excluded.last_edited_at,
          last_saved_at = excluded.last_saved_at,
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

pub fn order_map(connection: &Connection, vault_id: i64) -> AppResult<HashMap<String, i64>> {
    let mut statement =
        connection.prepare("SELECT path, position FROM entry_order WHERE vault_id = ?1")?;
    let rows = statement.query_map(params![vault_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut result = HashMap::new();
    for row in rows {
        let (path, position) = row?;
        result.insert(path, position);
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

pub fn push_history(
    transaction: &Transaction<'_>,
    vault_id: i64,
    path: &str,
    content: &str,
    reason: &str,
) -> AppResult<()> {
    let hash = hex::encode(Sha256::digest(content.as_bytes()));
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
    if latest_hash.as_deref() == Some(hash.as_str()) {
        return Ok(());
    }

    transaction.execute(
        r#"
        INSERT INTO history(vault_id, path, content, content_hash, reason, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![vault_id, path, content, hash, reason, now()],
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

pub fn list_history(
    connection: &Connection,
    vault_id: i64,
    path: &str,
) -> AppResult<Vec<HistoryRevision>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, created_at, reason, content
        FROM history
        WHERE vault_id = ?1 AND path = ?2
        ORDER BY id DESC
        "#,
    )?;
    let rows = statement.query_map(params![vault_id, path], |row| {
        let content: String = row.get(3)?;
        Ok(HistoryRevision {
            id: row.get(0)?,
            created_at: row.get(1)?,
            reason: row.get(2)?,
            preview: preview(&content),
            byte_count: content.len(),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn history_content(
    connection: &Connection,
    vault_id: i64,
    path: &str,
    revision_id: i64,
) -> AppResult<Option<String>> {
    Ok(connection
        .query_row(
            r#"
            SELECT content
            FROM history
            WHERE id = ?1 AND vault_id = ?2 AND path = ?3
            "#,
            params![revision_id, vault_id, path],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn history_count(connection: &Connection, vault_id: i64, path: &str) -> AppResult<i64> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM history WHERE vault_id = ?1 AND path = ?2",
        params![vault_id, path],
        |row| row.get(0),
    )?)
}

pub fn record_trash(
    connection: &Connection,
    vault_id: i64,
    original_path: &str,
    trash_path: &str,
    is_directory: bool,
) -> AppResult<()> {
    connection.execute(
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
    Ok(())
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

pub fn mark_restored(connection: &Connection, vault_id: i64, item_id: i64) -> AppResult<()> {
    connection.execute(
        r#"
        UPDATE trash_items
        SET restored_at = ?1
        WHERE id = ?2 AND vault_id = ?3
        "#,
        params![now(), item_id, vault_id],
    )?;
    Ok(())
}

pub fn rename_metadata(
    connection: &mut Connection,
    vault_id: i64,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    for table in ["note_stats", "history", "entry_order"] {
        let query = format!(
            r#"
            UPDATE {table}
            SET path = ?1 || substr(path, length(?2) + 1)
            WHERE vault_id = ?3
              AND (path = ?2 OR path LIKE ?2 || '/%')
            "#
        );
        transaction.execute(&query, params![new_path, old_path, vault_id])?;
    }
    transaction.execute(
        r#"
        UPDATE trash_items
        SET original_path = ?1 || substr(original_path, length(?2) + 1)
        WHERE vault_id = ?3
          AND (original_path = ?2 OR original_path LIKE ?2 || '/%')
        "#,
        params![new_path, old_path, vault_id],
    )?;
    transaction.commit()?;
    Ok(())
}

fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn preview(content: &str) -> String {
    let compact = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    compact.chars().take(180).collect()
}

#[cfg(test)]
mod tests {
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
            let transaction = connection.transaction().expect("transaction");
            push_history(
                &transaction,
                vault_id,
                "note.md",
                &format!("revision {revision}"),
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
            let transaction = connection.transaction().expect("transaction");
            push_history(&transaction, vault_id, "note.md", "same", "autosave").expect("history");
            transaction.commit().expect("commit");
        }

        assert_eq!(
            history_count(&connection, vault_id, "note.md").expect("count"),
            1
        );
    }
}
