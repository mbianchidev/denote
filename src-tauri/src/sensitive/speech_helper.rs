use std::{
    ffi::{CStr, CString, c_char, c_void},
    io::{Read, Write},
    mem::size_of,
    path::{Path, PathBuf},
    ptr,
};

use libloading::Library;
use zeroize::Zeroizing;

use super::speech_engine::{LOCALES, MAX_WAV_BYTES, Transcript, Word, verified_library};
use crate::error::{AppError, AppResult};

fn failed() -> AppError {
    AppError::Plugin(
        "The local Nemotron engine could not transcribe this audio. No text was inserted.".into(),
    )
}

fn failed_at(stage: &'static str) -> AppError {
    AppError::Plugin(format!(
        "Local Nemotron {stage} failed. No text was inserted."
    ))
}

pub(super) fn validate_pcm_wav(wav: &[u8]) -> AppResult<()> {
    if wav.len() < 46
        || wav.len() > MAX_WAV_BYTES
        || &wav[..4] != b"RIFF"
        || &wav[8..16] != b"WAVEfmt "
        || &wav[36..40] != b"data"
        || u32::from_le_bytes(wav[4..8].try_into().map_err(|_| failed())?) as usize != wav.len() - 8
        || u32::from_le_bytes(wav[16..20].try_into().map_err(|_| failed())?) != 16
        || u16::from_le_bytes(wav[20..22].try_into().map_err(|_| failed())?) != 1
        || u16::from_le_bytes(wav[22..24].try_into().map_err(|_| failed())?) != 1
        || u32::from_le_bytes(wav[24..28].try_into().map_err(|_| failed())?) != 16000
        || u32::from_le_bytes(wav[28..32].try_into().map_err(|_| failed())?) != 32000
        || u16::from_le_bytes(wav[32..34].try_into().map_err(|_| failed())?) != 2
        || u16::from_le_bytes(wav[34..36].try_into().map_err(|_| failed())?) != 16
        || u32::from_le_bytes(wav[40..44].try_into().map_err(|_| failed())?) as usize
            != wav.len() - 44
        || !(wav.len() - 44).is_multiple_of(2)
    {
        return Err(AppError::Plugin(
            "Transcription requires normalized mono PCM16 audio at 16 kHz, up to 10 minutes."
                .into(),
        ));
    }
    Ok(())
}

pub(super) fn pcm_samples(wav: &[u8]) -> AppResult<Zeroizing<Vec<f32>>> {
    validate_pcm_wav(wav)?;
    Ok(Zeroizing::new(
        wav[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0)
            .collect(),
    ))
}

// NVIDIA's pinned v0.2.0 stable C ABI: docs/phase-6-security.md links its header.
#[repr(C)]
struct Backend {
    size: usize,
    gpu: i32,
}
#[repr(C)]
struct Model {
    size: usize,
    path: *const c_char,
    name: *const c_char,
}
#[repr(C)]
struct RecognizerConfig {
    size: usize,
    backend: *const Backend,
    model: *const Model,
    remaining: [*const c_void; 7],
}
#[repr(C)]
struct Options {
    size: usize,
    request_id: *const c_char,
    language: *const c_char,
    interim: bool,
    word_offsets: bool,
    punctuation: bool,
    verbatim: bool,
    profanity: bool,
    stop_history_ms: i32,
    speech_contexts: *const c_void,
    speech_context_count: usize,
    max_alternatives: i32,
    diarization: bool,
    max_speakers: i32,
}

type Destroy = unsafe extern "C" fn(*mut c_void);
struct Handle {
    pointer: *mut c_void,
    destroy: Destroy,
}
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // The verified library and destroy symbol outlive every owned handle.
            unsafe {
                (self.destroy)(self.pointer);
            }
        }
    }
}

