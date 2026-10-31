use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use tauri::AppHandle;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::credentials::{Secret, validate_export_destination, write_external};
use crate::{
    dialogs,
    error::{AppError, AppResult},
    models::NoteDocument,
    vault,
};

#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioFile {
    base64: String,
    mime: String,
}

#[tauri::command]
pub(crate) async fn save_voice_note(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    note_path: String,
    expected_hash: String,
    from: usize,
    to: usize,
    wav: Secret,
) -> AppResult<NoteDocument> {
    if wav.len() > super::speech_engine::MAX_WAV_BYTES.div_ceil(3) * 4 {
        return Err(AppError::InvalidData(
            "Voice notes must fit within 10 minutes.".into(),
        ));
    }
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "speech",
        move |state, root, key| {
            let bytes = Zeroizing::new(
                STANDARD
                    .decode(wav.as_bytes())
                    .map_err(|_| AppError::InvalidData("Invalid voice-note audio.".into()))?,
            );
            super::speech_helper::validate_pcm_wav(&bytes)?;
            vault::speech::attach(
                &state.db_path,
                &root.to_string_lossy(),
                &note_path,
                &expected_hash,
                from,
                to,
                &bytes,
                key,
            )
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn read_speech_audio(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    note_path: String,
    href: String,
) -> AppResult<AudioFile> {
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "speech",
        move |_, root, key| {
            let bytes = vault::speech::read_audio(&root.to_string_lossy(), &note_path, &href, key)?;
            Ok(AudioFile {
                base64: STANDARD.encode(&bytes),
                mime: mime_guess::from_path(&href)
                    .first_or_octet_stream()
                    .to_string(),
            })
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn keep_unfinished_speech_audio(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    confirmed: bool,
) -> AppResult<()> {
    if !confirmed {
        return Err(AppError::InvalidData(
            "Confirm keeping unfinished files before clearing audio recovery metadata.".into(),
        ));
    }
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "speech",
        move |state, root, _| {
            vault::speech::keep_unfinished(&state.db_path, &root.to_string_lossy())
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn export_speech_audio(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    note_path: String,
    href: String,
    confirmed: bool,
) -> AppResult<bool> {
    if !confirmed {
        return Err(AppError::InvalidData(
            "Confirm exporting decrypted audio outside the vault.".into(),
        ));
    }
    let note = note_path.clone();
    let link = href.clone();
    let expected_hash = super::scoped(
        app.clone(),
        plugin_id.clone(),
        workspace_scope.clone(),
        "speech",
        move |_, root, key| {
            let bytes = vault::speech::read_audio(&root.to_string_lossy(), &note, &link, key)?;
            use sha2::{Digest, Sha256};
            Ok(hex::encode(Sha256::digest(&bytes)))
        },
    )
    .await?;
    let extension = std::path::Path::new(&href)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (name, extension) = match extension.as_str() {
        "wav" => ("voice-note.wav", "wav"),
        "mp3" => ("voice-note.mp3", "mp3"),
        "m4a" => ("voice-note.m4a", "m4a"),
        "aac" => ("voice-note.aac", "aac"),
        "ogg" => ("voice-note.ogg", "ogg"),
        "opus" => ("voice-note.opus", "opus"),
        "flac" => ("voice-note.flac", "flac"),
        "webm" => ("voice-note.webm", "webm"),
        _ => {
            return Err(AppError::InvalidData(
                "Unsupported local audio format.".into(),
            ));
        }
    };
    let Some(destination) =
        dialogs::save(&app, "Export unencrypted audio", name, extension).await?
    else {
        return Ok(false);
    };
    let handle = app.clone();
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "speech",
        move |_, root, key| {
            let bytes = vault::speech::read_audio(&root.to_string_lossy(), &note_path, &href, key)?;
            use sha2::{Digest, Sha256};
            if hex::encode(Sha256::digest(&bytes)) != expected_hash {
                return Err(AppError::InvalidData(
                    "The audio changed while choosing its destination. Nothing was exported."
                        .into(),
                ));
            }
            validate_export_destination(&handle, &destination)?;
            write_external(&destination, &bytes)?;
            Ok(true)
        },
    )
    .await
}