fn infer(root: &Path, samples: &[f32], locale: &str) -> AppResult<Transcript> {
    let path = verified_library(root, true)?;
    let model_path = root.join("nemotron-3.5-asr-streaming-0.6b.q8_0.gguf");
    let model_path = CString::new(model_path.to_str().ok_or_else(failed)?).map_err(|_| failed())?;
    let locale = CString::new(locale).map_err(|_| failed())?;
    // Only the pinned, fully reverified archive may supply code to this helper.
    unsafe {
        #[cfg(not(windows))]
        let library = Library::new(&path).map_err(|_| failed_at("library loading"))?;
        #[cfg(windows)]
        let library: Library = libloading::os::windows::Library::load_with_flags(&path, 0x00001100)
            .map_err(|_| failed_at("library loading"))?
            .into();
        let create = library
            .get::<unsafe extern "C" fn(*const RecognizerConfig, *mut *mut c_void) -> i32>(
                b"nemo_speech_asr_create\0",
            )
            .map_err(|_| failed())?;
        let destroy = *library
            .get::<Destroy>(b"nemo_speech_asr_destroy\0")
            .map_err(|_| failed())?;
        let destroy_result = *library
            .get::<Destroy>(b"nemo_speech_asr_result_destroy\0")
            .map_err(|_| failed())?;
        let defaults = library
            .get::<unsafe extern "C" fn() -> Options>(
                b"nemo_speech_asr_recognition_options_default\0",
            )
            .map_err(|_| failed())?;
        let recognize = library
            .get::<unsafe extern "C" fn(
                *mut c_void,
                *const Options,
                *const f32,
                usize,
                i32,
                *mut *mut c_void,
            ) -> i32>(b"nemo_speech_asr_recognize_f32\0")
            .map_err(|_| failed())?;
        let alternatives = library
            .get::<unsafe extern "C" fn(*const c_void) -> usize>(
                b"nemo_speech_asr_result_alternative_count\0",
            )
            .map_err(|_| failed())?;
        let transcript = library
            .get::<unsafe extern "C" fn(*const c_void, usize) -> *const c_char>(
                b"nemo_speech_asr_result_transcript\0",
            )
            .map_err(|_| failed())?;
        let word_count = library
            .get::<unsafe extern "C" fn(*const c_void, usize) -> usize>(
                b"nemo_speech_asr_result_word_count\0",
            )
            .map_err(|_| failed())?;
        let word_text = library
            .get::<unsafe extern "C" fn(*const c_void, usize, usize) -> *const c_char>(
                b"nemo_speech_asr_result_word_text\0",
            )
            .map_err(|_| failed())?;
        let word_start = library
            .get::<unsafe extern "C" fn(*const c_void, usize, usize) -> i32>(
                b"nemo_speech_asr_result_word_start_time\0",
            )
            .map_err(|_| failed())?;
        let word_end = library
            .get::<unsafe extern "C" fn(*const c_void, usize, usize) -> i32>(
                b"nemo_speech_asr_result_word_end_time\0",
            )
            .map_err(|_| failed())?;
        let backend = Backend {
            size: size_of::<Backend>(),
            gpu: -1,
        };
        let model = Model {
            size: size_of::<Model>(),
            path: model_path.as_ptr(),
            name: ptr::null(),
        };
        let config = RecognizerConfig {
            size: size_of::<RecognizerConfig>(),
            backend: &backend,
            model: &model,
            remaining: [ptr::null(); 7],
        };
        let mut recognizer = Handle {
            pointer: ptr::null_mut(),
            destroy,
        };
        let status = create(&config, &mut recognizer.pointer);
        if status != 0 || recognizer.pointer.is_null() {
            return Err(AppError::Plugin(format!(
                "Local Nemotron model initialization failed with native status {status}. No text was inserted."
            )));
        }
        let mut options = defaults();
        if options.size != size_of::<Options>() {
            return Err(failed_at("recognition ABI validation"));
        }
        options.language = locale.as_ptr();
        options.word_offsets = true;
        options.diarization = false;
        let mut result = Handle {
            pointer: ptr::null_mut(),
            destroy: destroy_result,
        };
        let status = recognize(
            recognizer.pointer,
            &options,
            samples.as_ptr(),
            samples.len(),
            16000,
            &mut result.pointer,
        );
        if status != 0 || result.pointer.is_null() || alternatives(result.pointer) == 0 {
            return Err(AppError::Plugin(format!(
                "Local Nemotron recognition failed with native status {status}. No text was inserted."
            )));
        }
        let text = bounded_string(transcript(result.pointer, 0), 1024 * 1024)?;
        let count = word_count(result.pointer, 0);
        if count > 20000 {
            return Err(failed());
        }
        let mut words = Vec::with_capacity(count);
        for index in 0..count {
            let start = word_start(result.pointer, 0, index);
            let end = word_end(result.pointer, 0, index);
            if start < 0 || end < start || end > 600000 {
                return Err(failed());
            }
            words.push(Word {
                text: bounded_string(word_text(result.pointer, 0, index), 1024)?,
                start_ms: start as u32,
                end_ms: end as u32,
            });
        }
        Ok(Transcript { text, words })
    }
}

unsafe fn bounded_string(pointer: *const c_char, limit: usize) -> AppResult<String> {
    if pointer.is_null() {
        return Err(failed());
    }
    // The pinned ABI owns this NUL-terminated string until its result is destroyed.
    let value = unsafe { CStr::from_ptr(pointer) };
    if value.to_bytes().len() > limit {
        return Err(failed());
    }
    value.to_str().map(str::to_owned).map_err(|_| failed())
}

pub fn run_if_requested() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--denote-speech-worker")) {
        return None;
    }
    let result = (|| {
        #[cfg(unix)]
        {
            let limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            // This changes only the disposable helper process, never the desktop host.
            if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
                return Err(failed());
            }
        }
        let root = PathBuf::from(args.next().ok_or_else(failed)?);
        let locale = args
            .next()
            .and_then(|value| value.into_string().ok())
            .ok_or_else(failed)?;
        if args.next().is_some() || !root.is_absolute() || !LOCALES.contains(&locale.as_str()) {
            return Err(failed());
        }
        let mut input = Zeroizing::new(Vec::new());
        std::io::stdin()
            .take(MAX_WAV_BYTES as u64 + 1)
            .read_to_end(&mut input)
            .map_err(|_| failed())?;
        let samples = pcm_samples(&input)?;
        let transcript = infer(&root, &samples, &locale)?;
        let output = Zeroizing::new(serde_json::to_vec(&transcript).map_err(|_| failed())?);
        std::io::stdout().write_all(&output).map_err(|_| failed())?;
        Ok::<_, AppError>(())
    })();
    Some(match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(&32000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&0i16.to_le_bytes());
        wav
    }

    #[test]
    fn speech_helper_validates_pcm_bounds_and_exact_header_without_temporary_files() {
        assert_eq!(&*pcm_samples(&wav()).unwrap(), &[0.0]);
        for offset in [0, 4, 8, 16, 20, 22, 24, 28, 32, 34, 36, 40] {
            let mut corrupted = wav();
            corrupted[offset] ^= 1;
            assert!(pcm_samples(&corrupted).is_err(), "{offset}");
        }
        assert!(pcm_samples(&[]).is_err());
        let mut truncated = wav();
        truncated.pop();
        assert!(pcm_samples(&truncated).is_err());
        assert_eq!(size_of::<Options>(), 72);
        assert_eq!(size_of::<RecognizerConfig>(), 80);
    }
}
